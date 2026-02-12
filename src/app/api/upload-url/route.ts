import { createJobFromPdfBytes } from '@/server/jobs/createJobFromPdfBytes';

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
        const created = await createJobFromPdfBytes({ bytes, sourceUrl: url });
        console.info(created.reused ? '[upload.url.reuse]' : '[upload.url.created]', {
            jobId: created.jobId,
            sha256: created.sha256,
            url,
        });
        return Response.json(created);
    } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('maximum allowed size')) {
            return Response.json({ error: err.message }, { status: 413 });
        }
        return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
    }
}
