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
    const job = globalJobStore.get(jobId);
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
