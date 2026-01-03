'use client';

import { useMemo, useRef, useState } from 'react';
import ReactCrop, { type Crop } from 'react-image-crop';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cropBoxToPercentCrop, isFullCropBox, normalizeCropBox, percentCropToCropBox } from '@/lib/cropConvert';
import type { CropBox } from '@/server/crop/crop';
import { cropBoxToClipPathInset } from '@/server/crop/crop';

type Props = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    jobId: string;
    pageNumber: number;
    initialCrop: CropBox | null;
    onSave: (crop: CropBox) => Promise<void> | void;
};

const FULL_CROP: CropBox = { height: 1, width: 1, x: 0, y: 0 };

export function CropDialog({ open, onOpenChange, jobId, pageNumber, initialCrop, onSave }: Props) {
    const initial = initialCrop ?? FULL_CROP;
    const [crop, setCrop] = useState<CropBox>(normalizeCropBox(initial));
    // If crop is "full page", start with no selection so drag creates a crop box.
    const [uiCrop, setUiCrop] = useState<Crop | undefined>(
        isFullCropBox(initial) ? undefined : cropBoxToPercentCrop(initial),
    );
    const [saving, setSaving] = useState(false);

    const imgRef = useRef<HTMLImageElement | null>(null);

    const clipPath = useMemo(() => cropBoxToClipPathInset(normalizeCropBox(crop)), [crop]);

    function setField(key: keyof CropBox, value: number) {
        if (!Number.isFinite(value)) {
            return;
        }
        setCrop((c) => {
            const next = normalizeCropBox({ ...c, [key]: value });
            setUiCrop(cropBoxToPercentCrop(next));
            return next;
        });
    }

    async function save() {
        setSaving(true);
        try {
            await onSave(crop);
            onOpenChange(false);
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(v) => {
                onOpenChange(v);
                if (v) {
                    const next = initialCrop ?? FULL_CROP;
                    const normalized = normalizeCropBox(next);
                    setCrop(normalized);
                    setUiCrop(isFullCropBox(normalized) ? undefined : cropBoxToPercentCrop(normalized));
                }
            }}
        >
            <DialogContent className="sm:max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Crop pages</DialogTitle>
                    <DialogDescription>
                        Draw a crop box on page {pageNumber}. This crop will be applied to all page previews so you can
                        scroll and verify.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 md:grid-cols-[1fr_320px]">
                    <div className="flex flex-col gap-3">
                        <div className="font-medium text-sm">Drag to select crop</div>
                        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                            <ReactCrop
                                crop={uiCrop}
                                keepSelection
                                minHeight={10}
                                minWidth={10}
                                onChange={(_, percentCrop) => {
                                    setUiCrop(percentCrop);
                                }}
                                onComplete={(_, percentCrop) => {
                                    if (!percentCrop.width || !percentCrop.height) {
                                        return;
                                    }
                                    const next = normalizeCropBox(percentCropToCropBox(percentCrop));
                                    setCrop(next);
                                    setUiCrop(cropBoxToPercentCrop(next));
                                }}
                            >
                                {/* react-image-crop expects a plain <img /> */}
                                {/* biome-ignore lint/performance/noImgElement: react-image-crop expects a plain <img> element */}
                                <img
                                    ref={imgRef}
                                    alt={`Page ${pageNumber}`}
                                    src={`/api/jobs/${encodeURIComponent(jobId)}/images/${pageNumber}`}
                                    className="block h-auto w-full select-none bg-white object-contain dark:bg-zinc-950"
                                    draggable={false}
                                />
                            </ReactCrop>
                        </div>
                        <div className="text-xs text-zinc-600 dark:text-zinc-400">
                            Preview uses the saved crop (clip-path): <span className="font-mono">{clipPath}</span>
                        </div>
                    </div>

                    <div className="flex flex-col gap-4">
                        <div className="font-medium text-sm">Fine tune (normalized 0..1)</div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-2">
                                <Label htmlFor="crop-x">x</Label>
                                <Input
                                    id="crop-x"
                                    inputMode="decimal"
                                    value={crop.x}
                                    onChange={(e) => setField('x', Number.parseFloat(e.target.value))}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="crop-y">y</Label>
                                <Input
                                    id="crop-y"
                                    inputMode="decimal"
                                    value={crop.y}
                                    onChange={(e) => setField('y', Number.parseFloat(e.target.value))}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="crop-w">width</Label>
                                <Input
                                    id="crop-w"
                                    inputMode="decimal"
                                    value={crop.width}
                                    onChange={(e) => setField('width', Number.parseFloat(e.target.value))}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="crop-h">height</Label>
                                <Input
                                    id="crop-h"
                                    inputMode="decimal"
                                    value={crop.height}
                                    onChange={(e) => setField('height', Number.parseFloat(e.target.value))}
                                />
                            </div>
                        </div>

                        <div className="text-xs text-zinc-600 dark:text-zinc-400">
                            Tip: x/y are from the top-left. width/height expand right/down.
                        </div>

                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => {
                                    const next = normalizeCropBox(FULL_CROP);
                                    setCrop(next);
                                    setUiCrop(undefined);
                                }}
                            >
                                Reset
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    const next = normalizeCropBox(initialCrop ?? FULL_CROP);
                                    setCrop(next);
                                    setUiCrop(isFullCropBox(next) ? undefined : cropBoxToPercentCrop(next));
                                }}
                            >
                                Revert
                            </Button>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={save} disabled={saving}>
                        Save crop
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
