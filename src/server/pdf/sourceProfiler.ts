/**
 * Pure, suggestion-only analysis of PDF font provenance.
 *
 * This module deliberately does not invoke Poppler, read a PDF, or alter OCR
 * text. Callers inject the output of `pdffonts`/`pdffonts -subst` and the glyph
 * references collected by their PDF parser. Keeping that boundary explicit
 * makes the classification deterministic and keeps renderer warnings visible
 * before a raster is produced.
 */

import type { BoundingBox, SourceRange, SuggestedEdit } from '@/lib/macOcr';
import type { RasterFidelity, SalutationSemanticClass, SalutationVisualForm } from '@/lib/salutationProposal';

export type PdfFontRecord = {
    readonly embedded: boolean;
    readonly encoding: string;
    readonly fontName: string;
    readonly fontType: string;
    readonly hasToUnicode: boolean;
    readonly objectId?: string;
    readonly subset: boolean;
};

export type PdfFontSubstitution = {
    readonly sourceFont: string;
    readonly sourceObjectId?: string;
    readonly substituteFont: string;
    readonly substituteFontFile?: string;
};

export type PdfGlyphObservation = {
    readonly charCode?: number;
    /** Text emitted by a parser (often `|` for Type 3/no-ToUnicode glyphs). */
    readonly extractedText?: string;
    readonly fontName: string;
    /** Type 3 glyph/charproc identifier, when available. */
    readonly glyphId?: string;
    readonly page: number;
    readonly printedForm?: SalutationVisualForm;
};

export type FontCodeProfileMapping = {
    readonly candidates: readonly SalutationSemanticClass[];
    readonly charCode: number;
    readonly fontName: string;
    readonly kind: 'font-code';
    readonly printedForm?: SalutationVisualForm;
};

export type Type3GlyphProfileMapping = {
    readonly candidates: readonly SalutationSemanticClass[];
    /** Optional because some PDF parsers expose glyph names without a font. */
    readonly fontName?: string;
    readonly glyphId: string;
    readonly kind: 'type3-glyph';
    readonly printedForm?: SalutationVisualForm;
};

export type EditionSourceProfileMapping = FontCodeProfileMapping | Type3GlyphProfileMapping;

export type EditionSourceProfileProvenance = {
    /** Stable link to the report/specimen/fixture that motivated the mapping. */
    readonly evidenceRef: string;
    /** True only after a person has checked the glyph against a specimen. */
    readonly humanValidated: boolean;
    readonly source: string;
    readonly validatedAt?: string;
    readonly validatedBy?: string;
};

export type EditionSourceProfile = {
    readonly editionKey: string;
    readonly id: string;
    readonly mappings: readonly EditionSourceProfileMapping[];
    readonly provenance: EditionSourceProfileProvenance;
};

export type ProfileValidation = { readonly errors: readonly string[]; readonly valid: boolean };

export type PdfSourceEvidenceKind = 'unembedded-symbol-font-substitution' | 'type3-no-tounicode';

export type PdfSourceEvidence = {
    readonly charCode?: number;
    readonly detail: string;
    readonly extractedText?: string;
    readonly fontName: string;
    readonly glyphId?: string;
    readonly kind: PdfSourceEvidenceKind;
    readonly page?: number;
    readonly rasterFidelity: RasterFidelity;
    readonly substituteFont?: string;
};

export type PdfSourceSuggestion = {
    readonly candidates: readonly SalutationSemanticClass[];
    readonly charCode?: number;
    readonly editionProfileId: string;
    readonly evidence: readonly PdfSourceEvidence[];
    readonly extractedText?: string;
    readonly fontName: string;
    readonly glyphId?: string;
    readonly id: string;
    readonly page: number;
    readonly printedForm?: SalutationVisualForm;
    readonly profileTrusted: boolean;
    readonly rasterFidelity: RasterFidelity;
    readonly reason: string;
    readonly status: 'suggested';
};

