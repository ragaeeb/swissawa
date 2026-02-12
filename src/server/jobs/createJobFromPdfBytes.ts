import { createHash, randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import { readHashIndex, writeHashIndex } from '@/server/jobs/hashIndex';
import { jobDir, jobImagesDir, jobPdfPath } from '@/server/jobs/jobPaths';
import { writeJobSnapshot } from '@/server/jobs/jobSnapshot';
import { globalJobStore } from '@/server/jobs/jobStore';
import { runPdfExtractionJob } from '@/server/pdf/runner';

export type CreateJobFromPdfBytesParams = { bytes: Uint8Array; sourceUrl?: string };

export type CreateJobFromPdfBytesResult = { jobId: string; reused: boolean; sha256: string };

export async function createJobFromPdfBytes(params: CreateJobFromPdfBytesParams): Promise<CreateJobFromPdfBytesResult> {
    const sha256 = createHash('sha256').update(params.bytes).digest('hex');
    const existing = await readHashIndex(sha256);
    if (existing) {
        return { jobId: existing.jobId, reused: true, sha256 };
    }

    const jobId = randomUUID();
    const dir = jobDir(jobId);
    const outputDir = jobImagesDir(jobId);
    const pdfPath = jobPdfPath(jobId);

    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(pdfPath, params.bytes);

    const job = globalJobStore.create({
        id: jobId,
        info: undefined,
        outputDir,
        pdfPath,
        progress: { extractedPages: 0, totalPages: undefined },
        sourceUrl: params.sourceUrl,
        status: 'uploaded',
    });
    await writeJobSnapshot(job);
    await writeHashIndex({ createdAtMs: Date.now(), hash: sha256, jobId });

    runPdfExtractionJob({ jobId, store: globalJobStore }).catch((err: unknown) => {
        const bus = globalJobStore.bus(jobId);
        globalJobStore.update(jobId, (j) => {
            j.status = 'error';
            j.error = err instanceof Error ? err.message : 'Unknown error';
        });
        bus?.emit('error', err instanceof Error ? err.message : 'Unknown error');
    });

    return { jobId, reused: false, sha256 };
}
