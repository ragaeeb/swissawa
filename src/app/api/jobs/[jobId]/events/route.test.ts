import { afterEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import { jobDir, jobImagesDir, jobPdfPath } from '@/server/jobs/jobPaths';
import { writeJobSnapshot } from '@/server/jobs/jobSnapshot';
import { globalJobStore } from '@/server/jobs/jobStore';
import { GET } from './route';

describe('GET /api/jobs/[jobId]/events', () => {
    const createdJobIds: string[] = [];
    it('should return 404 if job not found', async () => {
        const jobId = 'missing-sse';
        const request = new Request(`http://localhost/api/jobs/${jobId}/events`);
        const response = await GET(request, { params: Promise.resolve({ jobId }) });
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.error).toBe('Job not found');
    });

    it('should stream events successfully', async () => {
        const jobId = 'test-sse';
        const job = globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir: '/tmp/out',
            pdfPath: '/tmp/in.pdf',
            progress: { extractedPages: 0, totalPages: 10 },
            status: 'processing',
        });

        const bus = globalJobStore.bus(jobId)!;
        const request = new Request(`http://localhost/api/jobs/${jobId}/events`);
        const response = await GET(request, { params: Promise.resolve({ jobId }) });

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8');

        const reader = response.body?.getReader();
        expect(reader).toBeDefined();

        if (reader) {
            // 1. Initial snapshot
            const { value: v1 } = await reader.read();
            const s1 = new TextDecoder().decode(v1);
            expect(s1).toContain('event: snapshot');
            expect(s1).toContain(`"id":"${jobId}"`);

            // 2. Progress event
            setTimeout(() => {
                bus.emit('progress', { extractedPages: 1, totalPages: 10 });
            }, 10);

            const { value: v2 } = await reader.read();
            const s2 = new TextDecoder().decode(v2);
            expect(s2).toContain('event: progress');
            expect(s2).toContain('"extractedPages":1');

            // 3. Complete event
            setTimeout(() => {
                bus.emit('complete', { ...job, status: 'complete' });
            }, 10);

            const { value: v3 } = await reader.read();
            const s3 = new TextDecoder().decode(v3);
            expect(s3).toContain('event: complete');
            expect(s3).toContain('"status":"complete"');

            // The stream should be closed after complete
            const { done } = await reader.read();
            expect(done).toBe(true);
        }
    });

    it('should stream error event and closes', async () => {
        const jobId = 'test-sse-error';
        globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir: '/tmp/out',
            pdfPath: '/tmp/in.pdf',
            progress: { extractedPages: 0, totalPages: 10 },
            status: 'processing',
        });

        const bus = globalJobStore.bus(jobId)!;
        const request = new Request(`http://localhost/api/jobs/${jobId}/events`);
        const response = await GET(request, { params: Promise.resolve({ jobId }) });

        const reader = response.body?.getReader();
        if (reader) {
            // Skip snapshot
            await reader.read();

            // Emit error
            setTimeout(() => {
                bus.emit('error', 'Something went wrong');
            }, 10);

            const { value: v2 } = await reader.read();
            const s2 = new TextDecoder().decode(v2);
            expect(s2).toContain('event: error');
            expect(s2).toContain('"message":"Something went wrong"');

            const { done } = await reader.read();
            expect(done).toBe(true);
        }
    });

    it('should sent heartbeat', async () => {
        const jobId = 'test-sse-heartbeat';
        globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir: '/tmp/out',
            pdfPath: '/tmp/in.pdf',
            progress: { extractedPages: 0, totalPages: 10 },
            status: 'processing',
        });

        // Speed up heartbeat for test
        const originalSetInterval = global.setInterval;
        global.setInterval = ((cb: any, _ms: number) => originalSetInterval(cb, 10)) as any;

        try {
            const request = new Request(`http://localhost/api/jobs/${jobId}/events`);
            const response = await GET(request, { params: Promise.resolve({ jobId }) });
            const reader = response.body?.getReader();
            if (reader) {
                await reader.read(); // snapshot
                const { value } = await reader.read(); // heartbeat
                const s = new TextDecoder().decode(value);
                expect(s).toBe(':\n\n');
                await reader.cancel();
            }
        } finally {
            global.setInterval = originalSetInterval;
        }
    });

    it('should cleanup on cancel', async () => {
        const jobId = 'test-sse-cleanup';
        globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir: '/tmp/out',
            pdfPath: '/tmp/in.pdf',
            progress: { extractedPages: 0, totalPages: 10 },
            status: 'processing',
        });

        const bus = globalJobStore.bus(jobId)!;
        const request = new Request(`http://localhost/api/jobs/${jobId}/events`);
        const response = await GET(request, { params: Promise.resolve({ jobId }) });
        const reader = response.body?.getReader();

        if (reader) {
            await reader.read(); // snapshot
            await reader.cancel();

            // After cancel, emitting events should not cause any issues (bus listeners removed)
            expect(() => bus.emit('progress', { extractedPages: 1, totalPages: 10 })).not.toThrow();
        }
    });

    it('should recover from snapshot if job store was reset (dev HMR regression)', async () => {
        const jobId = randomUUID();
        createdJobIds.push(jobId);
        await fsp.mkdir(jobDir(jobId), { recursive: true });
        await fsp.writeFile(jobPdfPath(jobId), '%PDF-1.7 fake', 'utf8');

        const job = globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir: jobImagesDir(jobId),
            pdfPath: jobPdfPath(jobId),
            progress: { extractedPages: 0, totalPages: 10 },
            status: 'processing',
        });
        await writeJobSnapshot(job);

        // Simulate store reset
        globalJobStore.delete(jobId);

        const request = new Request(`http://localhost/api/jobs/${jobId}/events`);
        const response = await GET(request, { params: Promise.resolve({ jobId }) });

        expect(response.status).toBe(200);
        const reader = response.body?.getReader();
        expect(reader).toBeDefined();
        if (!reader) {
            return;
        }
        const { value } = await reader.read();
        const s = new TextDecoder().decode(value);
        expect(s).toContain('event: snapshot');
        expect(s).toContain(`"id":"${jobId}"`);
        await reader.cancel();
    });

    afterEach(async () => {
        for (const id of createdJobIds.splice(0)) {
            globalJobStore.delete(id);
            await fsp.rm(jobDir(id), { force: true, recursive: true });
        }
    });
});