export type PdfSourceAnalysis = {
    readonly evidence: readonly PdfSourceEvidence[];
    readonly fonts: readonly PdfFontRecord[];
    readonly ocrText?: undefined;
    readonly profileValidation?: ProfileValidation;
    readonly substitutions: readonly PdfFontSubstitution[];
    readonly suggestions: readonly PdfSourceSuggestion[];
    readonly unmatchedGlyphs: readonly PdfGlyphObservation[];
};

export type AnalyzePdfSourceInput = {
    readonly editionKey?: string;
    readonly fonts?: readonly PdfFontRecord[];
    readonly fontsOutput?: string;
    readonly glyphs?: readonly PdfGlyphObservation[];
    readonly profile?: EditionSourceProfile;
    readonly substitutions?: readonly PdfFontSubstitution[];
    readonly substitutionsOutput?: string;
};

export type SuggestedEditParams = {
    readonly bbox?: BoundingBox;
    readonly originalText: string;
    readonly replacementText: string;
    readonly sourceObservationIds: readonly string[];
    readonly sourceRange?: SourceRange;
};

const YES = 'yes';
const NO = 'no';

function parseBooleanColumn(value: string, label: string, line: string): boolean {
    const normalized = value.toLowerCase();
    if (normalized === YES) {
        return true;
    }
    if (normalized === NO) {
        return false;
    }
    throw new Error(`Invalid pdffonts ${label} column ${JSON.stringify(value)} in line ${JSON.stringify(line)}`);
}

/**
 * Parse the stable, columnar portion of Poppler's `pdffonts` output.
 *
 * The type column can contain spaces (for example `CID Type 0`), so the last
 * six tokens are parsed from the right rather than relying on fixed widths.
 */
export function parsePdffontsOutput(stdout: string): PdfFontRecord[] {
    const records: PdfFontRecord[] = [];

    for (const rawLine of stdout.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('-') || /^name\s+type\b/i.test(line)) {
            continue;
        }

        const tokens = line.split(/\s+/);
        if (tokens.length < 8) {
            continue;
        }

        const tail = tokens.slice(-6);
        const fontName = tokens[0];
        const fontType = tokens.slice(1, -6).join(' ');
        if (!fontName || !fontType || tail.length !== 6) {
            continue;
        }

        const [encoding, embeddedRaw, subsetRaw, unicodeRaw, objectNumber, generationNumber] = tail;
        if (!encoding || !embeddedRaw || !subsetRaw || !unicodeRaw || !objectNumber || !generationNumber) {
            continue;
        }
        if (![YES, NO].includes(embeddedRaw.toLowerCase())) {
            continue;
        }

        records.push({
            embedded: parseBooleanColumn(embeddedRaw, 'embedded', line),
            encoding,
            fontName,
            fontType,
            hasToUnicode: parseBooleanColumn(unicodeRaw, 'uni', line),
            objectId: `${objectNumber} ${generationNumber}`,
            subset: parseBooleanColumn(subsetRaw, 'subset', line),
        });
    }

    return records;
}

/** Parse Poppler's `pdffonts -subst` source/substitute table. */
export function parsePdffontsSubstitutionOutput(stdout: string): PdfFontSubstitution[] {
    const substitutions: PdfFontSubstitution[] = [];

    for (const rawLine of stdout.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('-') || /^name\s+(?:object\s+id\s+)?(?:substitute|substitution)\b/i.test(line)) {
            continue;
        }

        const fullMatch = line.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(.+?)\s{2,}(\S.*)$/);
        if (fullMatch) {
            const [, sourceFont, objectNumber, generationNumber, substituteFont, substituteFontFile] = fullMatch;
            if (sourceFont && objectNumber && generationNumber && substituteFont && substituteFontFile) {
                substitutions.push({
                    sourceFont,
                    sourceObjectId: `${objectNumber} ${generationNumber}`,
                    substituteFont: substituteFont.trim(),
                    substituteFontFile,
                });
            }
            continue;
        }

        const [sourceFont, ...substituteTokens] = line.split(/\s+/);
        const substituteFont = substituteTokens.join(' ');
        if (!sourceFont || !substituteFont) {
            continue;
        }
        substitutions.push({ sourceFont, substituteFont });
    }

    return substitutions;
}

