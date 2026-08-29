import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import path from 'node:path';

type RenderEntry = {
    readonly dpi: number;
    readonly path: string;
    readonly role: 'crop' | 'full';
    readonly sha256: string;
};

const fixtureRoot = path.resolve(import.meta.dir, '../../docs/research/fixtures/surya-dpi-salutation-2026-08-24');

describe('Surya DPI salutation fixture matrix', () => {
    it('keeps all 40 source renders and crops byte-identical to the rescued manifest', async () => {
        const manifest = (await Bun.file(path.join(fixtureRoot, 'render-manifest.json')).json()) as {
            readonly renderer: string;
            readonly renders: readonly RenderEntry[];
        };

        expect(manifest.renderer).toBe('pdftocairo 26.07.0');
        expect(manifest.renders).toHaveLength(40);
        expect(manifest.renders.filter((entry) => entry.role === 'full')).toHaveLength(20);
        expect(manifest.renders.filter((entry) => entry.role === 'crop')).toHaveLength(20);

        for (const dpi of [144, 200, 300, 450, 600]) {
            expect(manifest.renders.filter((entry) => entry.dpi === dpi)).toHaveLength(8);
        }

        for (const entry of manifest.renders) {
            expect(path.isAbsolute(entry.path)).toBe(false);
            const bytes = new Uint8Array(await Bun.file(path.resolve(fixtureRoot, entry.path)).arrayBuffer());
            expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
        }
    });
});
