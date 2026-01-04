import { describe, expect, it } from 'bun:test';
import { globalJobStore } from '@/server/jobs/jobStore';
import { emitOcrComplete, emitOcrProgress } from '@/server/ocr/ocrEventBus';
import { GET } from './route';

describe('GET /api/jobs/[jobId]/ocr/events', () => {
    it('should return 404 if job not found', async () => {
        const jobId = 'missing-ocr-sse';
        const request = new Request(`http://localhost/api/jobs/${jobId}/ocr/events`);
        const response = await GET(request, { params: Promise.resolve({ jobId }) });
        const data = await response.json();
        expect(response.status).toBe(404);
        expect(data.error).toBe('Job not found');
    });

    it('should stream progress and complete', async () => {
        const jobId = 'test-ocr-sse';
        globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir: '/tmp/out',
            pdfPath: '/tmp/in.pdf',
            progress: { extractedPages: 0, totalPages: 10 },
            status: 'complete',
        });

        const request = new Request(`http://localhost/api/jobs/${jobId}/ocr/events`);
        const response = await GET(request, { params: Promise.resolve({ jobId }) });
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8');

        const reader = response.body?.getReader();
        expect(reader).toBeDefined();
        if (!reader) {
            return;
        }

        const { value: v1 } = await reader.read();
        const s1 = new TextDecoder().decode(v1);
        expect(s1).toContain('event: snapshot');

        setTimeout(() => {
            emitOcrProgress(jobId, { currentPage: 1, line: 'Processing page 1 of 3...', totalPages: 3 });
        }, 10);

        const { value: v2 } = await reader.read();
        const s2 = new TextDecoder().decode(v2);
        expect(s2).toContain('event: progress');
        expect(s2).toContain('"currentPage":1');

        setTimeout(() => {
            emitOcrComplete(jobId);
        }, 10);

        const { value: v3 } = await reader.read();
        const s3 = new TextDecoder().decode(v3);
        expect(s3).toContain('event: complete');

        const { done } = await reader.read();
        expect(done).toBe(true);
    });

    it('should immediately complete if OCR already finished when SSE connects', async () => {
        const jobId = 'test-ocr-sse-immediate';
        globalJobStore.create({
            id: jobId,
            info: undefined,
            ocr: { status: 'complete', updatedAtMs: Date.now() },
            outputDir: '/tmp/out',
            pdfPath: '/tmp/in.pdf',
            progress: { extractedPages: 10, totalPages: 10 },
            status: 'complete',
        });

        const request = new Request(`http://localhost/api/jobs/${jobId}/ocr/events`);
        const response = await GET(request, { params: Promise.resolve({ jobId }) });
        expect(response.status).toBe(200);

        const reader = response.body?.getReader();
        expect(reader).toBeDefined();
        if (!reader) {
            return;
        }

        // Should get snapshot then immediately complete (no need to emit events).
        const { value: v1 } = await reader.read();
        const s1 = new TextDecoder().decode(v1);
        expect(s1).toContain('event: snapshot');
        expect(s1).toContain('"status":"complete"');

        const { value: v2 } = await reader.read();
        const s2 = new TextDecoder().decode(v2);
        expect(s2).toContain('event: complete');

        const { done } = await reader.read();
        expect(done).toBe(true);
    });
});
