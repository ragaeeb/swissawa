import { describe, expect, it } from 'bun:test';
import { JobStore } from '@/server/jobs/jobStore';

describe('JobStore', () => {
    it('should create/get/update works', () => {
        const store = new JobStore();
        const job = store.create({
            id: 'job-1',
            info: undefined,
            outputDir: '/tmp/out',
            pdfPath: '/tmp/in.pdf',
            progress: { extractedPages: 0, totalPages: undefined },
            status: 'uploaded',
        });

        expect(job.id).toBe('job-1');
        expect(store.get('job-1')?.status).toBe('uploaded');

        store.update('job-1', (j) => {
            j.status = 'processing';
            j.progress.totalPages = 10;
        });

        const updated = store.get('job-1');
        expect(updated?.status).toBe('processing');
        expect(updated?.progress.totalPages).toBe(10);
    });

    it('should emit events from bus', async () => {
        const store = new JobStore();
        store.create({
            id: 'job-1',
            info: undefined,
            outputDir: '/tmp/out',
            pdfPath: '/tmp/in.pdf',
            progress: { extractedPages: 0, totalPages: 2 },
            status: 'processing',
        });

        const bus = store.bus('job-1');
        expect(bus).toBeTruthy();

        const events: Array<{ event: string; data: unknown }> = [];

        await new Promise<void>((resolve) => {
            bus?.on('progress', (p) => {
                events.push({ data: p, event: 'progress' });
            });
            bus?.on('complete', () => {
                events.push({ data: null, event: 'complete' });
                resolve();
            });

            bus?.emit('progress', { extractedPages: 1, totalPages: 2 });
            bus?.emit('complete', store.get('job-1')!);
        });

        expect(events.map((e) => e.event)).toEqual(['progress', 'complete']);
    });

    it('should throw when creating job with duplicate id', () => {
        const store = new JobStore();
        const jobData = {
            id: 'job-1',
            info: undefined,
            outputDir: '/tmp/out',
            pdfPath: '/tmp/in.pdf',
            progress: { extractedPages: 0, totalPages: undefined },
            status: 'uploaded' as const,
        };
        store.create(jobData);
        expect(() => store.create(jobData)).toThrow('Job already exists: job-1');
    });

    it('should throw when updating non-existent job', () => {
        const store = new JobStore();
        expect(() => store.update('non-existent', () => {})).toThrow('Job not found: non-existent');
    });

    it('should delete job and bus', () => {
        const store = new JobStore();
        store.create({
            id: 'job-1',
            info: undefined,
            outputDir: '/tmp/out',
            pdfPath: '/tmp/in.pdf',
            progress: { extractedPages: 0, totalPages: undefined },
            status: 'uploaded',
        });

        expect(store.get('job-1')).toBeTruthy();
        expect(store.bus('job-1')).toBeTruthy();

        store.delete('job-1');

        expect(store.get('job-1')).toBeUndefined();
        expect(store.bus('job-1')).toBeUndefined();
    });
});
