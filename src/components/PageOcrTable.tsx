'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ObservationPage } from '@/lib/macOcr';
import type { CropBox } from '@/server/crop/crop';
import { cropBoxToClipPathInset } from '@/server/crop/crop';

type OcrStatus = 'idle' | 'running' | 'complete' | 'error';

type OcrProgress = { line: string; currentPage?: number; totalPages?: number };

function isProbablyRtl(text: string): boolean {
    // Arabic + Arabic Supplement + Arabic Extended-A + Arabic Presentation Forms + Hebrew
    return /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

type OcrStatusResponse = { status: OcrStatus; error?: string };

function scheduleOcrStatusSyncs(params: {
    jobId: string;
    setOcrError: (v: string | null) => void;
    setOcrReady: (v: boolean) => void;
    setOcrStatus: (v: OcrStatus) => void;
}) {
    // Bounded fallback: if SSE is blocked or misses the terminal event, sync status a few times.
    const delays = [500, 1500, 3000];
    for (const d of delays) {
        window.setTimeout(() => {
            void (async () => {
                try {
                    const r = await fetch(`/api/jobs/${encodeURIComponent(params.jobId)}/ocr`);
                    if (!r.ok) {
                        return;
                    }
                    const data = (await r.json()) as OcrStatusResponse;
                    if (data.status === 'complete') {
                        params.setOcrStatus('complete');
                        params.setOcrReady(true);
                    } else if (data.status === 'error') {
                        params.setOcrStatus('error');
                        params.setOcrError(data.error ?? 'OCR error');
                    }
                } catch {
                    // ignore
                }
            })();
        }, d);
    }
}

async function fetchOcrTextForPage(jobId: string, pageNumber: number, signal: AbortSignal): Promise<string | null> {
    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/ocr/pages/${pageNumber}`, { signal });
    if (!res.ok) {
        return null;
    }
    const page = (await res.json()) as ObservationPage;
    return page.observations.map((o) => o.text).join('\n');
}

function PageRow({
    clipPath,
    extractedPages,
    jobId,
    ocrReady,
    ocrText,
    onCropPage,
    pageNumber,
}: {
    pageNumber: number;
    jobId: string;
    extractedPages: number;
    onCropPage: (pageNumber: number) => void;
    clipPath?: string;
    ocrReady: boolean;
    ocrText?: string;
}) {
    return (
        <TableRow>
            <TableCell className="font-medium">
                <div>{pageNumber}</div>
            </TableCell>
            <TableCell>
                <div className="relative aspect-[3/4] w-[260px] overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                    {pageNumber <= extractedPages ? (
                        <button
                            type="button"
                            className="absolute inset-0"
                            onClick={() => onCropPage(pageNumber)}
                            aria-label={`Crop from page ${pageNumber}`}
                        >
                            <Image
                                alt={`Page ${pageNumber}`}
                                src={`/api/jobs/${encodeURIComponent(jobId)}/images/${pageNumber}`}
                                fill
                                sizes="260px"
                                className="object-contain"
                                style={clipPath ? { clipPath } : undefined}
                            />
                        </button>
                    ) : (
                        <div className="flex h-full items-center justify-center text-sm text-zinc-600 dark:text-zinc-400">
                            Extracting…
                        </div>
                    )}
                </div>
            </TableCell>
            <TableCell className="align-top">
                {ocrReady ? (
                    <div
                        dir={ocrText && isProbablyRtl(ocrText) ? 'rtl' : 'ltr'}
                        className={[
                            'whitespace-pre-wrap font-arabic text-[17px] leading-[1.8]',
                            ocrText && isProbablyRtl(ocrText) ? 'text-right' : 'text-left',
                        ].join(' ')}
                    >
                        {ocrText ?? (pageNumber <= extractedPages ? 'Loading…' : '')}
                    </div>
                ) : (
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">Run OCR to populate text.</div>
                )}
            </TableCell>
        </TableRow>
    );
}

export function PageOcrTable({
    canLoadMore,
    crop,
    extractedPages,
    jobId,
    onCropPage,
    onLoadMore,
    pages,
    previewPages,
}: {
    jobId: string;
    previewPages: number[];
    pages: number;
    extractedPages: number;
    crop: CropBox | null;
    canLoadMore: boolean;
    onLoadMore: () => void;
    onCropPage: (pageNumber: number) => void;
}) {
    const clipPath = useMemo(() => (crop ? cropBoxToClipPathInset(crop) : undefined), [crop]);
    const [ocrStatus, setOcrStatus] = useState<OcrStatus>('idle');
    const [ocrError, setOcrError] = useState<string | null>(null);
    const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
    const [ocrReady, setOcrReady] = useState(false);
    const [ocrTextByPage, setOcrTextByPage] = useState<Record<number, string>>({});

    const esRef = useRef<EventSource | null>(null);

    const ensureOcrEventSource = useCallback((): void => {
        if (esRef.current) {
            return;
        }
        console.info('[ocr.sse.client.connect]', { jobId });
        const es = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/ocr/events`);
        esRef.current = es;

        es.addEventListener('open', () => {
            console.info('[ocr.sse.client.open]', { jobId });
        });

        es.addEventListener('snapshot', (ev) => {
            const data = JSON.parse((ev as MessageEvent).data) as { status: OcrStatus; progress?: OcrProgress | null };
            setOcrStatus(data.status);
            setOcrProgress(data.progress ?? null);
            setOcrReady(data.status === 'complete');
        });

        es.addEventListener('progress', (ev) => {
            const data = JSON.parse((ev as MessageEvent).data) as OcrProgress;
            setOcrProgress(data);
            setOcrStatus('running');
        });

        es.addEventListener('complete', () => {
            setOcrStatus('complete');
            setOcrReady(true);
            es.close();
            esRef.current = null;
        });

        es.addEventListener('error', (ev) => {
            console.warn('[ocr.sse.client.error]', { ev, jobId });
            try {
                const data = JSON.parse((ev as MessageEvent).data) as any;
                setOcrError(data?.message ?? 'OCR error');
            } catch {
                setOcrError('OCR error');
            }
            setOcrStatus('error');
            es.close();
            esRef.current = null;
        });
    }, [jobId]);

    useEffect(() => {
        // Initialize state when job changes.
        setOcrStatus('idle');
        setOcrError(null);
        setOcrProgress(null);
        setOcrReady(false);
        setOcrTextByPage({});

        // Close any existing connection for previous job.
        if (esRef.current) {
            console.info('[ocr.sse.client.close]', { jobId });
            esRef.current.close();
            esRef.current = null;
        }

        // Connect immediately to observe status even if OCR is started elsewhere.
        ensureOcrEventSource();

        return () => {
            if (esRef.current) {
                console.info('[ocr.sse.client.close]', { jobId });
                esRef.current.close();
                esRef.current = null;
            }
        };
    }, [ensureOcrEventSource, jobId]);

    const runOcr = async () => {
        setOcrError(null);
        try {
            // Ensure we have an SSE connection before starting OCR so we don't miss early events.
            console.info('[ocr.ui.run]', { jobId });
            ensureOcrEventSource();
            const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/ocr`, { method: 'POST' });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error ?? `Failed to start OCR (${res.status})`);
            }
            setOcrStatus('running');
            // Fallback: one-shot status sync in case SSE is blocked by the browser or dev tooling.
            scheduleOcrStatusSyncs({ jobId, setOcrError, setOcrReady, setOcrStatus });
        } catch (err: unknown) {
            setOcrError(err instanceof Error ? err.message : 'Failed to start OCR');
            setOcrStatus('error');
        }
    };

    useEffect(() => {
        if (!ocrReady) {
            return;
        }
        const controller = new AbortController();

        void (async () => {
            try {
                for (const p of previewPages) {
                    if (controller.signal.aborted) {
                        return;
                    }
                    if (p > extractedPages) {
                        continue;
                    }
                    if (ocrTextByPage[p]) {
                        continue;
                    }
                    const text = await fetchOcrTextForPage(jobId, p, controller.signal);
                    if (!text) {
                        continue;
                    }
                    setOcrTextByPage((m) => ({ ...m, [p]: text }));
                }
            } catch (err: unknown) {
                if (err instanceof Error && err.name === 'AbortError') {
                    return;
                }
                // ignore other errors; rows will stay in "Loading…" and can be retried on rerender
            }
        })();

        return () => controller.abort();
    }, [extractedPages, jobId, ocrReady, ocrTextByPage, previewPages]);

    const progressLabel =
        ocrProgress?.currentPage && ocrProgress?.totalPages
            ? `Processing page ${ocrProgress.currentPage} of ${ocrProgress.totalPages}…`
            : (ocrProgress?.line ?? null);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                    <h2 className="font-semibold text-lg">Pages</h2>
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">
                        Showing {previewPages.length} / {pages}
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="secondary" onClick={runOcr} disabled={ocrStatus === 'running'}>
                        {ocrStatus === 'running' ? 'Running OCR…' : 'Run OCR'}
                    </Button>
                    <div className="text-xs text-zinc-600 dark:text-zinc-400">OCR: {ocrStatus}</div>
                </div>
            </div>

            {progressLabel ? <div className="text-xs text-zinc-600 dark:text-zinc-400">{progressLabel}</div> : null}
            {ocrError ? <div className="text-red-600 text-sm dark:text-red-400">{ocrError}</div> : null}

            <Table className="table-fixed">
                <colgroup>
                    <col style={{ width: 80 }} />
                    <col style={{ width: 300 }} />
                    <col />
                </colgroup>
                <TableHeader>
                    <TableRow>
                        <TableHead>Page</TableHead>
                        <TableHead>Image</TableHead>
                        <TableHead>OCR text</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {previewPages.map((p) => (
                        <PageRow
                            key={p}
                            pageNumber={p}
                            jobId={jobId}
                            extractedPages={extractedPages}
                            onCropPage={onCropPage}
                            clipPath={clipPath}
                            ocrReady={ocrReady}
                            ocrText={ocrTextByPage[p]}
                        />
                    ))}
                </TableBody>
            </Table>

            {canLoadMore ? (
                <div className="flex justify-center">
                    <Button type="button" variant="secondary" onClick={onLoadMore}>
                        Load more
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
