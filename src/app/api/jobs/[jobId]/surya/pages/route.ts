import * as fsp from 'node:fs/promises';
import path from 'node:path';
import type { ObservationPage } from '@/lib/macOcr';
import { readJobSnapshot } from '@/server/jobs/jobSnapshot';
import { globalJobStore } from '@/server/jobs/jobStore';
import { jobSuryaPagesDir } from '@/server/ocr/ocrPaths';

export const runtime = 'nodejs';

const PAGE_FILE_RE = /^(\d+)\.json$/;

const listSortedPageFiles = async (pagesDir: string): Promise<string[]> => {
    const files = await fsp.readdir(pagesDir);
    return files
        .filter((name) => PAGE_FILE_RE.test(name))
        .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
};

const readPageJson = async (pagesDir: string, fileName: string): Promise<ObservationPage | null> => {
    try {
        const raw = await fsp.readFile(path.join(pagesDir, fileName), 'utf8');
        const page = JSON.parse(raw) as ObservationPage;
        if (!Number.isInteger(page.page) || page.page <= 0 || !Array.isArray(page.observations)) {
            return null;
        }
        return page;
    } catch {
        return null;
    }
};

export const GET = async (_request: Request, ctx: { params: Promise<{ jobId: string }> }): Promise<Response> => {
    const { jobId } = await ctx.params;
    const job = globalJobStore.get(jobId) ?? (await readJobSnapshot(jobId));
    if (!job) {
        return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    const pagesDir = jobSuryaPagesDir(jobId);
    let fileNames: string[];
    try {
        fileNames = await listSortedPageFiles(pagesDir);
    } catch {
        return Response.json({ error: 'Surya OCR pages not found' }, { status: 404 });
    }

    const pages: ObservationPage[] = [];
    for (const fileName of fileNames) {
        const page = await readPageJson(pagesDir, fileName);
        if (page) {
            pages.push(page);
        }
    }

    return Response.json(
        { pages },
        {
            headers: {
                'Cache-Control': job.suryaOcr?.status === 'complete' ? 'public, max-age=3600, immutable' : 'no-store',
            },
        },
    );
};
