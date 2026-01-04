import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import { jobDir, jobImagesDir, jobPdfPath } from '@/server/jobs/jobPaths';
import { JobStore } from '@/server/jobs/jobStore';
import { ocrBus } from '@/server/ocr/ocrEventBus';
import { jobOcrJsonPath, jobOcrMetaPath, jobOcrPagesDir } from '@/server/ocr/ocrPaths';

type SpawnMode = { kind: 'success' } | { kind: 'fail' } | { kind: 'controlled'; close: () => void; fail?: boolean };

let spawnMode: SpawnMode = { kind: 'success' };
const spawnCalls: Array<{ cmd: string; args: string[] }> = [];

async function waitFor(predicate: () => boolean, timeoutMs = 250): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error('waitFor: timeout');
        }
        await new Promise((r) => setTimeout(r, 1));
    }
}

mock.module('@/server/ocr/spawn', () => {
    const { EventEmitter } = require('node:events');

    function makeChild() {
        const child: any = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        return child;
    }

    return {
        spawn: mock((cmd: string, args: string[]) => {
            spawnCalls.push({ args, cmd });
            const child = makeChild();
            (globalThis as any).__swissawa_lastSpawnChild = child;

            const outIdx = args.indexOf('--output');
            const outPath = outIdx >= 0 ? args[outIdx + 1] : null;

            const emitSuccess = async () => {
                if (outPath) {
                    await fsp.mkdir(path.dirname(outPath), { recursive: true });
                    await fsp.writeFile(
                        outPath,
                        JSON.stringify({
                            dpi: { x: 300, y: 300 },
                            pages: [
                                {
                                    height: 1000,
                                    observations: [{ bbox: { height: 4, width: 3, x: 1, y: 2 }, text: 'السلام عليكم' }],
                                    page: 1,
                                    width: 800,
                                },
                            ],
                        }),
                        'utf8',
                    );
                }
                child.emit('close', 0);
            };

            const emitFail = () => {
                child.stderr.emit('data', Buffer.from('boom'));
                child.emit('close', 1);
            };

            if (spawnMode.kind === 'success') {
                setTimeout(() => void emitSuccess(), 0);
            } else if (spawnMode.kind === 'fail') {
                setTimeout(() => emitFail(), 0);
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
import { runMacOcr } from '@/server/ocr/runMacOcr';

let store: JobStore;
let jobId = '';

describe('runMacOcr', () => {
    beforeEach(async () => {
        spawnCalls.length = 0;
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

    it('should spawn macOCR and persist ocr.json + meta + pages', async () => {
        spawnMode = { kind: 'success' };
        await runMacOcr({ jobId, store });

        expect(spawnCalls.length).toBe(1);
        // On macOS the command is 'script' with macOCR as an arg; otherwise it's 'macOCR' directly.
        const call = spawnCalls[0];
        const isMac = process.platform === 'darwin';
        expect(call?.cmd).toBe(isMac ? 'script' : 'macOCR');
        expect(call?.args).toContain('--language');
        expect(call?.args).toContain('ar-SA');
        if (isMac) {
            expect(call?.args).toContain('macOCR');
        }

        const raw = await fsp.readFile(jobOcrJsonPath(jobId), 'utf8');
        expect(raw).toContain('السلام عليكم');

        const meta = JSON.parse(await fsp.readFile(jobOcrMetaPath(jobId), 'utf8')) as any;
        expect(meta.totalPages).toBe(1);
        expect(meta.language).toBe('ar-SA');

        const p1 = await fsp.readFile(path.join(jobOcrPagesDir(jobId), '1.json'), 'utf8');
        expect(p1).toContain('السلام عليكم');

        expect(store.get(jobId)?.ocr?.status).toBe('complete');
    });

    it('should emit progress events from stdout and stderr', async () => {
        // Make spawn controlled so we can emit stdout/stderr before close.
        const controlled: SpawnMode = { close: () => {}, kind: 'controlled' };
        spawnMode = controlled;

        const events: Array<any> = [];
        const bus = ocrBus(jobId);
        const onProgress = (ev: any) => events.push(ev);
        bus.on('progress', onProgress);

        const p = runMacOcr({ jobId, store });
        await waitFor(() => spawnCalls.length === 1);

        // Simulate macOCR progress lines - some tools write progress to stderr.
        // We can reach the child via the spawn mock's last return by stashing it in globalThis in the mock.
        const lastChild = (globalThis as any).__swissawa_lastSpawnChild as any;
        expect(lastChild).toBeTruthy();
        lastChild.stdout.emit('data', Buffer.from('Processing page 1 of 3...\n'));
        lastChild.stderr.emit('data', Buffer.from('Processing page 2 of 3...\n'));

        // Ensure the progress events were observed before completion.
        await waitFor(() => events.length >= 2);
        expect(events[0]?.line).toContain('Processing page 1 of 3');
        expect(events[0]?.currentPage).toBe(1);
        expect(events[0]?.totalPages).toBe(3);
        expect(events[1]?.line).toContain('Processing page 2 of 3');
        expect(events[1]?.currentPage).toBe(2);
        expect(events[1]?.totalPages).toBe(3);

        controlled.close();
        await p;
        bus.off('progress', onProgress);
    });

    it('should capture failures and mark job ocr status error', async () => {
        spawnMode = { kind: 'fail' };
        await expect(runMacOcr({ jobId, store })).rejects.toThrow('macOCR exited');
        expect(store.get(jobId)?.ocr?.status).toBe('error');
        expect(store.get(jobId)?.ocr?.error).toContain('macOCR exited');
    });

    it('should not spawn twice if called while already running', async () => {
        const controlled: SpawnMode = { close: () => {}, kind: 'controlled' };
        spawnMode = controlled;

        const p1 = runMacOcr({ jobId, store });
        const p2 = runMacOcr({ jobId, store });

        await waitFor(() => spawnCalls.length === 1);
        expect(spawnCalls.length).toBe(1);

        controlled.close();
        await expect(Promise.all([p1, p2])).resolves.toBeDefined();
        expect(spawnCalls.length).toBe(1);
    });

    it('should allow re-run after completion', async () => {
        spawnMode = { kind: 'success' };
        await runMacOcr({ jobId, store });
        await runMacOcr({ jobId, store });
        expect(spawnCalls.length).toBe(2);
    });
});
