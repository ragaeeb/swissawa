export type PdfInfo = {
    title?: string;
    author?: string;
    creator?: string;
    producer?: string;
    pages: number;
    pageSize?: string;
    fileSizeBytes?: number;
};

export function parsePdfInfoOutput(stdout: string): PdfInfo {
    // `pdfinfo` output is a series of "Key: value" lines.
    // Example:
    // Pages:          12
    // Title:          My PDF
    const lines = stdout
        .split(/\r?\n/)
        .map((l) => l.trimEnd())
        .filter(Boolean);

    const kv = new Map<string, string>();
    for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx === -1) {
            continue;
        }
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (!key) {
            continue;
        }
        kv.set(key.toLowerCase(), value);
    }

    const pagesRaw = kv.get('pages');
    const pages = pagesRaw ? Number.parseInt(pagesRaw, 10) : Number.NaN;
    if (!Number.isFinite(pages) || pages <= 0) {
        throw new Error(`Unable to parse PDF page count from pdfinfo output (Pages: ${pagesRaw ?? 'missing'})`);
    }

    const fileSizeRaw = kv.get('file size');
    const fileSizeBytes = fileSizeRaw ? parsePdfInfoFileSizeBytes(fileSizeRaw) : undefined;

    return {
        author: kv.get('author'),
        creator: kv.get('creator'),
        fileSizeBytes,
        pageSize: kv.get('page size'),
        pages,
        producer: kv.get('producer'),
        title: kv.get('title'),
    };
}

export function parsePdfInfoFileSizeBytes(fileSize: string): number | undefined {
    // Example: "248043 bytes"
    const m = fileSize.match(/^\s*(\d+)\s+bytes\s*$/i);
    if (!m) {
        return undefined;
    }
    const n = Number.parseInt(m[1] ?? '', 10);
    if (!Number.isFinite(n) || n < 0) {
        return undefined;
    }
    return n;
}
