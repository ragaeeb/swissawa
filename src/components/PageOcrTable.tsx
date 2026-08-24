'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Coordinates, ObservationPage } from '@/lib/macOcr';
import { mapSkaluLayoutsByPage, type OcrPageText, type PageLayoutsByPage, pageToOcrPageText } from '@/lib/ocrPageText';
import type { AnalyzeApiResponse } from '@/lib/skalu';
import type { CropBox } from '@/server/crop/crop';
import { cropBoxToClipPathInset } from '@/server/crop/crop';

type OcrStatus = 'idle' | 'running' | 'complete' | 'error';
type OcrEngine = 'macOCR' | 'surya' | 'both';
type OcrTextMode = 'lines' | 'paragraphs';
type OcrPagesResponse = { dpi?: Coordinates; pages: ObservationPage[] };

type OcrProgress = { line: string; currentPage?: number; totalPages?: number; phase?: string };
const DEFAULT_DPI: Coordinates = { x: 72, y: 72 };

function isProbablyRtl(text: string): boolean {
    return /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

type OcrStatusResponse = { status: OcrStatus; error?: string };

function scheduleOcrStatusSyncs(params: {
    endpoint: string;
    setOcrError: (v: string | null) => void;
    setOcrReady: (v: boolean) => void;
    setOcrStatus: (v: OcrStatus) => void;
}) {
    const delays = [500, 1500, 3000];
    for (const d of delays) {
        window.setTimeout(() => {
            void (async () => {
                try {
                    const r = await fetch(params.endpoint);
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
                    /* ignore */
                }
            })();
        }, d);
    }
}

const normalizeDpi = (dpi: Coordinates | undefined): Coordinates => {
    if (!dpi) {
        return DEFAULT_DPI;
    }
    const x = Number(dpi.x);
    const y = Number(dpi.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) {
        return DEFAULT_DPI;
    }
    return { x, y };
};

const fetchOcrPages = async (
    jobId: string,
    engine: 'ocr' | 'surya',
    signal: AbortSignal,
): Promise<OcrPagesResponse | null> => {
    try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/${engine}/pages`, { signal });
        if (!res.ok) {
            return null;
        }
        return (await res.json()) as OcrPagesResponse;
    } catch (err: unknown) {
        // AbortError is expected when component unmounts or job changes
        if (err instanceof Error && err.name === 'AbortError') {
            return null;
        }
        console.warn('[fetchOcrPages.error]', { engine, err, jobId });
        return null;
    }
};

const mapPagesToTextByPage = (params: {
    layoutsByPage: PageLayoutsByPage;
    payload: OcrPagesResponse | null;
}): Record<number, OcrPageText> => {
    const { layoutsByPage, payload } = params;
    if (!payload) {
        return {};
    }

    const dpi = normalizeDpi(payload.dpi);
    const textByPage: Record<number, OcrPageText> = {};
    for (const page of payload.pages) {
        if (!Number.isInteger(page.page) || page.page <= 0) {
            continue;
        }
        textByPage[page.page] = pageToOcrPageText({ dpi, layout: layoutsByPage[page.page] ?? {}, page });
    }
    return textByPage;
};

function OcrTextCell({
    ready,
    text,
    extractedPages,
    pageNumber,
}: {
    ready: boolean;
    text?: string;
    extractedPages: number;
    pageNumber: number;
}) {
    if (!ready) {
        return <div className="text-xs text-zinc-600 dark:text-zinc-400">Run OCR to populate text.</div>;
    }
    return (
        <div
            dir={text && isProbablyRtl(text) ? 'rtl' : 'ltr'}
            className={[
                'whitespace-pre-wrap font-arabic text-[17px] leading-[1.8]',
                text && isProbablyRtl(text) ? 'text-right' : 'text-left',
            ].join(' ')}
        >
            {text ?? (pageNumber <= extractedPages ? 'Loading…' : '')}
        </div>
    );
}

function PageRow({
    clipPath,
    extractedPages,
    jobId,
    macOcrReady,
    macOcrText,
    suryaReady,
    suryaText,
    onCropPage,
    pageNumber,
    showMacOcr,
    showSurya,
}: {
    pageNumber: number;
    jobId: string;
    extractedPages: number;
    onCropPage: (pageNumber: number) => void;
    clipPath?: string;
    macOcrReady: boolean;
    macOcrText?: string;
    suryaReady: boolean;
    suryaText?: string;
    showMacOcr: boolean;
    showSurya: boolean;
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
            {showMacOcr && (
                <TableCell className="align-top">
                    <OcrTextCell
                        ready={macOcrReady}
                        text={macOcrText}
                        extractedPages={extractedPages}
                        pageNumber={pageNumber}
                    />
                </TableCell>
            )}
            {showSurya && (
                <TableCell className="align-top">
                    <OcrTextCell
                        ready={suryaReady}
                        text={suryaText}
                        extractedPages={extractedPages}
                        pageNumber={pageNumber}
                    />
                </TableCell>
            )}
        </TableRow>
    );
}

export function PageOcrTable({
    analyzeResult,
    canDetectStructures,
    canLoadMore,
    crop,
    detectingStructures,
    extractedPages,
    jobId,
    onDetectStructures,
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
    analyzeResult: AnalyzeApiResponse | null;
    canDetectStructures: boolean;
    detectingStructures: boolean;
    canLoadMore: boolean;
    onDetectStructures: () => void;
    onLoadMore: () => void;
    onCropPage: (pageNumber: number) => void;
}) {
    const clipPath = useMemo(() => (crop ? cropBoxToClipPathInset(crop) : undefined), [crop]);
    const [selectedEngine, setSelectedEngine] = useState<OcrEngine>('macOCR');
    const [ocrTextMode, setOcrTextMode] = useState<OcrTextMode>('lines');

    // macOCR state
    const [macOcrStatus, setMacOcrStatus] = useState<OcrStatus>('idle');
    const [macOcrError, setMacOcrError] = useState<string | null>(null);
    const [macOcrProgress, setMacOcrProgress] = useState<OcrProgress | null>(null);
    const [macOcrReady, setMacOcrReady] = useState(false);
    const [macOcrPayload, setMacOcrPayload] = useState<OcrPagesResponse | null>(null);
    const macOcrEsRef = useRef<EventSource | null>(null);

    // Surya state
    const [suryaStatus, setSuryaStatus] = useState<OcrStatus>('idle');
    const [suryaError, setSuryaError] = useState<string | null>(null);
    const [suryaProgress, setSuryaProgress] = useState<OcrProgress | null>(null);
    const [suryaReady, setSuryaReady] = useState(false);
    const [suryaPayload, setSuryaPayload] = useState<OcrPagesResponse | null>(null);
    const suryaEsRef = useRef<EventSource | null>(null);

    const showMacOcr = selectedEngine === 'macOCR' || selectedEngine === 'both';
    const showSurya = selectedEngine === 'surya' || selectedEngine === 'both';

    const layoutsByPage = useMemo(() => mapSkaluLayoutsByPage(analyzeResult?.pages ?? []), [analyzeResult]);

    const macOcrTextByPage = useMemo(
        () => mapPagesToTextByPage({ layoutsByPage, payload: macOcrPayload }),
        [layoutsByPage, macOcrPayload],
    );

    const suryaTextByPage = useMemo(
        () => mapPagesToTextByPage({ layoutsByPage, payload: suryaPayload }),
        [layoutsByPage, suryaPayload],
    );

    const createEventSource = useCallback(
        (
            endpoint: string,
            esRef: React.MutableRefObject<EventSource | null>,
            setStatus: (v: OcrStatus) => void,
            setProgress: (v: OcrProgress | null) => void,
            setReady: (v: boolean) => void,
            setError: (v: string | null) => void,
            label: string,
        ) => {
            if (esRef.current) {
                return;
            }
            console.info(`[${label}.sse.client.connect]`, { jobId });
            const es = new EventSource(endpoint);
            esRef.current = es;

            es.addEventListener('snapshot', (ev) => {
                const data = JSON.parse((ev as MessageEvent).data) as {
                    status: OcrStatus;
                    progress?: OcrProgress | null;
                };
                setStatus(data.status);
                setProgress(data.progress ?? null);
                setReady(data.status === 'complete');
            });

            es.addEventListener('progress', (ev) => {
                const data = JSON.parse((ev as MessageEvent).data) as OcrProgress;
                setProgress(data);
                setStatus('running');
            });

            es.addEventListener('complete', () => {
                setStatus('complete');
                setReady(true);
                es.close();
                esRef.current = null;
            });

            es.addEventListener('error', (ev) => {
                console.warn(`[${label}.sse.client.error]`, { ev, jobId });
                try {
                    const data = JSON.parse((ev as MessageEvent).data) as any;
                    setError(data?.message ?? 'OCR error');
                } catch {
                    setError('OCR error');
                }
                setStatus('error');
                es.close();
                esRef.current = null;
            });
        },
        [jobId],
    );

    const ensureMacOcrEventSource = useCallback(() => {
        createEventSource(
            `/api/jobs/${encodeURIComponent(jobId)}/ocr/events`,
            macOcrEsRef,
            setMacOcrStatus,
            setMacOcrProgress,
            setMacOcrReady,
            setMacOcrError,
            'macOcr',
        );
    }, [createEventSource, jobId]);

    const ensureSuryaEventSource = useCallback(() => {
        createEventSource(
            `/api/jobs/${encodeURIComponent(jobId)}/surya/events`,
            suryaEsRef,
            setSuryaStatus,
            setSuryaProgress,
            setSuryaReady,
            setSuryaError,
            'surya',
        );
    }, [createEventSource, jobId]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: jobId is intentionally included to reset state when job changes
    useEffect(() => {
        // Reset state when job changes
        setMacOcrStatus('idle');
        setMacOcrError(null);
        setMacOcrProgress(null);
        setMacOcrReady(false);
        setMacOcrPayload(null);
        setSuryaStatus('idle');
        setSuryaError(null);
        setSuryaProgress(null);
        setSuryaReady(false);
        setSuryaPayload(null);

        macOcrEsRef.current?.close();
        macOcrEsRef.current = null;
        suryaEsRef.current?.close();
        suryaEsRef.current = null;

        // Connect to SSE immediately
        if (showMacOcr) {
            ensureMacOcrEventSource();
        }
        if (showSurya) {
            ensureSuryaEventSource();
        }

        return () => {
            macOcrEsRef.current?.close();
            macOcrEsRef.current = null;
            suryaEsRef.current?.close();
            suryaEsRef.current = null;
        };
    }, [jobId, showMacOcr, showSurya, ensureMacOcrEventSource, ensureSuryaEventSource]);

    const runOcr = async () => {
        setMacOcrError(null);
        setSuryaError(null);

        const promises: Promise<void>[] = [];

        if (showMacOcr) {
            setMacOcrPayload(null);
            ensureMacOcrEventSource();
            promises.push(
                (async () => {
                    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/ocr`, { method: 'POST' });
                    if (!res.ok) {
                        const body = await res.json().catch(() => null);
                        throw new Error(body?.error ?? `Failed to start macOCR (${res.status})`);
                    }
                    setMacOcrStatus('running');
                    scheduleOcrStatusSyncs({
                        endpoint: `/api/jobs/${encodeURIComponent(jobId)}/ocr`,
                        setOcrError: setMacOcrError,
                        setOcrReady: setMacOcrReady,
                        setOcrStatus: setMacOcrStatus,
                    });
                })().catch((err) => setMacOcrError(err.message)),
            );
        }

        if (showSurya) {
            setSuryaPayload(null);
            ensureSuryaEventSource();
            promises.push(
                (async () => {
                    const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/surya`, { method: 'POST' });
                    if (!res.ok) {
                        const body = await res.json().catch(() => null);
                        throw new Error(body?.error ?? `Failed to start Surya (${res.status})`);
                    }
                    setSuryaStatus('running');
                    scheduleOcrStatusSyncs({
                        endpoint: `/api/jobs/${encodeURIComponent(jobId)}/surya`,
                        setOcrError: setSuryaError,
                        setOcrReady: setSuryaReady,
                        setOcrStatus: setSuryaStatus,
                    });
                })().catch((err) => setSuryaError(err.message)),
            );
        }

        await Promise.all(promises);
    };

    // Fetch macOCR text once for all pages when ready.
    useEffect(() => {
        if (!macOcrReady) {
            return;
        }
        if (macOcrPayload) {
            return;
        }

        const controller = new AbortController();
        void (async () => {
            const payload = await fetchOcrPages(jobId, 'ocr', controller.signal);
            if (!payload || controller.signal.aborted) {
                return;
            }
            setMacOcrPayload(payload);
        })();
        return () => controller.abort();
    }, [jobId, macOcrPayload, macOcrReady]);

    // Fetch Surya text once for all pages when ready.
    useEffect(() => {
        if (!suryaReady) {
            return;
        }
        if (suryaPayload) {
            return;
        }

        const controller = new AbortController();
        void (async () => {
            const payload = await fetchOcrPages(jobId, 'surya', controller.signal);
            if (!payload || controller.signal.aborted) {
                return;
            }
            setSuryaPayload(payload);
        })();
        return () => controller.abort();
    }, [jobId, suryaPayload, suryaReady]);

    const formatProgressLabel = (progress: OcrProgress | null, status: OcrStatus, label: string): string | null => {
        if (status !== 'running') {
            return null;
        }
        // Show the actual line with percentage info if available
        if (progress?.line) {
            return `${label}: ${progress.line}`;
        }
        if (progress?.currentPage && progress?.totalPages) {
            return `${label}: Page ${progress.currentPage} of ${progress.totalPages}`;
        }
        return null;
    };

    const macOcrProgressLabel = formatProgressLabel(macOcrProgress, macOcrStatus, 'macOCR');
    const suryaProgressLabel = formatProgressLabel(suryaProgress, suryaStatus, 'Surya');

    const isRunning = (showMacOcr && macOcrStatus === 'running') || (showSurya && suryaStatus === 'running');

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
                    <select
                        value={selectedEngine}
                        onChange={(e) => setSelectedEngine(e.target.value as OcrEngine)}
                        className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    >
                        <option value="both">Both Engines</option>
                        <option value="macOCR">macOCR Only</option>
                        <option value="surya">Surya Only</option>
                    </select>
                    <Button type="button" variant="secondary" onClick={runOcr} disabled={isRunning}>
                        {isRunning ? 'Running OCR…' : 'Run OCR'}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => setOcrTextMode((mode) => (mode === 'lines' ? 'paragraphs' : 'lines'))}
                    >
                        {ocrTextMode === 'lines' ? 'Use Paragraph Blocks' : 'Use OCR Lines'}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onDetectStructures}
                        disabled={detectingStructures || !canDetectStructures}
                    >
                        {detectingStructures ? (
                            <>
                                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                Detecting...
                            </>
                        ) : (
                            'Detect Structures'
                        )}
                    </Button>
                </div>
            </div>

            {/* Progress and status display */}
            <div className="flex flex-wrap gap-4 text-xs text-zinc-600 dark:text-zinc-400">
                {showMacOcr && (
                    <div>
                        <span className="font-medium">macOCR:</span> {macOcrStatus}
                        {macOcrProgressLabel && <span className="ml-2">{macOcrProgressLabel}</span>}
                    </div>
                )}
                {showSurya && (
                    <div>
                        <span className="font-medium">Surya:</span> {suryaStatus}
                        {suryaProgressLabel && <span className="ml-2">{suryaProgressLabel}</span>}
                    </div>
                )}
            </div>

            {macOcrError && <div className="text-red-600 text-sm dark:text-red-400">macOCR: {macOcrError}</div>}
            {suryaError && <div className="text-red-600 text-sm dark:text-red-400">Surya: {suryaError}</div>}

            <Table className="table-fixed">
                <colgroup>
                    <col style={{ width: 80 }} />
                    <col style={{ width: 300 }} />
                    {showMacOcr && <col />}
                    {showSurya && <col />}
                </colgroup>
                <TableHeader>
                    <TableRow>
                        <TableHead>Page</TableHead>
                        <TableHead>Image</TableHead>
                        {showMacOcr && <TableHead>macOCR</TableHead>}
                        {showSurya && <TableHead>Surya</TableHead>}
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
                            macOcrReady={macOcrReady}
                            macOcrText={macOcrTextByPage[p]?.[ocrTextMode]}
                            suryaReady={suryaReady}
                            suryaText={suryaTextByPage[p]?.[ocrTextMode]}
                            showMacOcr={showMacOcr}
                            showSurya={showSurya}
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
