import { describe, expect, it } from 'bun:test';
import {
    createSalutationProposal,
    protectedSymbolCountMismatch,
    type SalutationProposal,
    type SalutationSemanticClass,
} from '@/lib/salutationProposal';

describe('salutation proposals', () => {
    it('models the common salutation and honorific families without collapsing gender or number', () => {
        const classes: readonly SalutationSemanticClass[] = [
            'sallallahu-alayhi-wasallam',
            'alayhis-salam',
            'alayha-as-salam',
            'alayhima-as-salam',
            'alayhim-as-salam',
            'alayhinna-as-salam',
            'rahimahu-allah',
            'rahimaha-allah',
            'rahimahuma-allah',
            'rahimahum-allah',
            'rahimahunna-allah',
            'radi-allahu-anhu',
            'radi-allahu-anha',
            'radi-allahu-anhuma',
            'radi-allahu-anhum',
            'radi-allahu-anhunna',
            'azza-wa-jall',
            'jalla-jalaluhu',
        ];

        expect(new Set(classes).size).toBe(classes.length);
    });

    it('creates a suggestion-only proposal with geometry and engine evidence', () => {
        const proposal = createSalutationProposal({
            bbox: { height: 12, width: 40, x: 100, y: 200 },
            confidence: 0.88,
            engineEvidence: [
                {
                    confidence: 0.88,
                    engine: 'surya',
                    observedText: 'النبي صلى الله عليه وسلم',
                    rasterSha256: 'a'.repeat(64),
                    visualForm: 'expanded-text',
                },
            ],
            id: 'salutation-1',
            rasterFidelity: 'present-in-raster',
            semanticClass: 'sallallahu-alayhi-wasallam',
            sourceRange: { length: 4, location: 20, unit: 'utf16' },
            visualForm: 'expanded-text',
        });

        expect(proposal).toMatchObject({
            confidence: 0.88,
            decision: 'suggestion-only',
            geometry: {
                bbox: { height: 12, width: 40, x: 100, y: 200 },
                sourceRange: { length: 4, location: 20, unit: 'utf16' },
            },
            rasterFidelity: 'present-in-raster',
            semanticClass: 'sallallahu-alayhi-wasallam',
            visualForm: 'expanded-text',
        });
        expect(proposal.engineEvidence[0]?.visualForm).toBe('expanded-text');
        expect(proposal.abstentionReason).toBeUndefined();
    });

    it('carries an explicit protected-symbol-count mismatch abstention', () => {
        const reason = protectedSymbolCountMismatch({ expected: 1, observed: 0, symbol: 'ﷺ' });
        const proposal: SalutationProposal = createSalutationProposal({
            abstentionReason: reason,
            bbox: { height: 8, width: 8, x: 4, y: 4 },
            confidence: 0.42,
            engineEvidence: [],
            id: 'salutation-2',
            rasterFidelity: 'unknown',
            semanticClass: 'sallallahu-alayhi-wasallam',
            visualForm: 'unknown',
        });

        expect(proposal.decision).toBe('suggestion-only');
        expect(proposal.abstentionReason).toEqual({
            code: 'protected-symbol-count-mismatch',
            expected: 1,
            observed: 0,
            symbol: 'ﷺ',
        });
    });

    it('keeps a renderer-substituted letterform separate from semantic meaning', () => {
        const proposal = createSalutationProposal({
            bbox: { height: 8, width: 8, x: 4, y: 4 },
            confidence: 1,
            engineEvidence: [{ engine: 'pdf-source-profiler', observedText: 'y' }],
            id: 'salutation-renderer-substitution',
            rasterFidelity: 'destroyed-by-font-substitution',
            semanticClass: 'unknown',
            visualForm: 'substituted-letterform',
        });

        expect(proposal).toMatchObject({
            decision: 'suggestion-only',
            rasterFidelity: 'destroyed-by-font-substitution',
            semanticClass: 'unknown',
            visualForm: 'substituted-letterform',
        });
    });
});
