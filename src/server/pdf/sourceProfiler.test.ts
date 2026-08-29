import { describe, expect, it } from 'bun:test';
import { BAZMUL_AGAARABESQUE_Y_FIXTURE, IBRAHIM_T38_PIPE_FIXTURE } from '@/server/pdf/fixtures/sourceProfilerEvidence';
import {
    analyzePdfSource,
    type EditionSourceProfile,
    parsePdffontsOutput,
    parsePdffontsSubstitutionOutput,
    toSuggestedEdit,
    validateEditionSourceProfile,
} from '@/server/pdf/sourceProfiler';

const unvalidatedBazmulProfile: EditionSourceProfile = {
    editionKey: 'bazmul',
    id: 'bazmul-aga-arabesque-v1',
    mappings: [
        {
            candidates: ['sallallahu-alayhi-wasallam'],
            charCode: 0x79,
            fontName: 'AGAArabesque',
            kind: 'font-code',
            printedForm: 'compact-glyph',
        },
    ],
    provenance: {
        evidenceRef: 'spike:bazmul:aga-arabesque-y',
        humanValidated: false,
        source: 'salutation-spike-2026-08-24',
    },
};

const validatedBazmulProfile: EditionSourceProfile = {
    ...unvalidatedBazmulProfile,
    provenance: { ...unvalidatedBazmulProfile.provenance, humanValidated: true, validatedBy: 'reviewer@example.test' },
};

const validatedIbrahimProfile: EditionSourceProfile = {
    editionKey: 'ibrahim',
    id: 'ibrahim-t38-v1',
    mappings: [
        {
            candidates: ['sallallahu-alayhi-wasallam'],
            fontName: 'T38',
            glyphId: 'T38',
            kind: 'type3-glyph',
            printedForm: 'compact-glyph',
        },
    ],
    provenance: {
        evidenceRef: 'specimen:ibrahim:t38-charproc-validated',
        humanValidated: true,
        source: 'edition-review-2026-08-24',
        validatedBy: 'reviewer@example.test',
    },
};

describe('parsePdffontsOutput', () => {
    it('parses embedded, Type 3, and Unicode columns without requiring Poppler', () => {
        const records = parsePdffontsOutput(IBRAHIM_T38_PIPE_FIXTURE.fontsOutput);

        expect(records).toEqual([
            {
                embedded: true,
                encoding: 'Custom',
                fontName: 'T38',
                fontType: 'Type 3',
                hasToUnicode: false,
                objectId: '8985 0',
                subset: false,
            },
        ]);
    });
});

describe('parsePdffontsSubstitutionOutput', () => {
    it('parses source-to-substitute font diagnostics', () => {
        expect(parsePdffontsSubstitutionOutput(BAZMUL_AGAARABESQUE_Y_FIXTURE.substitutionsOutput)).toEqual([
            {
                sourceFont: 'AGAArabesque',
                sourceObjectId: '25 0',
                substituteFont: 'Verdana',
                substituteFontFile: '/System/Library/Fonts/Supplemental/Verdana.ttf',
            },
        ]);
    });
});

