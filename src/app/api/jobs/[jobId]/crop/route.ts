import { parseCropBox } from '@/server/crop/crop';
import { readCropBox, writeCropBox } from '@/server/crop/cropStore';
import { globalJobStore } from '@/server/jobs/jobStore';

export const runtime = 'nodejs';

export async function GET(_request: Request, ctx: { params: Promise<{ jobId: string }> }): Promise<Response> {
    const { jobId } = await ctx.params;
    const job = globalJobStore.get(jobId);

    // Prefer in-memory value, but allow filesystem fallback (useful in dev reloads)
    const crop = job?.crop ?? (await readCropBox(jobId));
    return Response.json({ crop: crop ?? null });
}

export async function POST(request: Request, ctx: { params: Promise<{ jobId: string }> }): Promise<Response> {
    const { jobId } = await ctx.params;

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    let crop: ReturnType<typeof parseCropBox>;
    try {
        const payload = body as any;
        crop = parseCropBox(payload?.crop ?? payload);
    } catch (err: unknown) {
        return Response.json({ error: err instanceof Error ? err.message : 'Invalid crop payload' }, { status: 400 });
    }

    await writeCropBox(jobId, crop);

    const job = globalJobStore.get(jobId);
    if (job) {
        globalJobStore.update(jobId, (j) => {
            j.crop = crop;
        });
    }

    return Response.json({ crop });
}
