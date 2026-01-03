import { describe, expect, it } from 'bun:test';
import { PDFDocument } from 'pdf-lib';
import { cropPdfBytes } from '@/server/pdf/cropPdf';

describe('cropPdfBytes', () => {
    it('sets CropBox/TrimBox based on normalized CropBox (0..1, top-left) without changing page size by default', async () => {
        const pdf = await PDFDocument.create();
        pdf.addPage([200, 400]); // width, height
        const bytes = await pdf.save();

        const out = await cropPdfBytes(bytes, { height: 0.25, width: 0.5, x: 0.1, y: 0.2 });
        const cropped = await PDFDocument.load(out);
        const page = cropped.getPages()[0];
        const size = page.getSize();

        // Page size is preserved (MediaBox unchanged)
        expect(size.width).toBeCloseTo(200, 6);
        expect(size.height).toBeCloseTo(400, 6);

        // Crop boxes are set to the intended rectangle
        const cropBox = page.getCropBox();
        const trimBox = page.getTrimBox();
        // width = 0.5*200 = 100, height = 0.25*400 = 100
        expect(cropBox.width).toBeCloseTo(100, 6);
        expect(cropBox.height).toBeCloseTo(100, 6);
        expect(trimBox.width).toBeCloseTo(100, 6);
        expect(trimBox.height).toBeCloseTo(100, 6);
    });

    it('returns original bytes for full-page crop', async () => {
        const pdf = await PDFDocument.create();
        pdf.addPage([200, 400]);
        const bytes = await pdf.save();

        const out = await cropPdfBytes(bytes, { height: 1, width: 1, x: 0, y: 0 });
        expect(out).toEqual(bytes);
    });

    it('can shrink page size if requested (legacy behavior)', async () => {
        const pdf = await PDFDocument.create();
        pdf.addPage([200, 400]);
        const bytes = await pdf.save();

        const out = await cropPdfBytes(bytes, { height: 0.25, width: 0.5, x: 0.1, y: 0.2 }, { shrinkPage: true });
        const cropped = await PDFDocument.load(out);
        const page = cropped.getPages()[0];
        const size = page.getSize();

        // 0.5 * 200 = 100, 0.25 * 400 = 100
        expect(size.width).toBeCloseTo(100, 6);
        expect(size.height).toBeCloseTo(100, 6);
    });
});