describe('analyzePdfSource', () => {
    it('reports unembedded symbol-font substitution as destroyed raster fidelity and keeps the mapping untrusted', () => {
        const analysis = analyzePdfSource({
            editionKey: 'bazmul',
            fontsOutput: BAZMUL_AGAARABESQUE_Y_FIXTURE.fontsOutput,
            glyphs: BAZMUL_AGAARABESQUE_Y_FIXTURE.glyphs,
            profile: unvalidatedBazmulProfile,
            substitutionsOutput: BAZMUL_AGAARABESQUE_Y_FIXTURE.substitutionsOutput,
        });

        expect(analysis.evidence).toContainEqual(
            expect.objectContaining({
                fontName: 'AGAArabesque',
                kind: 'unembedded-symbol-font-substitution',
                rasterFidelity: 'destroyed-by-font-substitution',
                substituteFont: 'Verdana',
            }),
        );
        expect(analysis.suggestions).toContainEqual(
            expect.objectContaining({
                candidates: ['sallallahu-alayhi-wasallam'],
                printedForm: 'substituted-letterform',
                profileTrusted: false,
                rasterFidelity: 'destroyed-by-font-substitution',
                status: 'suggested',
            }),
        );
        expect(analysis.suggestions[0]?.reason).toContain('human validation');
        expect(analysis.suggestions[0]?.reason).toContain('substitution');
        expect(analysis.evidence.filter((item) => item.kind === 'unembedded-symbol-font-substitution')).toHaveLength(1);
    });

    it('trusts a human-validated source-code mapping even when renderer substitution destroyed the raster glyph', () => {
        const analysis = analyzePdfSource({
            editionKey: 'bazmul',
            fontsOutput: BAZMUL_AGAARABESQUE_Y_FIXTURE.fontsOutput,
            glyphs: BAZMUL_AGAARABESQUE_Y_FIXTURE.glyphs,
            profile: validatedBazmulProfile,
            substitutionsOutput: BAZMUL_AGAARABESQUE_Y_FIXTURE.substitutionsOutput,
        });

        expect(analysis.suggestions).toContainEqual(
            expect.objectContaining({
                candidates: ['sallallahu-alayhi-wasallam'],
                profileTrusted: true,
                rasterFidelity: 'destroyed-by-font-substitution',
                status: 'suggested',
            }),
        );
        expect(analysis.suggestions[0]?.reason).toContain('Source profile mapping is human-validated');
        expect(analysis.suggestions[0]?.reason).toContain('not recoverable from pixels');
    });

    it('reports Type 3 without ToUnicode as present raster evidence and allows a validated profile to be trusted', () => {
        const analysis = analyzePdfSource({
            editionKey: 'ibrahim',
            fontsOutput: IBRAHIM_T38_PIPE_FIXTURE.fontsOutput,
            glyphs: IBRAHIM_T38_PIPE_FIXTURE.glyphs,
            profile: validatedIbrahimProfile,
        });

        expect(analysis.evidence).toContainEqual(
            expect.objectContaining({
                extractedText: '|',
                fontName: 'T38',
                glyphId: 'T38',
                kind: 'type3-no-tounicode',
                rasterFidelity: 'present-in-raster',
            }),
        );
        expect(analysis.suggestions).toContainEqual(
            expect.objectContaining({
                candidates: ['sallallahu-alayhi-wasallam'],
                printedForm: 'compact-glyph',
                profileTrusted: true,
                rasterFidelity: 'present-in-raster',
                status: 'suggested',
            }),
        );
    });

    it('does not invent a candidate or mutate OCR text when no profile matches', () => {
        const analysis = analyzePdfSource({
            editionKey: 'unknown',
            fonts: [
                {
                    embedded: true,
                    encoding: 'Identity-H',
                    fontName: 'NotoNaskhArabic',
                    fontType: 'TrueType',
                    hasToUnicode: true,
                    subset: false,
                },
            ],
            glyphs: [{ charCode: 65, extractedText: 'A', fontName: 'NotoNaskhArabic', page: 1 }],
        });

        expect(analysis.suggestions).toEqual([]);
        expect(analysis.ocrText).toBeUndefined();
    });

    it('does not apply an edition profile when the caller omits the edition identity', () => {
        const analysis = analyzePdfSource({
            fontsOutput: IBRAHIM_T38_PIPE_FIXTURE.fontsOutput,
            glyphs: IBRAHIM_T38_PIPE_FIXTURE.glyphs,
            profile: validatedIbrahimProfile,
        });

        expect(analysis.suggestions).toEqual([]);
        expect(analysis.unmatchedGlyphs).toEqual(IBRAHIM_T38_PIPE_FIXTURE.glyphs);
    });
});

describe('validateEditionSourceProfile', () => {
    it('requires provenance and a named human validator before trust', () => {
        const validation = validateEditionSourceProfile({
            editionKey: 'bazmul',
            id: 'bazmul-unreviewed',
            mappings: [
                {
                    candidates: ['sallallahu-alayhi-wasallam'],
                    charCode: 0x79,
                    fontName: 'AGAArabesque',
                    kind: 'font-code',
                },
            ],
            provenance: { evidenceRef: '', humanValidated: true, source: '' },
        });

        expect(validation.valid).toBe(false);
        expect(validation.errors).toEqual(
            expect.arrayContaining([
                'profile provenance source is required',
                'profile provenance evidenceRef is required',
                'validatedBy is required when humanValidated is true',
            ]),
        );
    });
});

describe('toSuggestedEdit', () => {
    it('creates a review-queue proposal without changing the caller text', () => {
        const analysis = analyzePdfSource({
            editionKey: 'ibrahim',
            fontsOutput: IBRAHIM_T38_PIPE_FIXTURE.fontsOutput,
            glyphs: IBRAHIM_T38_PIPE_FIXTURE.glyphs,
            profile: validatedIbrahimProfile,
        });
        const sourceSuggestion = analysis.suggestions[0];
        if (!sourceSuggestion) {
            throw new Error('expected source suggestion fixture');
        }

        const originalText = 'قال النبي';
        const edit = toSuggestedEdit(sourceSuggestion, {
            originalText,
            replacementText: 'قال النبي ﷺ',
            sourceObservationIds: ['macocr:page-35:observation-1'],
        });

        expect(edit).toMatchObject({
            evidence: [
                {
                    engine: 'pdf-source-profiler',
                    observationIds: ['macocr:page-35:observation-1'],
                    profileId: validatedIbrahimProfile.id,
                },
            ],
            kind: 'replace',
            originalText,
            replacementText: 'قال النبي ﷺ',
            status: 'suggested',
        });
        expect(originalText).toBe('قال النبي');
    });
});
