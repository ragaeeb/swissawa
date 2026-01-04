import { createReadStream } from 'node:fs';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { readJobSnapshot } from '@/server/jobs/jobSnapshot';
import { globalJobStore } from '@/server/jobs/jobStore';
import { jobSuryaPagesDir } from '@/server/ocr/ocrPaths';

export const runtime = 'nodejs';

function parsePageParam(v: string): number | null {
    const n = Number.parseInt(v, 10);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        return null;
    }
    return n;
}

export async function GET(
    _request: Request,
    ctx: { params: Promise<{ jobId: string; page: string }> },
): Promise<Response> {
    const { jobId, page } = await ctx.params;

    const job = globalJobStore.get(jobId) ?? (await readJobSnapshot(jobId));
    if (!job) {
        return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    const pageNumber = parsePageParam(page);
    if (!pageNumber) {
        return Response.json({ error: 'Invalid page' }, { status: 400 });
    }

    const filePath = path.join(jobSuryaPagesDir(jobId), `${pageNumber}.json`);
    try {
        await fsp.stat(filePath);
        const stream = createReadStream(filePath);
        return new Response(Readable.toWeb(stream) as any, {
            headers: {
                'Cache-Control': job.suryaOcr?.status === 'complete' ? 'public, max-age=3600, immutable' : 'no-store',
                'Content-Type': 'application/json; charset=utf-8',
            },
        });
    } catch {
        return Response.json({ error: 'Surya OCR page not found' }, { status: 404 });
    }
}
