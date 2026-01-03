import * as fsp from 'node:fs/promises';
import { deleteHashIndexByJobId } from '@/server/jobs/hashIndex';
import { jobDir } from '@/server/jobs/jobPaths';
import { readJobSnapshot } from '@/server/jobs/jobSnapshot';
import { globalJobStore } from '@/server/jobs/jobStore';
import { jobImageUrl } from '@/server/pdf/extract';

export const runtime = 'nodejs';

const parseIntParam = (v: string | null): number | null => {
    if (v === null) {
        return null;
    }
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n)) {
        return null;
    }
    return n;
};

export const GET = async (request: Request, { params }: { params: Promise<{ jobId: string }> }): Promise<Response> => {
    const { jobId } = await params;
    const job = globalJobStore.get(jobId) ?? (await readJobSnapshot(jobId));
    if (!job) {
        return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    const url = new URL(request.url);
    const from = parseIntParam(url.searchParams.get('from'));
    const to = parseIntParam(url.searchParams.get('to'));

    const cacheHeaders = (): HeadersInit =>
        job.status === 'complete' ? { 'Cache-Control': 'public, max-age=3600, immutable' } : {};

    if (from !== null || to !== null) {
        if (from !== null && to !== null && from > to) {
            return Response.json({ error: 'from must be <= to' }, { status: 400 });
        }
        const totalPages = job.progress.totalPages;
        if (!totalPages) {
            return Response.json({ error: 'PDF page count not available yet' }, { status: 409 });
        }
        const start = Math.max(1, from ?? 1);
        const end = Math.min(totalPages, to ?? Math.min(totalPages, start + 49));
        const images = [];
        for (let p = start; p <= end; p += 1) {
            images.push({ pageNumber: p, url: jobImageUrl(jobId, p) });
        }
        return Response.json({ images, job }, { headers: cacheHeaders() });
    }

    return Response.json({ job }, { headers: cacheHeaders() });
};

export const DELETE = async (
    _request: Request,
    { params }: { params: Promise<{ jobId: string }> },
): Promise<Response> => {
    const { jobId } = await params;

    let dir: string;
    try {
        dir = jobDir(jobId);
    } catch (err: unknown) {
        return Response.json({ error: err instanceof Error ? err.message : 'Invalid jobId' }, { status: 400 });
    }

    const deletedHashes = await deleteHashIndexByJobId(jobId);
    globalJobStore.delete(jobId);
    await fsp.rm(dir, { force: true, recursive: true });

    console.info('[jobs.delete]', { deletedHashes, dir, jobId });
    return Response.json({ deletedHashes, jobId, ok: true });
};
