'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import { ImageGallery } from '@/components/ImageGallery';
import { StatusDisplay } from '@/components/StatusDisplay';
import { UploadZone } from '@/components/UploadZone';

export default function Home() {
    const [uploading, setUploading] = useState(false);
    const [jobId, setJobId] = useState<string | null>(null);
    const [status, setStatus] = useState<string>('idle');
    const [error, setError] = useState<string | null>(null);
    const [pages, setPages] = useState<number | null>(null);
    const [extractedPages, setExtractedPages] = useState<number>(0);
    const [meta, setMeta] = useState<Record<string, unknown> | null>(null);
    const [previewCount, setPreviewCount] = useState<number>(24);

    const progressPct = useMemo(() => {
        if (!pages || pages <= 0) {
            return 0;
        }
        return Math.min(100, Math.round((extractedPages / pages) * 100));
    }, [extractedPages, pages]);

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
            setStatus('processing');
            setUploading(false);

            const es = new EventSource(`/api/jobs/${encodeURIComponent(body.jobId)}/events`);
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
                setPages(data.totalPages ?? pages);
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

                {jobId && pages ? (
                    <ImageGallery
                        jobId={jobId}
                        pages={pages}
                        extractedPages={extractedPages}
                        previewPages={previewPages}
                        onLoadMore={() => setPreviewCount((c) => c + 24)}
                    />
                ) : null}
            </main>
        </div>
    );
}
