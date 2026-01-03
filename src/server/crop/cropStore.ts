import fsp from 'node:fs/promises';
import path from 'node:path';
import type { CropBox } from '@/server/crop/crop';
import { parseCropBox } from '@/server/crop/crop';
import { jobDir } from '@/server/jobs/jobPaths';

export function cropFilePath(jobId: string): string {
    return path.join(jobDir(jobId), 'crop.json');
}

export async function readCropBox(jobId: string): Promise<CropBox | null> {
    try {
        const raw = await fsp.readFile(cropFilePath(jobId), 'utf8');
        const json = JSON.parse(raw) as unknown;
        return parseCropBox(json);
    } catch {
        return null;
    }
}

export async function writeCropBox(jobId: string, crop: CropBox): Promise<void> {
    const dir = jobDir(jobId);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(cropFilePath(jobId), `${JSON.stringify(crop)}\n`, 'utf8');
}
