import { describe, expect, it } from 'bun:test';
import { isMeaningfulRect, normalizeRectToCrop, rectFromPoints } from '@/lib/cropGeometry';

describe('rectFromPoints', () => {
    it('creates positive rect from any point order', () => {
        expect(rectFromPoints({ x: 10, y: 20 }, { x: 2, y: 5 })).toEqual({ height: 15, width: 8, x: 2, y: 5 });
    });
});

describe('isMeaningfulRect', () => {
    it('rejects click-sized selections', () => {
        expect(isMeaningfulRect({ height: 0, width: 0, x: 10, y: 10 })).toBeFalse();
        expect(isMeaningfulRect({ height: 5, width: 10, x: 0, y: 0 }, 6)).toBeFalse();
    });
});

describe('normalizeRectToCrop', () => {
    it('normalizes rect to [0..1]', () => {
        expect(normalizeRectToCrop({ height: 50, width: 100, x: 50, y: 25 }, { height: 100, width: 200 })).toEqual({
            height: 0.5,
            width: 0.5,
            x: 0.25,
            y: 0.25,
        });
    });

    it('clamps within bounds', () => {
        const crop = normalizeRectToCrop({ height: 999, width: 999, x: 150, y: 150 }, { height: 200, width: 200 });
        expect(crop.x).toBeCloseTo(0.75, 8);
        expect(crop.y).toBeCloseTo(0.75, 8);
        expect(crop.width).toBeCloseTo(0.25, 8);
        expect(crop.height).toBeCloseTo(0.25, 8);
    });
});
