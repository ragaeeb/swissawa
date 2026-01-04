'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { MacOCR, ObservationPage } from '@/lib/macOcr';
import type { CropBox } from '@/server/crop/crop';
import { cropBoxToClipPathInset } from '@/server/crop/crop';

type OcrStatus = 'idle' | 'running' | 'complete' | 'error';
type OcrDelivery =
    | { kind: 'inline'; ocr: MacOCR }
    | { kind: 'file'; url: string }
    | { kind: 'pages'; pagesBaseUrl: string; totalPages: number };

type OcrStatusResponse = {
    status: OcrStatus;
    error?: string;
    meta?: Record<string, unknown> | null;
    delivery?: OcrDelivery;
};

function getPageFromMacOcr(ocr: MacOCR, pageNumber: number): ObservationPage | null {
    return ocr.pages.find((p) => p.page === pageNumber) ?? null;
}

async function fetchOcrPageFromPagesDelivery(
    delivery: Extract<OcrDelivery, { kind: 'pages' }>,
    pageNumber: number,
    signal: AbortSignal,
): Promise<ObservationPage | null> {
    const res = await fetch(`${delivery.pagesBaseUrl}/${pageNumber}`, { signal });
    if (!res.ok) {
        return null;
    }
    return (await res.json()) as ObservationPage;
}

async function fetchOcrFromFileDelivery(
    delivery: Extract<OcrDelivery, { kind: 'file' }>,
    signal: AbortSignal,
): Promise<MacOCR | null> {
    const res = await fetch(delivery.url, { signal });
    if (!res.ok) {
        return null;
    }
    return (await res.json()) as MacOCR;
}

type ResolveOcrPageResult = { full: MacOCR | null; page: ObservationPage | null };

async function resolveOcrPage(
    delivery: OcrDelivery,
    pageNumber: number,
    cachedFull: MacOCR | null,
    signal: AbortSignal,
): Promise<ResolveOcrPageResult> {
    switch (delivery.kind) {
        case 'pages': {
            const page = await fetchOcrPageFromPagesDelivery(delivery, pageNumber, signal);
            return { full: null, page };
        }
        case 'inline': {
            const page = getPageFromMacOcr(delivery.ocr, pageNumber);
            return { full: null, page };
        }
        case 'file': {
            const full = cachedFull ?? (await fetchOcrFromFileDelivery(delivery, signal));
            const page = full ? getPageFromMacOcr(full, pageNumber) : null;
            return { full, page };
        }
    }
}

export function OcrSection({
    crop,
    jobId,
    selectedPage,
}: {
    jobId: string | null;
    selectedPage: number | null;
    crop: CropBox | null;
}) {
    const [ocrStatus, setOcrStatus] = useState<OcrStatus>('idle');
    const [ocrError, setOcrError] = useState<string | null>(null);
    const [ocrMeta, setOcrMeta] = useState<Record<string, unknown> | null>(null);
    const [ocrDelivery, setOcrDelivery] = useState<OcrDelivery | null>(null);
    const [ocrData, setOcrData] = useState<MacOCR | null>(null);
    const [ocrPageData, setOcrPageData] = useState<ObservationPage | null>(null);

    const refreshOcrStatus = useCallback(async () => {
        if (!jobId) {
            return;
        }
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/ocr`);
        if (!res.ok) {
            return;
        }
        const data = (await res.json()) as OcrStatusResponse;
        setOcrStatus(data.status);
        setOcrError(data.error ?? null);
        setOcrMeta(data.meta ?? null);
        setOcrDelivery(data.delivery ?? null);
        if (data.delivery?.kind === 'inline') {
            setOcrData(data.delivery.ocr);
        }
    }, [jobId]);

    useEffect(() => {
        setOcrStatus('idle');
        setOcrError(null);
        setOcrMeta(null);
        setOcrDelivery(null);
        setOcrData(null);
        setOcrPageData(null);
        if (!jobId) {
            return;
        }
        void refreshOcrStatus();
    }, [jobId, refreshOcrStatus]);

    useEffect(() => {
        if (!jobId || ocrStatus !== 'running') {
            return;
        }
        const t = window.setInterval(() => {
            void refreshOcrStatus();
        }, 2000);
        return () => window.clearInterval(t);
    }, [jobId, ocrStatus, refreshOcrStatus]);

    useEffect(() => {
        if (!jobId || !selectedPage || ocrStatus !== 'complete' || !ocrDelivery) {
            setOcrPageData(null);
            return;
        }
        const controller = new AbortController();
        void (async () => {
            try {
                const { full, page } = await resolveOcrPage(ocrDelivery, selectedPage, ocrData, controller.signal);
                if (full && !ocrData) {
                    setOcrData(full);
                }
                setOcrPageData(page);
            } catch (err: unknown) {
                if (err instanceof Error && err.name === 'AbortError') {
                    return;
                }
            }
        })();
        return () => controller.abort();
    }, [jobId, ocrData, ocrDelivery, ocrStatus, selectedPage]);

    const runOcr = useCallback(async () => {
        if (!jobId) {
            return;
        }
        setOcrError(null);
        try {
            const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/ocr`, { method: 'POST' });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error ?? `Failed to start OCR (${res.status})`);
            }
            setOcrStatus('running');
            void refreshOcrStatus();
        } catch (err: unknown) {
            setOcrError(err instanceof Error ? err.message : 'Failed to start OCR');
            setOcrStatus('error');
        }
    }, [jobId, refreshOcrStatus]);

    const clipPath = useMemo(() => (crop ? cropBoxToClipPathInset(crop) : undefined), [crop]);

    if (!jobId) {
        return null;
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">OCR</div>
                    <div className="flex items-center gap-2">
                        <div className="text-zinc-600 dark:text-zinc-400">Status: {ocrStatus}</div>
                        <Button type="button" variant="secondary" onClick={runOcr} disabled={ocrStatus === 'running'}>
                            {ocrStatus === 'running' ? 'Running OCR…' : 'Run OCR'}
                        </Button>
                    </div>
                </div>
                {ocrError ? <div className="mt-2 text-red-600 dark:text-red-400">{ocrError}</div> : null}
                {ocrDelivery ? (
                    <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Delivery: {ocrDelivery.kind}</div>
                ) : null}
                {ocrMeta ? (
                    <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">Meta: {JSON.stringify(ocrMeta)}</div>
                ) : null}
                <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                    Tip: click a page preview to select it for OCR viewing; use “Crop” to adjust the crop box.
                </div>
            </div>

            {selectedPage && ocrStatus === 'complete' && ocrPageData ? (
                <div className="grid gap-4 md:grid-cols-2">
                    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                        <div className="border-zinc-200 border-b px-3 py-2 text-xs dark:border-zinc-800">
                            <div className="font-medium">Page {selectedPage}</div>
                        </div>
                        <div className="relative aspect-[3/4]">
                            <Image
                                alt={`Page ${selectedPage}`}
                                src={`/api/jobs/${encodeURIComponent(jobId)}/images/${selectedPage}`}
                                fill
                                sizes="(min-width: 1024px) 45vw, 90vw"
                                className="bg-white object-contain dark:bg-zinc-950"
                                style={clipPath ? { clipPath } : undefined}
                            />
                        </div>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                        <div className="border-zinc-200 border-b px-3 py-2 text-xs dark:border-zinc-800">
                            <div className="font-medium">OCR text</div>
                            <div className="text-zinc-600 dark:text-zinc-400">
                                {ocrPageData.observations.length} observations
                            </div>
                        </div>
                        <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap px-3 py-2 text-sm">
                            {ocrPageData.observations.map((o) => o.text).join('\n')}
                        </pre>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
