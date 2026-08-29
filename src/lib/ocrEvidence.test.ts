import { describe, expect, it } from 'bun:test';
import type { ObservationPage, SuggestedEdit } from '@/lib/macOcr';
import { addSuggestedEdit } from '@/lib/ocrEvidence';

const page: ObservationPage = {
    height: 100,
    observations: [
        {
            bbox: { height: 10, width: 30, x: 10, y: 20 },
            id: 'macocr:page-1:observation-0001',
            rawText: 'النبي',
            text: 'النبي',
        },
    ],
    page: 1,
    suggestedEdits: [],
    width: 80,
};

const suggestion: SuggestedEdit = {
    bbox: { height: 8, width: 8, x: 42, y: 20 },
    evidence: [
        { engine: 'surya', observationIds: ['surya:page-1:line-0001'], rasterSha256: 'a'.repeat(64), score: 0.91 },
    ],
    id: 'suggestion-1',
    kind: 'insert',
    originalText: '',
    reason: 'Localized engine disagreement; review required',
    replacementText: 'ﷺ',
    sourceObservationIds: ['macocr:page-1:observation-0001'],
    status: 'suggested',
};

describe('addSuggestedEdit', () => {
    it('adds a proposal without mutating observations or normalized text', () => {
        const before = JSON.stringify(page);

        const result = addSuggestedEdit(page, suggestion);

        expect(JSON.stringify(page)).toBe(before);
        expect(result.observations).toBe(page.observations);
        expect(result.observations[0]?.text).toBe('النبي');
        expect(result.suggestedEdits).toEqual([suggestion]);
    });

    it('is byte-idempotent for the same suggestion ID', () => {
        const once = addSuggestedEdit(page, suggestion);
        const twice = addSuggestedEdit(once, suggestion);

        expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    });

    it('rejects proposals that cannot be traced to a page observation', () => {
        const untraceable = { ...suggestion, id: 'suggestion-2', sourceObservationIds: ['missing-source'] };

        expect(() => addSuggestedEdit(page, untraceable)).toThrow('unknown source observation: missing-source');
    });

    it('rejects a conflicting payload that reuses an existing suggestion ID', () => {
        const once = addSuggestedEdit(page, suggestion);
        const conflict = { ...suggestion, replacementText: 'ؒ' };

        expect(() => addSuggestedEdit(once, conflict)).toThrow('conflicting suggestion ID: suggestion-1');
    });
});
