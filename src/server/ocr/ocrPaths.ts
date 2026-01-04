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

// Surya OCR paths
export function jobSuryaOcrDir(jobId: string): string {
    return path.join(jobDir(jobId), 'surya');
}

export function jobSuryaResultsJsonPath(jobId: string): string {
    return path.join(jobSuryaOcrDir(jobId), 'results.json');
}

export function jobSuryaOcrJsonPath(jobId: string): string {
    return path.join(jobSuryaOcrDir(jobId), 'surya.json');
}

export function jobSuryaMetaPath(jobId: string): string {
    return path.join(jobSuryaOcrDir(jobId), 'meta.json');
}

export function jobSuryaPagesDir(jobId: string): string {
    return path.join(jobSuryaOcrDir(jobId), 'pages');
}
