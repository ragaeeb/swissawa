import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import { deleteHashIndexByJobId, hashIndexPath, readHashIndex, writeHashIndex } from '@/server/jobs/hashIndex';

describe('hashIndex', () => {
    it('returns null for missing hash', async () => {
        const missing = 'a'.repeat(64);
        expect(await readHashIndex(missing)).toBeNull();
    });

    it('writes and reads record', async () => {
        const hash = 'b'.repeat(64);
        const rec = { createdAtMs: Date.now(), hash, jobId: randomUUID() };
        await writeHashIndex(rec);
        expect(await readHashIndex(hash)).toEqual(rec);
        await fsp.rm(hashIndexPath(hash), { force: true });
    });

    it('deletes records by jobId (for cleanup)', async () => {
        const jobIdA = randomUUID();
        const jobIdB = randomUUID();
        const hashA = 'c'.repeat(64);
        const hashB = 'd'.repeat(64);

        await writeHashIndex({ createdAtMs: Date.now(), hash: hashA, jobId: jobIdA });
        await writeHashIndex({ createdAtMs: Date.now(), hash: hashB, jobId: jobIdB });

        expect(await readHashIndex(hashA)).not.toBeNull();
        expect(await readHashIndex(hashB)).not.toBeNull();

        const deleted = await deleteHashIndexByJobId(jobIdA);
        expect(deleted).toEqual([hashA]);
        expect(await readHashIndex(hashA)).toBeNull();
        expect(await readHashIndex(hashB)).not.toBeNull();

        await fsp.rm(hashIndexPath(hashB), { force: true });
    });
});
