import type { CropBox } from '@/server/crop/crop';

export type RectPx = { x: number; y: number; width: number; height: number };
export type PointPx = { x: number; y: number };

export function clamp(n: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, n));
}

export function clamp01(n: number): number {
    return clamp(n, 0, 1);
}

export function rectFromPoints(a: PointPx, b: PointPx): RectPx {
    const x1 = Math.min(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const x2 = Math.max(a.x, b.x);
    const y2 = Math.max(a.y, b.y);
    return { height: y2 - y1, width: x2 - x1, x: x1, y: y1 };
}

export function isMeaningfulRect(rect: RectPx, minPx = 6): boolean {
    return rect.width >= minPx && rect.height >= minPx;
}

export function normalizeRectToCrop(rect: RectPx, bounds: { width: number; height: number }, minSize = 0.001): CropBox {
    if (bounds.width <= 0 || bounds.height <= 0) {
        throw new Error('Invalid bounds');
    }

    const x = clamp01(rect.x / bounds.width);
    const y = clamp01(rect.y / bounds.height);
    const w = clamp01(rect.width / bounds.width);
    const h = clamp01(rect.height / bounds.height);

    // Ensure non-zero size and within bounds
    const width = clamp(w, minSize, 1 - x);
    const height = clamp(h, minSize, 1 - y);

    return { height, width, x, y };
}
