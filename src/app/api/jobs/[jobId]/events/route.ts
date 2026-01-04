import { readJobSnapshot } from '@/server/jobs/jobSnapshot';
import { globalJobStore } from '@/server/jobs/jobStore';
import { formatSseEvent } from '@/server/sse/sse';

export const runtime = 'nodejs';

export const GET = async (_request: Request, { params }: { params: Promise<{ jobId: string }> }): Promise<Response> => {
    const { jobId } = await params;
    let job = globalJobStore.get(jobId);
    let bus = globalJobStore.bus(jobId);

    // If HMR/dev refresh cleared memory, recover from the on-disk snapshot.
    if (!job || !bus) {
        const snap = await readJobSnapshot(jobId);
        if (snap) {
            globalJobStore.create({
                crop: snap.crop,
                error: snap.error,
                id: snap.id,
                info: snap.info,
                ocr: snap.ocr,
                outputDir: snap.outputDir,
                pdfPath: snap.pdfPath,
                progress: snap.progress,
                sourceUrl: snap.sourceUrl,
                status: snap.status,
            });
            job = globalJobStore.get(jobId);
            bus = globalJobStore.bus(jobId);
        }
    }

    if (!job || !bus) {
        return Response.json({ error: 'Job not found' }, { status: 404 });
    }

    const encoder = new TextEncoder();

    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let cleanup: (() => void) | null = null;

    const stream = new ReadableStream<Uint8Array>({
        cancel() {
            cleanup?.();
        },
        start(controller) {
            const write = (s: string) => controller.enqueue(encoder.encode(s));

            const closeStream = () => {
                cleanup?.();
                controller.close();
            };

            write(formatSseEvent('snapshot', { job }));

            const onProgress = (progress: unknown) => write(formatSseEvent('progress', progress));
            const onPdf = (info: unknown) => write(formatSseEvent('pdf', info));
            const onComplete = (j: unknown) => {
                write(formatSseEvent('complete', j));
                closeStream();
            };
            const onError = (message: string) => {
                write(formatSseEvent('error', { message }));
                closeStream();
            };

            bus.on('progress', onProgress);
            bus.on('pdf', onPdf);
            bus.on('complete', onComplete);
            bus.on('error', onError);

            heartbeat = setInterval(() => {
                // comment heartbeat
                write(':\n\n');
            }, 15_000);

            cleanup = () => {
                if (heartbeat) {
                    clearInterval(heartbeat);
                    heartbeat = null;
                }
                bus.off('progress', onProgress);
                bus.off('pdf', onPdf);
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
};
