import type { SalutationProposal } from '@/lib/salutationProposal';

export type Coordinates = { x: number; y: number };

export type Size = { readonly height: number; readonly width: number };

export type BoundingBox = Size & { x: number; y: number };

export type SourceRange = { readonly length: number; readonly location: number; readonly unit: 'utf16' };

export type OcrEvidence = {
    readonly engine: string;
    readonly engineVersion?: string;
    readonly observationIds: readonly string[];
    readonly profileId?: string;
    readonly rasterSha256?: string;
    readonly score?: number;
};

export type SuggestedEdit = {
    readonly bbox?: BoundingBox;
    readonly evidence: readonly OcrEvidence[];
    readonly id: string;
    readonly kind: 'delete' | 'insert' | 'replace';
    readonly originalText: string;
    readonly reason: string;
    readonly replacementText: string;
    readonly sourceObservationIds: readonly string[];
    readonly sourceRange?: SourceRange;
    readonly status: 'suggested';
};

export type RecognitionCandidate = { readonly confidence: number; readonly rank: number; readonly text: string };

export type RasterCropMetadata = {
    readonly height: number;
    readonly unit: 'normalized';
    readonly width: number;
    readonly x: number;
    readonly y: number;
};

export type RasterSourceMetadata = { readonly page: number; readonly pdfSha256: string };

export type RasterRendererMetadata = {
    readonly iccProfilePath?: string;
    readonly name: 'pdftocairo';
    readonly options: readonly string[];
    readonly version: '26.07.0';
};

export type RasterFontWarningMetadata = {
    readonly font?: string;
    readonly message: string;
    readonly severity: 'warning' | 'error';
};

export type RasterMetadata = Size & {
    readonly bitsPerComponent?: number;
    readonly bitsPerPixel?: number;
    readonly bytesPerRow?: number;
    readonly colorSpace?: 'sRGB';
    readonly consumedBy?: string;
    readonly consumedRasterSha256?: string;
    readonly crop?: RasterCropMetadata;
    readonly fontSubstitutionWarnings?: readonly RasterFontWarningMetadata[];
    readonly format?: 'png';
    readonly renderer?: RasterRendererMetadata;
    readonly sha256?: string;
    readonly source?: RasterSourceMetadata;
};

export type Observation = {
    bbox: BoundingBox;
    text: string;
    confidence?: number;
    bboxPrecision?: 'word';
    candidates?: readonly RecognitionCandidate[];
    id?: string;
    rawText?: string;
    sourceRange?: SourceRange;
    chars?: readonly unknown[];
    polygon?: readonly [number, number][];
    words?: readonly unknown[];
};

export type ObservationPage = Size & {
    page: number;
    observations: Observation[];
    raster?: RasterMetadata;
    salutationProposals?: readonly SalutationProposal[];
    suggestedEdits?: readonly SuggestedEdit[];
};

export type MacOCR = { pages: ObservationPage[]; dpi: Coordinates };
