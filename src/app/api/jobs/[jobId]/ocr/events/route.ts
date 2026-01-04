import { readJobSnapshot } from '@/server/jobs/jobSnapshot';
import { globalJobStore } from '@/server/jobs/jobStore';
import { getLastOcrProgress, ocrBus } from '@/server/ocr/ocrEventBus';
import { formatSseEvent } from '@/server/sse/sse';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }): Promise<Response> {
    const { jobId } = await params;
    console.info('[jobs.ocr.sse.connect]', { jobId });

    const job = globalJobStore.get(jobId) ?? (await readJobSnapshot(jobId));
    if (!job) {
        console.warn('[jobs.ocr.sse.not_found]', { jobId });
        return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    const bus = ocrBus(jobId);
    const encoder = new TextEncoder();

    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let cleanup: (() => void) | null = null;

    const stream = new ReadableStream<Uint8Array>({
        cancel() {
            console.info('[jobs.ocr.sse.cancel]', { jobId });
            cleanup?.();
        },
        start(controller) {
            const write = (s: string) => controller.enqueue(encoder.encode(s));

            const closeStream = () => {
                cleanup?.();
                controller.close();
            };

            const status = job.ocr?.status ?? 'idle';
            write(formatSseEvent('snapshot', { progress: getLastOcrProgress(jobId), status }));

            // If OCR is already done (or errored) by the time the client connects, emit terminal event immediately.
            if (status === 'complete') {
                console.info('[jobs.ocr.sse.complete]', { immediate: true, jobId });
                write(formatSseEvent('complete', { status: 'complete' }));
                closeStream();
                return;
            }
            if (status === 'error') {
                const message = job.ocr?.error ?? 'OCR failed';
                console.error('[jobs.ocr.sse.error]', { immediate: true, jobId, message });
                write(formatSseEvent('error', { message }));
                closeStream();
                return;
            }

            const onProgress = (ev: unknown) => write(formatSseEvent('progress', ev));
            const onComplete = () => {
                console.info('[jobs.ocr.sse.complete]', { jobId });
                write(formatSseEvent('complete', { status: 'complete' }));
                closeStream();
            };
            const onError = (message: string) => {
                console.error('[jobs.ocr.sse.error]', { jobId, message });
                write(formatSseEvent('error', { message }));
                closeStream();
            };

            bus.on('progress', onProgress as any);
            bus.on('complete', onComplete);
            bus.on('error', onError);

            heartbeat = setInterval(() => {
                write(':\n\n');
            }, 15_000);

            cleanup = () => {
                if (heartbeat) {
                    clearInterval(heartbeat);
                    heartbeat = null;
                }
                bus.off('progress', onProgress as any);
                bus.off('complete', onComplete);
                bus.off('error', onError);
            };
        },
    });

    return new Response(stream, {
        headers: {
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'Content-Type': 'text/event-stream; charset=utf-8',
            'X-Accel-Buffering': 'no',
        },
    });
}
