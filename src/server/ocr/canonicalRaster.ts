import { spawn as spawnProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';

export const CANONICAL_RASTER_CONTRACT = Object.freeze({
    colorSpace: 'sRGB' as const,
    dpi: 200,
    format: 'png' as const,
    renderer: 'pdftocairo' as const,
    rendererVersion: '26.07.0' as const,
});

export type RasterCrop = {
    readonly height: number;
    readonly unit: 'normalized';
    readonly width: number;
    readonly x: number;
    readonly y: number;
};

export type RasterSource = { readonly page: number; readonly pdfSha256: string };

export type FontSubstitutionWarning = {
    readonly font?: string;
    readonly message: string;
    readonly severity: 'warning' | 'error';
};

export type CanonicalRasterEnvelope = {
    readonly colorSpace: 'sRGB';
    readonly crop: RasterCrop;
    readonly fontSubstitutionWarnings: readonly FontSubstitutionWarning[];
    readonly format: 'png';
    readonly height: number;
    readonly renderer: {
        readonly iccProfilePath?: string;
        readonly name: 'pdftocairo';
        readonly options: readonly string[];
        readonly version: '26.07.0';
    };
    readonly sha256: string;
    readonly source: RasterSource;
    readonly width: number;
};

export type EngineRasterInput = { readonly bytes: Uint8Array; readonly engine: string };

export type CanonicalRasterInput = { readonly bytes: Uint8Array; readonly envelope: CanonicalRasterEnvelope };

export type RenderCanonicalPageParams = {
    readonly binary?: string;
    readonly crop?: RasterCrop;
    readonly fontSubstitutionWarnings?: readonly FontSubstitutionWarning[];
    readonly inputPdfPath: string;
    readonly iccProfilePath?: string;
    readonly outputPrefix: string;
    readonly page: number;
    readonly sourcePdfSha256: string;
};

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const FULL_PAGE_CROP: RasterCrop = Object.freeze({ height: 1, unit: 'normalized', width: 1, x: 0, y: 0 });

export function cropBoxToRasterCrop(crop: {
    readonly height: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
}): RasterCrop {
    return { ...crop, unit: 'normalized' };
}

function assertPositivePage(page: number): void {
    if (!Number.isInteger(page) || page <= 0) {
        throw new Error(`canonical raster page must be a positive integer (got ${page})`);
    }
}

function assertCrop(crop: RasterCrop): void {
    if (crop.unit !== 'normalized') {
        throw new Error(`canonical raster crop must use normalized coordinates (got ${crop.unit})`);
    }
    if (
        !Number.isFinite(crop.x) ||
        !Number.isFinite(crop.y) ||
        !Number.isFinite(crop.width) ||
        !Number.isFinite(crop.height) ||
        crop.x < 0 ||
        crop.y < 0 ||
        crop.width <= 0 ||
        crop.height <= 0 ||
        crop.x + crop.width > 1 ||
        crop.y + crop.height > 1
    ) {
        throw new Error('canonical raster crop must be a non-empty rectangle within normalized page bounds');
    }
}

/** Build the one supported page-render command. No scale-to or JPEG options are permitted. */
export function buildCanonicalRasterArgs(params: {
    readonly iccProfilePath?: string;
    readonly inputPdfPath: string;
    readonly outputPrefix: string;
    readonly page: number;
}): string[] {
    assertPositivePage(params.page);
    if (!params.inputPdfPath || !params.outputPrefix) {
        throw new Error('canonical raster inputPdfPath and outputPrefix are required');
    }

    const args = ['-png', '-r', String(CANONICAL_RASTER_CONTRACT.dpi)];
    if (params.iccProfilePath) {
        args.push('-icc', params.iccProfilePath);
    }
    args.push(
        '-f',
        String(params.page),
        '-l',
        String(params.page),
        '-singlefile',
        params.inputPdfPath,
        params.outputPrefix,
    );
    return args;
}

/**
 * pdftocairo's `-singlefile` output is a prefix; PNG is still written with a
 * suffix. Keep the lookup explicit so a stale prefix or a different format
 * can never be mistaken for the canonical raster.
 */
export function canonicalRasterOutputPath(outputPrefix: string): string {
    if (!outputPrefix) {
        throw new Error('canonical raster outputPrefix is required');
    }
    if (outputPrefix.endsWith('.png')) {
        throw new Error('canonical raster outputPrefix must not include the .png suffix');
    }
    return `${outputPrefix}.png`;
}

export function parsePdftocairoVersion(output: string): string | undefined {
    return output.match(/pdftocairo version\s+([^\s]+)/i)?.[1];
}

export function assertCanonicalRendererVersion(version: string): void {
    if (version !== CANONICAL_RASTER_CONTRACT.rendererVersion) {
        throw new Error(
            `Unsupported pdftocairo version ${version}; canonical raster requires ${CANONICAL_RASTER_CONTRACT.rendererVersion}`,
        );
    }
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

export function assertCanonicalRasterInput(input: CanonicalRasterInput): void {
    if (sha256(input.bytes) !== input.envelope.sha256) {
        throw new Error('raster envelope hash does not match engine input bytes');
    }
    const dimensions = parsePngDimensions(input.bytes);
    if (dimensions.width !== input.envelope.width || dimensions.height !== input.envelope.height) {
        throw new Error('raster envelope dimensions do not match engine input bytes');
    }
    assertPngSrgb(input.bytes);
}

function isPngSignature(bytes: Uint8Array): boolean {
    return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

type PngChunk = { readonly data: Uint8Array; readonly type: string };

function readPngChunks(bytes: Uint8Array): PngChunk[] {
    if (!isPngSignature(bytes)) {
        throw new Error('Expected PNG raster bytes');
    }

    const chunks: PngChunk[] = [];
    let offset = PNG_SIGNATURE.length;
    while (offset + 12 <= bytes.length) {
        const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
        offset += 4;
        const type = Buffer.from(bytes.subarray(offset, offset + 4)).toString('ascii');
        offset += 4;
        if (offset + length + 4 > bytes.length) {
            throw new Error('Truncated PNG chunk');
        }
        chunks.push({ data: bytes.slice(offset, offset + length), type });
        offset += length + 4; // data + CRC
        if (type === 'IEND') {
            return chunks;
        }
    }
    throw new Error('PNG is missing IEND');
}

function pngIhdr(chunks: readonly PngChunk[]): Uint8Array {
    const ihdr = chunks.find((chunk) => chunk.type === 'IHDR')?.data;
    if (ihdr?.length !== 13) {
        throw new Error('PNG is missing a valid IHDR chunk');
    }
    return ihdr;
}

function assertPngSrgb(bytes: Uint8Array): void {
    if (!readPngChunks(bytes).some((chunk) => chunk.type === 'sRGB')) {
        throw new Error('canonical raster PNG must contain an sRGB color-space chunk');
    }
}

export function parsePngDimensions(bytes: Uint8Array): { readonly height: number; readonly width: number } {
    const ihdr = pngIhdr(readPngChunks(bytes));
    const view = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
    return { height: view.getUint32(4), width: view.getUint32(0) };
}

function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePngByte(filter: number, raw: number, left: number, up: number, upLeft: number): number {
    switch (filter) {
        case 0:
            return raw;
        case 1:
            return (raw + left) & 0xff;
        case 2:
            return (raw + up) & 0xff;
        case 3:
            return (raw + Math.floor((left + up) / 2)) & 0xff;
        case 4:
            return (raw + paeth(left, up, upLeft)) & 0xff;
        default:
            throw new Error(`Unsupported PNG row filter ${filter}`);
    }
}

function decodePngScanlines(decoded: Uint8Array, width: number, height: number, channels: number): Uint8Array {
    const rowBytes = width * channels;
    const expectedLength = height * (rowBytes + 1);
    if (decoded.length !== expectedLength) {
        throw new Error(`Unexpected PNG scanline length (expected ${expectedLength}, got ${decoded.length})`);
    }

    const pixels = new Uint8Array(width * height * channels);
    let inputOffset = 0;
    for (let y = 0; y < height; y++) {
        const filter = decoded[inputOffset++];
        const rowOffset = y * rowBytes;
        for (let x = 0; x < rowBytes; x++) {
            const raw = decoded[inputOffset++];
            const left = x >= channels ? pixels[rowOffset + x - channels]! : 0;
            const up = y > 0 ? pixels[rowOffset - rowBytes + x]! : 0;
            const upLeft = y > 0 && x >= channels ? pixels[rowOffset - rowBytes + x - channels]! : 0;
            pixels[rowOffset + x] = decodePngByte(filter, raw, left, up, upLeft);
        }
    }
    return pixels;
}

function decodePng(bytes: Uint8Array): {
    readonly chunks: readonly PngChunk[];
    readonly colorType: number;
    readonly height: number;
    readonly pixels: Uint8Array;
    readonly width: number;
} {
    const chunks = readPngChunks(bytes);
    const ihdr = pngIhdr(chunks);
    const view = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
    const width = view.getUint32(0);
    const height = view.getUint32(4);
    const bitDepth = view.getUint8(8);
    const colorType = view.getUint8(9);
    const compression = view.getUint8(10);
    const filterMethod = view.getUint8(11);
    const interlace = view.getUint8(12);

    if (
        bitDepth !== 8 ||
        (colorType !== 2 && colorType !== 6) ||
        compression !== 0 ||
        filterMethod !== 0 ||
        interlace !== 0
    ) {
        throw new Error('Canonical PNG crop supports only non-interlaced 8-bit RGB/RGBA PNGs');
    }

    const channels = colorType === 6 ? 4 : 3;
    const compressed = Buffer.concat(
        chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => Buffer.from(chunk.data)),
    );
    const pixels = decodePngScanlines(inflateSync(compressed), width, height, channels);
    return { chunks, colorType, height, pixels, width };
}

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

function pngChunk(type: string, data: Uint8Array): Uint8Array {
    const typeBytes = Buffer.from(type, 'ascii');
    const dataBytes = Buffer.from(data);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(dataBytes.length, 0);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, dataBytes])), 0);
    return Buffer.concat([length, typeBytes, dataBytes, checksum]);
}

