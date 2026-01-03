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
});
