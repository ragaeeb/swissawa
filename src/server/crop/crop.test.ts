import { describe, expect, test } from 'bun:test';
import { cropBoxToClipPathInset, cropBoxToInsetPercent, parseCropBox } from '@/server/crop/crop';

describe('cropBoxToInsetPercent', () => {
    test('computes inset for a centered crop', () => {
        const inset = cropBoxToInsetPercent({ height: 0.8, width: 0.6, x: 0.2, y: 0.1 });

        expect(inset.top).toBeCloseTo(10, 8);
        expect(inset.left).toBeCloseTo(20, 8);
        expect(inset.right).toBeCloseTo(20, 8);
        expect(inset.bottom).toBeCloseTo(10, 8);
    });
});

describe('cropBoxToClipPathInset', () => {
    test('formats clip-path inset', () => {
        expect(cropBoxToClipPathInset({ height: 0.5, width: 0.5, x: 0.25, y: 0.25 })).toBe('inset(25% 25% 25% 25%)');
    });
});

describe('parseCropBox', () => {
    test('rejects out of bounds', () => {
        expect(() => parseCropBox({ height: 0.2, width: 0.2, x: 0.9, y: 0 })).toThrow();
    });
});
