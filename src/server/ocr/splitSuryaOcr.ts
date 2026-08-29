import * as fsp from 'node:fs/promises';
import path from 'node:path';
import type { BoundingBox, Observation, ObservationPage } from '@/lib/macOcr';
import type { SuryaOcrOutput, SuryaPageOcrResult, SuryaRawOutput, SuryaTextLine } from '@/lib/suryaOcr';

export type SuryaOcrMeta = {
    totalPages: number;
    dpi: { x: number; y: number };
    createdAtIso: string;
    raster?: ObservationPage['raster'];
};

export type SplitSuryaOcrOptions = { outDir: string; pages: SuryaPageOcrResult[]; raster?: ObservationPage['raster'] };

/**
 * Filter raw surya results.json output by stripping character-level data.
 * Removes: chars, confidence, polygon, words, original_text_good from text_lines.
 */
export function filterSuryaRawOutput(raw: SuryaRawOutput): SuryaOcrOutput {
    const result: SuryaOcrOutput = {};

    for (const [filename, pages] of Object.entries(raw)) {
        result[filename] = pages.map((page) => ({
            image_bbox: page.image_bbox,
            page: page.page,
            text_lines: page.text_lines.map((line: any) => ({ bbox: line.bbox, text: line.text })),
        }));
    }

    return result;
}

/**
 * Convert surya bbox format [x1, y1, x2, y2] to macOCR BoundingBox { x, y, width, height }.
 */
function suryaBboxToBoundingBox(bbox: [number, number, number, number]): BoundingBox {
    const [x1, y1, x2, y2] = bbox;
    return { height: y2 - y1, width: x2 - x1, x: x1, y: y1 };
}

/**
 * Convert SuryaPageOcrResult to ObservationPage format for unified page rendering.
 * Note: Surya pages are already 1-indexed based on results.json output.
 */
export function convertSuryaToObservationPage(
    suryaPage: SuryaPageOcrResult,
    raster?: ObservationPage['raster'],
): ObservationPage {
    const [, , width, height] = suryaPage.image_bbox;

    const observations: Observation[] = suryaPage.text_lines.map((line: SuryaTextLine, index) => ({
        bbox: suryaBboxToBoundingBox(line.bbox),
        ...(line.chars ? { chars: line.chars } : {}),
        ...(line.confidence !== undefined ? { confidence: line.confidence } : {}),
        id: `surya:page-${suryaPage.page}:line-${String(index + 1).padStart(4, '0')}`,
        ...(line.polygon ? { polygon: line.polygon } : {}),
        rawText: line.text,
        sourceRange: { length: line.text.length, location: 0, unit: 'utf16' },
        text: line.text,
        ...(line.words ? { words: line.words } : {}),
    }));

    return {
        height,
        observations,
        page: suryaPage.page, // Surya is already 1-indexed
        ...(raster ? { raster } : {}),
        salutationProposals: [],
        suggestedEdits: [],
        width,
    };
}

/**
 * Build metadata for surya OCR results.
 * Surya doesn't provide DPI info, so we default to 72.
 */
export function buildSuryaMeta(pages: SuryaPageOcrResult[], raster?: ObservationPage['raster']): SuryaOcrMeta {
    return { createdAtIso: new Date().toISOString(), dpi: { x: 72, y: 72 }, raster, totalPages: pages.length };
}

/**
 * Write surya meta.json to the output directory.
 */
export async function writeSuryaMeta(outDir: string, meta: SuryaOcrMeta): Promise<void> {
    await fsp.mkdir(outDir, { recursive: true });
    await fsp.writeFile(path.join(outDir, 'meta.json'), JSON.stringify(meta), 'utf8');
}

/**
 * Write a single page's ObservationPage to JSON file.
 */
async function writePageJson(pagesDir: string, page: ObservationPage): Promise<void> {
    const outPath = path.join(pagesDir, `${page.page}.json`);
    await fsp.writeFile(outPath, JSON.stringify(page), 'utf8');
}

/**
 * Split surya OCR output into per-page JSON files matching macOCR format.
 * Creates pages/ directory with 1.json, 2.json, etc.
 */
export async function splitSuryaOcrToPages({ outDir, pages, raster }: SplitSuryaOcrOptions): Promise<SuryaOcrMeta> {
    const pagesDir = path.join(outDir, 'pages');
    await fsp.mkdir(pagesDir, { recursive: true });

    // Write per-page JSON (converting from surya format to macOCR format)
    for (const suryaPage of pages) {
        const observationPage = convertSuryaToObservationPage(suryaPage, raster);
        await writePageJson(pagesDir, observationPage);
    }

    const meta = buildSuryaMeta(pages, raster);
    await writeSuryaMeta(outDir, meta);
    return meta;
}
