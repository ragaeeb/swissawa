import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { POST } from './route';

const testContext = {
    createJobResult: { jobId: 'job-1', reused: false, sha256: 'abc' },
    fetchBody: new TextEncoder().encode('%PDF-1.7 UT'),
    fetchContentType: 'application/pdf',
    fetchOk: true,
    signedUrl: 'https://files.example.com/file.pdf',
    throwSignedUrl: false,
};

mock.module('uploadthing/server', () => ({
    UTApi: class {
        async generateSignedURL(_key: string) {
            if (testContext.throwSignedUrl) {
                throw new Error('signed-url-failed');
            }
            return { ufsUrl: testContext.signedUrl };
        }
    },
}));

mock.module('@/server/jobs/createJobFromPdfBytes', () => ({
    createJobFromPdfBytes: mock(async () => testContext.createJobResult),
}));

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(bytes);
            controller.close();
        },
    });
}

describe('POST /api/uploadthing/ingest', () => {
    beforeEach(() => {
        testContext.fetchOk = true;
        testContext.fetchContentType = 'application/pdf';
        testContext.fetchBody = new TextEncoder().encode('%PDF-1.7');
        testContext.throwSignedUrl = false;
    });

    afterEach(() => {
        mock.restore();
    });

    it('returns 400 for missing key', async () => {
        const req = new Request('http://localhost/api/uploadthing/ingest', {
            body: JSON.stringify({}),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });
        const res = await POST(req);
        expect(res.status).toBe(400);
    });

    it('returns 400 when fetched file is not pdf', async () => {
        testContext.fetchContentType = 'image/png';
        // @ts-expect-error test mock
        global.fetch = mock(async () => {
            return new Response(streamFromBytes(testContext.fetchBody), {
                headers: { 'content-type': testContext.fetchContentType },
                status: 200,
            });
        });

        const req = new Request('http://localhost/api/uploadthing/ingest', {
            body: JSON.stringify({ key: 'file-key' }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });
        const res = await POST(req);
        expect(res.status).toBe(400);
    });

    it('returns 200 with job payload on success', async () => {
        // @ts-expect-error test mock
        global.fetch = mock(async () => {
            return new Response(streamFromBytes(testContext.fetchBody), {
                headers: { 'content-type': testContext.fetchContentType },
                status: 200,
            });
        });

        const req = new Request('http://localhost/api/uploadthing/ingest', {
            body: JSON.stringify({ key: 'file-key' }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
        });
        const res = await POST(req);
        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect(body.jobId).toBe(testContext.createJobResult.jobId);
    });
});
