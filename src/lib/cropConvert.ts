import type { CropBox } from '@/server/crop/crop';

export type PercentCrop = { unit: '%'; x: number; y: number; width: number; height: number };

function clamp(n: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, n));
}

export function isFullCropBox(crop: CropBox): boolean {
    // Treat values very close to full as full (avoid float noise).
    const eps = 1e-9;
    return (
        Math.abs(crop.x) <= eps &&
        Math.abs(crop.y) <= eps &&
        Math.abs(crop.width - 1) <= eps &&
        Math.abs(crop.height - 1) <= eps
    );
}

export function normalizeCropBox(input: CropBox, minSize = 0.001): CropBox {
    const n = (v: number) => (Number.isFinite(v) ? v : 0);
    const x = clamp(n(input.x), 0, 1);
    const y = clamp(n(input.y), 0, 1);
    let width = clamp(n(input.width), 0, 1);
    let height = clamp(n(input.height), 0, 1);

    // Ensure non-zero size.
    width = Math.max(width, minSize);
    height = Math.max(height, minSize);

    // Ensure within bounds.
    if (x + width > 1) {
        width = Math.max(minSize, 1 - x);
    }
    if (y + height > 1) {
        height = Math.max(minSize, 1 - y);
    }

    // If we ended up in a weird state, fall back.
    if (!(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 1 && y + height <= 1)) {
        return { height: 1, width: 1, x: 0, y: 0 };
    }

    return { height, width, x, y };
}

export function cropBoxToPercentCrop(crop: CropBox): PercentCrop {
    const c = normalizeCropBox(crop);
    return { height: c.height * 100, unit: '%', width: c.width * 100, x: c.x * 100, y: c.y * 100 };
}

export function percentCropToCropBox(crop: {
    x: number;
    y: number;
    width: number;
    height: number;
    unit?: string;
}): CropBox {
    if (crop.unit && crop.unit !== '%') {
        throw new Error(`Expected a percent crop (unit: "%"), got "${crop.unit}"`);
    }
    return normalizeCropBox({ height: crop.height / 100, width: crop.width / 100, x: crop.x / 100, y: crop.y / 100 });
}
