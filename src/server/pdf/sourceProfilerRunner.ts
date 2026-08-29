import { spawn } from 'node:child_process';
import type { FontSubstitutionWarning } from '@/server/ocr/canonicalRaster';
import {
    analyzePdfSource,
    type EditionSourceProfile,
    type PdfGlyphObservation,
    type PdfSourceAnalysis,
} from '@/server/pdf/sourceProfiler';

export type PdfFontInspectionCommandRunner = (
    command: string,
    args: readonly string[],
) => Promise<{ readonly stderr: string; readonly stdout: string }>;

export type InspectPdfSourcePageParams = {
    readonly editionKey?: string;
    readonly glyphs?: readonly PdfGlyphObservation[];
    readonly page: number;
    readonly pdfPath: string;
    readonly profile?: EditionSourceProfile;
    readonly runner?: PdfFontInspectionCommandRunner;
};

export function buildPdfFontInspectionArgs(params: { readonly page: number; readonly pdfPath: string }): {
    readonly fonts: readonly string[];
    readonly substitutions: readonly string[];
} {
    if (!Number.isInteger(params.page) || params.page <= 0) {
        throw new Error('PDF source-profiler page must be a positive integer');
    }
    if (!params.pdfPath) {
        throw new Error('PDF source-profiler path is required');
    }
    const pageArgs = ['-f', String(params.page), '-l', String(params.page)];
    return { fonts: [...pageArgs, params.pdfPath], substitutions: [...pageArgs, '-subst', params.pdfPath] };
}

const runCommand: PdfFontInspectionCommandRunner = (command, args) =>
    new Promise((resolve, reject) => {
        const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        let stdout = '';
        child.stdout?.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
        });
        child.once('error', reject);
        child.once('close', (code) => {
            if (code === 0) {
                resolve({ stderr, stdout });
                return;
            }
            reject(new Error(`${command} exited with code ${code ?? 'null'}: ${stderr}`));
        });
    });

function toFontSubstitutionWarnings(analysis: PdfSourceAnalysis): FontSubstitutionWarning[] {
    return analysis.evidence
        .filter((evidence) => evidence.kind === 'unembedded-symbol-font-substitution')
        .map((evidence) => ({ font: evidence.fontName, message: evidence.detail, severity: 'error' as const }));
}

/**
 * Read-only Poppler preflight for one PDF page. Its warnings can be passed to
 * `renderCanonicalPage`; proposals remain separate and suggestion-only.
 */
export async function inspectPdfSourcePage(
    params: InspectPdfSourcePageParams,
): Promise<{
    readonly analysis: PdfSourceAnalysis;
    readonly fontSubstitutionWarnings: readonly FontSubstitutionWarning[];
    readonly stderr: { readonly fonts: string; readonly substitutions: string };
}> {
    const args = buildPdfFontInspectionArgs(params);
    const runner = params.runner ?? runCommand;
    const fonts = await runner('pdffonts', args.fonts);
    const substitutions = await runner('pdffonts', args.substitutions);
    const analysis = analyzePdfSource({
        editionKey: params.editionKey,
        fontsOutput: fonts.stdout,
        glyphs: params.glyphs,
        profile: params.profile,
        substitutionsOutput: substitutions.stdout,
    });
    return {
        analysis,
        fontSubstitutionWarnings: toFontSubstitutionWarnings(analysis),
        stderr: { fonts: fonts.stderr, substitutions: substitutions.stderr },
    };
}
