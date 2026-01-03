import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import { hashIndexPath } from '@/server/jobs/hashIndex';
import { jobDir } from '@/server/jobs/jobPaths';
import { globalJobStore } from '@/server/jobs/jobStore';
import { POST } from './route';

interface TestContext {
    triggerFile: boolean;
    mime: string;
    failStream: boolean;
    bytes: Uint8Array;
}

const testContext: TestContext = {
    bytes: new Uint8Array([1, 2, 3]),
    failStream: false,
    mime: 'application/pdf',
    triggerFile: false,
};

// We mock the handleUploadStream function which we extracted
mock.module('./route', () => {
    const original = require('./route');
    return {
        ...original,
        handleUploadStream: mock((_body: any, _headers: any) => {
            if (testContext.failStream) {
                throw new Error('Stream error');
            }
            if (!testContext.triggerFile) {
                return Promise.resolve({ fileFound: false });
            }
            return Promise.resolve({ fileBytes: testContext.bytes, fileFound: true, fileMime: testContext.mime });
        }),
    };
});

mock.module('@/server/pdf/runner', () => ({ runPdfExtractionJob: mock(() => Promise.resolve()) }));

describe('POST /api/upload', () => {
    beforeEach(() => {
        testContext.triggerFile = false;
        testContext.mime = 'application/pdf';
        testContext.failStream = false;
        testContext.bytes = new TextEncoder().encode(`test-${Math.random()}-${Date.now()}`);
    });

    afterEach(async () => {
        // Best-effort cleanup to keep tests isolated in parallel runs.
        try {
            const sha256 = createHash('sha256').update(testContext.bytes).digest('hex');
            await fsp.rm(hashIndexPath(sha256), { force: true });
        } catch {
            // ignore
        }
    });

    it('should return 400 if not multipart/form-data', async () => {
        const request = new Request('http://localhost/api/upload', {
            body: JSON.stringify({}),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe('Expected multipart/form-data');
    });

    it('should return 400 if missing request body', async () => {
        const request = new Request('http://localhost/api/upload', {
            headers: { 'content-type': 'multipart/form-data; boundary=---' },
            method: 'POST',
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe('Missing request body');
    });

    it('should return 400 if no file uploaded', async () => {
        testContext.triggerFile = false;
        const request = new Request('http://localhost/api/upload', {
            body: 'some content',
            headers: { 'content-type': 'multipart/form-data; boundary=---' },
            method: 'POST',
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe('No file uploaded');
    });

    it('should return 400 if file is not a PDF', async () => {
        testContext.triggerFile = true;
        testContext.mime = 'image/png';

        const request = new Request('http://localhost/api/upload', {
            body: 'some content',
            headers: { 'content-type': 'multipart/form-data; boundary=---' },
            method: 'POST',
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe('Only PDF files are supported');
    });

    it('should return 500 on stream error', async () => {
        testContext.failStream = true;

        const request = new Request('http://localhost/api/upload', {
            body: 'some content',
            headers: { 'content-type': 'multipart/form-data; boundary=---' },
            method: 'POST',
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe('Stream error');
    });

    it('should return 413 if file is too large', async () => {
        // Simulate the underlying stream handler throwing the same message we surface.
        const mod = require('./route');
        mod.handleUploadStream.mockImplementationOnce(() => {
            throw new Error('File size exceeds maximum allowed size');
        });

        const request = new Request('http://localhost/api/upload', {
            body: 'some content',
            headers: { 'content-type': 'multipart/form-data; boundary=---' },
            method: 'POST',
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(413);
        expect(data.error).toBe('File size exceeds maximum allowed size');
    });

    it('should return 200 and jobId on success', async () => {
        testContext.triggerFile = true;
        testContext.mime = 'application/pdf';

        const request = new Request('http://localhost/api/upload', {
            body: 'fake pdf content',
            headers: { 'content-type': 'multipart/form-data; boundary=---' },
            method: 'POST',
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.jobId).toBeDefined();
        expect(globalJobStore.get(data.jobId)).toBeDefined();
        expect(data.sha256).toBeDefined();
        expect(data.reused).toBeFalse();

        // Cleanup job artifacts created by the upload route (input.pdf + snapshot)
        await fsp.rm(jobDir(data.jobId), { force: true, recursive: true });
        if (typeof data.sha256 === 'string') {
            await fsp.rm(hashIndexPath(data.sha256), { force: true });
        }
    });
});
