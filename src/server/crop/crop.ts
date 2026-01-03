export type CropBox = {
    // Normalized coordinates in [0..1]
    x: number;
    y: number;
    width: number;
    height: number;
};

export function validateCropBox(crop: CropBox): void {
    const { x, y, width, height } = crop;
    if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) {
        throw new Error('CropBox must contain finite numbers');
    }
    if (width <= 0 || height <= 0) {
        throw new Error('CropBox width/height must be > 0');
    }
    if (x < 0 || y < 0) {
        throw new Error('CropBox x/y must be >= 0');
    }
    if (x + width > 1 || y + height > 1) {
        throw new Error('CropBox must fit within [0..1] bounds');
    }
}

export function cropBoxToInsetPercent(crop: CropBox): { top: number; right: number; bottom: number; left: number } {
    validateCropBox(crop);
    const top = crop.y * 100;
    const left = crop.x * 100;
    const right = (1 - (crop.x + crop.width)) * 100;
    const bottom = (1 - (crop.y + crop.height)) * 100;
    return { bottom, left, right, top };
}

export function cropBoxToClipPathInset(crop: CropBox): string {
    const { top, right, bottom, left } = cropBoxToInsetPercent(crop);
    // keep a stable number of decimals for consistent snapshots/logs
    const fmt = (n: number) => Number(n.toFixed(4));
    return `inset(${fmt(top)}% ${fmt(right)}% ${fmt(bottom)}% ${fmt(left)}%)`;
}

export function parseCropBox(input: unknown): CropBox {
    if (!input || typeof input !== 'object') {
        throw new Error('Invalid crop payload');
    }
    const obj = input as Record<string, unknown>;
    const crop: CropBox = {
        height: obj.height as number,
        width: obj.width as number,
        x: obj.x as number,
        y: obj.y as number,
    };
    validateCropBox(crop);
    return crop;
}
