import { describe, expect, it } from 'bun:test';
import { BAZMUL_AGAARABESQUE_Y_FIXTURE } from '@/server/pdf/fixtures/sourceProfilerEvidence';
import {
    buildPdfFontInspectionArgs,
    inspectPdfSourcePage,
    type PdfFontInspectionCommandRunner,
} from '@/server/pdf/sourceProfilerRunner';

describe('buildPdfFontInspectionArgs', () => {
    it('scopes both Poppler probes to the requested page without invoking a shell', () => {
        expect(buildPdfFontInspectionArgs({ page: 10, pdfPath: 'external-corpus/bazmul.pdf' })).toEqual({
            fonts: ['-f', '10', '-l', '10', 'external-corpus/bazmul.pdf'],
            substitutions: ['-f', '10', '-l', '10', '-subst', 'external-corpus/bazmul.pdf'],
        });
    });

    it('rejects invalid page numbers', () => {
        expect(() => buildPdfFontInspectionArgs({ page: 0, pdfPath: 'book.pdf' })).toThrow(
            'PDF source-profiler page must be a positive integer',
        );
    });
});

describe('inspectPdfSourcePage', () => {
    it('collects page-scoped diagnostics and exposes substitution warnings for raster provenance', async () => {
        const calls: Array<{ args: readonly string[]; command: string }> = [];
        const runner: PdfFontInspectionCommandRunner = async (command, args) => {
            calls.push({ args, command });
            return {
                stderr: '',
                stdout: args.includes('-subst')
                    ? BAZMUL_AGAARABESQUE_Y_FIXTURE.substitutionsOutput
                    : BAZMUL_AGAARABESQUE_Y_FIXTURE.fontsOutput,
            };
        };

        const result = await inspectPdfSourcePage({
            glyphs: BAZMUL_AGAARABESQUE_Y_FIXTURE.glyphs,
            page: 10,
            pdfPath: 'external-corpus/bazmul.pdf',
            runner,
        });

        expect(calls).toEqual([
            { args: ['-f', '10', '-l', '10', 'external-corpus/bazmul.pdf'], command: 'pdffonts' },
            { args: ['-f', '10', '-l', '10', '-subst', 'external-corpus/bazmul.pdf'], command: 'pdffonts' },
        ]);
        expect(result.analysis.evidence).toContainEqual(
            expect.objectContaining({
                fontName: 'AGAArabesque',
                kind: 'unembedded-symbol-font-substitution',
                substituteFont: 'Verdana',
            }),
        );
        expect(result.fontSubstitutionWarnings).toEqual([
            {
                font: 'AGAArabesque',
                message: 'Unembedded symbol font AGAArabesque is substituted with Verdana before rasterization',
                severity: 'error',
            },
        ]);
    });
});
