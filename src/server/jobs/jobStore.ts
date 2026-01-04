import { EventEmitter } from 'node:events';
import type { CropBox } from '@/server/crop/crop';
import type { OcrMeta } from '@/server/ocr/splitMacOcr';
import type { PdfInfo } from '@/server/pdf/pdfInfo';

export type JobStatus = 'uploaded' | 'processing' | 'complete' | 'error';

export type JobProgress = { extractedPages: number; totalPages?: number };

export type JobOcrStatus = 'idle' | 'running' | 'complete' | 'error';

export type JobOcr = { status: JobOcrStatus; language?: string; error?: string; meta?: OcrMeta; updatedAtMs: number };

export type Job = {
    id: string;
    createdAtMs: number;
    status: JobStatus;
    pdfPath: string;
    outputDir: string;
    crop?: CropBox;
    info?: PdfInfo;
    progress: JobProgress;
    error?: string;
    // Optional; default behavior should treat missing as {status:'idle'}.
    ocr?: JobOcr;
    // Optional; surya OCR status tracked separately for parallel execution.
    suryaOcr?: JobOcr;
    // Optional; informational only (dedupe is by content hash).
    sourceUrl?: string;
};

export type JobEvents = {
    progress: (progress: JobProgress) => void;
    pdf: (info: PdfInfo) => void;
    page: (page: { pageNumber: number }) => void;
    complete: (job: Job) => void;
    error: (message: string) => void;
};

export class JobEventBus {
    private emitter = new EventEmitter();

    on<K extends keyof JobEvents>(event: K, handler: JobEvents[K]): void {
        this.emitter.on(event, handler as (...args: any[]) => void);
    }

    off<K extends keyof JobEvents>(event: K, handler: JobEvents[K]): void {
        this.emitter.off(event, handler as (...args: any[]) => void);
    }

    emit<K extends keyof JobEvents>(event: K, ...args: Parameters<JobEvents[K]>): void {
        this.emitter.emit(event, ...args);
    }
}

export class JobStore {
    private jobs = new Map<string, Job>();
    private buses = new Map<string, JobEventBus>();

    create(job: Omit<Job, 'createdAtMs'>): Job {
        if (this.jobs.has(job.id)) {
            throw new Error(`Job already exists: ${job.id}`);
        }
        const full: Job = { ...job, createdAtMs: Date.now() };
        this.jobs.set(job.id, full);
        this.buses.set(job.id, new JobEventBus());
        return full;
    }

    get(id: string): Job | undefined {
        return this.jobs.get(id);
    }

    bus(id: string): JobEventBus | undefined {
        return this.buses.get(id);
    }

    update(id: string, updater: (job: Job) => void): Job {
        const job = this.jobs.get(id);
        if (!job) {
            throw new Error(`Job not found: ${id}`);
        }
        updater(job);
        return job;
    }

    delete(id: string): void {
        this.jobs.delete(id);
        this.buses.delete(id);
    }
}

export const globalJobStore = new JobStore();
