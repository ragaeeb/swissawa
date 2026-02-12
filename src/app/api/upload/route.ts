import { parseMultipartStream } from '@mjackson/multipart-parser';
import { createJobFromPdfBytes } from '@/server/jobs/createJobFromPdfBytes';

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

        const created = await createJobFromPdfBytes({ bytes: fileBytes });
        console.info(created.reused ? '[upload.reuse]' : '[upload.created]', {
            jobId: created.jobId,
            sha256: created.sha256,
        });
        return Response.json(created);
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
