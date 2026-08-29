import { describe, expect, it } from 'bun:test';
import { deflateSync } from 'node:zlib';
import {
    assertCanonicalRasterInput,
    assertCanonicalRendererVersion,
    assertIdenticalRasterBytes,
    buildCanonicalRasterArgs,
    CANONICAL_RASTER_CONTRACT,
    canonicalRasterOutputPath,
    createRasterEnvelope,
    cropBoxToRasterCrop,
    cropPngBytes,
    parseFontSubstitutionWarnings,
    parsePdftocairoVersion,
    parsePngDimensions,
} from '@/server/ocr/canonicalRaster';

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
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 0);
    return Buffer.concat([length, typeBytes, Buffer.from(data), checksum]);
}

function rgbPng(width: number, height: number, pixels: readonly number[], includeSrgb = true): Uint8Array {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // RGB
    const scanlines: number[] = [];
    for (let y = 0; y < height; y++) {
        scanlines.push(0); // filter method: none
        scanlines.push(...pixels.slice(y * width * 3, (y + 1) * width * 3));
    }
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        Buffer.from(chunk('IHDR', ihdr)),
        ...(includeSrgb ? [Buffer.from(chunk('sRGB', Uint8Array.of(0)))] : []),
        Buffer.from(chunk('IDAT', deflateSync(Buffer.from(scanlines)))),
        Buffer.from(chunk('IEND', Buffer.alloc(0))),
    ]);
}

describe('canonical raster contract', () => {
    it('pins the page render to pdftocairo 26.07.0, 200 DPI, PNG, and sRGB', () => {
        expect(CANONICAL_RASTER_CONTRACT).toMatchObject({
            colorSpace: 'sRGB',
            dpi: 200,
            format: 'png',
            renderer: 'pdftocairo',
            rendererVersion: '26.07.0',
        });

        expect(
            buildCanonicalRasterArgs({ inputPdfPath: '/tmp/source.pdf', outputPrefix: '/tmp/page', page: 3 }),
        ).toEqual(['-png', '-r', '200', '-f', '3', '-l', '3', '-singlefile', '/tmp/source.pdf', '/tmp/page']);
        expect(parsePdftocairoVersion('pdftocairo version 26.07.0')).toBe('26.07.0');
        expect(() => assertCanonicalRendererVersion('26.07.1')).toThrow('canonical raster requires 26.07.0');
        expect(cropBoxToRasterCrop({ height: 0.5, width: 0.5, x: 0.25, y: 0.25 })).toEqual({
            height: 0.5,
            unit: 'normalized',
            width: 0.5,
            x: 0.25,
            y: 0.25,
        });
        expect(canonicalRasterOutputPath('/tmp/page')).toBe('/tmp/page.png');
        expect(() => canonicalRasterOutputPath('/tmp/page.png')).toThrow('must not include the .png suffix');
    });

    it('crops decoded raster bytes, preserving a deterministic PNG rather than creating a PDF', () => {
        const source = rgbPng(2, 2, [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);

        const cropped = cropPngBytes(source, { height: 0.5, unit: 'normalized', width: 0.5, x: 0.5, y: 0.5 });

        expect(parsePngDimensions(cropped)).toEqual({ height: 1, width: 1 });
        expect(cropped).not.toEqual(source);
    });

    it('records source, crop, renderer, dimensions, hash, and font provenance', () => {
        const bytes = rgbPng(2, 1, [255, 0, 0, 0, 0, 0]);
        const envelope = createRasterEnvelope({
            bytes,
            crop: { height: 1, unit: 'normalized', width: 1, x: 0, y: 0 },
            fontSubstitutionWarnings: [{ message: 'font fallback: AGAArabesque', severity: 'warning' }],
            source: { page: 3, pdfSha256: 'pdf-hash' },
        });

        expect(envelope).toMatchObject({
            colorSpace: 'sRGB',
            crop: { height: 1, width: 1, x: 0, y: 0 },
            fontSubstitutionWarnings: [{ message: 'font fallback: AGAArabesque' }],
            height: 1,
            renderer: { name: 'pdftocairo', version: '26.07.0' },
            source: { page: 3, pdfSha256: 'pdf-hash' },
            width: 2,
        });
        expect(envelope.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(
            parseFontSubstitutionWarnings('Warning: font fallback: AGAArabesque\nWarning: font fallback: AGAArabesque'),
        ).toEqual([{ font: undefined, message: 'Warning: font fallback: AGAArabesque', severity: 'warning' }]);
    });

    it('refuses to label an unprofiled PNG as canonical sRGB', () => {
        expect(() =>
            createRasterEnvelope({
                bytes: rgbPng(1, 1, [0, 0, 0], false),
                crop: { height: 1, unit: 'normalized', width: 1, x: 0, y: 0 },
                source: { page: 1, pdfSha256: 'pdf-hash' },
            }),
        ).toThrow('canonical raster PNG must contain an sRGB color-space chunk');
    });

    it('rejects engine inputs that do not consume the exact same raster bytes', () => {
        const first = rgbPng(1, 1, [0, 0, 0]);
        const second = rgbPng(1, 1, [255, 255, 255]);

        expect(() =>
            assertIdenticalRasterBytes({ bytes: first, engine: 'macOCR' }, { bytes: first, engine: 'surya' }),
        ).not.toThrow();
        expect(() =>
            assertIdenticalRasterBytes({ bytes: first, engine: 'macOCR' }, { bytes: second, engine: 'surya' }),
        ).toThrow('OCR engines must consume identical raster bytes');
    });

    it('rejects an input envelope whose hash does not match the bytes sent to an engine', () => {
        expect(() =>
            assertCanonicalRasterInput({
                bytes: Uint8Array.from([1, 2, 3]),
                envelope: {
                    colorSpace: 'sRGB',
                    crop: { height: 1, unit: 'normalized', width: 1, x: 0, y: 0 },
                    fontSubstitutionWarnings: [],
                    format: 'png',
                    height: 1,
                    renderer: { name: 'pdftocairo', options: [], version: '26.07.0' },
                    sha256: '0'.repeat(64),
                    source: { page: 1, pdfSha256: 'pdf' },
                    width: 1,
                },
            }),
        ).toThrow('raster envelope hash does not match engine input bytes');
    });
});
