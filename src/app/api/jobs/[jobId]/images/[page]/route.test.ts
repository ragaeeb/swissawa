import { describe, expect, it, mock } from 'bun:test';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { globalJobStore } from '@/server/jobs/jobStore';
import { GET } from './route';

mock.module('@/server/pdf/imageResolve', () => ({
    resolveJobImagePath: mock(({ pageNumber }: { pageNumber: number }) => {
        if (pageNumber === 999) {
            return Promise.resolve(null);
        }
        const base = path.join(os.tmpdir(), 'swissawa-test-images');
        return Promise.resolve(path.join(base, 'page-001.jpg'));
    }),
}));

describe('GET /api/jobs/[jobId]/images/[page]', () => {
    it('should return 400 for invalid page number', async () => {
        const jobId = 'test-img';
        const request = new Request(`http://localhost/api/jobs/${jobId}/images/abc`);
        const response = await GET(request, { params: Promise.resolve({ jobId, page: 'abc' }) });

        expect(response.status).toBe(400);
        const text = await response.text();
        expect(text).toBe('Invalid page');
    });

    it('should return 400 for negative page number', async () => {
        const jobId = 'test-img';
        const request = new Request(`http://localhost/api/jobs/${jobId}/images/-1`);
        const response = await GET(request, { params: Promise.resolve({ jobId, page: '-1' }) });

        expect(response.status).toBe(400);
    });

    it('should return 404 if image not resolved', async () => {
        const jobId = 'test-img';
        const request = new Request(`http://localhost/api/jobs/${jobId}/images/999`);
        const response = await GET(request, { params: Promise.resolve({ jobId, page: '999' }) });

        expect(response.status).toBe(404);
        const text = await response.text();
        expect(text).toBe('Not found');
    });

    it('should serve image successfully', async () => {
        const jobId = 'test-img-success';
        const base = path.join(os.tmpdir(), 'swissawa-test-images');
        await fsp.mkdir(base, { recursive: true });
        await fsp.writeFile(path.join(base, 'page-001.jpg'), 'fake-image-data', 'utf8');

        globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir: '/tmp/out',
            pdfPath: '/tmp/in.pdf',
            progress: { extractedPages: 10, totalPages: 10 },
            status: 'complete',
        });

        const request = new Request(`http://localhost/api/jobs/${jobId}/images/1`);
        const response = await GET(request, { params: Promise.resolve({ jobId, page: '1' }) });

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('image/jpeg');
        expect(response.headers.get('Cache-Control')).toContain('immutable');

        const blob = await response.blob();
        expect(blob.size).toBeGreaterThan(0);
        const text = await blob.text();
        expect(text).toBe('fake-image-data');

        await fsp.rm(base, { force: true, recursive: true });
    });
});
