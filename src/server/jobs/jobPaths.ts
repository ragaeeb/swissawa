import os from 'node:os';
import path from 'node:path';

export function jobDir(jobId: string): string {
    return path.join(os.tmpdir(), 'swissawa', jobId);
}

export function jobPdfPath(jobId: string): string {
    return path.join(jobDir(jobId), 'input.pdf');
}

export function jobImagesDir(jobId: string): string {
    return path.join(jobDir(jobId), 'images');
}
