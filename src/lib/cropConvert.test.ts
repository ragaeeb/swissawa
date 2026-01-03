import { describe, expect, it } from 'bun:test';
import { cropBoxToPercentCrop, isFullCropBox, normalizeCropBox, percentCropToCropBox } from '@/lib/cropConvert';

describe('cropConvert', () => {
    it('detects full crop box', () => {
        expect(isFullCropBox({ height: 1, width: 1, x: 0, y: 0 })).toBeTrue();
        expect(isFullCropBox({ height: 0.9, width: 1, x: 0, y: 0 })).toBeFalse();
    });

    it('converts crop box to percent crop', () => {
        expect(cropBoxToPercentCrop({ height: 0.5, width: 0.25, x: 0.1, y: 0.2 })).toEqual({
            height: 50,
            unit: '%',
            width: 25,
            x: 10,
            y: 20,
        });
    });

    it('converts percent crop to crop box', () => {
        expect(percentCropToCropBox({ height: 50, width: 25, x: 10, y: 20 })).toEqual({
            height: 0.5,
            width: 0.25,
            x: 0.1,
            y: 0.2,
        });
    });

    it('normalizes out-of-bounds crops to stay within [0..1]', () => {
        expect(normalizeCropBox({ height: 1, width: 1, x: 0.5, y: 0.5 })).toEqual({
            height: 0.5,
            width: 0.5,
            x: 0.5,
            y: 0.5,
        });
        expect(normalizeCropBox({ height: 0.2, width: 0.2, x: -1, y: -1 })).toEqual({
            height: 0.2,
            width: 0.2,
            x: 0,
            y: 0,
        });
    });

    it('throws if given a pixel crop (unit: "px") to avoid silent UI regressions', () => {
        expect(() => percentCropToCropBox({ height: 200, unit: 'px', width: 300, x: 10, y: 20 })).toThrow(
            'Expected a percent crop',
        );
    });
});
