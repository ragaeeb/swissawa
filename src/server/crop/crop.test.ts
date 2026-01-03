import { describe, expect, it } from 'bun:test';
import { cropBoxToClipPathInset, cropBoxToInsetPercent, parseCropBox } from '@/server/crop/crop';

describe('cropBoxToInsetPercent', () => {
    it('should compute inset for a centered crop', () => {
        const inset = cropBoxToInsetPercent({ height: 0.8, width: 0.6, x: 0.2, y: 0.1 });

        expect(inset.top).toBeCloseTo(10, 8);
        expect(inset.left).toBeCloseTo(20, 8);
        expect(inset.right).toBeCloseTo(20, 8);
        expect(inset.bottom).toBeCloseTo(10, 8);
    });
});

describe('cropBoxToClipPathInset', () => {
    it('should format clip-path inset', () => {
        expect(cropBoxToClipPathInset({ height: 0.5, width: 0.5, x: 0.25, y: 0.25 })).toBe('inset(25% 25% 25% 25%)');
    });
});

describe('parseCropBox', () => {
    it('should reject out of bounds', () => {
        expect(() => parseCropBox({ height: 0.2, width: 0.2, x: 0.9, y: 0 })).toThrow();
    });

    it('should reject null input', () => {
        expect(() => parseCropBox(null)).toThrow('Invalid crop payload');
    });

    it('should reject missing fields', () => {
        expect(() => parseCropBox({ x: 0.1, y: 0.1 })).toThrow();
    });

    it('should reject negative values', () => {
        expect(() => parseCropBox({ height: -0.1, width: 0.5, x: 0.1, y: 0.1 })).toThrow();
    });

    it('should accept boundary values', () => {
        expect(parseCropBox({ height: 1.0, width: 1.0, x: 0, y: 0 })).toEqual({ height: 1.0, width: 1.0, x: 0, y: 0 });
    });
});
