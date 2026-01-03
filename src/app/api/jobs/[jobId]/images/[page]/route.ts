import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { globalJobStore } from '@/server/jobs/jobStore';
import { resolveJobImagePath } from '@/server/pdf/imageResolve';

export const runtime = 'nodejs';

export const GET = async (
    _request: Request,
    { params }: { params: { jobId: string; page: string } },
): Promise<Response> => {
    const jobId = params.jobId;
    const page = Number.parseInt(params.page, 10);

    if (!Number.isFinite(page) || page <= 0) {
        return new Response('Invalid page', { status: 400 });
    }

    const job = globalJobStore.get(jobId);
    const outputDir = job?.outputDir ?? path.join(os.tmpdir(), 'swissawa', jobId, 'images');
    const totalPages = job?.info?.pages ?? job?.progress.totalPages;

    const filePath = await resolveJobImagePath({ outputDir, pageNumber: page, totalPages });
    if (!filePath) {
        return new Response('Not found', { status: 404 });
    }

    const nodeStream = fs.createReadStream(filePath);
    const body = Readable.toWeb(nodeStream as any) as any;

    return new Response(body, {
        headers: { 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Type': 'image/jpeg' },
    });
};
