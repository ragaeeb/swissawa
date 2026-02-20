import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { jobDir, jobImagesDir, jobPdfPath } from '@/server/jobs/jobPaths';
import { globalJobStore } from '@/server/jobs/jobStore';
import { jobOcrMetaPath, jobOcrPagesDir } from '@/server/ocr/ocrPaths';
import { GET } from './route';

describe('GET /api/jobs/[jobId]/ocr/pages', () => {
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
            progress: { extractedPages: 0, totalPages: 2 },
            status: 'complete',
        });
    });

    afterEach(async () => {
        globalJobStore.delete(jobId);
        await fsp.rm(jobDir(jobId), { force: true, recursive: true });
    });

    it('should return 404 when pages dir is missing', async () => {
        const req = new Request(`http://localhost/api/jobs/${jobId}/ocr/pages`);
        const res = await GET(req, { params: Promise.resolve({ jobId }) });
        expect(res.status).toBe(404);
    });

    it('should return sorted pages when json files exist', async () => {
        await fsp.mkdir(jobOcrPagesDir(jobId), { recursive: true });
        await fsp.writeFile(jobOcrMetaPath(jobId), JSON.stringify({ dpi: { x: 330, y: 330 }, totalPages: 2 }), 'utf8');
        await fsp.writeFile(
            path.join(jobOcrPagesDir(jobId), '2.json'),
            JSON.stringify({
                height: 100,
                observations: [{ bbox: { height: 1, width: 1, x: 0, y: 0 }, text: 'b' }],
                page: 2,
                width: 100,
            }),
            'utf8',
        );
        await fsp.writeFile(
            path.join(jobOcrPagesDir(jobId), '1.json'),
            JSON.stringify({
                height: 100,
                observations: [{ bbox: { height: 1, width: 1, x: 0, y: 0 }, text: 'a' }],
                page: 1,
                width: 100,
            }),
            'utf8',
        );

        const req = new Request(`http://localhost/api/jobs/${jobId}/ocr/pages`);
        const res = await GET(req, { params: Promise.resolve({ jobId }) });
        expect(res.status).toBe(200);

        const data = (await res.json()) as { dpi?: { x: number; y: number }; pages: Array<{ page: number }> };
        expect(data.pages.length).toBe(2);
        expect(data.pages[0]?.page).toBe(1);
        expect(data.pages[1]?.page).toBe(2);
        expect(data.dpi).toEqual({ x: 330, y: 330 });
    });
});