export function validateEditionSourceProfile(profile: EditionSourceProfile): ProfileValidation {
    const errors: string[] = [];
    if (!profile.id.trim()) {
        errors.push('profile ID is required');
    }
    if (!profile.editionKey.trim()) {
        errors.push('edition key is required');
    }
    if (profile.mappings.length === 0) {
        errors.push('at least one mapping is required');
    }
    if (!profile.provenance.source.trim()) {
        errors.push('profile provenance source is required');
    }
    if (!profile.provenance.evidenceRef.trim()) {
        errors.push('profile provenance evidenceRef is required');
    }
    if (!profile.provenance.humanValidated) {
        errors.push('profile mapping requires human validation');
    } else if (!profile.provenance.validatedBy?.trim()) {
        errors.push('validatedBy is required when humanValidated is true');
    }

    for (const mapping of profile.mappings) {
        errors.push(...validateProfileMapping(mapping));
    }

    return { errors, valid: errors.length === 0 };
}

function validateProfileMapping(mapping: EditionSourceProfileMapping): string[] {
    const errors: string[] = [];
    if (mapping.candidates.length === 0) {
        errors.push(`mapping ${mapping.kind} has no semantic candidates`);
    }
    if (mapping.kind === 'font-code') {
        if (!mapping.fontName.trim() || !Number.isInteger(mapping.charCode)) {
            errors.push('font-code mapping requires a font name and integer charCode');
        }
    } else if (!mapping.glyphId.trim()) {
        errors.push('type3-glyph mapping requires a glyphId');
    }
    return errors;
}

function likelySymbolFont(fontName: string): boolean {
    return /(?:symbol|dingbat|arabesque|ornament|zapf)/i.test(fontName);
}

function isType3(fontType: string): boolean {
    return /^type\s*3$/i.test(fontType.trim());
}

function makeSubstitutionEvidence(
    font: PdfFontRecord | undefined,
    substitution: PdfFontSubstitution,
): PdfSourceEvidence | undefined {
    if (!font || font.embedded || !likelySymbolFont(font.fontName)) {
        return undefined;
    }

    return {
        detail: `Unembedded symbol font ${font.fontName} is substituted with ${substitution.substituteFont} before rasterization`,
        fontName: font.fontName,
        kind: 'unembedded-symbol-font-substitution',
        rasterFidelity: 'destroyed-by-font-substitution',
        substituteFont: substitution.substituteFont,
    };
}

function makeType3Evidence(font: PdfFontRecord | undefined, glyph: PdfGlyphObservation): PdfSourceEvidence | undefined {
    if (!font || !isType3(font.fontType) || font.hasToUnicode) {
        return undefined;
    }

    return {
        charCode: glyph.charCode,
        detail: `Type 3 glyph ${glyph.glyphId ?? glyph.extractedText ?? 'unknown'} has no ToUnicode mapping; the glyph remains in the PDF raster but extraction is ambiguous`,
        extractedText: glyph.extractedText,
        fontName: glyph.fontName,
        glyphId: glyph.glyphId,
        kind: 'type3-no-tounicode',
        page: glyph.page,
        rasterFidelity: 'present-in-raster',
    };
}

function findMapping(
    profile: EditionSourceProfile | undefined,
    glyph: PdfGlyphObservation,
): EditionSourceProfileMapping | undefined {
    if (!profile) {
        return undefined;
    }

    for (const mapping of profile.mappings) {
        if (mapping.kind === 'font-code') {
            if (mapping.fontName === glyph.fontName && mapping.charCode === glyph.charCode) {
                return mapping;
            }
            continue;
        }
        if (mapping.glyphId === glyph.glyphId && (!mapping.fontName || mapping.fontName === glyph.fontName)) {
            return mapping;
        }
    }

    return undefined;
}

function stableGlyphPart(glyph: PdfGlyphObservation): string {
    return glyph.glyphId ?? (glyph.charCode === undefined ? 'unknown' : `code-${glyph.charCode}`);
}

