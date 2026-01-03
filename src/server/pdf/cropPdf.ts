import { PDFDocument } from 'pdf-lib';
import { isFullCropBox, normalizeCropBox } from '@/lib/cropConvert';
import type { CropBox } from '@/server/crop/crop';

export async function cropPdfBytes(
    pdfBytes: Uint8Array,
    crop: CropBox,
    options?: { shrinkPage?: boolean },
): Promise<Uint8Array> {
    const normalized = normalizeCropBox(crop);
    const shrinkPage = Boolean(options?.shrinkPage);

    // If it's effectively full-page, return the original bytes.
    if (isFullCropBox(normalized)) {
        return pdfBytes;
    }

    const pdf = await PDFDocument.load(pdfBytes);
    for (const page of pdf.getPages()) {
        const { height, width } = page.getSize();

        const llx = normalized.x * width;
        const lly = height - (normalized.y + normalized.height) * height;
        const w = normalized.width * width;
        const h = normalized.height * height;

        // Crop area in PDF coordinates (lower-left origin).
        page.setCropBox(llx, lly, w, h);
        // TrimBox is generally respected for visual trimming, while preserving original MediaBox.
        page.setTrimBox(llx, lly, w, h);
        if (shrinkPage) {
            // Optional: physically shrink the page size.
            page.setMediaBox(llx, lly, w, h);
        }
    }

    return await pdf.save();
}
