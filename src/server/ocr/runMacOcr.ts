import * as fsp from 'node:fs/promises';
import { isFullCropBox, normalizeCropBox } from '@/lib/cropConvert';
import type { MacOCR } from '@/lib/macOcr';
import { readCropBox } from '@/server/crop/cropStore';
import { jobPdfPath } from '@/server/jobs/jobPaths';
import { writeJobSnapshot } from '@/server/jobs/jobSnapshot';
import type { JobOcr, JobStore } from '@/server/jobs/jobStore';
import { emitOcrComplete, emitOcrError, emitOcrProgress } from '@/server/ocr/ocrEventBus';
import { jobOcrDir, jobOcrInputPdfPath, jobOcrJsonPath } from '@/server/ocr/ocrPaths';
import { spawn } from '@/server/ocr/spawn';
import { buildOcrMeta, splitMacOcrToPages, writeOcrMeta } from '@/server/ocr/splitMacOcr';
import { cropPdfBytes } from '@/server/pdf/cropPdf';

export type RunMacOcrParams = {
    jobId: string;
    store: JobStore;
    language?: string; // default: ar-SA
    splitPages?: boolean; // default: true
};

const runningByJobId = new Map<string, Promise<void>>();

function parseMacOcrJson(raw: string): MacOCR {
    const json = JSON.parse(raw) as unknown;
    if (!json || typeof json !== 'object') {
        throw new Error('Invalid macOCR output JSON');
    }
    return json as MacOCR;
}

async function getOcrInputPdfBytes(jobId: string, store: JobStore): Promise<Uint8Array> {
    const job = store.get(jobId);
    if (!job) {
        throw new Error(`Job not found: ${jobId}`);
    }
    const original = await fsp.readFile(job.pdfPath ?? jobPdfPath(jobId));
    const crop = job.crop ?? (await readCropBox(jobId));
    if (!crop) {
        return original;
    }
    const normalized = normalizeCropBox(crop);
    if (isFullCropBox(normalized)) {
        return original;
    }
    // For OCR we shrink the page to the crop area so macOCR coordinates are relative to the cropped page.
    return await cropPdfBytes(original, normalized, { shrinkPage: true });
}

async function updateOcrStatus(store: JobStore, jobId: string, updater: (current: JobOcr) => void): Promise<void> {
    const updated = store.update(jobId, (j) => {
        const current: JobOcr = j.ocr ?? { status: 'idle', updatedAtMs: Date.now() };
        const next: JobOcr = { ...current, updatedAtMs: Date.now() };
        updater(next);
        j.ocr = next;
    });
    await writeJobSnapshot(updated);
}

type LineState = { buf: string };

function handleStreamChunk(params: { jobId: string; state: LineState; chunk: Buffer }): void {
    params.state.buf += params.chunk.toString('utf8');

    // Normalize \r\n to \n, but also handle standalone \r.
    params.state.buf = params.state.buf.replaceAll('\r\n', '\n').replaceAll('\r', '\n');

    while (true) {
        const idx = params.state.buf.indexOf('\n');
        if (idx < 0) {
            break;
        }
        const line = params.state.buf.slice(0, idx).trimEnd();
        params.state.buf = params.state.buf.slice(idx + 1);
        if (!line) {
            continue;
        }
        const m = line.match(/Processing page (\d+) of (\d+)\.\.\./i);
        if (m) {
            emitOcrProgress(params.jobId, {
                currentPage: Number.parseInt(m[1] ?? '', 10),
                line,
                totalPages: Number.parseInt(m[2] ?? '', 10),
            });
        } else {
            emitOcrProgress(params.jobId, { line });
        }
    }
}

export async function runMacOcr(params: RunMacOcrParams): Promise<void> {
    const existing = runningByJobId.get(params.jobId);
    if (existing) {
        return existing;
    }

    const promise = (async () => {
        const job = params.store.get(params.jobId);
        if (!job) {
            throw new Error(`Job not found: ${params.jobId}`);
        }

        const language = params.language ?? 'ar-SA';
        const splitPages = params.splitPages ?? true;

        console.info('[ocr.run.start]', { jobId: params.jobId, language, splitPages });
        await updateOcrStatus(params.store, params.jobId, (ocr) => {
            ocr.status = 'running';
            ocr.language = language;
            delete ocr.error;
        });

        const ocrDir = jobOcrDir(params.jobId);
        await fsp.mkdir(ocrDir, { recursive: true });

        const inputPdfBytes = await getOcrInputPdfBytes(params.jobId, params.store);
        await fsp.writeFile(jobOcrInputPdfPath(params.jobId), inputPdfBytes);

        const outPath = jobOcrJsonPath(params.jobId);
        const args = ['--language', language, '--output', outPath, jobOcrInputPdfPath(params.jobId)];

        await new Promise<void>((resolve, reject) => {
            // Use `script -q /dev/null` on macOS to force line-buffered output from macOCR.
            // Without this, stdout is block-buffered when piped and all output arrives at once on exit.
            const useScript = process.platform === 'darwin';
            const cmd = useScript ? 'script' : 'macOCR';
            const cmdArgs = useScript ? ['-q', '/dev/null', 'macOCR', ...args] : args;

            console.info('[ocr.run.spawn]', { args: cmdArgs, jobId: params.jobId, useScript });
            const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
            const outState: LineState = { buf: '' };
            const errState: LineState = { buf: '' };
            let stderr = '';
            let stdoutChunks = 0;
            let stderrChunks = 0;
            child.stdout?.on('data', (d: Buffer) => {
                stdoutChunks++;
                handleStreamChunk({ chunk: d, jobId: params.jobId, state: outState });
            });
            child.stderr?.on('data', (d: Buffer) => {
                stderrChunks++;
                stderr += d.toString('utf8');
                // Some tools print progress to stderr; parse it too.
                handleStreamChunk({ chunk: d, jobId: params.jobId, state: errState });
            });
            child.on('error', reject);
            child.on('close', (code: number | null) => {
                console.info('[ocr.run.exit]', { code, jobId: params.jobId, stderrChunks, stdoutChunks });
                if (code === 0) {
                    resolve();
                    return;
                }
                reject(new Error(`macOCR exited with code ${code ?? 'null'}: ${stderr}`));
            });
        });

        const raw = await fsp.readFile(outPath, 'utf8');
        const ocr = parseMacOcrJson(raw);

        // Always write meta.json (small), even if we don't split.
        const meta = buildOcrMeta(ocr, language);
        await writeOcrMeta(jobOcrDir(params.jobId), meta);

        if (splitPages) {
            await splitMacOcrToPages({ language, ocr, outDir: jobOcrDir(params.jobId) });
        }

        await updateOcrStatus(params.store, params.jobId, (s) => {
            s.status = 'complete';
            s.meta = meta;
        });
        emitOcrComplete(params.jobId);
        console.info('[ocr.run.complete]', { jobId: params.jobId });
    })()
        .catch(async (err: unknown) => {
            await updateOcrStatus(params.store, params.jobId, (s) => {
                s.status = 'error';
                s.error = err instanceof Error ? err.message : 'OCR failed';
            });
            emitOcrError(params.jobId, err instanceof Error ? err.message : 'OCR failed');
            console.error('[ocr.run.error]', {
                jobId: params.jobId,
                message: err instanceof Error ? err.message : String(err),
            });
            throw err;
        })
        .finally(() => {
            runningByJobId.delete(params.jobId);
        });

    runningByJobId.set(params.jobId, promise);
    return promise;
}