function buildSuggestion(params: {
    glyph: PdfGlyphObservation;
    mapping: EditionSourceProfileMapping;
    profile: EditionSourceProfile;
    profileValidation: ProfileValidation;
    rasterFidelity: RasterFidelity;
    evidence: readonly PdfSourceEvidence[];
}): PdfSourceSuggestion {
    const { glyph, mapping, profile, profileValidation, rasterFidelity, evidence } = params;
    // Profile trust comes from edition-scoped human validation. Raster fidelity
    // is separate: a source font/code mapping can remain trustworthy even when
    // the renderer substituted away the intended pixels.
    const profileTrusted = profileValidation.valid;
    const reasons: string[] = [];
    if (!profileValidation.valid) {
        reasons.push(`Profile is advisory only: ${profileValidation.errors.join('; ')}`);
    } else {
        reasons.push('Source profile mapping is human-validated for this edition');
    }
    if (rasterFidelity === 'destroyed-by-font-substitution') {
        reasons.push(
            'The intended mark is not recoverable from pixels because of source-font substitution before rendering',
        );
    } else if (rasterFidelity === 'present-in-raster') {
        reasons.push('Source glyph remains present in the PDF raster; verify the edition specimen before editing');
    } else {
        reasons.push('Raster fidelity is unknown; retain for human review only');
    }
    reasons.push('Structured suggestion only; this analysis never changes OCR text');

    return {
        candidates: mapping.candidates,
        charCode: glyph.charCode,
        editionProfileId: profile.id,
        evidence,
        extractedText: glyph.extractedText,
        fontName: glyph.fontName,
        glyphId: glyph.glyphId,
        id: `pdf-source:${profile.id}:page-${glyph.page}:${glyph.fontName}:${stableGlyphPart(glyph)}`,
        page: glyph.page,
        printedForm: glyph.printedForm ?? mapping.printedForm,
        profileTrusted,
        rasterFidelity,
        reason: reasons.join('. '),
        status: 'suggested',
    };
}

function sourceEvidenceForGlyph(
    glyph: PdfGlyphObservation,
    font: PdfFontRecord | undefined,
    substitution: PdfFontSubstitution | undefined,
): PdfSourceEvidence[] {
    const substitutionEvidence = substitution ? makeSubstitutionEvidence(font, substitution) : undefined;
    const type3Evidence = makeType3Evidence(font, glyph);
    return [substitutionEvidence, type3Evidence].filter((item): item is PdfSourceEvidence => item !== undefined);
}

function rasterFidelityForEvidence(evidence: readonly PdfSourceEvidence[]): RasterFidelity {
    if (evidence.some((item) => item.rasterFidelity === 'destroyed-by-font-substitution')) {
        return 'destroyed-by-font-substitution';
    }
    if (evidence.some((item) => item.rasterFidelity === 'present-in-raster')) {
        return 'present-in-raster';
    }
    return 'unknown';
}

