import path from 'node:path';
import type { RasterFidelity, SalutationSemanticClass, SalutationVisualForm } from '@/lib/salutationProposal';

export type SalutationGoldSemanticClass = SalutationSemanticClass | 'none';
export type SalutationGoldVisualForm = SalutationVisualForm | 'ordinary-text';
export type SalutationTargetPresence = 'present' | 'absent' | 'unknown';
export type SalutationGoldRole = 'positive-anchor' | 'hard-negative' | 'unresolved-hard-negative';

export type SalutationGoldCrop = {
    readonly dimensions: readonly [number, number];
    readonly dpi: number;
    readonly path: string;
    readonly sha256: string;
};

export type SalutationGoldEntry = {
    readonly bookKey: string;
    readonly crop: SalutationGoldCrop;
    readonly editionKey: string;
    readonly humanAnnotationStatus: string;
    readonly id: string;
    readonly includeInHardNegativeSet: boolean;
    readonly includeInPixelRecall: boolean;
    readonly page: number;
    readonly rasterFidelity: RasterFidelity;
    readonly role: SalutationGoldRole;
    readonly semanticClass: SalutationGoldSemanticClass;
    readonly splitKey: string;
    readonly targetPresence: SalutationTargetPresence;
    readonly visualForm: SalutationGoldVisualForm;
};

export type SalutationGoldPacket = {
    readonly entries: readonly SalutationGoldEntry[];
    readonly packetId: string;
    readonly packetType: 'seed-annotation-packet';
    readonly status: 'seed-not-evaluation-corpus';
};

const RASTER_FIDELITIES = new Set<RasterFidelity>(['present-in-raster', 'destroyed-by-font-substitution', 'unknown']);
const SEMANTIC_CLASSES = new Set<SalutationGoldSemanticClass>([
    'alayhis-salam',
    'alayha-as-salam',
    'alayhima-as-salam',
    'alayhim-as-salam',
    'alayhinna-as-salam',
    'azza-wa-jall',
    'jalla-jalaluhu',
    'none',
    'rahimahu-allah',
    'rahimaha-allah',
    'rahimahuma-allah',
    'rahimahum-allah',
    'rahimahunna-allah',
    'radi-allahu-anha',
    'radi-allahu-anhuma',
    'radi-allahu-anhu',
    'radi-allahu-anhum',
    'radi-allahu-anhunna',
    'sallallahu-alayhi-wasallam',
    'unknown',
]);
const TARGET_PRESENCE = new Set<SalutationTargetPresence>(['present', 'absent', 'unknown']);
const VISUAL_FORMS = new Set<SalutationGoldVisualForm>([
    'compact-glyph',
    'expanded-text',
    'ordinary-text',
    'substituted-letterform',
    'unknown',
]);
const ROLES = new Set<SalutationGoldRole>(['hard-negative', 'positive-anchor', 'unresolved-hard-negative']);
const SHA256 = /^[a-f0-9]{64}$/;

