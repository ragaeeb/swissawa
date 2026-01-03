import { describe, expect, it } from 'bun:test';
import { createPageRanges, runWithConcurrency } from '@/server/pdf/ranges';

describe('createPageRanges', () => {
    it('should split into fixed chunks', () => {
        expect(createPageRanges(10, 4)).toEqual([
            { end: 4, start: 1 },
            { end: 8, start: 5 },
            { end: 10, start: 9 },
        ]);
    });

    it('should throw on invalid inputs', () => {
        expect(() => createPageRanges(0, 1)).toThrow();
        expect(() => createPageRanges(1, 0)).toThrow();
    });

    it('should handle pageCount equal to chunkSize', () => {
        expect(createPageRanges(5, 5)).toEqual([{ end: 5, start: 1 }]);
    });

    it('should handle pageCount less than chunkSize', () => {
        expect(createPageRanges(3, 10)).toEqual([{ end: 3, start: 1 }]);
    });

    it('should handle single page', () => {
        expect(createPageRanges(1, 1)).toEqual([{ end: 1, start: 1 }]);
    });
});

describe('runWithConcurrency', () => {
    it('should run all tasks', async () => {
        const items = [1, 2, 3, 4, 5] as const;
        const seen: number[] = [];
        await runWithConcurrency(items, 2, async (n) => {
            // keep it deterministic
            await new Promise((r) => setTimeout(r, 1));
            seen.push(n);
        });
        expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    });

    it('should respect concurrency limit', async () => {
        const concurrency = 2;
        const items = Array.from({ length: 10 }, (_, i) => i);
        let active = 0;
        let maxActive = 0;

        await runWithConcurrency(items, concurrency, async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            // Artificial delay to ensure overlap
            await new Promise((r) => setTimeout(r, 10));
            active -= 1;
        });

        expect(maxActive).toBe(concurrency);
    });

    it('should handle falsy values', async () => {
        const items = [0, '', false, null, undefined] as const;
        const seen: unknown[] = [];
        await runWithConcurrency(items, 1, async (item) => {
            seen.push(item);
        });
        expect(seen).toEqual([0, '', false, null, undefined]);
    });
});
