import { describe, expect, it } from 'bun:test';
import { buildPdftocairoArgs, jobImageFileName, jobImageUrl } from '@/server/pdf/extract';

describe('buildPdftocairoArgs', () => {
    it('should build args with defaults', () => {
        expect(
            buildPdftocairoArgs({
                inputPdfPath: '/tmp/in.pdf',
                outputPrefix: '/tmp/job/page',
                range: { end: 10, start: 1 },
            }),
        ).toEqual([
            '-jpeg',
            '-jpegopt',
            'quality=50',
            '-scale-to',
            '1200',
            '-f',
            '1',
            '-l',
            '10',
            '/tmp/in.pdf',
            '/tmp/job/page',
        ]);
    });

    it('should apply custom options', () => {
        expect(
            buildPdftocairoArgs({
                inputPdfPath: '/tmp/in.pdf',
                options: { jpegQuality: 80, scaleTo: 2400 },
                outputPrefix: '/tmp/job/page',
                range: { end: 10, start: 1 },
            }),
        ).toEqual([
            '-jpeg',
            '-jpegopt',
            'quality=80',
            '-scale-to',
            '2400',
            '-f',
            '1',
            '-l',
            '10',
            '/tmp/in.pdf',
            '/tmp/job/page',
        ]);
    });

    it('should throw error for invalid scaleTo', () => {
        expect(() =>
            buildPdftocairoArgs({
                inputPdfPath: '/tmp/in.pdf',
                options: { scaleTo: 0 },
                outputPrefix: '/tmp/job/page',
                range: { end: 10, start: 1 },
            }),
        ).toThrow('scaleTo must be > 0');
    });

    it('should throw error for invalid jpegQuality', () => {
        expect(() =>
            buildPdftocairoArgs({
                inputPdfPath: '/tmp/in.pdf',
                options: { jpegQuality: 150 },
                outputPrefix: '/tmp/job/page',
                range: { end: 10, start: 1 },
            }),
        ).toThrow('jpegQuality must be 1..100');
    });
});

describe('jobImageUrl', () => {
    it('should build URL', () => {
        expect(jobImageUrl('abc', 12)).toBe('/api/jobs/abc/images/12');
    });

    it('should throw error for empty jobId', () => {
        expect(() => jobImageUrl('', 1)).toThrow('jobId is required');
    });

    it('should throw error for non-integer pageNumber', () => {
        expect(() => jobImageUrl('abc', 1.5)).toThrow('pageNumber must be a positive integer');
    });

    it('should throw error for non-positive pageNumber', () => {
        expect(() => jobImageUrl('abc', 0)).toThrow('pageNumber must be a positive integer');
        expect(() => jobImageUrl('abc', -1)).toThrow('pageNumber must be a positive integer');
    });
});

describe('jobImageFileName', () => {
    it('should pad based on total pages digits', () => {
        expect(jobImageFileName(1, 510)).toBe('page-001.jpg');
        expect(jobImageFileName(108, 510)).toBe('page-108.jpg');
    });

    it('should pad based on pageNumber digits when totalPages is omitted', () => {
        expect(jobImageFileName(5)).toBe('page-5.jpg');
        expect(jobImageFileName(42)).toBe('page-42.jpg');
        expect(jobImageFileName(123)).toBe('page-123.jpg');
    });

    it('should throw error for invalid pageNumber', () => {
        expect(() => jobImageFileName(0)).toThrow('pageNumber must be a positive integer');
        expect(() => jobImageFileName(-1)).toThrow('pageNumber must be a positive integer');
        expect(() => jobImageFileName(1.5)).toThrow('pageNumber must be a positive integer');
    });
});