function deduplicateEvidence(evidence: readonly PdfSourceEvidence[]): PdfSourceEvidence[] {
    const seen = new Set<string>();
    return evidence.filter((item) => {
        const key = JSON.stringify([
            item.kind,
            item.fontName,
            item.charCode,
            item.extractedText,
            item.glyphId,
            item.page,
            item.substituteFont,
            item.rasterFidelity,
            item.detail,
        ]);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

function matchingProfileMapping(
    profile: EditionSourceProfile | undefined,
    profileValidation: ProfileValidation | undefined,
    editionKey: string | undefined,
    glyph: PdfGlyphObservation,
): EditionSourceProfileMapping | undefined {
    if (!profile || !profileValidation || !editionKey || profile.editionKey !== editionKey) {
        return undefined;
    }
    return findMapping(profile, glyph);
}

function analyzeGlyph(params: {
    editionKey?: string;
    fontByName: ReadonlyMap<string, PdfFontRecord>;
    glyph: PdfGlyphObservation;
    profile?: EditionSourceProfile;
    profileValidation?: ProfileValidation;
    substitutionByName: ReadonlyMap<string, PdfFontSubstitution>;
}): {
    readonly evidence: readonly PdfSourceEvidence[];
    readonly proposal?: {
        readonly mapping: EditionSourceProfileMapping;
        readonly profile: EditionSourceProfile;
        readonly profileValidation: ProfileValidation;
    };
    readonly rasterFidelity: RasterFidelity;
} {
    const { editionKey, fontByName, glyph, profile, profileValidation, substitutionByName } = params;
    const glyphEvidence = sourceEvidenceForGlyph(
        glyph,
        fontByName.get(glyph.fontName),
        substitutionByName.get(glyph.fontName),
    );
    const mapping = matchingProfileMapping(profile, profileValidation, editionKey, glyph);
    const proposal = mapping && profile && profileValidation ? { mapping, profile, profileValidation } : undefined;
    return { evidence: glyphEvidence, proposal, rasterFidelity: rasterFidelityForEvidence(glyphEvidence) };
}

/**
 * Analyze injected PDF provenance and return diagnostics plus review proposals.
 * No OCR text is accepted as input or emitted as a replacement value.
 */
export function analyzePdfSource(input: AnalyzePdfSourceInput): PdfSourceAnalysis {
    const fonts = input.fonts ?? parsePdffontsOutput(input.fontsOutput ?? '');
    const substitutions = input.substitutions ?? parsePdffontsSubstitutionOutput(input.substitutionsOutput ?? '');
    const glyphs = input.glyphs ?? [];
    const fontByName = new Map(fonts.map((font) => [font.fontName, font]));
    const substitutionByName = new Map(substitutions.map((substitution) => [substitution.sourceFont, substitution]));
    const evidence: PdfSourceEvidence[] = [];

    for (const substitution of substitutions) {
        const item = makeSubstitutionEvidence(fontByName.get(substitution.sourceFont), substitution);
        if (item) {
            evidence.push(item);
        }
    }

    const profileValidation = input.profile ? validateEditionSourceProfile(input.profile) : undefined;
    const suggestions: PdfSourceSuggestion[] = [];
    const unmatchedGlyphs: PdfGlyphObservation[] = [];

    for (const glyph of glyphs) {
        const glyphAnalysis = analyzeGlyph({
            editionKey: input.editionKey,
            fontByName,
            glyph,
            profile: input.profile,
            profileValidation,
            substitutionByName,
        });
        evidence.push(...glyphAnalysis.evidence);

        const proposal = glyphAnalysis.proposal;
        if (!proposal) {
            unmatchedGlyphs.push(glyph);
            continue;
        }

        suggestions.push(
            buildSuggestion({
                evidence: glyphAnalysis.evidence,
                glyph,
                mapping: proposal.mapping,
                profile: proposal.profile,
                profileValidation: proposal.profileValidation,
                rasterFidelity: glyphAnalysis.rasterFidelity,
            }),
        );
    }

    return {
        evidence: deduplicateEvidence(evidence),
        fonts,
        profileValidation,
        substitutions,
        suggestions,
        unmatchedGlyphs,
    };
}

/**
 * Adapt a source-profiler proposal to the shared review queue. The caller
 * still has to pass the OCR observation IDs and choose replacement text; this
 * function creates a suggestion object only and never edits an ObservationPage.
 */
export function toSuggestedEdit(suggestion: PdfSourceSuggestion, params: SuggestedEditParams): SuggestedEdit {
    if (params.sourceObservationIds.length === 0) {
        throw new Error('at least one source observation ID is required');
    }
    const kind: SuggestedEdit['kind'] =
        params.originalText.length === 0 ? 'insert' : params.replacementText.length === 0 ? 'delete' : 'replace';
    return {
        ...(params.bbox ? { bbox: params.bbox } : {}),
        evidence: [
            {
                engine: 'pdf-source-profiler',
                observationIds: params.sourceObservationIds,
                profileId: suggestion.editionProfileId,
            },
        ],
        id: suggestion.id,
        kind,
        originalText: params.originalText,
        reason: suggestion.reason,
        replacementText: params.replacementText,
        sourceObservationIds: params.sourceObservationIds,
        ...(params.sourceRange ? { sourceRange: params.sourceRange } : {}),
        status: 'suggested',
    };
}
