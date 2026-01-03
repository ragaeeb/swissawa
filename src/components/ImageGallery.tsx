'use client';

import Image from 'next/image';
import { Button } from '@/components/ui/button';
import type { CropBox } from '@/server/crop/crop';
import { cropBoxToClipPathInset } from '@/server/crop/crop';

interface ImageGalleryProps {
    jobId: string;
    extractedPages: number;
    previewPages: number[];
    onLoadMore: () => void;
    canLoadMore: boolean;
    crop: CropBox | null;
    onCropPage: (pageNumber: number) => void;
}

export const ImageGallery = ({
    jobId,
    extractedPages,
    previewPages,
    onLoadMore,
    canLoadMore,
    crop,
    onCropPage,
}: ImageGalleryProps) => {
    const clipPath = crop ? cropBoxToClipPathInset(crop) : undefined;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <h2 className="font-semibold text-lg">Page previews</h2>
                {crop ? <div className="text-xs text-zinc-600 dark:text-zinc-400">Crop: enabled</div> : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {previewPages.map((p) => (
                    <div
                        key={p}
                        className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                    >
                        <div className="flex items-center justify-between border-zinc-200 border-b px-3 py-2 text-xs dark:border-zinc-800">
                            <div className="font-medium">Page {p}</div>
                            <div className="text-zinc-600 dark:text-zinc-400">
                                {p <= extractedPages ? 'ready' : 'pending'}
                            </div>
                        </div>
                        <div className="relative aspect-[3/4]">
                            {p <= extractedPages ? (
                                <button
                                    type="button"
                                    className="absolute inset-0"
                                    onClick={() => onCropPage(p)}
                                    aria-label={`Crop from page ${p}`}
                                >
                                    <Image
                                        alt={`Page ${p}`}
                                        src={`/api/jobs/${encodeURIComponent(jobId)}/images/${p}`}
                                        fill
                                        sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 90vw"
                                        className="bg-white object-contain dark:bg-zinc-950"
                                        style={clipPath ? { clipPath } : undefined}
                                    />
                                </button>
                            ) : (
                                <div className="flex h-full items-center justify-center text-sm text-zinc-600 dark:text-zinc-400">
                                    Extracting…
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
                For huge PDFs, we render previews progressively instead of returning a massive array of URLs at once.
            </div>
            {canLoadMore ? (
                <div className="flex justify-center">
                    <Button type="button" variant="secondary" onClick={onLoadMore}>
                        Load more
                    </Button>
                </div>
            ) : null}
        </div>
    );
};