/** Crop an already-rendered PNG. This deliberately never loads or rewrites the source PDF. */
export function cropPngBytes(bytes: Uint8Array, crop: RasterCrop): Uint8Array {
    assertCrop(crop);
    const decoded = decodePng(bytes);
    const left = Math.max(0, Math.min(decoded.width - 1, Math.floor(crop.x * decoded.width)));
    const top = Math.max(0, Math.min(decoded.height - 1, Math.floor(crop.y * decoded.height)));
    const right = Math.max(left + 1, Math.min(decoded.width, Math.ceil((crop.x + crop.width) * decoded.width)));
    const bottom = Math.max(top + 1, Math.min(decoded.height, Math.ceil((crop.y + crop.height) * decoded.height)));
    const channels = decoded.colorType === 6 ? 4 : 3;
    const width = right - left;
    const height = bottom - top;
    const scanlines = Buffer.alloc(height * (width * channels + 1));

    for (let y = 0; y < height; y++) {
        const outputRow = y * (width * channels + 1);
        scanlines[outputRow] = 0;
        const sourceStart = ((top + y) * decoded.width + left) * channels;
        const sourceEnd = sourceStart + width * channels;
        scanlines.set(decoded.pixels.subarray(sourceStart, sourceEnd), outputRow + 1);
    }

    const ihdr = Buffer.from(pngIhdr(decoded.chunks));
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    const ancillary = decoded.chunks.filter((chunk) => chunk.type === 'sRGB' || chunk.type === 'pHYs');
    return Buffer.concat([
        Buffer.from(PNG_SIGNATURE),
        Buffer.from(pngChunk('IHDR', ihdr)),
        ...ancillary.map((chunk) => Buffer.from(pngChunk(chunk.type, chunk.data))),
        Buffer.from(pngChunk('IDAT', deflateSync(scanlines))),
        Buffer.from(pngChunk('IEND', new Uint8Array())),
    ]);
}

