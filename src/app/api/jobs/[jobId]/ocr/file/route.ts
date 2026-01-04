import { createReadStream } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { Readable } from 'node:stream';
import { readJobSnapshot } from '@/server/jobs/jobSnapshot';
import { globalJobStore } from '@/server/jobs/jobStore';
import { jobOcrJsonPath } from '@/server/ocr/ocrPaths';

export const runtime = 'nodejs';

export async function GET(_request: Request, ctx: { params: Promise<{ jobId: string }> }): Promise<Response> {
    const { jobId } = await ctx.params;

    const job = globalJobStore.get(jobId) ?? (await readJobSnapshot(jobId));
    if (!job) {
        return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    const filePath = jobOcrJsonPath(jobId);
    try {
        await fsp.stat(filePath);
        const stream = createReadStream(filePath);
        return new Response(Readable.toWeb(stream) as any, {
            headers: {
                // Let the browser cache once OCR is complete.
                'Cache-Control': job.ocr?.status === 'complete' ? 'public, max-age=3600, immutable' : 'no-store',
                'Content-Type': 'application/json; charset=utf-8',
            },
        });
    } catch {
        return Response.json({ error: 'OCR file not found' }, { status: 404 });
    }
}
