import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import type { ObservationPage } from '@/lib/macOcr';
import type { SuryaPageOcrResult } from '@/lib/suryaOcr';
import { jobDir } from '@/server/jobs/jobPaths';
import {
    convertSuryaToObservationPage,
    filterSuryaRawOutput,
    splitSuryaOcrToPages,
    writeSuryaMeta,
} from '@/server/ocr/splitSuryaOcr';

let testJobId = '';

describe('splitSuryaOcr', () => {
    beforeEach(async () => {
        testJobId = randomUUID();
        await fsp.mkdir(jobDir(testJobId), { recursive: true });
    });

    afterEach(async () => {
        if (testJobId) {
            await fsp.rm(jobDir(testJobId), { force: true, recursive: true });
        }
    });

    describe('filterSuryaRawOutput', () => {
        it('should strip chars, confidence, polygon, words, and original_text_good from text_lines', () => {
            const rawPage = {
                image_bbox: [0, 0, 800, 1000] as [number, number, number, number],
                page: 1, // Surya uses 1-indexed pages
                text_lines: [
                    {
                        bbox: [10, 20, 100, 40] as [number, number, number, number],
                        chars: [{ bbox: [10, 20, 15, 40], text: 'a' }],
                        confidence: 0.95,
                        original_text_good: true,
                        polygon: [
                            [10, 20],
                            [100, 20],
                            [100, 40],
                            [10, 40],
                        ],
                        text: 'مرحبا',
                        words: [{ bbox: [10, 20, 100, 40], text: 'مرحبا' }],
                    },
                ],
            };

            const result = filterSuryaRawOutput({ 'test-file': [rawPage as any] });

            expect(result).toEqual({
                'test-file': [
                    {
                        image_bbox: [0, 0, 800, 1000],
                        page: 1,
                        text_lines: [{ bbox: [10, 20, 100, 40], text: 'مرحبا' }],
                    },
                ],
            });
        });

        it('should handle multiple pages and files', () => {
            const raw = {
                file1: [
                    {
                        image_bbox: [0, 0, 100, 100] as [number, number, number, number],
                        page: 1,
                        text_lines: [{ bbox: [0, 0, 10, 10], confidence: 0.9, text: 'a' }],
                    },
                    {
                        image_bbox: [0, 0, 100, 100] as [number, number, number, number],
                        page: 2,
                        text_lines: [{ bbox: [0, 0, 10, 10], confidence: 0.8, text: 'b' }],
                    },
                ],
                file2: [{ image_bbox: [0, 0, 200, 200] as [number, number, number, number], page: 1, text_lines: [] }],
            };

            const result = filterSuryaRawOutput(raw as any);

            expect(Object.keys(result)).toEqual(['file1', 'file2']);
            expect(result.file1?.length).toBe(2);
            expect(result.file2?.length).toBe(1);
            expect(result.file1?.[0]?.text_lines[0]).not.toHaveProperty('confidence');
        });
    });

    describe('convertSuryaToObservationPage', () => {
        it('should convert SuryaPageOcrResult to ObservationPage format', () => {
            const suryaPage: SuryaPageOcrResult = {
                image_bbox: [0, 0, 800, 1200],
                page: 1, // Surya uses 1-indexed pages
                text_lines: [
                    { bbox: [10, 20, 110, 50], text: 'السلام عليكم' },
                    { bbox: [10, 60, 200, 90], text: 'وعليكم السلام' },
                ],
            };

            const result = convertSuryaToObservationPage(suryaPage);

            expect(result).toEqual({
                height: 1200,
                observations: [
                    {
                        bbox: { height: 30, width: 100, x: 10, y: 20 },
                        id: 'surya:page-1:line-0001',
                        rawText: 'السلام عليكم',
                        sourceRange: { length: 12, location: 0, unit: 'utf16' },
                        text: 'السلام عليكم',
                    },
                    {
                        bbox: { height: 30, width: 190, x: 10, y: 60 },
                        id: 'surya:page-1:line-0002',
                        rawText: 'وعليكم السلام',
                        sourceRange: { length: 13, location: 0, unit: 'utf16' },
                        text: 'وعليكم السلام',
                    },
                ],
                page: 1, // Same as input - surya is already 1-indexed
                salutationProposals: [],
                suggestedEdits: [],
                width: 800,
            });
        });

        it('retains Surya localization evidence in the paged observation contract', () => {
            const chars = [{ bbox: [10, 20, 15, 40] as [number, number, number, number], text: 'ﷺ' }];
            const polygon = [
                [10, 20],
                [30, 20],
                [30, 40],
                [10, 40],
            ] as Array<[number, number]>;
            const words = [{ bbox: [10, 20, 30, 40] as [number, number, number, number], text: 'ﷺ' }];
            const result = convertSuryaToObservationPage({
                image_bbox: [0, 0, 100, 100],
                page: 2,
                text_lines: [{ bbox: [10, 20, 30, 40], chars, confidence: 0.93, polygon, text: 'ﷺ', words }],
            });

            expect(result.observations[0]).toMatchObject({
                chars,
                confidence: 0.93,
                id: 'surya:page-2:line-0001',
                polygon,
                rawText: 'ﷺ',
                sourceRange: { length: 1, location: 0, unit: 'utf16' },
                words,
            });
        });

        it('measures supplementary-plane honorific ranges in UTF-16 code units', () => {
            const honorific = String.fromCodePoint(0x10ed1);
            const result = convertSuryaToObservationPage({
                image_bbox: [0, 0, 100, 100],
                page: 3,
                text_lines: [{ bbox: [10, 20, 30, 40], text: honorific }],
            });

            expect(result.observations[0]?.sourceRange).toEqual({ length: 2, location: 0, unit: 'utf16' });
        });

        it('should handle empty text_lines', () => {
            const suryaPage: SuryaPageOcrResult = { image_bbox: [0, 0, 500, 700], page: 5, text_lines: [] };

            const result = convertSuryaToObservationPage(suryaPage);

            expect(result).toEqual({
                height: 700,
                observations: [],
                page: 5, // Same as input
                salutationProposals: [],
                suggestedEdits: [],
                width: 500,
            });
        });
    });

    describe('writeSuryaMeta', () => {
        it('should write meta.json with correct fields', async () => {
            const outDir = path.join(jobDir(testJobId), 'surya');
            await fsp.mkdir(outDir, { recursive: true });

            const meta = { createdAtIso: '2026-01-04T00:00:00Z', dpi: { x: 72, y: 72 }, totalPages: 5 };
            await writeSuryaMeta(outDir, meta);

            const written = JSON.parse(await fsp.readFile(path.join(outDir, 'meta.json'), 'utf8'));
            expect(written.totalPages).toBe(5);
            expect(written.createdAtIso).toBe('2026-01-04T00:00:00Z');
        });
    });

    describe('splitSuryaOcrToPages', () => {
        it('should split surya output into per-page JSON files', async () => {
            const suryaPages: SuryaPageOcrResult[] = [
                {
                    image_bbox: [0, 0, 800, 1000],
                    page: 1, // Surya uses 1-indexed pages
                    text_lines: [{ bbox: [10, 20, 100, 40], text: 'صفحة واحدة' }],
                },
                {
                    image_bbox: [0, 0, 800, 1000],
                    page: 2,
                    text_lines: [{ bbox: [10, 20, 100, 40], text: 'صفحة اثنين' }],
                },
            ];

            const outDir = path.join(jobDir(testJobId), 'surya');
            const meta = await splitSuryaOcrToPages({ outDir, pages: suryaPages });

            expect(meta.totalPages).toBe(2);

            // Check per-page files exist with correct content
            const page1 = JSON.parse(
                await fsp.readFile(path.join(outDir, 'pages', '1.json'), 'utf8'),
            ) as ObservationPage;
            expect(page1.page).toBe(1);
            expect(page1.observations[0]?.text).toBe('صفحة واحدة');

            const page2 = JSON.parse(
                await fsp.readFile(path.join(outDir, 'pages', '2.json'), 'utf8'),
            ) as ObservationPage;
            expect(page2.page).toBe(2);
            expect(page2.observations[0]?.text).toBe('صفحة اثنين');

            // Check meta.json
            const writtenMeta = JSON.parse(await fsp.readFile(path.join(outDir, 'meta.json'), 'utf8'));
            expect(writtenMeta.totalPages).toBe(2);
        });

        it('should handle empty pages array', async () => {
            const outDir = path.join(jobDir(testJobId), 'surya');
            const meta = await splitSuryaOcrToPages({ outDir, pages: [] });

            expect(meta.totalPages).toBe(0);

            const pagesDir = path.join(outDir, 'pages');
            const files = await fsp.readdir(pagesDir);
            expect(files.length).toBe(0);
        });
    });
});
