import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { jobDir, jobImagesDir, jobPdfPath } from '@/server/jobs/jobPaths';
import { globalJobStore } from '@/server/jobs/jobStore';
import { jobOcrDir, jobOcrJsonPath } from '@/server/ocr/ocrPaths';
import { GET, POST } from './route';

mock.module('@/server/ocr/runMacOcr', () => ({
    runMacOcr: mock(async ({ jobId, store }: { jobId: string; store: any }) => {
        store.update(jobId, (j: any) => {
            j.ocr = { language: 'ar-SA', status: 'complete', updatedAtMs: Date.now() };
        });
        await fsp.mkdir(jobOcrDir(jobId), { recursive: true });
        await fsp.writeFile(jobOcrJsonPath(jobId), JSON.stringify({ dpi: { x: 300, y: 300 }, pages: [] }), 'utf8');
    }),
}));

describe('GET/POST /api/jobs/[jobId]/ocr', () => {
    let jobId = '';

    async function waitForAsync(predicate: () => Promise<boolean>, timeoutMs = 250): Promise<void> {
        const start = Date.now();
        while (!(await predicate())) {
            if (Date.now() - start > timeoutMs) {
                throw new Error('waitForAsync: timeout');
            }
            await new Promise((r) => setTimeout(r, 1));
        }
    }

    beforeEach(async () => {
        jobId = randomUUID();
        await fsp.mkdir(jobDir(jobId), { recursive: true });
        await fsp.writeFile(jobPdfPath(jobId), '%PDF-1.7 fake', 'utf8');
        globalJobStore.create({
            id: jobId,
            info: undefined,
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

    it('should return idle when no OCR has run yet', async () => {
        const req = new Request(`http://localhost/api/jobs/${jobId}/ocr`);
        const res = await GET(req, { params: Promise.resolve({ jobId }) });
        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect(body.status).toBe('idle');
    });

    it('should run OCR on POST and return status', async () => {
        const req = new Request(`http://localhost/api/jobs/${jobId}/ocr`, { method: 'POST' });
        const res = await POST(req, { params: Promise.resolve({ jobId }) });
        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect(body.status).toBe('running');

        // Ensure background OCR finishes before test cleanup (prevents noisy logs).
        await waitForAsync(async () => {
            try {
                await fsp.stat(jobOcrJsonPath(jobId));
                return true;
            } catch {
                return false;
            }
        });
    });

    it('should return delivery when complete', async () => {
        // Arrange: create ocr output and mark complete
        await fsp.mkdir(jobOcrDir(jobId), { recursive: true });
        await fsp.writeFile(jobOcrJsonPath(jobId), JSON.stringify({ dpi: { x: 300, y: 300 }, pages: [] }), 'utf8');
        globalJobStore.update(jobId, (j) => {
            j.ocr = { language: 'ar-SA', status: 'complete', updatedAtMs: Date.now() };
        });

        const req = new Request(`http://localhost/api/jobs/${jobId}/ocr`);
        const res = await GET(req, { params: Promise.resolve({ jobId }) });
        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect(body.status).toBe('complete');
        expect(['inline', 'file', 'pages']).toContain(body.delivery.kind);
    });

    it('should return pages delivery when pages dir exists and file is large', async () => {
        await fsp.mkdir(path.join(jobOcrDir(jobId), 'pages'), { recursive: true });
        await fsp.writeFile(path.join(jobOcrDir(jobId), 'pages', '1.json'), JSON.stringify({ page: 1 }), 'utf8');
        // create a > threshold file
        await fsp.writeFile(jobOcrJsonPath(jobId), 'x'.repeat(2_000_000), 'utf8');
        await fsp.writeFile(
            path.join(jobOcrDir(jobId), 'meta.json'),
            JSON.stringify({ dpi: { x: 300, y: 300 }, totalPages: 1 }),
            'utf8',
        );
        globalJobStore.update(jobId, (j) => {
            j.ocr = { language: 'ar-SA', status: 'complete', updatedAtMs: Date.now() };
        });

        const req = new Request(`http://localhost/api/jobs/${jobId}/ocr`);
        const res = await GET(req, { params: Promise.resolve({ jobId }) });
        const body = (await res.json()) as any;
        expect(body.delivery.kind).toBe('pages');
    });
});