function record(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} must be a non-empty string`);
    }
    return value;
}

function boolean(value: unknown, label: string): boolean {
    if (typeof value !== 'boolean') {
        throw new Error(`${label} must be a boolean`);
    }
    return value;
}

function positiveInteger(value: unknown, label: string): number {
    if (!Number.isInteger(value) || Number(value) <= 0) {
        throw new Error(`${label} must be a positive integer`);
    }
    return Number(value);
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, label: string): T {
    if (typeof value !== 'string' || !allowed.has(value as T)) {
        throw new Error(`${label} has unsupported value ${JSON.stringify(value)}`);
    }
    return value as T;
}

function parseCrop(value: unknown, entryId: string): SalutationGoldCrop {
    const crop = record(value, `${entryId}.crop`);
    const cropPath = nonEmptyString(crop.path, `${entryId}.crop.path`);
    if (path.isAbsolute(cropPath)) {
        throw new Error(`${entryId}.crop.path must be repository-relative`);
    }
    if (!Array.isArray(crop.dimensions) || crop.dimensions.length !== 2) {
        throw new Error(`${entryId}.crop.dimensions must contain width and height`);
    }
    const dimensions = [
        positiveInteger(crop.dimensions[0], `${entryId}.crop.dimensions[0]`),
        positiveInteger(crop.dimensions[1], `${entryId}.crop.dimensions[1]`),
    ] as const;
    const sha256 = nonEmptyString(crop.sha256, `${entryId}.crop.sha256`);
    if (!SHA256.test(sha256)) {
        throw new Error(`${entryId}.crop.sha256 must be a lowercase SHA-256 digest`);
    }
    return { dimensions, dpi: positiveInteger(crop.dpi, `${entryId}.crop.dpi`), path: cropPath, sha256 };
}

function parseEntry(value: unknown): SalutationGoldEntry {
    const raw = record(value, 'gold entry');
    const id = nonEmptyString(raw.id, 'gold entry id');
    const entry: SalutationGoldEntry = {
        bookKey: nonEmptyString(raw.bookKey, `${id}.bookKey`),
        crop: parseCrop(raw.crop, id),
        editionKey: nonEmptyString(raw.editionKey, `${id}.editionKey`),
        humanAnnotationStatus: nonEmptyString(raw.humanAnnotationStatus, `${id}.humanAnnotationStatus`),
        id,
        includeInHardNegativeSet: boolean(raw.includeInHardNegativeSet, `${id}.includeInHardNegativeSet`),
        includeInPixelRecall: boolean(raw.includeInPixelRecall, `${id}.includeInPixelRecall`),
        page: positiveInteger(raw.page, `${id}.page`),
        rasterFidelity: enumValue(raw.rasterFidelity, RASTER_FIDELITIES, `${id}.rasterFidelity`),
        role: enumValue(raw.role, ROLES, `${id}.role`),
        semanticClass: enumValue(raw.semanticClass, SEMANTIC_CLASSES, `${id}.semanticClass`),
        splitKey: nonEmptyString(raw.splitKey, `${id}.splitKey`),
        targetPresence: enumValue(raw.targetPresence, TARGET_PRESENCE, `${id}.targetPresence`),
        visualForm: enumValue(raw.visualForm, VISUAL_FORMS, `${id}.visualForm`),
    };

    if (entry.role === 'hard-negative' && (entry.semanticClass !== 'none' || entry.targetPresence !== 'absent')) {
        throw new Error('hard-negative entries must use semanticClass none and targetPresence absent');
    }
    if (entry.rasterFidelity === 'destroyed-by-font-substitution' && entry.includeInPixelRecall) {
        throw new Error('renderer-destroyed entries cannot be included in pixel recall');
    }
    if (
        entry.includeInPixelRecall &&
        (entry.rasterFidelity !== 'present-in-raster' ||
            entry.targetPresence !== 'present' ||
            entry.semanticClass === 'none' ||
            entry.semanticClass === 'unknown')
    ) {
        throw new Error('pixel-recall entries require present target pixels and a known semantic class');
    }
    return entry;
}

export function validateSalutationGoldPacket(value: unknown): SalutationGoldPacket {
    const raw = record(value, 'salutation gold packet');
    if (!Array.isArray(raw.entries)) {
        throw new Error('salutation gold packet entries must be an array');
    }
    const entries = raw.entries.map(parseEntry);
    const ids = new Set<string>();
    for (const entry of entries) {
        if (ids.has(entry.id)) {
            throw new Error(`duplicate salutation gold entry id: ${entry.id}`);
        }
        ids.add(entry.id);
    }
    const packetType = nonEmptyString(raw.packetType, 'packetType');
    const status = nonEmptyString(raw.status, 'status');
    if (packetType !== 'seed-annotation-packet' || status !== 'seed-not-evaluation-corpus') {
        throw new Error('unsupported salutation gold packet type or status');
    }
    return { entries, packetId: nonEmptyString(raw.packetId, 'packetId'), packetType, status };
}
