import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeJobSnapshot } from '@/server/jobs/jobSnapshot';
import type { JobStore } from '@/server/jobs/jobStore';
import { buildPdftocairoArgs } from '@/server/pdf/extract';
import { parsePdfInfoOutput } from '@/server/pdf/pdfInfo';
import { createPageRanges, runWithConcurrency } from '@/server/pdf/ranges';

export type RunExtractionParams = {
    jobId: string;
    store: JobStore;
    // tunables
    chunkSize?: number;
    concurrency?: number;
};

function runCmdCaptureStdout(cmd: string, args: string[]): Promise<{ stdout: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => {
            stdout += d.toString('utf8');
        });
        child.stderr.on('data', (d) => {
            stderr += d.toString('utf8');
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve({ stdout });
                return;
            }
            reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
        });
    });
}

function runCmd(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (d) => {
            stderr += d.toString('utf8');
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
        });
    });
}

export function defaultConcurrency(): number {
    const cpu = os.cpus()?.length ?? 2;
    // Leave a core free; ensure at least 1
    return Math.max(1, cpu - 1);
}

export async function runPdfExtractionJob(params: RunExtractionParams): Promise<void> {
    const job = params.store.get(params.jobId);
    if (!job) {
        throw new Error(`Job not found: ${params.jobId}`);
    }
    const bus = params.store.bus(params.jobId);
    if (!bus) {
        throw new Error(`Job event bus not found: ${params.jobId}`);
    }

    const chunkSize = params.chunkSize ?? 10;
    const concurrency = params.concurrency ?? defaultConcurrency();

    console.info('[extract.start]', { chunkSize, concurrency, jobId: params.jobId, pdfPath: job.pdfPath });

    params.store.update(params.jobId, (j) => {
        j.status = 'processing';
    });
    await writeJobSnapshot(params.store.get(params.jobId)!);

    await fs.mkdir(job.outputDir, { recursive: true });

    const infoOut = await runCmdCaptureStdout('pdfinfo', [job.pdfPath]);
    const info = parsePdfInfoOutput(infoOut.stdout);

    params.store.update(params.jobId, (j) => {
        j.info = info;
        j.progress.totalPages = info.pages;
    });
    await writeJobSnapshot(params.store.get(params.jobId)!);
    bus.emit('pdf', info);
    bus.emit('progress', { extractedPages: job.progress.extractedPages, totalPages: info.pages });

    const ranges = createPageRanges(info.pages, chunkSize);
    const outputPrefix = path.join(job.outputDir, 'page');

    try {
        await runWithConcurrency(ranges, concurrency, async (range) => {
            const args = buildPdftocairoArgs({ inputPdfPath: job.pdfPath, options: undefined, outputPrefix, range });
            await runCmd('pdftocairo', args);

            const completed = range.end - range.start + 1;
            const updated = params.store.update(params.jobId, (j) => {
                j.progress.extractedPages += completed;
            });
            await writeJobSnapshot(updated);
            bus.emit('progress', { ...updated.progress });
        });

        const done = params.store.update(params.jobId, (j) => {
            j.status = 'complete';
        });
        await writeJobSnapshot(done);
        bus.emit('complete', done);
        console.info('[extract.complete]', { extractedPages: done.progress.extractedPages, jobId: params.jobId });
    } catch (err) {
        params.store.update(params.jobId, (j) => {
            j.status = 'error';
            j.error = err instanceof Error ? err.message : 'Extraction failed';
        });
        await writeJobSnapshot(params.store.get(params.jobId)!);
        console.error('[extract.error]', {
            jobId: params.jobId,
            message: err instanceof Error ? err.message : String(err),
        });
        throw err;
    }
}
