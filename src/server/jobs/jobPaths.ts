import os from 'node:os';
import path from 'node:path';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateJobId(jobId: string): void {
    if (!UUID_REGEX.test(jobId)) {
        throw new Error(`Invalid jobId: ${jobId}`);
    }
}

export function jobDir(jobId: string): string {
    validateJobId(jobId);
    return path.join(os.tmpdir(), 'swissawa', jobId);
}

export function jobPdfPath(jobId: string): string {
    return path.join(jobDir(jobId), 'input.pdf');
}

export function jobImagesDir(jobId: string): string {
    return path.join(jobDir(jobId), 'images');
}
