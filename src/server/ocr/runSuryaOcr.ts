import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { isFullCropBox, normalizeCropBox } from '@/lib/cropConvert';
import type { SuryaOcrOutput, SuryaPageOcrResult } from '@/lib/suryaOcr';
import { readCropBox } from '@/server/crop/cropStore';
import { jobPdfPath } from '@/server/jobs/jobPaths';
import { writeJobSnapshot } from '@/server/jobs/jobSnapshot';
import type { JobOcr, JobStore } from '@/server/jobs/jobStore';
import { emitSuryaComplete, emitSuryaError, emitSuryaProgress } from '@/server/ocr/ocrEventBus';
import { jobSuryaOcrDir, jobSuryaOcrJsonPath } from '@/server/ocr/ocrPaths';
import { spawn } from '@/server/ocr/spawn';
import { filterSuryaRawOutput, splitSuryaOcrToPages } from '@/server/ocr/splitSuryaOcr';
import { cropPdfBytes } from '@/server/pdf/cropPdf';

export type RunSuryaOcrParams = {
    jobId: string;
    store: JobStore;
    splitPages?: boolean; // default: true
};

const runningByJobId = new Map<string, Promise<void>>();

const SURYA_VENV_PATH = '~/surya-env/bin/activate';

async function getSuryaInputPdfBytes(jobId: string, store: JobStore): Promise<Uint8Array> {
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
    return await cropPdfBytes(original, normalized, { shrinkPage: true });
}

async function updateSuryaOcrStatus(store: JobStore, jobId: string, updater: (current: JobOcr) => void): Promise<void> {
    const updated = store.update(jobId, (j) => {
        const current: JobOcr = j.suryaOcr ?? { status: 'idle', updatedAtMs: Date.now() };
        const next: JobOcr = { ...current, updatedAtMs: Date.now() };
        updater(next);
        j.suryaOcr = next;
    });
    await writeJobSnapshot(updated);
}

type LineState = { buf: string };

function handleSuryaStreamChunk(params: { jobId: string; state: LineState; chunk: Buffer }): void {
    params.state.buf += params.chunk.toString('utf8');
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

        // Parse surya progress patterns:
        // "Detecting bboxes:  50%|████████" or "Detecting bboxes: 2/5 [00:07<00:30, 7.65s/it]"
        // "Recognizing Text:  25%|████" or "Recognizing Text: 4/697 [00:07<14:26, 1.25s/it]"
        const detectingMatch =
            line.match(/Detecting bboxes:\s*(\d+)%/i) || line.match(/Detecting bboxes:\s*(\d+)\/(\d+)/i);
        const recognizingMatch =
            line.match(/Recognizing Text:\s*(\d+)%/i) || line.match(/Recognizing Text:\s*(\d+)\/(\d+)/i);

        if (detectingMatch) {
            emitSuryaProgress(params.jobId, { line, phase: 'detecting' });
        } else if (recognizingMatch) {
            emitSuryaProgress(params.jobId, { line, phase: 'recognizing' });
        } else if (line.includes('Downloading') || line.includes('surya:')) {
            // Info lines like model downloads or final output message
            emitSuryaProgress(params.jobId, { line });
        }
    }
}

async function spawnSuryaOcr(params: {
    jobId: string;
    inputPdfPath: string;
    outputDir: string;
    device: 'mps' | 'cpu';
}): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        // Build command to run in virtual environment
        const suryaCmd = `source ${SURYA_VENV_PATH} && surya_ocr --disable_math --output_dir "${params.outputDir}" "${params.inputPdfPath}"`;
        const args = ['-c', suryaCmd];
        const env = { ...process.env, TORCH_DEVICE: params.device };

        console.info('[surya.run.spawn]', { device: params.device, jobId: params.jobId, outputDir: params.outputDir });
        const child = spawn('bash', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

        const outState: LineState = { buf: '' };
        const errState: LineState = { buf: '' };
        let stderr = '';

        child.stdout?.on('data', (d: Buffer) => {
            handleSuryaStreamChunk({ chunk: d, jobId: params.jobId, state: outState });
        });
        child.stderr?.on('data', (d: Buffer) => {
            stderr += d.toString('utf8');
            handleSuryaStreamChunk({ chunk: d, jobId: params.jobId, state: errState });
        });
        child.on('error', reject);
        child.on('close', (code: number | null) => {
            console.info('[surya.run.exit]', { code, jobId: params.jobId });
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`surya_ocr exited with code ${code ?? 'null'}: ${stderr}`));
        });
    });
}

