import { afterEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import {
    buildCanonicalRasterArgs,
    createRasterEnvelope,
    type FontSubstitutionWarning,
} from '@/server/ocr/canonicalRaster';
import {
    type CanonicalRasterRenderer,
    type CanonicalRasterSourceProfiler,
    prepareCanonicalRasterPage,
} from '@/server/ocr/canonicalRasterCache';

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const typeBytes = Buffer.from(type, 'ascii');
    const dataBytes = Buffer.from(data);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(dataBytes.length, 0);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, dataBytes])), 0);
    return Buffer.concat([length, typeBytes, dataBytes, checksum]);
}

function rgbPng(includeSrgb = true): Uint8Array {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const scanline = Buffer.from([0, 255, 0, 0]);
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        ...(includeSrgb ? [chunk('sRGB', Uint8Array.of(0))] : []),
        chunk('IDAT', deflateSync(scanline)),
        chunk('IEND', new Uint8Array()),
    ]);
}

const sourceWarning: FontSubstitutionWarning = {
    font: 'AGAArabesque',
    message: 'source-profiler substitution warning',
    severity: 'error',
};

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => fsp.rm(directory, { force: true, recursive: true })));
});

describe('prepareCanonicalRasterPage', () => {
    it('profiles once, renders once, persists atomically, and returns byte-identical cache hits', async () => {
        const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'swissawa-canonical-raster-'));
        directories.push(directory);
        const pdfPath = path.join(directory, 'book with spaces.pdf');
        const pdfBytes = Buffer.from('%PDF-source-one');
        await fsp.writeFile(pdfPath, pdfBytes);
        const order: string[] = [];
        let profileCalls = 0;
        let renderCalls = 0;
        let renderDirectoryExisted = false;
        const sourceProfiler: CanonicalRasterSourceProfiler = async () => {
            profileCalls++;
            order.push('profile');
            return { fontSubstitutionWarnings: [sourceWarning] };
        };
        const renderer: CanonicalRasterRenderer = async (params) => {
            renderCalls++;
            order.push('render');
            await fsp.access(path.dirname(params.outputPrefix));
            renderDirectoryExisted = true;
            const bytes = rgbPng();
            return {
                bytes,
                envelope: createRasterEnvelope({
                    bytes,
                    crop: params.crop!,
                    fontSubstitutionWarnings: [],
                    rendererOptions: buildCanonicalRasterArgs({
                        inputPdfPath: params.inputPdfPath,
                        outputPrefix: params.outputPrefix,
                        page: params.page,
                    }),
                    source: { page: params.page, pdfSha256: params.sourcePdfSha256 },
                }),
                stderr: '',
            };
        };
        const request = {
            cacheDir: path.join(directory, 'cache'),
            inputPdfPath: pdfPath,
            page: 7,
            renderer,
            sourceProfiler,
        };

        const first = await prepareCanonicalRasterPage(request);
        const second = await prepareCanonicalRasterPage(request);

        expect(order).toEqual(['profile', 'render']);
        expect(profileCalls).toBe(1);
        expect(renderCalls).toBe(1);
        expect(renderDirectoryExisted).toBe(true);
        expect(first.cacheHit).toBe(false);
        expect(second.cacheHit).toBe(true);
        expect(second.bytes).toEqual(first.bytes);
        expect(second.envelope).toEqual(first.envelope);
        expect(second.envelope.fontSubstitutionWarnings).toEqual([sourceWarning]);
        expect(second.pngPath.endsWith('.png')).toBe(true);
        expect(second.envelope.source).toEqual({
            page: 7,
            pdfSha256: createHash('sha256').update(pdfBytes).digest('hex'),
        });
    });

    it('rejects stale cache metadata and re-renders after the PDF identity changes', async () => {
        const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'swissawa-canonical-raster-'));
        directories.push(directory);
        const pdfPath = path.join(directory, 'book.pdf');
        await fsp.writeFile(pdfPath, '%PDF-source-one');
        let renderCalls = 0;
        const renderer: CanonicalRasterRenderer = async (params) => {
            renderCalls++;
            const bytes = rgbPng();
            return {
                bytes,
                envelope: createRasterEnvelope({
                    bytes,
                    crop: params.crop!,
                    fontSubstitutionWarnings: [],
                    rendererOptions: buildCanonicalRasterArgs({
                        inputPdfPath: params.inputPdfPath,
                        outputPrefix: params.outputPrefix,
                        page: params.page,
                    }),
                    source: { page: params.page, pdfSha256: params.sourcePdfSha256 },
                }),
                stderr: '',
            };
        };
        const request = {
            cacheDir: path.join(directory, 'cache'),
            inputPdfPath: pdfPath,
            page: 1,
            renderer,
            sourceProfiler: async () => ({ fontSubstitutionWarnings: [] }),
        };
        const first = await prepareCanonicalRasterPage(request);
        const metadata = JSON.parse(await fsp.readFile(first.envelopePath, 'utf8')) as Record<string, unknown>;
        metadata.source = { page: 99, pdfSha256: 'stale' };
        await fsp.writeFile(first.envelopePath, JSON.stringify(metadata));

        const stale = await prepareCanonicalRasterPage(request);
        expect(stale.cacheHit).toBe(false);
        expect(renderCalls).toBe(2);

        await fsp.writeFile(pdfPath, '%PDF-source-two');
        const changed = await prepareCanonicalRasterPage(request);
        expect(changed.cacheHit).toBe(false);
        expect(renderCalls).toBe(3);
        expect(changed.envelope.source.pdfSha256).not.toBe(first.envelope.source.pdfSha256);
    });

    it('single-flights concurrent requests for the same page and returns identical inputs', async () => {
        const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'swissawa-canonical-raster-'));
        directories.push(directory);
        const pdfPath = path.join(directory, 'book.pdf');
        await fsp.writeFile(pdfPath, '%PDF-source-one');
        let profileCalls = 0;
        let renderCalls = 0;
        let releaseRender!: () => void;
        let renderStarted!: () => void;
        const renderGate = new Promise<void>((resolve) => {
            releaseRender = resolve;
        });
        const renderReady = new Promise<void>((resolve) => {
            renderStarted = resolve;
        });
        const renderer: CanonicalRasterRenderer = async (params) => {
            renderCalls++;
            renderStarted();
            await renderGate;
            const bytes = rgbPng();
            return {
                bytes,
                envelope: createRasterEnvelope({
                    bytes,
                    crop: params.crop!,
                    fontSubstitutionWarnings: params.fontSubstitutionWarnings,
                    rendererOptions: ['-png', '-r', '200'],
                    source: { page: params.page, pdfSha256: params.sourcePdfSha256 },
                }),
                stderr: '',
            };
        };
        const sourceProfiler: CanonicalRasterSourceProfiler = async () => {
            profileCalls++;
            return { fontSubstitutionWarnings: [sourceWarning] };
        };
        const request = {
            cacheDir: path.join(directory, 'cache'),
            inputPdfPath: pdfPath,
            page: 4,
            renderer,
            sourceProfiler,
        };
        const concurrent = Promise.all([prepareCanonicalRasterPage(request), prepareCanonicalRasterPage(request)]);
        await renderReady;
        releaseRender();
        const [first, second] = await concurrent;

        expect(profileCalls).toBe(1);
        expect(renderCalls).toBe(1);
        expect(first.cacheHit).toBe(false);
        expect(second.cacheHit).toBe(false);
        expect(first.bytes).toEqual(second.bytes);
        expect(first.envelope).toEqual(second.envelope);
    });

    it('accepts an injected profiler and renderer without constructing shell commands', async () => {
        const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'swissawa-canonical-raster-'));
        directories.push(directory);
        const pdfPath = path.join(directory, 'unsafe;path.pdf');
        await fsp.writeFile(pdfPath, '%PDF-source');
        let rendererParams: Parameters<CanonicalRasterRenderer>[0] | undefined;
        const renderer: CanonicalRasterRenderer = async (params) => {
            rendererParams = params;
            const bytes = rgbPng();
            return {
                bytes,
                envelope: createRasterEnvelope({
                    bytes,
                    crop: params.crop!,
                    fontSubstitutionWarnings: params.fontSubstitutionWarnings,
                    rendererOptions: ['-png', '-r', '200'],
                    source: { page: params.page, pdfSha256: params.sourcePdfSha256 },
                }),
                stderr: '',
            };
        };
        const sourceProfiler: CanonicalRasterSourceProfiler = async () => ({ fontSubstitutionWarnings: [] });

        await prepareCanonicalRasterPage({
            cacheDir: path.join(directory, 'cache'),
            crop: { height: 0.5, unit: 'normalized', width: 0.5, x: 0.25, y: 0.25 },
            inputPdfPath: pdfPath,
            page: 2,
            renderer,
            sourceProfiler,
        });

        expect(rendererParams?.inputPdfPath).toBe(pdfPath);
        expect(rendererParams?.outputPrefix).not.toContain('unsafe;path.pdf');
        expect(rendererParams?.outputPrefix.endsWith('.png')).toBe(false);
    });

    it('invalidates a cache entry when PNG color-space provenance is missing', async () => {
        const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'swissawa-canonical-raster-'));
        directories.push(directory);
        const pdfPath = path.join(directory, 'book.pdf');
        await fsp.writeFile(pdfPath, '%PDF-source');
        let renderCalls = 0;
        const renderer: CanonicalRasterRenderer = async (params) => {
            renderCalls++;
            const bytes = rgbPng();
            return {
                bytes,
                envelope: createRasterEnvelope({
                    bytes,
                    crop: params.crop!,
                    rendererOptions: ['-png', '-r', '200'],
                    source: { page: params.page, pdfSha256: params.sourcePdfSha256 },
                }),
                stderr: '',
            };
        };
        const request = {
            cacheDir: path.join(directory, 'cache'),
            inputPdfPath: pdfPath,
            page: 1,
            renderer,
            sourceProfiler: async () => ({ fontSubstitutionWarnings: [] }),
        };
        const first = await prepareCanonicalRasterPage(request);
        const invalidBytes = rgbPng(false);
        const metadata = JSON.parse(await fsp.readFile(first.envelopePath, 'utf8')) as Record<string, unknown>;
        metadata.sha256 = createHash('sha256').update(invalidBytes).digest('hex');
        await fsp.writeFile(first.pngPath, invalidBytes);
        await fsp.writeFile(first.envelopePath, JSON.stringify(metadata));

        const repaired = await prepareCanonicalRasterPage(request);

        expect(repaired.cacheHit).toBe(false);
        expect(renderCalls).toBe(2);
    });

    it('separates cache entries when the ICC profile bytes change', async () => {
        const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'swissawa-canonical-raster-'));
        directories.push(directory);
        const pdfPath = path.join(directory, 'book.pdf');
        const iccProfilePath = path.join(directory, 'profile.icc');
        await fsp.writeFile(pdfPath, '%PDF-source');
        await fsp.writeFile(iccProfilePath, 'profile-one');
        let renderCalls = 0;
        const renderer: CanonicalRasterRenderer = async (params) => {
            renderCalls++;
            const bytes = rgbPng();
            return {
                bytes,
                envelope: createRasterEnvelope({
                    bytes,
                    crop: params.crop!,
                    iccProfilePath: params.iccProfilePath,
                    rendererOptions: ['-png', '-r', '200'],
                    source: { page: params.page, pdfSha256: params.sourcePdfSha256 },
                }),
                stderr: '',
            };
        };
        const request = {
            cacheDir: path.join(directory, 'cache'),
            iccProfilePath,
            inputPdfPath: pdfPath,
            page: 1,
            renderer,
            sourceProfiler: async () => ({ fontSubstitutionWarnings: [] }),
        };
        const first = await prepareCanonicalRasterPage(request);
        const hit = await prepareCanonicalRasterPage(request);
        await fsp.writeFile(iccProfilePath, 'profile-two');
        const changed = await prepareCanonicalRasterPage(request);

        expect(first.cacheHit).toBe(false);
        expect(hit.cacheHit).toBe(true);
        expect(changed.cacheHit).toBe(false);
        expect(renderCalls).toBe(2);
    });
});
