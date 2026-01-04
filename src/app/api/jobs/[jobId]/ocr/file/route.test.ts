import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import { jobDir, jobImagesDir, jobPdfPath } from '@/server/jobs/jobPaths';
import { globalJobStore } from '@/server/jobs/jobStore';
import { jobOcrDir, jobOcrJsonPath } from '@/server/ocr/ocrPaths';
import { GET } from './route';

describe('GET /api/jobs/[jobId]/ocr/file', () => {
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

    it('should return 404 when OCR file is missing', async () => {
        const req = new Request(`http://localhost/api/jobs/${jobId}/ocr/file`);
        const res = await GET(req, { params: Promise.resolve({ jobId }) });
        expect(res.status).toBe(404);
    });

    it('should stream the OCR json when present', async () => {
        await fsp.mkdir(jobOcrDir(jobId), { recursive: true });
        await fsp.writeFile(jobOcrJsonPath(jobId), JSON.stringify({ ok: true }), 'utf8');

        const req = new Request(`http://localhost/api/jobs/${jobId}/ocr/file`);
        const res = await GET(req, { params: Promise.resolve({ jobId }) });
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('application/json');
        const text = await res.text();
        expect(text).toContain('"ok":true');
    });
});
