import type { JobStore } from '@/server/jobs/jobStore';

export type StartMacOcrParams = { jobId: string; store: JobStore; language?: string; splitPages?: boolean };

export interface MacOcrProvider {
    start(params: StartMacOcrParams): Promise<void>;
}