export async function runSuryaOcr(params: RunSuryaOcrParams): Promise<void> {
    const existing = runningByJobId.get(params.jobId);
    if (existing) {
        return existing;
    }

    const promise = (async () => {
        const job = params.store.get(params.jobId);
        if (!job) {
            throw new Error(`Job not found: ${params.jobId}`);
        }

        const splitPages = params.splitPages ?? true;

        console.info('[surya.run.start]', { jobId: params.jobId, splitPages });
        await updateSuryaOcrStatus(params.store, params.jobId, (ocr) => {
            ocr.status = 'running';
            delete ocr.error;
        });

        const suryaDir = jobSuryaOcrDir(params.jobId);
        await fsp.mkdir(suryaDir, { recursive: true });

        // Write cropped PDF to surya input directory
        const inputPdfBytes = await getSuryaInputPdfBytes(params.jobId, params.store);
        const inputPdfPath = path.join(suryaDir, 'input.pdf');
        await fsp.writeFile(inputPdfPath, inputPdfBytes);

        // Try MPS first, fallback to CPU if it fails
        let device: 'mps' | 'cpu' = 'mps';
        try {
            await spawnSuryaOcr({ device, inputPdfPath, jobId: params.jobId, outputDir: suryaDir });
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            if (errMsg.includes('MPS') || errMsg.includes('mps') || errMsg.includes('Metal')) {
                console.warn('[surya.run.mps_fallback]', { jobId: params.jobId, reason: errMsg });
                device = 'cpu';
                await spawnSuryaOcr({ device, inputPdfPath, jobId: params.jobId, outputDir: suryaDir });
            } else {
                throw err;
            }
        }

        // Surya outputs to: outputDir/<input-basename>/results.json
        // Since we name our input "input.pdf", the results go to suryaDir/input/results.json
        const resultsJsonPath = path.join(suryaDir, 'input', 'results.json');
        const rawJson = await fsp.readFile(resultsJsonPath, 'utf8');
        const rawOutput = JSON.parse(rawJson) as SuryaOcrOutput;

        // Filter to remove char-level data
        const filteredOutput = filterSuryaRawOutput(rawOutput);

        // Write filtered surya.json
        await fsp.writeFile(jobSuryaOcrJsonPath(params.jobId), JSON.stringify(filteredOutput, null, 2), 'utf8');

        // Get pages array from the first (and usually only) file key
        const fileKeys = Object.keys(filteredOutput);
        const pages: SuryaPageOcrResult[] = fileKeys.length > 0 ? (filteredOutput[fileKeys[0]] ?? []) : [];

        if (splitPages) {
            await splitSuryaOcrToPages({ outDir: suryaDir, pages });
        }

        await updateSuryaOcrStatus(params.store, params.jobId, (s) => {
            s.status = 'complete';
            s.meta = { createdAtIso: new Date().toISOString(), dpi: { x: 72, y: 72 }, totalPages: pages.length };
        });
        emitSuryaComplete(params.jobId);
        console.info('[surya.run.complete]', { jobId: params.jobId, totalPages: pages.length });
    })()
        .catch(async (err: unknown) => {
            await updateSuryaOcrStatus(params.store, params.jobId, (s) => {
                s.status = 'error';
                s.error = err instanceof Error ? err.message : 'Surya OCR failed';
            });
            emitSuryaError(params.jobId, err instanceof Error ? err.message : 'Surya OCR failed');
            console.error('[surya.run.error]', {
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
