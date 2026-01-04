import * as fsp from 'node:fs/promises';
import type { MacOCR } from '@/lib/macOcr';
import { readJobSnapshot } from '@/server/jobs/jobSnapshot';
import { globalJobStore } from '@/server/jobs/jobStore';
import type { OcrDeliveryPreferredKind } from '@/server/ocr/ocrDelivery';
import { selectOcrDelivery } from '@/server/ocr/ocrDelivery';
import { jobOcrJsonPath, jobOcrMetaPath, jobOcrPagesDir } from '@/server/ocr/ocrPaths';
import { runMacOcr } from '@/server/ocr/runMacOcr';

export const runtime = 'nodejs';

const DEFAULT_INLINE_THRESHOLD_BYTES = 1_000_000;

function getPreferredKindFromUrl(requestUrl: string): OcrDeliveryPreferredKind {
    const url = new URL(requestUrl);
    const k = url.searchParams.get('delivery');
    if (k === 'inline' || k === 'file' || k === 'pages' || k === 'auto') {
        return k;
    }
    return 'auto';
}

function readInlineThresholdBytesFromEnv(): number {
    const raw = process.env.SWISSAWA_OCR_INLINE_THRESHOLD_BYTES;
    if (!raw) {
        return DEFAULT_INLINE_THRESHOLD_BYTES;
    }
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
        return DEFAULT_INLINE_THRESHOLD_BYTES;
    }
    return n;
}

async function exists(p: string): Promise<boolean> {
    try {
        await fsp.stat(p);
        return true;
    } catch {
        return false;
    }
}

async function ensureJobInStore(jobId: string): Promise<void> {
    if (globalJobStore.get(jobId)) {
        return;
    }
    const snap = await readJobSnapshot(jobId);
    if (!snap) {
        return;
    }
    globalJobStore.create({
        crop: snap.crop,
        error: snap.error,
        id: snap.id,
        info: snap.info,
        ocr: snap.ocr,
        outputDir: snap.outputDir,
        pdfPath: snap.pdfPath,
        progress: snap.progress,
        sourceUrl: snap.sourceUrl,
        status: snap.status,
    });
}

export async function POST(_request: Request, ctx: { params: Promise<{ jobId: string }> }): Promise<Response> {
    const { jobId } = await ctx.params;
    console.info('[jobs.ocr.post]', { jobId });
    await ensureJobInStore(jobId);
    if (!globalJobStore.get(jobId)) {
        console.warn('[jobs.ocr.post.not_found]', { jobId });
        return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    const job = globalJobStore.get(jobId)!;
    if (job.ocr?.status === 'running') {
        console.info('[jobs.ocr.post.already_running]', { jobId });
        return Response.json({ status: 'running' });
    }
    if (job.ocr?.status === 'complete') {
        console.info('[jobs.ocr.post.already_complete]', { jobId });
        return Response.json({ status: 'complete' });
    }

    // Fire-and-forget: OCR can take a long time; the UI should poll GET /ocr for status.
    console.info('[jobs.ocr.start]', { jobId });
    void runMacOcr({ jobId, store: globalJobStore }).catch((err: unknown) => {
        console.error('[jobs.ocr]', { jobId, message: err instanceof Error ? err.message : String(err) });
    });
    return Response.json({ status: 'running' });
}

export async function GET(request: Request, ctx: { params: Promise<{ jobId: string }> }): Promise<Response> {
    const { jobId } = await ctx.params;
    const job = globalJobStore.get(jobId) ?? (await readJobSnapshot(jobId));
    if (!job) {
        return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    const status = job.ocr?.status ?? 'idle';
    const error = job.ocr?.status === 'error' ? (job.ocr?.error ?? 'OCR failed') : undefined;
    const metaRaw = await fsp.readFile(jobOcrMetaPath(jobId), 'utf8').catch(() => null);
    const meta = metaRaw ? (JSON.parse(metaRaw) as unknown) : null;

    if (status !== 'complete') {
        return Response.json({ error, meta, status });
    }

    const rawBytes = await fsp
        .stat(jobOcrJsonPath(jobId))
        .then((s) => s.size)
        .catch(() => 0);
    const hasPagesSplit = await exists(jobOcrPagesDir(jobId));

    const fileUrl = `/api/jobs/${encodeURIComponent(jobId)}/ocr/file`;
    const pagesBaseUrl = `/api/jobs/${encodeURIComponent(jobId)}/ocr/pages`;
    const preferredKind = getPreferredKindFromUrl(request.url);
    const inlineThresholdBytes = readInlineThresholdBytesFromEnv();

    // Inline only if explicitly requested or file is small; otherwise file/pages.
    let ocr: MacOCR | undefined;
    if (preferredKind === 'inline' || rawBytes <= inlineThresholdBytes) {
        const raw = await fsp.readFile(jobOcrJsonPath(jobId), 'utf8');
        ocr = JSON.parse(raw) as MacOCR;
    }

    const totalPages =
        typeof (meta as any)?.totalPages === 'number' ? ((meta as any).totalPages as number) : job.progress.totalPages;

    const delivery = selectOcrDelivery({
        fileUrl,
        hasPagesSplit,
        inlineThresholdBytes,
        ocr,
        pagesBaseUrl,
        preferredKind,
        rawJsonBytes: rawBytes,
        totalPages,
    });

    return Response.json({ delivery, meta, status });
}
