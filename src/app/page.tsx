'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CropDialog } from '@/components/CropDialog';
import { ImageGallery } from '@/components/ImageGallery';
import { StatusDisplay } from '@/components/StatusDisplay';
import { UploadZone } from '@/components/UploadZone';
import { Button } from '@/components/ui/button';
import type { CropBox } from '@/server/crop/crop';

export default function Home() {
    const [uploading, setUploading] = useState(false);
    const [jobId, setJobId] = useState<string | null>(null);
    const [status, setStatus] = useState<string>('idle');
    const [error, setError] = useState<string | null>(null);
    const [pages, setPages] = useState<number | null>(null);
    const [extractedPages, setExtractedPages] = useState<number>(0);
    const [meta, setMeta] = useState<Record<string, unknown> | null>(null);
    const [previewCount, setPreviewCount] = useState<number>(24);
    const [crop, setCrop] = useState<CropBox | null>(null);
    const [cropPage, setCropPage] = useState<number | null>(null);
    const [cropOpen, setCropOpen] = useState(false);

    const esRef = useRef<EventSource | null>(null);

    useEffect(() => {
        if (jobId) {
            return;
        }
        const saved = localStorage.getItem('swissawa:lastJobId');
        if (saved) {
            setJobId(saved);
        }
    }, [jobId]);

    const progressPct = useMemo(() => {
        if (!pages || pages <= 0) {
            return 0;
        }
        return Math.min(100, Math.round((extractedPages / pages) * 100));
    }, [extractedPages, pages]);

    useEffect(() => {
        if (!jobId) {
            return;
        }

        // Load a job snapshot on refresh (works even if in-memory job store was reset).
        void (async () => {
            const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
            if (!res.ok) {
                return;
            }
            const data = (await res.json()) as any;
            setStatus(data.job.status);
            setExtractedPages(data.job.progress.extractedPages ?? 0);
            setPages(data.job.progress.totalPages ?? null);
            setMeta(data.job.info ?? null);
        })();
    }, [jobId]);

    useEffect(() => {
        if (!jobId) {
            return;
        }
        if (esRef.current) {
            esRef.current.close();
        }

        // If the job is already complete, don't open SSE (it may not be available after refresh).
        if (status === 'complete' || status === 'error') {
            return;
        }

        const es = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
        esRef.current = es;

        es.addEventListener('snapshot', (ev) => {
            const data = JSON.parse((ev as MessageEvent).data) as any;
            setStatus(data.job.status);
            setExtractedPages(data.job.progress.extractedPages ?? 0);
            setPages(data.job.progress.totalPages ?? null);
            setMeta(data.job.info ?? null);
        });

        es.addEventListener('pdf', (ev) => {
            const data = JSON.parse((ev as MessageEvent).data) as any;
            setMeta(data);
            setPages((p) => p ?? (typeof data.pages === 'number' ? data.pages : null));
        });

        es.addEventListener('progress', (ev) => {
            const data = JSON.parse((ev as MessageEvent).data) as any;
            setExtractedPages(data.extractedPages ?? 0);
            setPages((p) => data.totalPages ?? p);
        });

        es.addEventListener('complete', () => {
            setStatus('complete');
            es.close();
        });

        es.addEventListener('error', (ev) => {
            try {
                const data = JSON.parse((ev as MessageEvent).data) as any;
                setError(data?.message ?? 'Error');
            } catch {
                setError('Error');
            }
            setStatus('error');
            es.close();
        });

        return () => {
            es.close();
            esRef.current = null;
        };
    }, [jobId, status]);

    useEffect(() => {
        if (!jobId) {
            setCrop(null);
            return;
        }
        void (async () => {
            const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/crop`);
            if (!res.ok) {
                return;
            }
            const data = (await res.json()) as { crop: CropBox | null };
            setCrop(data.crop ?? null);
        })();
    }, [jobId]);

    const uploadPdf = async (file: File) => {
        try {
            setError(null);
            setUploading(true);
            setStatus('uploading');
            setJobId(null);
            setPages(null);
            setMeta(null);
            setExtractedPages(0);

            const form = new FormData();
            form.append('file', file);

            const resp = await fetch('/api/upload', { body: form, method: 'POST' });
            if (!resp.ok) {
                const body = await resp.json().catch(() => null);
                throw new Error(body?.error ?? `Upload failed (${resp.status})`);
            }
            const body = (await resp.json()) as { jobId: string };
            setJobId(body.jobId);
            localStorage.setItem('swissawa:lastJobId', body.jobId);
            setStatus('processing');
            setUploading(false);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Upload failed');
            setStatus('error');
            setUploading(false);
        }
    };

    const previewPages = useMemo(() => {
        if (!jobId || !pages) {
            return [];
        }
        const count = Math.min(pages, previewCount);
        return Array.from({ length: count }, (_, i) => i + 1);
    }, [jobId, pages, previewCount]);

    const canLoadMore = Boolean(pages && previewCount < pages);

    const cleanupJob = async () => {
        if (!jobId) {
            return;
        }
        const ok = window.confirm('Delete cached PDF + extracted images for this job? This cannot be undone.');
        if (!ok) {
            return;
        }
        setError(null);
        try {
            const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.error ?? `Cleanup failed (${res.status})`);
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Cleanup failed');
        } finally {
            // Reset client state regardless; the intent is to clear the UI.
            localStorage.removeItem('swissawa:lastJobId');
            setJobId(null);
            setPages(null);
            setMeta(null);
            setExtractedPages(0);
            setStatus('idle');
            setPreviewCount(24);
            setCrop(null);
            setCropOpen(false);
            setCropPage(null);
        }
    };

    return (
        <div className="min-h-screen bg-zinc-50 font-sans text-zinc-950 dark:bg-black dark:text-zinc-50">
            <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-12">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-col gap-1">
                        <h1 className="font-semibold text-2xl tracking-tight">PDF → images</h1>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">
                            Drag & drop a PDF. We’ll upload it and stream extraction progress via SSE.
                        </p>
                    </div>
                    <Image className="opacity-80 dark:invert" src="/icon.png" alt="Swissawa" width={40} height={40} />
                </div>

                <UploadZone onFileSelected={uploadPdf} isUploading={uploading} error={error} />

                <StatusDisplay
                    status={status}
                    jobId={jobId}
                    extractedPages={extractedPages}
                    pages={pages}
                    progressPct={progressPct}
                    meta={meta}
                />

                {jobId ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => {
                                window.location.href = `/api/jobs/${encodeURIComponent(jobId)}/download`;
                            }}
                        >
                            Download PDF (cropped)
                        </Button>
                        <Button type="button" variant="destructive" onClick={cleanupJob}>
                            Cleanup cached files
                        </Button>
                    </div>
                ) : null}

                {jobId && pages ? (
                    <ImageGallery
                        jobId={jobId}
                        extractedPages={extractedPages}
                        previewPages={previewPages}
                        onLoadMore={() => setPreviewCount((c) => c + 24)}
                        canLoadMore={canLoadMore}
                        crop={crop}
                        onCropPage={(p) => {
                            setCropPage(p);
                            setCropOpen(true);
                        }}
                    />
                ) : null}

                {jobId && cropPage ? (
                    <CropDialog
                        open={cropOpen}
                        onOpenChange={setCropOpen}
                        jobId={jobId}
                        pageNumber={cropPage}
                        initialCrop={crop}
                        onSave={async (nextCrop) => {
                            const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/crop`, {
                                body: JSON.stringify({ crop: nextCrop }),
                                headers: { 'content-type': 'application/json' },
                                method: 'POST',
                            });
                            if (res.ok) {
                                const data = (await res.json()) as { crop: CropBox };
                                setCrop(data.crop);
                            }
                        }}
                    />
                ) : null}
            </main>
        </div>
    );
}
