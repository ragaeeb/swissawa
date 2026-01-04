import { describe, expect, it } from 'bun:test';
import type { MacOCR } from '@/lib/macOcr';
import { selectOcrDelivery } from '@/server/ocr/ocrDelivery';

const FIXTURE_OCR: MacOCR = {
    dpi: { x: 300, y: 300 },
    pages: [
        {
            height: 1000,
            observations: [{ bbox: { height: 4, width: 3, x: 1, y: 2 }, text: 'السلام عليكم' }],
            page: 1,
            width: 800,
        },
    ],
};

describe('selectOcrDelivery', () => {
    it('should choose inline under size threshold', () => {
        const d = selectOcrDelivery({
            fileUrl: '/file',
            hasPagesSplit: false,
            inlineThresholdBytes: 1000,
            ocr: FIXTURE_OCR,
            pagesBaseUrl: '/pages',
            rawJsonBytes: 100,
            totalPages: 1,
        });
        expect(d.kind).toBe('inline');
    });

    it('should choose file when above threshold and pages split is not available', () => {
        const d = selectOcrDelivery({
            fileUrl: '/file',
            hasPagesSplit: false,
            inlineThresholdBytes: 1000,
            pagesBaseUrl: '/pages',
            rawJsonBytes: 10_000,
            totalPages: 1,
        });
        expect(d).toEqual({ kind: 'file', url: '/file' });
    });

    it('should choose pages when above threshold and pages split is available', () => {
        const d = selectOcrDelivery({
            fileUrl: '/file',
            hasPagesSplit: true,
            inlineThresholdBytes: 1000,
            pagesBaseUrl: '/pages',
            rawJsonBytes: 10_000,
            totalPages: 42,
        });
        expect(d).toEqual({ kind: 'pages', pagesBaseUrl: '/pages', totalPages: 42 });
    });

    it('should respect preferredKind=inline when possible', () => {
        const d = selectOcrDelivery({
            fileUrl: '/file',
            hasPagesSplit: true,
            inlineThresholdBytes: 1000,
            ocr: FIXTURE_OCR,
            pagesBaseUrl: '/pages',
            preferredKind: 'inline',
            rawJsonBytes: 100,
            totalPages: 10,
        });
        expect(d.kind).toBe('inline');
    });

    it('should fall back from preferredKind=inline when too large', () => {
        const d = selectOcrDelivery({
            fileUrl: '/file',
            hasPagesSplit: true,
            inlineThresholdBytes: 1000,
            pagesBaseUrl: '/pages',
            preferredKind: 'inline',
            rawJsonBytes: 10_000,
            totalPages: 10,
        });
        expect(d.kind).toBe('pages');
    });

    it('should respect preferredKind=pages and fall back to file if pages split is not available', () => {
        const d = selectOcrDelivery({
            fileUrl: '/file',
            hasPagesSplit: false,
            inlineThresholdBytes: 1000,
            pagesBaseUrl: '/pages',
            preferredKind: 'pages',
            rawJsonBytes: 10_000,
            totalPages: 10,
        });
        expect(d.kind).toBe('file');
    });
});
