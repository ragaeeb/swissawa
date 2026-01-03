import { createHash, randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import { parseMultipartStream } from '@mjackson/multipart-parser';
import { readHashIndex, writeHashIndex } from '@/server/jobs/hashIndex';
import { jobDir, jobImagesDir, jobPdfPath } from '@/server/jobs/jobPaths';
import { writeJobSnapshot } from '@/server/jobs/jobSnapshot';
import { globalJobStore } from '@/server/jobs/jobStore';
import { runPdfExtractionJob } from '@/server/pdf/runner';

export const runtime = 'nodejs';

const DEFAULT_MAX_UPLOAD_BYTES = 64 * 1024 * 1024; // 64MB (multipart-parser buffers the whole file)

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

export const handleUploadStream = async (
    body: ReadableStream,
    headers: Headers,
    maxBytes = readMaxUploadBytesFromEnv(),
): Promise<{ fileFound: boolean; fileMime?: string; fileBytes?: Uint8Array }> => {
    const contentType = headers.get('content-type') || '';
    const boundary = contentType.split('boundary=')[1];

    if (!boundary) {
        throw new Error('No boundary found in content-type');
    }

    let fileFound = false;
    let fileMime: string | undefined;
    let fileBytes: Uint8Array | undefined;

    for await (const part of parseMultipartStream(body, { boundary, maxFileSize: maxBytes })) {
        if (part.isFile && !fileFound) {
            fileFound = true;
            fileMime = part.mediaType;

            fileBytes = part.bytes;
            break; // We only expect one file
        }
    }

    return { fileBytes, fileFound, fileMime };
};

export const POST = async (request: Request): Promise<Response> => {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
        return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 });
    }

    const body = request.body;
    if (!body) {
        return Response.json({ error: 'Missing request body' }, { status: 400 });
    }

    try {
        const maxBytes = readMaxUploadBytesFromEnv();
        console.info('[upload.start]', { maxBytes });
        const { fileFound, fileMime, fileBytes } = await handleUploadStream(body, request.headers, maxBytes);

        if (!fileFound) {
            return Response.json({ error: 'No file uploaded' }, { status: 400 });
        }

        if (fileMime !== 'application/pdf') {
            return Response.json({ error: 'Only PDF files are supported' }, { status: 400 });
        }

        if (!fileBytes) {
            return Response.json({ error: 'No file uploaded' }, { status: 400 });
        }

        const sha256 = createHash('sha256').update(fileBytes).digest('hex');
        const existing = await readHashIndex(sha256);
        if (existing) {
            console.info('[upload.reuse]', { jobId: existing.jobId, sha256 });
            return Response.json({ jobId: existing.jobId, reused: true, sha256 });
        }

        const jobId = randomUUID();
        const dir = jobDir(jobId);
        const outputDir = jobImagesDir(jobId);
        const pdfPath = jobPdfPath(jobId);

        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(pdfPath, fileBytes);

        const job = globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir,
            pdfPath,
            progress: { extractedPages: 0, totalPages: undefined },
            status: 'uploaded',
        });
        await writeJobSnapshot(job);
        await writeHashIndex({ createdAtMs: Date.now(), hash: sha256, jobId });
        console.info('[upload.created]', { jobId, sha256 });

        runPdfExtractionJob({ jobId, store: globalJobStore }).catch((err: unknown) => {
            const bus = globalJobStore.bus(jobId);
            globalJobStore.update(jobId, (j) => {
                j.status = 'error';
                j.error = err instanceof Error ? err.message : 'Unknown error';
            });
            bus?.emit('error', err instanceof Error ? err.message : 'Unknown error');
        });

        return Response.json({ jobId, reused: false, sha256 });
    } catch (err: any) {
        if (
            err instanceof Error &&
            (err.name === 'MaxFileSizeExceededError' || err.message.includes('maximum allowed size'))
        ) {
            return Response.json({ error: err.message }, { status: 413 });
        }
        return Response.json({ error: err.message }, { status: 500 });
    }
};
