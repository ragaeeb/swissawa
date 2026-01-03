import { afterEach, describe, expect, it } from 'bun:test';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCandidateImageNames, inferPadWidthFromFileName, resolveJobImagePath } from '@/server/pdf/imageResolve';

const testDirs: string[] = [];

const tmpDir = (name: string): string => {
    const dir = path.join(
        os.tmpdir(),
        'swissawa-tests',
        `${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    testDirs.push(dir);
    return dir;
};

afterEach(async () => {
    for (const dir of testDirs) {
        try {
            await fsp.rm(dir, { force: true, recursive: true });
        } catch {
            // Ignore errors during cleanup
        }
    }
    testDirs.length = 0;
});

describe('inferPadWidthFromFileName', () => {
    it('should infer width from poppler-style filenames', () => {
        expect(inferPadWidthFromFileName('page-001.jpg')).toBe(3);
        expect(inferPadWidthFromFileName('page-040.jpg')).toBe(3);
        expect(inferPadWidthFromFileName('page-108.jpg')).toBe(3);
        expect(inferPadWidthFromFileName('page-1.jpg')).toBe(1);
    });
});

describe('buildCandidateImageNames', () => {
    it('should include padded candidate when total pages is known', () => {
        const names = buildCandidateImageNames(1, 510, null);
        expect(names[0]).toBe('page-001.jpg');
    });
});

describe('resolveJobImagePath', () => {
    it('should serve padded filenames (regression for 404 images)', async () => {
        const dir = tmpDir('padded');
        await fsp.mkdir(dir, { recursive: true });
        const file = path.join(dir, 'page-001.jpg');
        await fsp.writeFile(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9])); // minimal JPEG

        const resolved = await resolveJobImagePath({ outputDir: dir, pageNumber: 1, totalPages: 510 });
        expect(resolved).toBe(file);
    });

    it('should infer pad width from directory when totalPages is unknown (regression for job-store reset)', async () => {
        const dir = tmpDir('infer');
        await fsp.mkdir(dir, { recursive: true });
        const file = path.join(dir, 'page-040.jpg');
        await fsp.writeFile(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

        const resolved = await resolveJobImagePath({ outputDir: dir, pageNumber: 40, totalPages: undefined });
        expect(resolved).toBe(file);
    });
});
