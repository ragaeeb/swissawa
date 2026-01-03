import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { normalizeCropBox } from '@/lib/cropConvert';
import { readCropBox } from '@/server/crop/cropStore';
import { jobDir, jobPdfPath } from '@/server/jobs/jobPaths';
import { readJobSnapshot } from '@/server/jobs/jobSnapshot';
import { globalJobStore } from '@/server/jobs/jobStore';
import { cropPdfBytes } from '@/server/pdf/cropPdf';

export const runtime = 'nodejs';

function cropCachePath(
    jobId: string,
    crop: { x: number; y: number; width: number; height: number },
    shrinkPage: boolean,
): string {
    const hash = createHash('sha256').update(JSON.stringify({ crop, shrinkPage })).digest('hex').slice(0, 16);
    return path.join(jobDir(jobId), `cropped-${hash}.pdf`);
}

export async function GET(request: Request, ctx: { params: Promise<{ jobId: string }> }): Promise<Response> {
    const { jobId } = await ctx.params;
    const url = new URL(request.url);
    const shrinkPage = url.searchParams.get('shrink') === '1';

    const job = globalJobStore.get(jobId) ?? (await readJobSnapshot(jobId));
    if (!job) {
        return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    const pdfPath = job.pdfPath ?? jobPdfPath(jobId);
    const original = await fsp.readFile(pdfPath);

    const crop = job.crop ?? (await readCropBox(jobId));
    if (!crop) {
        console.info('[jobs.download]', { jobId, mode: 'original' });
        return new Response(original, {
            headers: {
                'Content-Disposition': `attachment; filename="swissawa-${jobId}.pdf"`,
                'Content-Type': 'application/pdf',
            },
        });
    }

    const normalized = normalizeCropBox(crop);
    if (normalized.x === 0 && normalized.y === 0 && normalized.width === 1 && normalized.height === 1) {
        console.info('[jobs.download]', { jobId, mode: 'original-full-crop' });
        return new Response(original, {
            headers: {
                'Content-Disposition': `attachment; filename="swissawa-${jobId}.pdf"`,
                'Content-Type': 'application/pdf',
            },
        });
    }

    const cachedPath = cropCachePath(jobId, normalized, shrinkPage);
    try {
        const cached = await fsp.readFile(cachedPath);
        console.info('[jobs.download]', { cached: true, jobId, mode: 'cropped', path: cachedPath, shrinkPage });
        return new Response(cached, {
            headers: {
                'Content-Disposition': `attachment; filename="swissawa-${jobId}-cropped.pdf"`,
                'Content-Type': 'application/pdf',
            },
        });
    } catch {
        // regenerate below
    }

    const cropped = await cropPdfBytes(original, normalized, { shrinkPage });
    await fsp.mkdir(jobDir(jobId), { recursive: true });
    await fsp.writeFile(cachedPath, cropped);
    console.info('[jobs.download]', { cached: false, jobId, mode: 'cropped', path: cachedPath, shrinkPage });

    return new Response(cropped, {
        headers: {
            'Content-Disposition': `attachment; filename="swissawa-${jobId}-cropped.pdf"`,
            'Content-Type': 'application/pdf',
        },
    });
}
