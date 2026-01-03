import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import { parseMultipartStream } from '@mjackson/multipart-parser';
import { jobDir, jobImagesDir, jobPdfPath } from '@/server/jobs/jobPaths';
import { globalJobStore } from '@/server/jobs/jobStore';
import { runPdfExtractionJob } from '@/server/pdf/runner';

export const runtime = 'nodejs';

export const handleUploadStream = async (
    body: ReadableStream,
    headers: Headers,
    pdfPath: string,
): Promise<{ fileFound: boolean; fileMime?: string; fileWritePromise?: Promise<void> }> => {
    const contentType = headers.get('content-type') || '';
    const boundary = contentType.split('boundary=')[1];

    if (!boundary) {
        throw new Error('No boundary found in content-type');
    }

    let fileFound = false;
    let fileMime: string | undefined;
    let fileWritePromise: Promise<void> | undefined;

    for await (const part of parseMultipartStream(body, { boundary })) {
        if (part.isFile && !fileFound) {
            fileFound = true;
            fileMime = part.mediaType;
            fileWritePromise = fsp.writeFile(pdfPath, part.bytes);
            break; // We only expect one file
        }
    }

    return { fileFound, fileMime, fileWritePromise };
};

export const POST = async (request: Request): Promise<Response> => {
    const jobId = randomUUID();
    const dir = jobDir(jobId);
    const outputDir = jobImagesDir(jobId);
    const pdfPath = jobPdfPath(jobId);

    await fsp.mkdir(dir, { recursive: true });

    globalJobStore.create({
        id: jobId,
        info: undefined,
        outputDir,
        pdfPath,
        progress: { extractedPages: 0, totalPages: undefined },
        status: 'uploaded',
    });

    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
        globalJobStore.update(jobId, (j) => {
            j.status = 'error';
            j.error = 'Expected multipart/form-data';
        });
        return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 });
    }

    const body = request.body;
    if (!body) {
        globalJobStore.update(jobId, (j) => {
            j.status = 'error';
            j.error = 'Missing request body';
        });
        return Response.json({ error: 'Missing request body' }, { status: 400 });
    }

    try {
        const { fileFound, fileMime, fileWritePromise } = await handleUploadStream(body, request.headers, pdfPath);

        if (!fileFound) {
            globalJobStore.update(jobId, (j) => {
                j.status = 'error';
                j.error = 'No file uploaded';
            });
            return Response.json({ error: 'No file uploaded' }, { status: 400 });
        }

        if (fileMime !== 'application/pdf') {
            globalJobStore.update(jobId, (j) => {
                j.status = 'error';
                j.error = `Invalid file type: ${fileMime ?? 'unknown'}`;
            });
            return Response.json({ error: 'Only PDF files are supported' }, { status: 400 });
        }

        await fileWritePromise;

        runPdfExtractionJob({ jobId, store: globalJobStore }).catch((err: unknown) => {
            const bus = globalJobStore.bus(jobId);
            globalJobStore.update(jobId, (j) => {
                j.status = 'error';
                j.error = err instanceof Error ? err.message : 'Unknown error';
            });
            bus?.emit('error', err instanceof Error ? err.message : 'Unknown error');
        });

        return Response.json({ jobId });
    } catch (err: any) {
        globalJobStore.update(jobId, (j) => {
            j.status = 'error';
            j.error = err.message;
        });
        return Response.json({ error: err.message }, { status: 500 });
    }
};
