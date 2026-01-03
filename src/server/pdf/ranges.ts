export type PageRange = { start: number; end: number };

export function createPageRanges(pageCount: number, chunkSize: number): PageRange[] {
    if (!Number.isInteger(pageCount) || pageCount <= 0) {
        throw new Error(`pageCount must be a positive integer (got ${pageCount})`);
    }
    if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
        throw new Error(`chunkSize must be a positive integer (got ${chunkSize})`);
    }

    const ranges: PageRange[] = [];
    for (let start = 1; start <= pageCount; start += chunkSize) {
        const end = Math.min(pageCount, start + chunkSize - 1);
        ranges.push({ end, start });
    }
    return ranges;
}

export async function runWithConcurrency<T>(
    items: readonly T[],
    concurrency: number,
    fn: (item: T) => Promise<void>,
): Promise<void> {
    if (!Number.isInteger(concurrency) || concurrency <= 0) {
        throw new Error(`concurrency must be a positive integer (got ${concurrency})`);
    }
    if (items.length === 0) {
        return;
    }

    let idx = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (true) {
            const myIdx = idx;
            idx += 1;
            if (myIdx >= items.length) {
                return;
            }
            const item = items[myIdx];
            await fn(item);
        }
    });

    await Promise.all(workers);
}
