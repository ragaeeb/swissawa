import { createHash, randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import { readHashIndex, writeHashIndex } from '@/server/jobs/hashIndex';
import { jobDir, jobImagesDir, jobPdfPath } from '@/server/jobs/jobPaths';
import { writeJobSnapshot } from '@/server/jobs/jobSnapshot';
import { globalJobStore } from '@/server/jobs/jobStore';
import { runPdfExtractionJob } from '@/server/pdf/runner';

export const runtime = 'nodejs';

const DEFAULT_MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

function readMaxUploadBytesFromEnv(): number {
    const raw = process.env.SWISSAWA_MAX_UPLOAD_BYTES;
    if (!raw) {
        return DEFAULT_MAX_UPLOAD_BYTES;
    }
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
        return DEFAULT_MAX_UPLOAD_BYTES;
    }
    return n;
}

function parseJsonBody(request: Request): Promise<unknown> {
    return request.json().catch(() => null);
}

function isHttpUrl(raw: string): boolean {
    try {
        const u = new URL(raw);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

async function readAllBytesWithLimit(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        if (value) {
            total += value.byteLength;
            if (total > maxBytes) {
                throw new Error('Remote file exceeds maximum allowed size');
            }
            chunks.push(value);
        }
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.byteLength;
    }
    return out;
}

export async function POST(request: Request): Promise<Response> {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
        return Response.json({ error: 'Expected application/json' }, { status: 400 });
    }

    const json = await parseJsonBody(request);
    const url = (json as any)?.url as unknown;
    if (typeof url !== 'string' || !isHttpUrl(url)) {
        return Response.json({ error: 'Invalid url' }, { status: 400 });
    }

    try {
        const maxBytes = readMaxUploadBytesFromEnv();
        console.info('[upload.url.start]', { maxBytes, url });
        const res = await fetch(url, { redirect: 'follow' });
        if (!res.ok) {
            return Response.json({ error: `Failed to download (${res.status})` }, { status: 400 });
        }
        const mime = res.headers.get('content-type') ?? '';
        if (!mime.toLowerCase().includes('application/pdf')) {
            return Response.json({ error: 'Only PDF files are supported' }, { status: 400 });
        }
        if (!res.body) {
            return Response.json({ error: 'Missing response body' }, { status: 500 });
        }

        const bytes = await readAllBytesWithLimit(res.body, maxBytes);
        const sha256 = createHash('sha256').update(bytes).digest('hex');

        const existing = await readHashIndex(sha256);
        if (existing) {
            console.info('[upload.url.reuse]', { jobId: existing.jobId, sha256, url });
            return Response.json({ jobId: existing.jobId, reused: true, sha256 });
        }

        const jobId = randomUUID();
        const dir = jobDir(jobId);
        const outputDir = jobImagesDir(jobId);
        const pdfPath = jobPdfPath(jobId);

        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(pdfPath, bytes);

        const job = globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir,
            pdfPath,
            progress: { extractedPages: 0, totalPages: undefined },
            sourceUrl: url,
            status: 'uploaded',
        });
        await writeJobSnapshot(job);
        await writeHashIndex({ createdAtMs: Date.now(), hash: sha256, jobId });
        console.info('[upload.url.created]', { jobId, sha256, url });

        runPdfExtractionJob({ jobId, store: globalJobStore }).catch((err: unknown) => {
            const bus = globalJobStore.bus(jobId);
            globalJobStore.update(jobId, (j) => {
                j.status = 'error';
                j.error = err instanceof Error ? err.message : 'Unknown error';
            });
            bus?.emit('error', err instanceof Error ? err.message : 'Unknown error');
        });

        return Response.json({ jobId, reused: false, sha256 });
    } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('maximum allowed size')) {
            return Response.json({ error: err.message }, { status: 413 });
        }
        return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
    }
}
