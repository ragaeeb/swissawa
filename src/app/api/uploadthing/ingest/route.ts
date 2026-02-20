import { UTApi } from 'uploadthing/server';
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

function parseBody(request: Request): Promise<{ key?: unknown }> {
    return request.json().catch(() => ({}));
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
        if (!value) {
            continue;
        }
        total += value.byteLength;
        if (total > maxBytes) {
            throw new Error('Remote file exceeds maximum allowed size');
        }
        chunks.push(value);
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
    const body = await parseBody(request);
    const key = typeof body.key === 'string' ? body.key : null;
    if (!key) {
        return Response.json({ error: 'Missing file key' }, { status: 400 });
    }

    try {
        const utapi = new UTApi();
        const { ufsUrl } = await utapi.generateSignedURL(key, { expiresIn: '10 minutes' });
        const response = await fetch(ufsUrl, { redirect: 'follow' });
        if (!response.ok) {
            return Response.json({ error: `Failed to download uploaded file (${response.status})` }, { status: 400 });
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().includes('application/pdf')) {
            return Response.json({ error: 'Only PDF files are supported' }, { status: 400 });
        }
        if (!response.body) {
            return Response.json({ error: 'Missing response body' }, { status: 500 });
        }

        const bytes = await readAllBytesWithLimit(response.body, readMaxUploadBytesFromEnv());
        const created = await createJobFromPdfBytes({ bytes });
        return Response.json(created);
    } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('maximum allowed size')) {
            return Response.json({ error: err.message }, { status: 413 });
        }
        return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
    }
}
