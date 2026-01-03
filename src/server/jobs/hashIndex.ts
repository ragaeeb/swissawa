import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SHA256_RE = /^[a-f0-9]{64}$/i;

export type HashIndexRecord = { hash: string; jobId: string; createdAtMs: number };

function validateHash(hash: string): void {
    if (!SHA256_RE.test(hash)) {
        throw new Error(`Invalid sha256 hash: ${hash}`);
    }
}

export function hashIndexDir(): string {
    return path.join(os.tmpdir(), 'swissawa', 'by-hash');
}

export function hashIndexPath(hash: string): string {
    validateHash(hash);
    return path.join(hashIndexDir(), `${hash}.json`);
}

export async function readHashIndex(hash: string): Promise<HashIndexRecord | null> {
    try {
        const raw = await fsp.readFile(hashIndexPath(hash), 'utf8');
        return JSON.parse(raw) as HashIndexRecord;
    } catch {
        return null;
    }
}

export async function writeHashIndex(record: HashIndexRecord): Promise<void> {
    validateHash(record.hash);
    await fsp.mkdir(hashIndexDir(), { recursive: true });
    await fsp.writeFile(hashIndexPath(record.hash), `${JSON.stringify(record)}\n`, 'utf8');
}

export async function deleteHashIndexByJobId(jobId: string): Promise<string[]> {
    const deleted: string[] = [];
    let entries: string[];
    try {
        entries = await fsp.readdir(hashIndexDir());
    } catch {
        return deleted;
    }

    for (const name of entries) {
        if (!name.endsWith('.json')) {
            continue;
        }
        const fullPath = path.join(hashIndexDir(), name);
        try {
            const raw = await fsp.readFile(fullPath, 'utf8');
            const rec = JSON.parse(raw) as HashIndexRecord;
            if (rec?.jobId === jobId && typeof rec?.hash === 'string') {
                await fsp.unlink(fullPath);
                deleted.push(rec.hash);
            }
        } catch {
            // ignore malformed records
        }
    }

    return deleted;
}
