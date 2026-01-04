import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { MacOCR } from '@/lib/macOcr';
import { pageFileName, splitMacOcrToPages } from '@/server/ocr/splitMacOcr';

let tmpDir: string;

const FIXTURE_OCR: MacOCR = {
    dpi: { x: 300, y: 300 },
    pages: [
        {
            height: 1000,
            observations: [{ bbox: { height: 40, width: 30, x: 10, y: 20 }, text: 'بسم الله' }],
            page: 1,
            width: 800,
        },
        {
            height: 1000,
            observations: [{ bbox: { height: 41, width: 31, x: 11, y: 21 }, text: 'الرحمن الرحيم' }],
            page: 2,
            width: 800,
        },
    ],
};

describe('splitMacOcrToPages', () => {
    beforeEach(async () => {
        tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'swissawa-ocr-split-'));
    });

    afterEach(async () => {
        await fsp.rm(tmpDir, { force: true, recursive: true });
    });

    it('should emit pages/<page>.json and meta.json', async () => {
        const meta = await splitMacOcrToPages({ language: 'ar-SA', ocr: FIXTURE_OCR, outDir: tmpDir });
        expect(meta.totalPages).toBe(2);
        expect(meta.dpi).toEqual({ x: 300, y: 300 });
        expect(meta.language).toBe('ar-SA');

        const p1 = JSON.parse(await fsp.readFile(path.join(tmpDir, 'pages', '1.json'), 'utf8')) as unknown;
        const p2 = JSON.parse(await fsp.readFile(path.join(tmpDir, 'pages', '2.json'), 'utf8')) as unknown;
        expect((p1 as any).page).toBe(1);
        expect((p2 as any).page).toBe(2);

        const metaOnDisk = JSON.parse(await fsp.readFile(path.join(tmpDir, 'meta.json'), 'utf8')) as any;
        expect(metaOnDisk.totalPages).toBe(2);
        expect(metaOnDisk.language).toBe('ar-SA');
    });

    it('should validate pageFileName input', () => {
        expect(pageFileName(1)).toBe('1.json');
        expect(() => pageFileName(0)).toThrow();
        expect(() => pageFileName(-1)).toThrow();
        expect(() => pageFileName(1.5)).toThrow();
    });
});
