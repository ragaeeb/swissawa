import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import { readHashIndex, writeHashIndex } from '@/server/jobs/hashIndex';
import { jobDir } from '@/server/jobs/jobPaths';
import { globalJobStore } from '@/server/jobs/jobStore';
import { DELETE, GET } from './route';

describe('GET /api/jobs/[jobId]', () => {
    it('should return 404 if job not found', async () => {
        const request = new Request('http://localhost/api/jobs/missing');
        const response = await GET(request, { params: Promise.resolve({ jobId: 'missing' }) });
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.error).toBe('Job not found');
    });

    it('should return job status', async () => {
        const jobId = 'test-job-1';
        globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir: '/tmp/out',
            pdfPath: '/tmp/in.pdf',
            progress: { extractedPages: 0, totalPages: 10 },
            status: 'processing',
        });

        const request = new Request(`http://localhost/api/jobs/${jobId}`);
        const response = await GET(request, { params: Promise.resolve({ jobId }) });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.job.id).toBe(jobId);
        expect(data.images).toBeUndefined();
    });

    it('should return 409 if pages requested but not available', async () => {
        const jobId = 'test-job-no-pages';
        globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir: '/tmp/out',
            pdfPath: '/tmp/in.pdf',
            progress: { extractedPages: 0, totalPages: undefined },
            status: 'uploaded',
        });

        const request = new Request(`http://localhost/api/jobs/${jobId}?from=1&to=5`);
        const response = await GET(request, { params: Promise.resolve({ jobId }) });
        const data = await response.json();

        expect(response.status).toBe(409);
        expect(data.error).toBe('PDF page count not available yet');
    });

    it('should return images range', async () => {
        const jobId = 'test-job-images';
        globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir: '/tmp/out',
            pdfPath: '/tmp/in.pdf',
            progress: { extractedPages: 5, totalPages: 100 },
            status: 'processing',
        });

        const request = new Request(`http://localhost/api/jobs/${jobId}?from=1&to=3`);
        const response = await GET(request, { params: Promise.resolve({ jobId }) });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.images).toHaveLength(3);
        expect(data.images[0].pageNumber).toBe(1);
        expect(data.images[2].pageNumber).toBe(3);
        expect(data.images[0].url).toContain(`/api/jobs/${jobId}/images/1`);
    });

    it('should handle default range if parameters are missing some values', async () => {
        const jobId = 'test-job-range-defaults';
        globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir: '/tmp/out',
            pdfPath: '/tmp/in.pdf',
            progress: { extractedPages: 0, totalPages: 10 },
            status: 'processing',
        });

        const request = new Request(`http://localhost/api/jobs/${jobId}?from=8`);
        const response = await GET(request, { params: Promise.resolve({ jobId }) });
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.images).toHaveLength(3); // 8, 9, 10
        expect(data.images[0].pageNumber).toBe(8);
        expect(data.images[2].pageNumber).toBe(10);
    });

    it('should handle invalid parseIntParam gracefully', async () => {
        const jobId = 'test-job-invalid-param';
        globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir: '/tmp/out',
            pdfPath: '/tmp/in.pdf',
            progress: { extractedPages: 0, totalPages: 10 },
            status: 'processing',
        });

        const request = new Request(`http://localhost/api/jobs/${jobId}?from=abc`);
        const response = await GET(request, { params: Promise.resolve({ jobId }) });
        const data = await response.json();

        // from=abc -> parseIntParam returns null -> defaults to 1 (if to is provided)
        // Actually if both are null (from=abc and to=null), it returns just the job.
        expect(response.status).toBe(200);
        expect(data.images).toBeUndefined();
    });
});

describe('DELETE /api/jobs/[jobId]', () => {
    it('deletes the job dir, removes hash index entry, and evicts the in-memory job', async () => {
        const jobId = randomUUID();
        const hash = 'e'.repeat(64);

        // Create a fake job dir to delete
        const dir = jobDir(jobId);
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(`${dir}/input.pdf`, 'fake', 'utf8');

        // Create hash index entry
        await writeHashIndex({ createdAtMs: Date.now(), hash, jobId });
        expect(await readHashIndex(hash)).not.toBeNull();

        // Create an in-memory job
        globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir: `${dir}/images`,
            pdfPath: `${dir}/input.pdf`,
            progress: { extractedPages: 0, totalPages: 1 },
            status: 'uploaded',
        });
        expect(globalJobStore.get(jobId)).not.toBeUndefined();

        const request = new Request(`http://localhost/api/jobs/${jobId}`, { method: 'DELETE' });
        const response = await DELETE(request, { params: Promise.resolve({ jobId }) });
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.ok).toBe(true);
        expect(data.deletedHashes).toEqual([hash]);

        // In-memory job removed
        expect(globalJobStore.get(jobId)).toBeUndefined();

        // Hash index removed
        expect(await readHashIndex(hash)).toBeNull();

        // Dir removed
        await expect(fsp.stat(dir)).rejects.toBeTruthy();
    });
});
