import * as fsp from 'node:fs/promises';
import { readJobSnapshot } from '@/server/jobs/jobSnapshot';
import { globalJobStore } from '@/server/jobs/jobStore';
import { jobSuryaMetaPath, jobSuryaPagesDir } from '@/server/ocr/ocrPaths';
import { runSuryaOcr } from '@/server/ocr/runSuryaOcr';

export const runtime = 'nodejs';

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
        suryaOcr: snap.suryaOcr,
    });
}

export async function POST(_request: Request, ctx: { params: Promise<{ jobId: string }> }): Promise<Response> {
    const { jobId } = await ctx.params;
    console.info('[jobs.surya.post]', { jobId });
    await ensureJobInStore(jobId);
    if (!globalJobStore.get(jobId)) {
        console.warn('[jobs.surya.post.not_found]', { jobId });
        return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    const job = globalJobStore.get(jobId)!;
    if (job.suryaOcr?.status === 'running') {
        console.info('[jobs.surya.post.already_running]', { jobId });
        return Response.json({ status: 'running' });
    }
    if (job.suryaOcr?.status === 'complete') {
        console.info('[jobs.surya.post.already_complete]', { jobId });
        return Response.json({ status: 'complete' });
    }

    // Fire-and-forget: Surya OCR can take a long time; the UI should poll GET /surya for status.
    console.info('[jobs.surya.start]', { jobId });
    void runSuryaOcr({ jobId, store: globalJobStore }).catch((err: unknown) => {
        console.error('[jobs.surya]', { jobId, message: err instanceof Error ? err.message : String(err) });
    });
    return Response.json({ status: 'running' });
}

export async function GET(_request: Request, ctx: { params: Promise<{ jobId: string }> }): Promise<Response> {
    const { jobId } = await ctx.params;
    const job = globalJobStore.get(jobId) ?? (await readJobSnapshot(jobId));
    if (!job) {
        return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    const status = job.suryaOcr?.status ?? 'idle';
    const error = job.suryaOcr?.status === 'error' ? (job.suryaOcr?.error ?? 'Surya OCR failed') : undefined;
    const metaRaw = await fsp.readFile(jobSuryaMetaPath(jobId), 'utf8').catch(() => null);
    const meta = metaRaw ? (JSON.parse(metaRaw) as unknown) : null;

    if (status !== 'complete') {
        return Response.json({ error, meta, status });
    }

    const hasPagesSplit = await exists(jobSuryaPagesDir(jobId));
    const pagesBaseUrl = `/api/jobs/${encodeURIComponent(jobId)}/surya/pages`;
    const totalPages =
        typeof (meta as any)?.totalPages === 'number' ? ((meta as any).totalPages as number) : job.progress.totalPages;

    return Response.json({
        delivery: { kind: hasPagesSplit ? 'pages' : 'file', pagesBaseUrl, totalPages },
        meta,
        status,
    });
}