export function createRasterEnvelope(params: {
    readonly bytes: Uint8Array;
    readonly crop: RasterCrop;
    readonly fontSubstitutionWarnings?: readonly FontSubstitutionWarning[];
    readonly iccProfilePath?: string;
    readonly rendererOptions?: readonly string[];
    readonly source: RasterSource;
}): CanonicalRasterEnvelope {
    assertCrop(params.crop);
    assertPositivePage(params.source.page);
    assertPngSrgb(params.bytes);
    const dimensions = parsePngDimensions(params.bytes);
    return {
        colorSpace: CANONICAL_RASTER_CONTRACT.colorSpace,
        crop: params.crop,
        fontSubstitutionWarnings: params.fontSubstitutionWarnings ?? [],
        format: CANONICAL_RASTER_CONTRACT.format,
        height: dimensions.height,
        renderer: {
            name: CANONICAL_RASTER_CONTRACT.renderer,
            options: params.rendererOptions ?? [],
            version: CANONICAL_RASTER_CONTRACT.rendererVersion,
            ...(params.iccProfilePath ? { iccProfilePath: params.iccProfilePath } : {}),
        },
        sha256: sha256(params.bytes),
        source: params.source,
        width: dimensions.width,
    };
}

export function createEngineRasterEnvelope(
    engine: string,
    raster: CanonicalRasterEnvelope,
): CanonicalRasterEnvelope & { readonly consumedBy: string; readonly consumedRasterSha256: string } {
    return { ...raster, consumedBy: engine, consumedRasterSha256: raster.sha256 };
}

