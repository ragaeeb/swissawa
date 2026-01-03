import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import { cropFilePath } from '@/server/crop/cropStore';
import { jobDir } from '@/server/jobs/jobPaths';
import { globalJobStore } from '@/server/jobs/jobStore';
import { GET, POST } from './route';

describe('GET/POST /api/jobs/[jobId]/crop', () => {
    it('GET returns null crop if none set', async () => {
        const jobId = randomUUID();
        globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir: '/tmp/out',
            pdfPath: '/tmp/in.pdf',
            progress: { extractedPages: 0, totalPages: 1 },
            status: 'processing',
        });

        const res = await GET(new Request(`http://localhost/api/jobs/${jobId}/crop`), {
            params: Promise.resolve({ jobId }),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.crop).toBeNull();
    });

    it('POST saves crop and GET returns it', async () => {
        const jobId = randomUUID();
        globalJobStore.create({
            id: jobId,
            info: undefined,
            outputDir: '/tmp/out',
            pdfPath: '/tmp/in.pdf',
            progress: { extractedPages: 0, totalPages: 10 },
            status: 'processing',
        });

        const crop = { height: 0.8, width: 0.6, x: 0.2, y: 0.1 };
        const postRes = await POST(
            new Request(`http://localhost/api/jobs/${jobId}/crop`, {
                body: JSON.stringify({ crop }),
                headers: { 'content-type': 'application/json' },
                method: 'POST',
            }),
            { params: Promise.resolve({ jobId }) },
        );
        expect(postRes.status).toBe(200);

        const getRes = await GET(new Request(`http://localhost/api/jobs/${jobId}/crop`), {
            params: Promise.resolve({ jobId }),
        });
        const data = await getRes.json();
        expect(data.crop).toEqual(crop);

        await fsp.rm(cropFilePath(jobId), { force: true });
    });

    it('GET can return crop from filesystem even if job is missing (dev HMR regression)', async () => {
        const jobId = randomUUID();
        const crop = { height: 0.9, width: 0.9, x: 0.05, y: 0.05 };
        await fsp.mkdir(jobDir(jobId), { recursive: true });
        await fsp.writeFile(cropFilePath(jobId), JSON.stringify(crop), 'utf8');

        const res = await GET(new Request(`http://localhost/api/jobs/${jobId}/crop`), {
            params: Promise.resolve({ jobId }),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.crop).toEqual(crop);

        await fsp.rm(cropFilePath(jobId), { force: true });
    });
});
