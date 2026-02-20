import { afterEach, describe, expect, it, mock } from 'bun:test';
import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createJobFromPdfBytes } from '@/server/jobs/createJobFromPdfBytes';
import { hashIndexPath } from '@/server/jobs/hashIndex';
import { jobDir, jobPdfPath } from '@/server/jobs/jobPaths';
import { globalJobStore } from '@/server/jobs/jobStore';

mock.module('@/server/pdf/runner', () => ({ runPdfExtractionJob: mock(async () => {}) }));

const createdJobIds: string[] = [];
const createdHashes: string[] = [];

afterEach(async () => {
    for (const id of createdJobIds) {
        globalJobStore.delete(id);
        await fsp.rm(jobDir(id), { force: true, recursive: true });
    }
    createdJobIds.length = 0;

    for (const hash of createdHashes) {
        await fsp.rm(hashIndexPath(hash), { force: true });
    }
    createdHashes.length = 0;
});

describe('createJobFromPdfBytes', () => {
    it('creates a new job, writes pdf, and stores snapshot/hash', async () => {
        const bytes = new TextEncoder().encode('%PDF-1.7 create helper');
        const hash = createHash('sha256').update(bytes).digest('hex');
        createdHashes.push(hash);

        const result = await createJobFromPdfBytes({ bytes });
        createdJobIds.push(result.jobId);

        expect(result.reused).toBe(false);
        expect(result.sha256).toBe(hash);

        const stored = globalJobStore.get(result.jobId);
        expect(stored).toBeTruthy();
        const onDisk = await fsp.readFile(jobPdfPath(result.jobId));
        expect(onDisk.length).toBe(bytes.length);

        const snapshotPath = path.join(os.tmpdir(), 'swissawa', result.jobId, 'job.json');
        const snapshotRaw = await fsp.readFile(snapshotPath, 'utf8');
        expect(snapshotRaw).toContain(result.jobId);
    });

    it('reuses existing job for identical bytes', async () => {
        const bytes = new TextEncoder().encode('%PDF-1.7 duplicate');
        const hash = createHash('sha256').update(bytes).digest('hex');
        createdHashes.push(hash);

        const first = await createJobFromPdfBytes({ bytes });
        createdJobIds.push(first.jobId);
        const second = await createJobFromPdfBytes({ bytes });

        expect(first.reused).toBe(false);
        expect(second.reused).toBe(true);
        expect(second.jobId).toBe(first.jobId);
        expect(second.sha256).toBe(first.sha256);
    });
});
