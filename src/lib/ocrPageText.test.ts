import { describe, expect, it } from 'bun:test';
import type { ObservationPage } from '@/lib/macOcr';
import { filterArabicPageObservations, mapSkaluLayoutsByPage, pageToOcrPageText } from '@/lib/ocrPageText';

const makePage = (observations: ObservationPage['observations']): ObservationPage => ({
    height: 1200,
    observations,
    page: 1,
    width: 1000,
});

describe('OCR page text reconstruction', () => {
    it('filters a page containing no real Arabic text', () => {
        const result = pageToOcrPageText({
            dpi: { x: 144, y: 144 },
            layout: {},
            page: makePage([
                { bbox: { height: 20, width: 100, x: 50, y: 100 }, text: 'ABC 123' },
                { bbox: { height: 20, width: 100, x: 50, y: 200 }, text: '7 - ..' },
            ]),
        });

        expect(result).toEqual({ lines: '', paragraphs: '' });
    });

    it('preserves a numeric fragment aligned with Arabic text while dropping isolated noise', () => {
        const observations = filterArabicPageObservations([
            { bbox: { height: 44, width: 700, x: 100, y: 200 }, text: 'الفصل الأول' },
            { bbox: { height: 24, width: 50, x: 850, y: 210 }, text: '٤٣٢' },
            { bbox: { height: 24, width: 50, x: 40, y: 210 }, text: '1A' },
            { bbox: { height: 24, width: 100, x: 800, y: 300 }, text: '(١) (ص ٥٩).' },
            { bbox: { height: 20, width: 100, x: 50, y: 400 }, text: 'ABC 123' },
        ]);

        expect(observations.map((observation) => observation.text)).toEqual(['الفصل الأول', '٤٣٢', '(١) (ص ٥٩).']);
    });

    it('keeps both line and rectangle layout primitives by page', () => {
        const layouts = mapSkaluLayoutsByPage([
            {
                height: 1200,
                horizontal_lines: [{ height: 2, width: 300, x: 600, y: 900 }],
                page: 1,
                rectangles: [{ height: 100, width: 500, x: 250, y: 100 }],
                width: 1000,
            },
        ]);

        expect(layouts[1]).toEqual({
            horizontalLines: [{ height: 2, width: 300, x: 600, y: 900 }],
            rectangles: [{ height: 100, width: 500, x: 250, y: 100 }],
        });
    });
});
