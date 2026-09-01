import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { jobDir, jobImagesDir, jobPdfPath } from '@/server/jobs/jobPaths';
import { JobStore } from '@/server/jobs/jobStore';
import { createRasterEnvelope } from '@/server/ocr/canonicalRaster';
import { suryaBus } from '@/server/ocr/ocrEventBus';
import { jobSuryaMetaPath, jobSuryaOcrJsonPath, jobSuryaPagesDir } from '@/server/ocr/ocrPaths';

type SpawnMode =
    | { kind: 'success' }
    | { kind: 'fail' }
    | { kind: 'controlled'; close: () => void; fail?: boolean }
    | { kind: 'mps-fallback' }; // MPS fails, retry with CPU succeeds

let spawnMode: SpawnMode = { kind: 'success' };
const spawnCalls: Array<{ cmd: string; args: string[]; env?: Record<string, string> }> = [];

async function waitFor(predicate: () => boolean, timeoutMs = 250): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error('waitFor: timeout');
        }
        await new Promise((r) => setTimeout(r, 1));
    }
}

// Sample surya results.json structure (before filtering)
const sampleSuryaRawOutput = {
    input: [
        {
            image_bbox: [0, 0, 800, 1000],
            page: 1, // Surya uses 1-indexed pages
            text_lines: [
                {
                    bbox: [10, 20, 110, 50],
                    chars: [{ bbox: [10, 20, 20, 50], text: 'ا' }],
                    confidence: 0.95,
                    polygon: [
                        [10, 20],
                        [110, 20],
                        [110, 50],
                        [10, 50],
                    ],
                    text: 'السلام عليكم',
                    words: [{ bbox: [10, 20, 110, 50], text: 'السلام' }],
                },
            ],
        },
    ],
};

mock.module('@/server/ocr/spawn', () => {
    const { EventEmitter } = require('node:events');

    function makeChild() {
        const child: any = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        return child;
    }

    let mpsFailed = false;

    // Expose reset function for tests to call in beforeEach
    (globalThis as any).__resetMpsFailed = () => {
        mpsFailed = false;
    };

    return {
        spawn: mock((cmd: string, args: string[], options?: { env?: Record<string, string> }) => {
            spawnCalls.push({ args, cmd, env: options?.env });
            const child = makeChild();
            (globalThis as any).__swissawa_lastSpawnChild = child;

            // Extract output dir from bash -c command string
            // Command format: bash -c "source ... && surya_ocr --disable_math --output_dir \"<dir>\" \"<input>\""
            const cmdString = args[1] || '';
            const outputDirMatch = cmdString.match(/--output_dir\s+"([^"]+)"/);
            const outputDir = outputDirMatch ? outputDirMatch[1] : null;

            const emitSuccess = async () => {
                // Simulate progress output on stderr
                child.stderr.emit('data', Buffer.from('Detecting bboxes:  50%|████████\n'));
                child.stderr.emit('data', Buffer.from('Detecting bboxes: 100%|████████████████\n'));
                child.stderr.emit('data', Buffer.from('Recognizing Text:  25%|████\n'));
                child.stderr.emit('data', Buffer.from('Recognizing Text: 100%|████████████████\n'));

                // Write results.json to outputDir/input/results.json (surya's actual output location)
                if (outputDir) {
                    const suryaOutDir = path.join(outputDir, 'input');
                    await fsp.mkdir(suryaOutDir, { recursive: true });
                    await fsp.writeFile(
                        path.join(suryaOutDir, 'results.json'),
                        JSON.stringify(sampleSuryaRawOutput),
                        'utf8',
                    );
                }
                child.emit('close', 0);
            };

            const emitFail = () => {
                child.stderr.emit('data', Buffer.from('Error: CUDA out of memory\n'));
                child.emit('close', 1);
            };

            const emitMpsFail = () => {
                child.stderr.emit('data', Buffer.from('RuntimeError: MPS backend out of memory\n'));
                child.emit('close', 1);
            };

            if (spawnMode.kind === 'success') {
                setTimeout(() => void emitSuccess(), 0);
            } else if (spawnMode.kind === 'fail') {
                setTimeout(() => emitFail(), 0);
            } else if (spawnMode.kind === 'mps-fallback') {
                if (!mpsFailed) {
                    mpsFailed = true;
                    setTimeout(() => emitMpsFail(), 0);
                } else {
                    // Second attempt with CPU should succeed
                    setTimeout(() => void emitSuccess(), 0);
                }
            } else {
                const close = () => {
                    if (spawnMode.kind !== 'controlled') {
                        return;
                    }
                    if (spawnMode.fail) {
                        emitFail();
                    } else {
                        void emitSuccess();
                    }
                };
                spawnMode.close = close;
            }

            return child;
        }),
    };
});

