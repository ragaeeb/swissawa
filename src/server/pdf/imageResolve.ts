import fsp from 'node:fs/promises';
import path from 'node:path';
import { jobImageFileName } from '@/server/pdf/extract';

export type ResolveJobImageParams = { outputDir: string; pageNumber: number; totalPages?: number };

export function buildCandidateImageNames(
    pageNumber: number,
    totalPages?: number,
    inferredPadWidth?: number | null,
): string[] {
    const candidates: string[] = [];

    if (typeof inferredPadWidth === 'number' && inferredPadWidth > 0) {
        candidates.push(`page-${String(pageNumber).padStart(inferredPadWidth, '0')}.jpg`);
    }
    if (totalPages && Number.isInteger(totalPages) && totalPages > 0) {
        candidates.push(jobImageFileName(pageNumber, totalPages));
    }

    // Unpadded (some tools/configs)
    candidates.push(`page-${pageNumber}.jpg`);

    // Common pad widths for poppler output
    candidates.push(`page-${String(pageNumber).padStart(3, '0')}.jpg`);
    candidates.push(`page-${String(pageNumber).padStart(4, '0')}.jpg`);
    candidates.push(`page-${String(pageNumber).padStart(5, '0')}.jpg`);
    candidates.push(`page-${String(pageNumber).padStart(6, '0')}.jpg`);

    // De-dupe while preserving order
    return [...new Set(candidates)];
}

export function inferPadWidthFromFileName(fileName: string): number | null {
    if (!fileName.startsWith('page-') || !fileName.endsWith('.jpg')) {
        return null;
    }
    const core = fileName.slice('page-'.length, -'.jpg'.length);
    if (!/^\d+$/.test(core)) {
        return null;
    }
    return core.length;
}

export async function inferPadWidthFromDir(outputDir: string): Promise<number | null> {
    try {
        const entries = await fsp.readdir(outputDir);
        const first = entries.find((e) => e.startsWith('page-') && e.endsWith('.jpg'));
        if (!first) {
            return null;
        }
        return inferPadWidthFromFileName(first);
    } catch {
        return null;
    }
}

export async function resolveJobImagePath(params: ResolveJobImageParams): Promise<string | null> {
    const inferred = await inferPadWidthFromDir(params.outputDir);
    const candidates = buildCandidateImageNames(params.pageNumber, params.totalPages, inferred);

    for (const name of candidates) {
        const p = path.join(params.outputDir, name);
        try {
            await fsp.stat(p);
            return p;
        } catch {
            // continue
        }
    }

    return null;
}
