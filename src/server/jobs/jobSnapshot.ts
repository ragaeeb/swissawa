import fsp from 'node:fs/promises';
import path from 'node:path';
import { jobDir } from '@/server/jobs/jobPaths';
import type { Job } from '@/server/jobs/jobStore';

export function jobSnapshotPath(jobId: string): string {
    return path.join(jobDir(jobId), 'job.json');
}

export async function writeJobSnapshot(job: Job): Promise<void> {
    await fsp.mkdir(jobDir(job.id), { recursive: true });
    // Keep it human readable; no secrets here.
    await fsp.writeFile(jobSnapshotPath(job.id), `${JSON.stringify(job)}\n`, 'utf8');
}

export async function readJobSnapshot(jobId: string): Promise<Job | null> {
    try {
        const raw = await fsp.readFile(jobSnapshotPath(jobId), 'utf8');
        return JSON.parse(raw) as Job;
    } catch {
        return null;
    }
}
