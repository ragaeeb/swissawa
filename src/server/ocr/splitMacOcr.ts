import * as fsp from 'node:fs/promises';
import path from 'node:path';
import type { MacOCR, ObservationPage } from '@/lib/macOcr';

export type OcrMeta = {
    totalPages: number;
    dpi: { x: number; y: number };
    createdAtIso: string;
    language?: string;
    raster?: ObservationPage['raster'];
};

export type SplitMacOcrOptions = { ocr: MacOCR; outDir: string; language?: string };

export function pageFileName(pageNumber: number): string {
    if (!Number.isInteger(pageNumber) || pageNumber <= 0) {
        throw new Error('pageFileName: pageNumber must be a positive integer');
    }
    return `${pageNumber}.json`;
}

export function buildOcrMeta(ocr: MacOCR, language?: string): OcrMeta {
    return {
        createdAtIso: new Date().toISOString(),
        dpi: ocr.dpi,
        language,
        raster: ocr.pages[0]?.raster,
        totalPages: ocr.pages.length,
    };
}

export async function writeOcrMeta(outDir: string, meta: OcrMeta): Promise<void> {
    await fsp.mkdir(outDir, { recursive: true });
    await fsp.writeFile(path.join(outDir, 'meta.json'), JSON.stringify(meta), 'utf8');
}

export async function splitMacOcrToPages({ ocr, outDir, language }: SplitMacOcrOptions): Promise<OcrMeta> {
    const pagesDir = path.join(outDir, 'pages');
    await fsp.mkdir(pagesDir, { recursive: true });

    // Write per-page JSON (1-indexed).
    for (const p of ocr.pages) {
        await writePageJson(pagesDir, {
            ...p,
            observations: p.observations.map((observation) => ({
                ...observation,
                ...(observation.id ? { id: `macocr:page-${p.page}:${observation.id}` } : {}),
            })),
            salutationProposals: p.salutationProposals ?? [],
            suggestedEdits: p.suggestedEdits ?? [],
        });
    }

    const meta = buildOcrMeta(ocr, language);
    await writeOcrMeta(outDir, meta);
    return meta;
}

async function writePageJson(pagesDir: string, page: ObservationPage): Promise<void> {
    const outPath = path.join(pagesDir, pageFileName(page.page));
    await fsp.writeFile(outPath, JSON.stringify(page), 'utf8');
}