export function assertIdenticalRasterBytes(...inputs: readonly EngineRasterInput[]): void {
    if (inputs.length < 2) {
        return;
    }
    const expected = sha256(inputs[0]!.bytes);
    for (const input of inputs.slice(1)) {
        if (sha256(input.bytes) !== expected) {
            throw new Error(
                `OCR engines must consume identical raster bytes (mismatch: ${inputs[0]!.engine} vs ${input.engine})`,
            );
        }
    }
}

function runRenderer(
    binary: string,
    args: readonly string[],
): Promise<{ readonly stderr: string; readonly stdout: string }> {
    return new Promise((resolve, reject) => {
        const child = spawnProcess(binary, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        let stdout = '';
        child.stdout?.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
        });
        child.once('error', reject);
        child.once('close', (code) => {
            if (code === 0) {
                resolve({ stderr, stdout });
            } else {
                reject(new Error(`${binary} exited with code ${code ?? 'null'}: ${stderr}`));
            }
        });
    });
}

export function parseFontSubstitutionWarnings(stderr: string): FontSubstitutionWarning[] {
    const seen = new Set<string>();
    const warnings: FontSubstitutionWarning[] = [];
    for (const line of stderr
        .split(/\r?\n/)
        .map((candidate) => candidate.trim())
        .filter(Boolean)) {
        if (!/(font|type\s*3|substitut|fallback|glyph)/i.test(line)) {
            continue;
        }
        if (seen.has(line)) {
            continue;
        }
        seen.add(line);
        const font = line.match(/(?:font|family)\s*:\s*["']?([^"']+?)["']?(?:\s|$)/i)?.[1]?.trim();
        warnings.push({
            font,
            message: line,
            severity: /error|fail|missing|cannot|can't/i.test(line) ? 'error' : 'warning',
        });
    }
    return warnings;
}

/** Render one page once, then crop the resulting PNG bytes for every OCR engine. */
export async function renderCanonicalPage(
    params: RenderCanonicalPageParams,
): Promise<{ readonly bytes: Uint8Array; readonly envelope: CanonicalRasterEnvelope; readonly stderr: string }> {
    const binary = params.binary ?? 'pdftocairo';
    const versionProbe = await runRenderer(binary, ['-v']);
    const version = parsePdftocairoVersion(`${versionProbe.stdout}\n${versionProbe.stderr}`);
    if (!version) {
        throw new Error(`Unable to determine ${binary} renderer version`);
    }
    assertCanonicalRendererVersion(version);
    const args = buildCanonicalRasterArgs({
        iccProfilePath: params.iccProfilePath,
        inputPdfPath: params.inputPdfPath,
        outputPrefix: params.outputPrefix,
        page: params.page,
    });
    const { stderr } = await runRenderer(binary, args);
    const outputPath = canonicalRasterOutputPath(params.outputPrefix);
    await fsp.access(outputPath);
    const rendered = await fsp.readFile(outputPath);
    const crop = params.crop ?? FULL_PAGE_CROP;
    const bytes =
        crop === FULL_PAGE_CROP || (crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1)
            ? rendered
            : cropPngBytes(rendered, crop);
    const warnings = [...(params.fontSubstitutionWarnings ?? []), ...parseFontSubstitutionWarnings(stderr)];
    return {
        bytes,
        envelope: createRasterEnvelope({
            bytes,
            crop,
            fontSubstitutionWarnings: warnings,
            iccProfilePath: params.iccProfilePath,
            rendererOptions: args,
            source: { page: params.page, pdfSha256: params.sourcePdfSha256 },
        }),
        stderr,
    };
}
