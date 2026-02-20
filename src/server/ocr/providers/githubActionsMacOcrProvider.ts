import { randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { UTApi } from 'uploadthing/server';
import { isFullCropBox, normalizeCropBox } from '@/lib/cropConvert';
import type { MacOCR } from '@/lib/macOcr';
import { readCropBox } from '@/server/crop/cropStore';
import { writeJobSnapshot } from '@/server/jobs/jobSnapshot';
import type { JobOcr, JobStore } from '@/server/jobs/jobStore';
import { GithubActionsClient } from '@/server/ocr/github/githubActionsClient';
import { PatAuthProvider } from '@/server/ocr/github/githubAuth';
import { emitOcrComplete, emitOcrError, emitOcrProgress } from '@/server/ocr/ocrEventBus';
import { jobOcrDir, jobOcrInputPdfPath, jobOcrJsonPath } from '@/server/ocr/ocrPaths';
import type { MacOcrProvider, StartMacOcrParams } from '@/server/ocr/providers/macOcrProvider';
import { buildOcrMeta, splitMacOcrToPages, writeOcrMeta } from '@/server/ocr/splitMacOcr';
import { cropPdfBytes } from '@/server/pdf/cropPdf';

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

const runningByJobId = new Map<string, Promise<void>>();

function readNumberEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) {
        return fallback;
    }
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
        return fallback;
    }
    return n;
}

function requiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing ${name}`);
    }
    return value;
}

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
    const original = await fsp.readFile(job.pdfPath);
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

async function resolveRemotePdfUrl(
    params: StartMacOcrParams,
    job: NonNullable<ReturnType<JobStore['get']>>,
): Promise<string> {
    const sourceUrl = job.sourceUrl;
    const crop = job.crop ?? (await readCropBox(params.jobId));
    if (sourceUrl && (!crop || isFullCropBox(normalizeCropBox(crop)))) {
        emitOcrProgress(params.jobId, { line: 'Using original remote PDF URL for OCR input…' });
        return sourceUrl;
    }

    emitOcrProgress(params.jobId, { line: 'Preparing cropped PDF for remote OCR…' });
    const inputPdfBytes = await getOcrInputPdfBytes(params.jobId, params.store);
    await fsp.writeFile(jobOcrInputPdfPath(params.jobId), inputPdfBytes);

    const utapi = new UTApi();
    const uploadBytes = new Uint8Array(inputPdfBytes);
    const uploadFile = new File([uploadBytes], `${params.jobId}-input.pdf`, { type: 'application/pdf' });
    emitOcrProgress(params.jobId, { line: 'Uploading OCR input PDF to UploadThing…' });
    const uploadResult = await utapi.uploadFiles(uploadFile);
    if (!uploadResult?.data?.key) {
        throw new Error('Failed to upload OCR input PDF to UploadThing');
    }
    const { ufsUrl } = await utapi.generateSignedURL(uploadResult.data.key, { expiresIn: '15 minutes' });
    return ufsUrl;
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

function getRemoteConfig(): { pollIntervalMs: number; ref: string; repo: string; timeoutMs: number; workflow: string } {
    return {
        pollIntervalMs: readNumberEnv('SWISSAWA_GH_OCR_POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS),
        ref: process.env.SWISSAWA_GH_OCR_REF ?? 'main',
        repo: requiredEnv('SWISSAWA_GH_OCR_REPO'),
        timeoutMs: readNumberEnv('SWISSAWA_GH_OCR_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
        workflow: process.env.SWISSAWA_GH_OCR_WORKFLOW ?? 'ocr-remote.yml',
    };
}

function readOutputJsonFromZip(zipBuffer: ArrayBuffer): string {
    const zip = new AdmZip(Buffer.from(zipBuffer));
    const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
    const outputEntry = entries.find((entry) => path.basename(entry.entryName) === 'output.json');
    if (outputEntry) {
        return outputEntry.getData().toString('utf8');
    }
    const anyJson = entries.find((entry) => entry.entryName.endsWith('.json'));
    if (anyJson) {
        return anyJson.getData().toString('utf8');
    }
    throw new Error('Remote OCR artifact does not contain a JSON output file');
}

export class GithubActionsMacOcrProvider implements MacOcrProvider {
    async start(params: StartMacOcrParams): Promise<void> {
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
            const requestId = randomUUID();
            const artifactName = `ocr-results-${params.jobId}-${requestId.slice(0, 8)}`;
            const config = getRemoteConfig();
            const ocrDir = jobOcrDir(params.jobId);

            await updateOcrStatus(params.store, params.jobId, (ocr) => {
                ocr.status = 'running';
                ocr.language = language;
                ocr.backend = 'github_actions';
                ocr.requestId = requestId;
                ocr.artifactName = artifactName;
                ocr.startedAtMs = Date.now();
                delete ocr.error;
            });

            await fsp.mkdir(ocrDir, { recursive: true });
            const pdfUrl = await resolveRemotePdfUrl(params, job);

            const auth = new PatAuthProvider();
            const client = new GithubActionsClient({
                auth,
                ref: config.ref,
                repo: config.repo,
                workflow: config.workflow,
            });

            emitOcrProgress(params.jobId, { line: 'Dispatching remote OCR workflow…' });
            const dispatch = await client.dispatchWorkflow({
                artifact_name: artifactName,
                languages: language,
                output_format: 'json',
                pdf_url: pdfUrl,
                request_id: requestId,
            });
            if (!dispatch.requestIdAccepted) {
                emitOcrProgress(params.jobId, { line: 'Workflow does not support request_id; using latest-run correlation…' });
            }

            const runSearchStartedAt = Date.now();
            let runId: number | null = null;
            while (!runId) {
                const run = dispatch.requestIdAccepted
                    ? await client.findRunByRequestId(requestId)
                    : await client.findMostRecentDispatchedRunSince(dispatch.dispatchedAtMs);
                if (run) {
                    runId = run.id;
                    await updateOcrStatus(params.store, params.jobId, (ocr) => {
                        ocr.runId = run.id;
                        ocr.workflowUrl = run.html_url || client.workflowRunUrl(run.id);
                        ocr.lastCheckedAtMs = Date.now();
                    });
                    break;
                }
                if (Date.now() - runSearchStartedAt > config.timeoutMs) {
                    throw new Error('Timed out while waiting for workflow run to appear');
                }
                emitOcrProgress(params.jobId, { line: 'Waiting for remote workflow run to start…' });
                await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
            }

            emitOcrProgress(params.jobId, { line: 'Remote OCR workflow running…' });
            const finalRun = await client.waitForRunCompletion(runId, config.timeoutMs, config.pollIntervalMs);
            await updateOcrStatus(params.store, params.jobId, (ocr) => {
                ocr.lastCheckedAtMs = Date.now();
                ocr.workflowUrl = finalRun.html_url || client.workflowRunUrl(finalRun.id);
            });

            if (finalRun.conclusion !== 'success') {
                throw new Error(`Remote OCR workflow failed (${finalRun.conclusion ?? 'unknown'})`);
            }

            emitOcrProgress(params.jobId, { line: 'Downloading OCR artifact…' });
            const artifact = await client.findArtifactForRun(runId, [artifactName, 'ocr-results']);
            if (!artifact) {
                throw new Error('Artifact not found for remote OCR run');
            }
            const zipBuffer = await client.downloadArtifactZip(artifact);
            const rawJson = readOutputJsonFromZip(zipBuffer);
            const ocr = parseMacOcrJson(rawJson);

            await fsp.writeFile(jobOcrJsonPath(params.jobId), rawJson, 'utf8');
            const meta = buildOcrMeta(ocr, language);
            await writeOcrMeta(ocrDir, meta);
            if (splitPages) {
                await splitMacOcrToPages({ language, ocr, outDir: ocrDir });
            }

            await updateOcrStatus(params.store, params.jobId, (s) => {
                s.status = 'complete';
                s.meta = meta;
                s.lastCheckedAtMs = Date.now();
            });
            emitOcrComplete(params.jobId);
        })()
            .catch(async (err: unknown) => {
                await updateOcrStatus(params.store, params.jobId, (s) => {
                    s.status = 'error';
                    s.error = err instanceof Error ? err.message : 'OCR failed';
                    s.lastCheckedAtMs = Date.now();
                });
                emitOcrError(params.jobId, err instanceof Error ? err.message : 'OCR failed');
                throw err;
            })
            .finally(() => {
                runningByJobId.delete(params.jobId);
            });

        runningByJobId.set(params.jobId, promise);
        return promise;
    }
}
