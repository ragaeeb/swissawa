import type { PageRange } from '@/server/pdf/ranges';

export type ExtractOptions = {
    // max dimension (long edge) in pixels; lower = faster/smaller
    scaleTo: number;
    jpegQuality: number;
};

export const DEFAULT_EXTRACT_OPTIONS: ExtractOptions = { jpegQuality: 50, scaleTo: 1200 };

export function buildPdftocairoArgs(params: {
    inputPdfPath: string;
    outputPrefix: string; // e.g. "/tmp/job/page" => page-1.jpg, page-2.jpg, ...
    range: PageRange;
    options?: Partial<ExtractOptions>;
}): string[] {
    const options = { ...DEFAULT_EXTRACT_OPTIONS, ...params.options };

    if (options.scaleTo <= 0) {
        throw new Error(`scaleTo must be > 0 (got ${options.scaleTo})`);
    }
    if (options.jpegQuality <= 0 || options.jpegQuality > 100) {
        throw new Error(`jpegQuality must be 1..100 (got ${options.jpegQuality})`);
    }

    return [
        '-jpeg',
        '-jpegopt',
        `quality=${options.jpegQuality}`,
        '-scale-to',
        `${options.scaleTo}`,
        '-f',
        `${params.range.start}`,
        '-l',
        `${params.range.end}`,
        params.inputPdfPath,
        params.outputPrefix,
    ];
}

export function jobImageUrl(jobId: string, pageNumber: number): string {
    if (!jobId) {
        throw new Error('jobId is required');
    }
    if (!Number.isInteger(pageNumber) || pageNumber <= 0) {
        throw new Error(`pageNumber must be a positive integer (got ${pageNumber})`);
    }
    return `/api/jobs/${encodeURIComponent(jobId)}/images/${pageNumber}`;
}

export function jobImageFileName(pageNumber: number, totalPages?: number): string {
    if (!Number.isInteger(pageNumber) || pageNumber <= 0) {
        throw new Error(`pageNumber must be a positive integer (got ${pageNumber})`);
    }
    const width =
        totalPages && Number.isInteger(totalPages) && totalPages > 0
            ? String(totalPages).length
            : String(pageNumber).length;
    return `page-${String(pageNumber).padStart(width, '0')}.jpg`;
}