// Import after mocking spawn
import { runSuryaOcr } from '@/server/ocr/runSuryaOcr';

let store: JobStore;
let jobId = '';

describe('runSuryaOcr', () => {
    beforeEach(async () => {
        spawnCalls.length = 0;
        (globalThis as any).__resetMpsFailed?.();
        store = new JobStore();
        jobId = randomUUID();

        await fsp.mkdir(jobDir(jobId), { recursive: true });
        await fsp.writeFile(jobPdfPath(jobId), '%PDF-1.7 fake', 'utf8');

        store.create({
            id: jobId,
            info: undefined,
            outputDir: jobImagesDir(jobId),
            pdfPath: jobPdfPath(jobId),
            progress: { extractedPages: 0, totalPages: 1 },
            status: 'complete',
        });
    });

    afterEach(async () => {
        if (jobId) {
            await fsp.rm(jobDir(jobId), { force: true, recursive: true });
        }
    });

    it('should spawn surya_ocr with correct args and MPS device', async () => {
        spawnMode = { kind: 'success' };
        await runSuryaOcr({ jobId, store });

        expect(spawnCalls.length).toBeGreaterThanOrEqual(1);
        const call = spawnCalls[0];
        expect(call?.cmd).toBe('bash');
        // Args are in the bash command string
        const cmdString = call?.args[1] || '';
        expect(cmdString).toContain('surya_ocr');
        expect(cmdString).toContain('--disable_math');
        expect(cmdString).toContain('--output_dir');
        expect(call?.env?.TORCH_DEVICE).toBe('mps');
    });

    it('should fallback to CPU if MPS fails', async () => {
        spawnMode = { kind: 'mps-fallback' };
        await runSuryaOcr({ jobId, store });

        // Should have two spawn calls: first with mps, second with cpu
        expect(spawnCalls.length).toBe(2);
        expect(spawnCalls[0]?.env?.TORCH_DEVICE).toBe('mps');
        expect(spawnCalls[1]?.env?.TORCH_DEVICE).toBe('cpu');

        // Final status should be complete
        expect(store.get(jobId)?.suryaOcr?.status).toBe('complete');
    });

    it('should emit progress events for bbox detection and text recognition', async () => {
        const controlled: SpawnMode = { close: () => {}, kind: 'controlled' };
        spawnMode = controlled;

        const events: Array<any> = [];
        const bus = suryaBus(jobId);
        const onProgress = (ev: any) => events.push(ev);
        bus.on('progress', onProgress);

        const p = runSuryaOcr({ jobId, store });
        await waitFor(() => spawnCalls.length === 1);

        const lastChild = (globalThis as any).__swissawa_lastSpawnChild as any;
        expect(lastChild).toBeTruthy();

        // Simulate surya progress
        lastChild.stderr.emit('data', Buffer.from('Detecting bboxes:  20%|████\n'));
        await waitFor(() => events.length >= 1);
        expect(events[0]?.line).toContain('Detecting bboxes');
        expect(events[0]?.phase).toBe('detecting');

        lastChild.stderr.emit('data', Buffer.from('Recognizing Text:  50%|████████\n'));
        await waitFor(() => events.length >= 2);
        expect(events[1]?.line).toContain('Recognizing Text');
        expect(events[1]?.phase).toBe('recognizing');

        controlled.close();
        await p;
        bus.off('progress', onProgress);
    });

    it('should filter results.json and write surya.json without char-level data', async () => {
        spawnMode = { kind: 'success' };
        await runSuryaOcr({ jobId, store });

        const suryaJson = JSON.parse(await fsp.readFile(jobSuryaOcrJsonPath(jobId), 'utf8'));

        // Should have the filtered structure
        expect(suryaJson.input).toBeDefined();
        expect(suryaJson.input[0].text_lines[0]).not.toHaveProperty('chars');
        expect(suryaJson.input[0].text_lines[0]).not.toHaveProperty('confidence');
        expect(suryaJson.input[0].text_lines[0]).not.toHaveProperty('polygon');
        expect(suryaJson.input[0].text_lines[0]).not.toHaveProperty('words');
        expect(suryaJson.input[0].text_lines[0].text).toBe('السلام عليكم');
    });

    it('should write per-page JSON files and meta.json', async () => {
        spawnMode = { kind: 'success' };
        await runSuryaOcr({ jobId, store });

        const meta = JSON.parse(await fsp.readFile(jobSuryaMetaPath(jobId), 'utf8'));
        expect(meta.totalPages).toBe(1);

        const page1 = JSON.parse(await fsp.readFile(path.join(jobSuryaPagesDir(jobId), '1.json'), 'utf8'));
        expect(page1.page).toBe(1);
        expect(page1.observations[0]?.text).toBe('السلام عليكم');
        expect(page1.observations[0]).toMatchObject({
            chars: [{ bbox: [10, 20, 20, 50], text: 'ا' }],
            confidence: 0.95,
            id: 'surya:page-1:line-0001',
            rawText: 'السلام عليكم',
            sourceRange: { length: 12, location: 0, unit: 'utf16' },
            words: [{ bbox: [10, 20, 110, 50], text: 'السلام' }],
        });
        expect(page1.suggestedEdits).toEqual([]);
    });

    it('should mark job suryaOcr status as complete on success', async () => {
        spawnMode = { kind: 'success' };
        await runSuryaOcr({ jobId, store });

        expect(store.get(jobId)?.suryaOcr?.status).toBe('complete');
    });

    it('should mark job suryaOcr status as error on failure', async () => {
        spawnMode = { kind: 'fail' };
        await expect(runSuryaOcr({ jobId, store })).rejects.toThrow();

        expect(store.get(jobId)?.suryaOcr?.status).toBe('error');
        expect(store.get(jobId)?.suryaOcr?.error).toBeDefined();
    });

    it('should not spawn twice if called while already running', async () => {
        const controlled: SpawnMode = { close: () => {}, kind: 'controlled' };
        spawnMode = controlled;

        const p1 = runSuryaOcr({ jobId, store });
        const p2 = runSuryaOcr({ jobId, store });

        await waitFor(() => spawnCalls.length === 1);
        expect(spawnCalls.length).toBe(1);

        controlled.close();
        await expect(Promise.all([p1, p2])).resolves.toBeDefined();
        expect(spawnCalls.length).toBe(1);
    });

    it('should allow re-run after completion', async () => {
        spawnMode = { kind: 'success' };
        await runSuryaOcr({ jobId, store });
        await runSuryaOcr({ jobId, store });
        expect(spawnCalls.length).toBe(2);
    });

    it('should use virtual environment activation', async () => {
        spawnMode = { kind: 'success' };
        await runSuryaOcr({ jobId, store });

        const call = spawnCalls[0];
        // Should use bash -c with source activation
        expect(call?.cmd).toBe('bash');
        expect(call?.args[0]).toBe('-c');
        expect(call?.args[1]).toContain('source');
        expect(call?.args[1]).toContain('surya-env');
    });

    it('uses a caller-provided canonical raster and records its provenance', async () => {
        const bytes = Uint8Array.from(
            Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAAXNSR0IArs4c6QAAAAxJREFUeJxjYGBgAAAABAAB9hc4VQAAAABJRU5ErkJggg==',
                'base64',
            ),
        );
        const envelope = createRasterEnvelope({
            bytes,
            crop: { height: 1, unit: 'normalized', width: 1, x: 0, y: 0 },
            source: { page: 1, pdfSha256: 'pdf-source' },
        });

        await runSuryaOcr({ jobId, rasterInput: { bytes, envelope }, store });

        const call = spawnCalls[0];
        expect(call?.args[1]).toContain('input.png');
        const page = JSON.parse(await fsp.readFile(path.join(jobSuryaPagesDir(jobId), '1.json'), 'utf8'));
        expect(page.raster).toMatchObject({
            consumedBy: 'surya',
            consumedRasterSha256: envelope.sha256,
            renderer: { version: '26.07.0' },
            sha256: envelope.sha256,
            source: { pdfSha256: 'pdf-source' },
        });
    });
});
