import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { jobDir, jobImagesDir, jobPdfPath } from '@/server/jobs/jobPaths';
import { globalJobStore } from '@/server/jobs/jobStore';
import { jobSuryaPagesDir } from '@/server/ocr/ocrPaths';
import { GET } from './route';

describe('GET /api/jobs/[jobId]/surya/pages', () => {
    let jobId = '';

    beforeEach(async () => {
        jobId = randomUUID();
        await fsp.mkdir(jobDir(jobId), { recursive: true });
        await fsp.writeFile(jobPdfPath(jobId), '%PDF-1.7 fake', 'utf8');
        globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir: jobImagesDir(jobId),
            pdfPath: jobPdfPath(jobId),
            progress: { extractedPages: 0, totalPages: 2 },
            status: 'complete',
            suryaOcr: { status: 'complete', updatedAtMs: Date.now() },
        });
    });

    afterEach(async () => {
        globalJobStore.delete(jobId);
        await fsp.rm(jobDir(jobId), { force: true, recursive: true });
    });

    it('should return 404 when pages dir is missing', async () => {
        const req = new Request(`http://localhost/api/jobs/${jobId}/surya/pages`);
        const res = await GET(req, { params: Promise.resolve({ jobId }) });
        expect(res.status).toBe(404);
    });

    it('should return sorted pages when json files exist', async () => {
        await fsp.mkdir(jobSuryaPagesDir(jobId), { recursive: true });
        await fsp.writeFile(
            path.join(jobSuryaPagesDir(jobId), '2.json'),
            JSON.stringify({
                height: 100,
                observations: [{ bbox: { height: 1, width: 1, x: 0, y: 0 }, text: 'b' }],
                page: 2,
                width: 100,
            }),
            'utf8',
        );
        await fsp.writeFile(
            path.join(jobSuryaPagesDir(jobId), '1.json'),
            JSON.stringify({
                height: 100,
                observations: [{ bbox: { height: 1, width: 1, x: 0, y: 0 }, text: 'a' }],
                page: 1,
                width: 100,
            }),
            'utf8',
        );

        const req = new Request(`http://localhost/api/jobs/${jobId}/surya/pages`);
        const res = await GET(req, { params: Promise.resolve({ jobId }) });
        expect(res.status).toBe(200);

        const data = (await res.json()) as { pages: Array<{ page: number }> };
        expect(data.pages.length).toBe(2);
        expect(data.pages[0]?.page).toBe(1);
        expect(data.pages[1]?.page).toBe(2);
    });
});
