import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { globalJobStore } from '@/server/jobs/jobStore';
import { POST } from './route';

// Mock dependencies
mock.module('node:fs/promises', () => ({ default: { mkdir: mock(() => Promise.resolve()) } }));

// We mock the handleUploadStream function which we extracted
mock.module('./route', () => {
    const original = require('./route');
    return {
        ...original,
        handleUploadStream: mock((_body: any, _headers: any, _pdfPath: string) => {
            if (global.__TEST_FAIL_STREAM__) {
                throw new Error('Stream error');
            }
            if (!global.__TEST_TRIGGER_BUSBOY_FILE__) {
                return Promise.resolve({ fileFound: false });
            }
            return Promise.resolve({
                fileFound: true,
                fileMime: global.__TEST_MIME__ || 'application/pdf',
                fileWritePromise: Promise.resolve(),
            });
        }),
    };
});

mock.module('@/server/pdf/runner', () => ({ runPdfExtractionJob: mock(() => Promise.resolve()) }));

declare global {
    var __TEST_TRIGGER_BUSBOY_FILE__: boolean;
    var __TEST_MIME__: string;
    var __TEST_FAIL_STREAM__: boolean;
}

describe('POST /api/upload', () => {
    beforeEach(() => {
        global.__TEST_TRIGGER_BUSBOY_FILE__ = false;
        global.__TEST_MIME__ = 'application/pdf';
        global.__TEST_FAIL_STREAM__ = false;
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
        global.__TEST_TRIGGER_BUSBOY_FILE__ = false;
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
        global.__TEST_TRIGGER_BUSBOY_FILE__ = true;
        global.__TEST_MIME__ = 'image/png';

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
        global.__TEST_FAIL_STREAM__ = true;

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

    it('should return 200 and jobId on success', async () => {
        global.__TEST_TRIGGER_BUSBOY_FILE__ = true;
        global.__TEST_MIME__ = 'application/pdf';

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
    });
});
