import type { MacOCR } from '@/lib/macOcr';

export type OcrDelivery =
    | { kind: 'inline'; ocr: MacOCR }
    | { kind: 'file'; url: string }
    | { kind: 'pages'; pagesBaseUrl: string; totalPages: number };

export type OcrDeliveryPreferredKind = 'auto' | 'inline' | 'file' | 'pages';

export type SelectOcrDeliveryOptions = {
    preferredKind?: OcrDeliveryPreferredKind;
    rawJsonBytes: number;
    hasPagesSplit: boolean;
    totalPages?: number;
    inlineThresholdBytes?: number;
    // These are produced by the API layer so this module stays pure and testable.
    fileUrl: string;
    pagesBaseUrl: string;
    // Only required when inline is selected.
    ocr?: MacOCR;
};

const DEFAULT_INLINE_THRESHOLD_BYTES = 1_000_000; // 1MB default; override per deployment needs.

export function selectOcrDelivery(opts: SelectOcrDeliveryOptions): OcrDelivery {
    const preferredKind: OcrDeliveryPreferredKind = opts.preferredKind ?? 'auto';
    const inlineThresholdBytes = opts.inlineThresholdBytes ?? DEFAULT_INLINE_THRESHOLD_BYTES;

    const canInline = opts.rawJsonBytes <= inlineThresholdBytes;
    const canPages = opts.hasPagesSplit && typeof opts.totalPages === 'number' && opts.totalPages > 0;

    const chooseInline = () => {
        if (!opts.ocr) {
            throw new Error('selectOcrDelivery: opts.ocr is required for inline delivery');
        }
        return { kind: 'inline', ocr: opts.ocr } as const;
    };

    const chooseFile = () => ({ kind: 'file', url: opts.fileUrl }) as const;

    const choosePages = () =>
        ({ kind: 'pages', pagesBaseUrl: opts.pagesBaseUrl, totalPages: opts.totalPages as number }) as const;

    if (preferredKind === 'inline') {
        return canInline ? chooseInline() : canPages ? choosePages() : chooseFile();
    }

    if (preferredKind === 'pages') {
        return canPages ? choosePages() : chooseFile();
    }

    if (preferredKind === 'file') {
        return chooseFile();
    }

    // auto
    if (canInline) {
        return chooseInline();
    }
    if (canPages) {
        return choosePages();
    }
    return chooseFile();
}
