import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import { cropFilePath, readCropBox, writeCropBox } from '@/server/crop/cropStore';

describe('cropStore', () => {
    it('returns null if crop file does not exist', async () => {
        const jobId = randomUUID();
        expect(await readCropBox(jobId)).toBeNull();
    });

    it('writes and reads crop box', async () => {
        const jobId = randomUUID();
        const crop = { height: 0.8, width: 0.6, x: 0.2, y: 0.1 };
        await writeCropBox(jobId, crop);
        expect(await readCropBox(jobId)).toEqual(crop);

        // cleanup best-effort
        await fsp.rm(cropFilePath(jobId), { force: true });
    });
});
