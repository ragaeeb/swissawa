import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { jobDir, jobImagesDir, jobPdfPath } from '@/server/jobs/jobPaths';
import { globalJobStore } from '@/server/jobs/jobStore';
import { jobOcrPagesDir } from '@/server/ocr/ocrPaths';
import { GET } from './route';

describe('GET /api/jobs/[jobId]/ocr/pages/[page]', () => {
    let jobId = '';

    beforeEach(async () => {
        jobId = randomUUID();
        await fsp.mkdir(jobDir(jobId), { recursive: true });
        await fsp.writeFile(jobPdfPath(jobId), '%PDF-1.7 fake', 'utf8');
        globalJobStore.create({
            id: jobId,
            info: undefined,
            ocr: { status: 'complete', updatedAtMs: Date.now() },
            outputDir: jobImagesDir(jobId),
            pdfPath: jobPdfPath(jobId),
            progress: { extractedPages: 0, totalPages: 1 },
            status: 'complete',
        });
    });

    afterEach(async () => {
        globalJobStore.delete(jobId);
        await fsp.rm(jobDir(jobId), { force: true, recursive: true });
    });

    it('should return 400 for invalid page', async () => {
        const req = new Request(`http://localhost/api/jobs/${jobId}/ocr/pages/abc`);
        const res = await GET(req, { params: Promise.resolve({ jobId, page: 'abc' }) });
        expect(res.status).toBe(400);
    });

    it('should return 404 when page file is missing', async () => {
        const req = new Request(`http://localhost/api/jobs/${jobId}/ocr/pages/1`);
        const res = await GET(req, { params: Promise.resolve({ jobId, page: '1' }) });
        expect(res.status).toBe(404);
    });

    it('should stream a page json when present', async () => {
        await fsp.mkdir(jobOcrPagesDir(jobId), { recursive: true });
        await fsp.writeFile(
            path.join(jobOcrPagesDir(jobId), '1.json'),
            JSON.stringify({ observations: [], page: 1 }),
            'utf8',
        );

        const req = new Request(`http://localhost/api/jobs/${jobId}/ocr/pages/1`);
        const res = await GET(req, { params: Promise.resolve({ jobId, page: '1' }) });
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('"page":1');
    });
});
