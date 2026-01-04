import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readHashIndex } from '@/server/jobs/hashIndex';
import { jobDir, jobPdfPath } from '@/server/jobs/jobPaths';
import { globalJobStore } from '@/server/jobs/jobStore';
import { POST } from './route';

mock.module('@/server/pdf/runner', () => ({ runPdfExtractionJob: mock(async () => {}) }));

function makeReadableStreamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(bytes);
            controller.close();
        },
    });
}

describe('POST /api/upload-url', () => {
    const createdDirs: string[] = [];
    const createdHashRecords: string[] = [];
    const originalEnv = process.env.SWISSAWA_MAX_UPLOAD_BYTES;

    beforeEach(() => {
        mock.restore();
        globalJobStore.delete('noop');
    });

    afterEach(async () => {
        if (typeof originalEnv === 'string') {
            process.env.SWISSAWA_MAX_UPLOAD_BYTES = originalEnv;
        } else {
            delete process.env.SWISSAWA_MAX_UPLOAD_BYTES;
        }
        for (const p of createdHashRecords) {
            await fsp.rm(p, { force: true });
        }
        for (const d of createdDirs) {
            await fsp.rm(d, { force: true, recursive: true });
        }
    });

    it('should return 400 for invalid url', async () => {
        const req = new Request('http://localhost/api/upload-url', {
            body: JSON.stringify({ url: 'not-a-url' }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });
        const res = await POST(req);
        expect(res.status).toBe(400);
    });

    it('should download, hash, create a job, and return jobId', async () => {
        const pdfBytes = new TextEncoder().encode(`%PDF-1.7 fake ${randomUUID()}`);
        const pdfSha = createHash('sha256').update(pdfBytes).digest('hex');
        createdHashRecords.push(path.join(os.tmpdir(), 'swissawa', 'by-hash', `${pdfSha}.json`));

        const fetchMock = mock(async () => {
            return new Response(makeReadableStreamFromBytes(pdfBytes), {
                headers: { 'content-type': 'application/pdf' },
                status: 200,
            });
        });
        // @ts-expect-error - test env
        global.fetch = fetchMock;

        const req = new Request('http://localhost/api/upload-url', {
            body: JSON.stringify({ url: 'https://example.com/file.pdf' }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });

        const res = await POST(req);
        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect(typeof body.jobId).toBe('string');
        expect(body.sha256).toBe(pdfSha);
        expect(body.reused).toBe(false);

        const pdfPath = jobPdfPath(body.jobId);
        createdDirs.push(jobDir(body.jobId));
        const onDisk = await fsp.readFile(pdfPath);
        expect(onDisk.length).toBe(pdfBytes.length);

        const record = await readHashIndex(pdfSha);
        expect(record?.jobId).toBe(body.jobId);
        expect(globalJobStore.get(body.jobId)).toBeTruthy();
    });

    it('should reuse existing hash index entry for identical bytes', async () => {
        const pdfBytes = new TextEncoder().encode(`%PDF-1.7 fake ${randomUUID()}`);
        const pdfSha = createHash('sha256').update(pdfBytes).digest('hex');
        createdHashRecords.push(path.join(os.tmpdir(), 'swissawa', 'by-hash', `${pdfSha}.json`));

        // First upload: create job
        const fetchMock = mock(async () => {
            return new Response(makeReadableStreamFromBytes(pdfBytes), {
                headers: { 'content-type': 'application/pdf' },
                status: 200,
            });
        });
        // @ts-expect-error - test env
        global.fetch = fetchMock;

        const req1 = new Request('http://localhost/api/upload-url', {
            body: JSON.stringify({ url: 'https://example.com/a.pdf' }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });
        const res1 = await POST(req1);
        const body1 = (await res1.json()) as any;
        createdDirs.push(jobDir(body1.jobId));

        // Second upload: should reuse
        const req2 = new Request('http://localhost/api/upload-url', {
            body: JSON.stringify({ url: 'https://example.com/b.pdf' }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });
        const res2 = await POST(req2);
        expect(res2.status).toBe(200);
        const body2 = (await res2.json()) as any;
        expect(body2.reused).toBe(true);
        expect(body2.jobId).toBe(body1.jobId);
        expect(body2.sha256).toBe(pdfSha);
    });

    it('should return 413 when remote file exceeds max bytes', async () => {
        process.env.SWISSAWA_MAX_UPLOAD_BYTES = '4';
        const fetchMock = mock(async () => {
            return new Response(makeReadableStreamFromBytes(new Uint8Array([1, 2, 3, 4, 5])), {
                headers: { 'content-type': 'application/pdf' },
                status: 200,
            });
        });
        // @ts-expect-error - test env
        global.fetch = fetchMock;

        const req = new Request('http://localhost/api/upload-url', {
            body: JSON.stringify({ url: 'https://example.com/too-big.pdf' }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });
        const res = await POST(req);
        expect(res.status).toBe(413);
    });
});
