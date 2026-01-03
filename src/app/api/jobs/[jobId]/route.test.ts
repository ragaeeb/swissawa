import { describe, expect, it } from 'bun:test';
import { globalJobStore } from '@/server/jobs/jobStore';
import { GET } from './route';

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
