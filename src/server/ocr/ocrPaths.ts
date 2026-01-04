import path from 'node:path';
import { jobDir } from '@/server/jobs/jobPaths';

export function jobOcrDir(jobId: string): string {
    return path.join(jobDir(jobId), 'ocr');
}

export function jobOcrInputPdfPath(jobId: string): string {
    return path.join(jobOcrDir(jobId), 'input.pdf');
}

export function jobOcrJsonPath(jobId: string): string {
    return path.join(jobOcrDir(jobId), 'ocr.json');
}

export function jobOcrMetaPath(jobId: string): string {
    return path.join(jobOcrDir(jobId), 'meta.json');
}

export function jobOcrPagesDir(jobId: string): string {
    return path.join(jobOcrDir(jobId), 'pages');
}
