export type SalutationSemanticClass =
    | 'alayhis-salam'
    | 'alayha-as-salam'
    | 'alayhima-as-salam'
    | 'alayhim-as-salam'
    | 'alayhinna-as-salam'
    | 'azza-wa-jall'
    | 'jalla-jalaluhu'
    | 'sallallahu-alayhi-wasallam'
    | 'rahimahu-allah'
    | 'rahimaha-allah'
    | 'rahimahuma-allah'
    | 'rahimahum-allah'
    | 'rahimahunna-allah'
    | 'radi-allahu-anhu'
    | 'radi-allahu-anha'
    | 'radi-allahu-anhuma'
    | 'radi-allahu-anhum'
    | 'radi-allahu-anhunna'
    | 'unknown';

/** The printed/visual form is independent from the semantic class. */
export type SalutationVisualForm = 'expanded-text' | 'compact-glyph' | 'substituted-letterform' | 'unknown';

export type RasterFidelity = 'present-in-raster' | 'destroyed-by-font-substitution' | 'unknown';

export type SalutationBoundingBox = {
    readonly height: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
};

export type SalutationSourceRange = { readonly length: number; readonly location: number; readonly unit: 'utf16' };

export type SalutationSourceGeometry = {
    readonly bbox: SalutationBoundingBox;
    readonly polygon?: readonly (readonly [number, number])[];
    readonly sourceRange?: SalutationSourceRange;
};

export type SalutationEngineEvidence = {
    readonly bbox?: SalutationBoundingBox;
    readonly confidence?: number;
    readonly engine: string;
    readonly observationId?: string;
    readonly observedText?: string;
    readonly rasterSha256?: string;
    readonly visualForm?: SalutationVisualForm;
};

export type SalutationAbstentionReason =
    | {
          readonly code: 'protected-symbol-count-mismatch';
          readonly expected: number;
          readonly observed: number;
          readonly symbol: string;
      }
    | {
          readonly code: 'engine-disagreement' | 'insufficient-evidence' | 'low-confidence' | 'raster-fidelity-unknown';
          readonly detail: string;
      };

export type SalutationProposal = {
    readonly abstentionReason?: SalutationAbstentionReason;
    readonly confidence: number;
    readonly decision: 'suggestion-only';
    readonly engineEvidence: readonly SalutationEngineEvidence[];
    readonly geometry: SalutationSourceGeometry;
    readonly id: string;
    readonly rasterFidelity: RasterFidelity;
    readonly semanticClass: SalutationSemanticClass;
    readonly visualForm: SalutationVisualForm;
};

export type CreateSalutationProposalParams = Omit<SalutationProposal, 'decision' | 'geometry'> & {
    readonly bbox: SalutationBoundingBox;
    readonly polygon?: readonly (readonly [number, number])[];
    readonly sourceRange?: SalutationSourceRange;
};

export function protectedSymbolCountMismatch(params: {
    readonly expected: number;
    readonly observed: number;
    readonly symbol: string;
}): SalutationAbstentionReason {
    if (
        !Number.isInteger(params.expected) ||
        params.expected < 0 ||
        !Number.isInteger(params.observed) ||
        params.observed < 0
    ) {
        throw new Error('protected symbol counts must be non-negative integers');
    }
    if (!params.symbol) {
        throw new Error('protected symbol is required');
    }
    return {
        code: 'protected-symbol-count-mismatch',
        expected: params.expected,
        observed: params.observed,
        symbol: params.symbol,
    };
}

export function createSalutationProposal(params: CreateSalutationProposalParams): SalutationProposal {
    if (!params.id) {
        throw new Error('salutation proposal id is required');
    }
    if (!Number.isFinite(params.confidence) || params.confidence < 0 || params.confidence > 1) {
        throw new Error('salutation proposal confidence must be between 0 and 1');
    }
    return {
        abstentionReason: params.abstentionReason,
        confidence: params.confidence,
        decision: 'suggestion-only',
        engineEvidence: params.engineEvidence,
        geometry: {
            bbox: params.bbox,
            ...(params.polygon ? { polygon: params.polygon } : {}),
            ...(params.sourceRange ? { sourceRange: params.sourceRange } : {}),
        },
        id: params.id,
        rasterFidelity: params.rasterFidelity,
        semanticClass: params.semanticClass,
        visualForm: params.visualForm,
    };
}
