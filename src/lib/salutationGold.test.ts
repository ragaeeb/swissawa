import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { validateSalutationGoldPacket } from '@/lib/salutationGold';

const packetPath = path.resolve(
    import.meta.dir,
    '../../docs/research/fixtures/salutation-gold-seed-2026-08-24/annotations.json',
);

async function loadPacket(): Promise<unknown> {
    return await Bun.file(packetPath).json();
}

describe('salutation gold packet', () => {
    it('validates the seed packet and every referenced crop hash', async () => {
        const packet = validateSalutationGoldPacket(await loadPacket());
        const ids = new Set(packet.entries.map((entry) => entry.id));

        expect(packet.entries).toHaveLength(7);
        expect(ids.size).toBe(packet.entries.length);

        for (const entry of packet.entries) {
            const cropPath = path.resolve(path.dirname(packetPath), entry.crop.path);
            const bytes = new Uint8Array(await Bun.file(cropPath).arrayBuffer());
            const digest = createHash('sha256').update(bytes).digest('hex');
            expect(digest).toBe(entry.crop.sha256);
        }
    });

    it('rejects a hard negative that claims a target is present', async () => {
        const raw = structuredClone(await loadPacket()) as any;
        const negative = raw.entries.find((entry: any) => entry.role === 'hard-negative');
        negative.targetPresence = 'present';

        expect(() => validateSalutationGoldPacket(raw)).toThrow(
            'hard-negative entries must use semanticClass none and targetPresence absent',
        );
    });

    it('excludes renderer-destroyed evidence from pixel recall', async () => {
        const raw = structuredClone(await loadPacket()) as any;
        const destroyed = raw.entries.find((entry: any) => entry.rasterFidelity === 'destroyed-by-font-substitution');
        destroyed.includeInPixelRecall = true;

        expect(() => validateSalutationGoldPacket(raw)).toThrow(
            'renderer-destroyed entries cannot be included in pixel recall',
        );
    });
});
