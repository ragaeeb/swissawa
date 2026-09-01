import type { ObservationPage, SuggestedEdit } from '@/lib/macOcr';

/**
 * Append an auditable suggestion without changing OCR observations or text.
 * Re-applying an existing suggestion ID is a byte-idempotent no-op.
 */
export function addSuggestedEdit(page: ObservationPage, suggestion: SuggestedEdit): ObservationPage {
    const existing = page.suggestedEdits ?? [];
    const previous = existing.find((candidate) => candidate.id === suggestion.id);
    if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(suggestion)) {
            throw new Error(`conflicting suggestion ID: ${suggestion.id}`);
        }
        return page;
    }

    const sourceIds = new Set(page.observations.flatMap((observation) => (observation.id ? [observation.id] : [])));
    for (const sourceObservationId of suggestion.sourceObservationIds) {
        if (!sourceIds.has(sourceObservationId)) {
            throw new Error(`unknown source observation: ${sourceObservationId}`);
        }
    }

    return { ...page, suggestedEdits: [...existing, suggestion] };
}
