import { createHash, randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import {
    assertCanonicalRasterInput,
    CANONICAL_RASTER_CONTRACT,
    type CanonicalRasterEnvelope,
    type CanonicalRasterInput,
    canonicalRasterOutputPath,
    type FontSubstitutionWarning,
    type RasterCrop,
    type RenderCanonicalPageParams,
    renderCanonicalPage,
} from '@/server/ocr/canonicalRaster';
import type { EditionSourceProfile, PdfGlyphObservation } from '@/server/pdf/sourceProfiler';
import { type InspectPdfSourcePageParams, inspectPdfSourcePage } from '@/server/pdf/sourceProfilerRunner';

export type CanonicalRasterRenderer = (
    params: RenderCanonicalPageParams,
) => Promise<{ readonly bytes: Uint8Array; readonly envelope: CanonicalRasterEnvelope; readonly stderr: string }>;

export type CanonicalRasterSourceProfiler = (
    params: InspectPdfSourcePageParams,
) => Promise<{ readonly fontSubstitutionWarnings: readonly FontSubstitutionWarning[] }>;

export type CanonicalRasterFileSystem = {
    readonly mkdir: (directory: string, options?: { readonly recursive?: boolean }) => Promise<void>;
    readonly readFile: (filePath: string) => Promise<Uint8Array>;
    readonly rename: (source: string, destination: string) => Promise<void>;
    readonly unlink?: (filePath: string) => Promise<void>;
    readonly writeFile: (filePath: string, data: Uint8Array | string) => Promise<void>;
};

export type PrepareCanonicalRasterPageParams = {
    readonly cacheDir: string;
    readonly crop?: RasterCrop;
    readonly editionKey?: string;
    readonly fs?: CanonicalRasterFileSystem;
    readonly glyphs?: readonly PdfGlyphObservation[];
    readonly iccProfilePath?: string;
    readonly inputPdfPath: string;
    readonly page: number;
    readonly profile?: EditionSourceProfile;
    readonly renderer?: CanonicalRasterRenderer;
    readonly sourceProfiler?: CanonicalRasterSourceProfiler;
};

export type PreparedCanonicalRasterPage = CanonicalRasterInput & {
    readonly cacheHit: boolean;
    readonly envelopePath: string;
    readonly pngPath: string;
};

const FULL_PAGE_CROP: RasterCrop = Object.freeze({ height: 1, unit: 'normalized', width: 1, x: 0, y: 0 });

const defaultFileSystem: CanonicalRasterFileSystem = {
    async mkdir(directory, options) {
        await fsp.mkdir(directory, options);
    },
    async readFile(filePath) {
        return new Uint8Array(await fsp.readFile(filePath));
    },
    async rename(source, destination) {
        await fsp.rename(source, destination);
    },
    async unlink(filePath) {
        await fsp.unlink(filePath);
    },
    async writeFile(filePath, data) {
        await fsp.writeFile(filePath, typeof data === 'string' ? data : Buffer.from(data));
    },
};

const inFlight = new Map<string, Promise<PreparedCanonicalRasterPage>>();

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

function normalizeCrop(crop: RasterCrop | undefined): RasterCrop {
    const value = crop ?? FULL_PAGE_CROP;
    if (
        value.unit !== 'normalized' ||
        !Number.isFinite(value.x) ||
        !Number.isFinite(value.y) ||
        !Number.isFinite(value.width) ||
        !Number.isFinite(value.height) ||
        value.x < 0 ||
        value.y < 0 ||
        value.width <= 0 ||
        value.height <= 0 ||
        value.x + value.width > 1 ||
        value.y + value.height > 1
    ) {
        throw new Error('canonical raster crop must be a non-empty rectangle within normalized page bounds');
    }
    return { height: value.height, unit: 'normalized', width: value.width, x: value.x, y: value.y };
}

function assertPage(page: number): void {
    if (!Number.isInteger(page) || page <= 0) {
        throw new Error(`canonical raster page must be a positive integer (got ${page})`);
    }
}

function sameCrop(left: RasterCrop, right: RasterCrop): boolean {
    return (
        left.unit === right.unit &&
        left.x === right.x &&
        left.y === right.y &&
        left.width === right.width &&
        left.height === right.height
    );
}

function cacheKey(
    sourcePdfSha256: string,
    page: number,
    crop: RasterCrop,
    iccProfilePath: string | undefined,
    iccProfileSha256: string | undefined,
): string {
    const variantHash = sha256(
        Buffer.from(
            JSON.stringify({
                contract: CANONICAL_RASTER_CONTRACT,
                crop,
                iccProfilePath: iccProfilePath ?? null,
                iccProfileSha256: iccProfileSha256 ?? null,
            }),
            'utf8',
        ),
    ).slice(0, 32);
    return `${sourcePdfSha256}-page-${page}-${variantHash}`;
}

function cachePaths(cacheDir: string, key: string): { readonly envelopePath: string; readonly pngPath: string } {
    return { envelopePath: path.join(cacheDir, `${key}.json`), pngPath: path.join(cacheDir, `${key}.png`) };
}

function warningKey(warning: FontSubstitutionWarning): string {
    return JSON.stringify([warning.font ?? null, warning.message, warning.severity]);
}

function mergeWarnings(
    sourceWarnings: readonly FontSubstitutionWarning[],
    rendererWarnings: readonly FontSubstitutionWarning[],
): FontSubstitutionWarning[] {
    const seen = new Set<string>();
    const merged: FontSubstitutionWarning[] = [];
    for (const warning of [...sourceWarnings, ...rendererWarnings]) {
        const key = warningKey(warning);
        if (!seen.has(key)) {
            seen.add(key);
            merged.push(warning);
        }
    }
    return merged;
}

function assertEnvelopeMetadata(params: {
    readonly crop: RasterCrop;
    readonly envelope: CanonicalRasterEnvelope;
    readonly iccProfilePath?: string;
    readonly page: number;
    readonly sourcePdfSha256: string;
}): void {
    const { crop, envelope, iccProfilePath, page, sourcePdfSha256 } = params;
    if (
        envelope.format !== CANONICAL_RASTER_CONTRACT.format ||
        envelope.colorSpace !== CANONICAL_RASTER_CONTRACT.colorSpace
    ) {
        throw new Error('canonical raster cache entry does not match the PNG/sRGB contract');
    }
    if (envelope.source.pdfSha256 !== sourcePdfSha256 || envelope.source.page !== page) {
        throw new Error('canonical raster cache entry does not match the source PDF or page');
    }
    if (!sameCrop(envelope.crop, crop)) {
        throw new Error('canonical raster cache entry does not match the requested crop');
    }
    if (
        envelope.renderer.name !== CANONICAL_RASTER_CONTRACT.renderer ||
        envelope.renderer.version !== CANONICAL_RASTER_CONTRACT.rendererVersion ||
        envelope.renderer.iccProfilePath !== iccProfilePath ||
        !Array.isArray(envelope.renderer.options) ||
        envelope.renderer.options[0] !== '-png' ||
        envelope.renderer.options[1] !== '-r' ||
        envelope.renderer.options[2] !== String(CANONICAL_RASTER_CONTRACT.dpi)
    ) {
        throw new Error('canonical raster cache entry does not match the renderer contract');
    }
    if (!Array.isArray(envelope.fontSubstitutionWarnings)) {
        throw new Error('canonical raster cache entry has invalid font-substitution provenance');
    }
}

async function readCache(params: {
    readonly envelopePath: string;
    readonly fs: CanonicalRasterFileSystem;
    readonly iccProfilePath?: string;
    readonly page: number;
    readonly pngPath: string;
    readonly crop: RasterCrop;
    readonly sourcePdfSha256: string;
}): Promise<CanonicalRasterInput | undefined> {
    try {
        const [envelopeBytes, bytes] = await Promise.all([
            params.fs.readFile(params.envelopePath),
            params.fs.readFile(params.pngPath),
        ]);
        const envelope = JSON.parse(Buffer.from(envelopeBytes).toString('utf8')) as CanonicalRasterEnvelope;
        assertEnvelopeMetadata({
            crop: params.crop,
            envelope,
            iccProfilePath: params.iccProfilePath,
            page: params.page,
            sourcePdfSha256: params.sourcePdfSha256,
        });
        const input = { bytes: new Uint8Array(bytes), envelope };
        assertCanonicalRasterInput(input);
        return input;
    } catch {
        return undefined;
    }
}

async function writeAtomically(
    fs: CanonicalRasterFileSystem,
    filePath: string,
    data: Uint8Array | string,
): Promise<void> {
    const temporaryPath = `${filePath}.tmp-${randomUUID()}`;
    try {
        await fs.writeFile(temporaryPath, data);
        await fs.rename(temporaryPath, filePath);
    } finally {
        if (fs.unlink) {
            await fs.unlink(temporaryPath).catch(() => undefined);
        }
    }
}

async function prepareUncached(params: {
    readonly cacheDir: string;
    readonly crop: RasterCrop;
    readonly editionKey?: string;
    readonly envelopePath: string;
    readonly fs: CanonicalRasterFileSystem;
    readonly glyphs?: readonly PdfGlyphObservation[];
    readonly iccProfilePath?: string;
    readonly inputPdfPath: string;
    readonly page: number;
    readonly pngPath: string;
    readonly profile?: EditionSourceProfile;
    readonly renderer: CanonicalRasterRenderer;
    readonly sourcePdfSha256: string;
    readonly sourceProfiler: CanonicalRasterSourceProfiler;
}): Promise<PreparedCanonicalRasterPage> {
    await params.fs.mkdir(params.cacheDir, { recursive: true });
    const sourceProfile = await params.sourceProfiler({
        editionKey: params.editionKey,
        glyphs: params.glyphs,
        page: params.page,
        pdfPath: params.inputPdfPath,
        profile: params.profile,
    });
    const sourceWarnings = [...sourceProfile.fontSubstitutionWarnings];
    const outputPrefix = path.join(params.cacheDir, `.render-${randomUUID()}`);
    let rendered: Awaited<ReturnType<CanonicalRasterRenderer>>;
    try {
        rendered = await params.renderer({
            crop: params.crop,
            fontSubstitutionWarnings: sourceWarnings,
            iccProfilePath: params.iccProfilePath,
            inputPdfPath: params.inputPdfPath,
            outputPrefix,
            page: params.page,
            sourcePdfSha256: params.sourcePdfSha256,
        });
    } finally {
        if (params.fs.unlink) {
            await params.fs.unlink(canonicalRasterOutputPath(outputPrefix)).catch(() => undefined);
        }
    }

    assertEnvelopeMetadata({
        crop: params.crop,
        envelope: rendered.envelope,
        iccProfilePath: params.iccProfilePath,
        page: params.page,
        sourcePdfSha256: params.sourcePdfSha256,
    });
    const envelope: CanonicalRasterEnvelope = {
        ...rendered.envelope,
        fontSubstitutionWarnings: mergeWarnings(sourceWarnings, rendered.envelope.fontSubstitutionWarnings),
    };
    const input: CanonicalRasterInput = { bytes: new Uint8Array(rendered.bytes), envelope };
    assertCanonicalRasterInput(input);

    await writeAtomically(params.fs, params.pngPath, input.bytes);
    await writeAtomically(params.fs, params.envelopePath, JSON.stringify(input.envelope, null, 2));
    return { ...input, cacheHit: false, envelopePath: params.envelopePath, pngPath: params.pngPath };
}

/**
 * Prepare one canonical page raster for all OCR engines. The PDF is hashed
 * before lookup, source-font profiling runs before rendering on a miss, and a
 * single-flight map prevents concurrent macOCR/Surya requests from rendering
 * the same page twice.
 */
export async function prepareCanonicalRasterPage(
    params: PrepareCanonicalRasterPageParams,
): Promise<PreparedCanonicalRasterPage> {
    assertPage(params.page);
    if (!params.inputPdfPath || !params.cacheDir) {
        throw new Error('canonical raster inputPdfPath and cacheDir are required');
    }
    const crop = normalizeCrop(params.crop);
    const fs = params.fs ?? defaultFileSystem;
    const sourcePdfSha256 = sha256(await fs.readFile(params.inputPdfPath));
    const iccProfileSha256 = params.iccProfilePath ? sha256(await fs.readFile(params.iccProfilePath)) : undefined;
    const key = cacheKey(sourcePdfSha256, params.page, crop, params.iccProfilePath, iccProfileSha256);
    const cacheDirectory = path.resolve(params.cacheDir);
    const paths = cachePaths(cacheDirectory, key);
    const flightKey = `${cacheDirectory}:${key}`;
    const existing = inFlight.get(flightKey);
    if (existing) {
        return existing;
    }

    const work = (async (): Promise<PreparedCanonicalRasterPage> => {
        const cached = await readCache({
            crop,
            envelopePath: paths.envelopePath,
            fs,
            iccProfilePath: params.iccProfilePath,
            page: params.page,
            pngPath: paths.pngPath,
            sourcePdfSha256,
        });
        if (cached) {
            return { ...cached, cacheHit: true, envelopePath: paths.envelopePath, pngPath: paths.pngPath };
        }
        return prepareUncached({
            cacheDir: cacheDirectory,
            crop,
            editionKey: params.editionKey,
            envelopePath: paths.envelopePath,
            fs,
            glyphs: params.glyphs,
            iccProfilePath: params.iccProfilePath,
            inputPdfPath: params.inputPdfPath,
            page: params.page,
            pngPath: paths.pngPath,
            profile: params.profile,
            renderer: params.renderer ?? renderCanonicalPage,
            sourcePdfSha256,
            sourceProfiler: params.sourceProfiler ?? inspectPdfSourcePage,
        });
    })();
    inFlight.set(flightKey, work);
    work.then(
        () => {
            if (inFlight.get(flightKey) === work) {
                inFlight.delete(flightKey);
            }
        },
        () => {
            if (inFlight.get(flightKey) === work) {
                inFlight.delete(flightKey);
            }
        },
    );
    return work;
}
