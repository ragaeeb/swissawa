import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { writeCropBox } from '@/server/crop/cropStore';
import { jobDir, jobImagesDir, jobPdfPath } from '@/server/jobs/jobPaths';
import { globalJobStore } from '@/server/jobs/jobStore';
import { GET } from './route';

describe('GET /api/jobs/[jobId]/download', () => {
    it('returns original PDF when no crop exists', async () => {
        const jobId = randomUUID();
        const pdf = await PDFDocument.create();
        pdf.addPage([200, 400]);
        const bytes = await pdf.save();

        await fsp.mkdir(jobDir(jobId), { recursive: true });
        await fsp.writeFile(jobPdfPath(jobId), bytes);
        globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir: jobImagesDir(jobId),
            pdfPath: jobPdfPath(jobId),
            progress: { extractedPages: 0, totalPages: 1 },
            status: 'uploaded',
        });

        const res = await GET(new Request(`http://localhost/api/jobs/${jobId}/download`), {
            params: Promise.resolve({ jobId }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/pdf');

        const out = new Uint8Array(await res.arrayBuffer());
        const loaded = await PDFDocument.load(out);
        const page = loaded.getPages()[0];
        const { width, height } = page.getSize();
        expect(width).toBeCloseTo(200, 6);
        expect(height).toBeCloseTo(400, 6);

        await fsp.rm(jobDir(jobId), { force: true, recursive: true });
    });

    it('returns cropped PDF when crop exists', async () => {
        const jobId = randomUUID();
        const pdf = await PDFDocument.create();
        pdf.addPage([200, 400]);
        const bytes = await pdf.save();

        await fsp.mkdir(jobDir(jobId), { recursive: true });
        await fsp.writeFile(jobPdfPath(jobId), bytes);
        globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir: jobImagesDir(jobId),
            pdfPath: jobPdfPath(jobId),
            progress: { extractedPages: 0, totalPages: 1 },
            status: 'uploaded',
        });

        // width = 0.5*200 = 100, height = 0.25*400 = 100
        await writeCropBox(jobId, { height: 0.25, width: 0.5, x: 0.1, y: 0.2 });

        const res = await GET(new Request(`http://localhost/api/jobs/${jobId}/download`), {
            params: Promise.resolve({ jobId }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('application/pdf');
        expect(res.headers.get('Content-Disposition')).toContain('cropped');

        const out = new Uint8Array(await res.arrayBuffer());
        const loaded = await PDFDocument.load(out);
        const page = loaded.getPages()[0];
        const size = page.getSize();
        // Default keeps page size the same to avoid "quality looks worse" due to extra zoom in viewers.
        expect(size.width).toBeCloseTo(200, 6);
        expect(size.height).toBeCloseTo(400, 6);
        const cropBox = page.getCropBox();
        expect(cropBox.width).toBeCloseTo(100, 6);
        expect(cropBox.height).toBeCloseTo(100, 6);

        await fsp.rm(jobDir(jobId), { force: true, recursive: true });
    });

    it('can shrink page size when requested (shrink=1)', async () => {
        const jobId = randomUUID();
        const pdf = await PDFDocument.create();
        pdf.addPage([200, 400]);
        const bytes = await pdf.save();

        await fsp.mkdir(jobDir(jobId), { recursive: true });
        await fsp.writeFile(jobPdfPath(jobId), bytes);
        globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir: jobImagesDir(jobId),
            pdfPath: jobPdfPath(jobId),
            progress: { extractedPages: 0, totalPages: 1 },
            status: 'uploaded',
        });
        await writeCropBox(jobId, { height: 0.25, width: 0.5, x: 0.1, y: 0.2 });

        const res = await GET(new Request(`http://localhost/api/jobs/${jobId}/download?shrink=1`), {
            params: Promise.resolve({ jobId }),
        });
        expect(res.status).toBe(200);

        const out = new Uint8Array(await res.arrayBuffer());
        const loaded = await PDFDocument.load(out);
        const page = loaded.getPages()[0];
        const size = page.getSize();
        expect(size.width).toBeCloseTo(100, 6);
        expect(size.height).toBeCloseTo(100, 6);

        await fsp.rm(jobDir(jobId), { force: true, recursive: true });
    });
});
