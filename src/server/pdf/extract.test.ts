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
});

describe('jobImageUrl', () => {
    it('should build URL', () => {
        expect(jobImageUrl('abc', 12)).toBe('/api/jobs/abc/images/12');
    });
});

describe('jobImageFileName', () => {
    it('should pad based on total pages digits', () => {
        expect(jobImageFileName(1, 510)).toBe('page-001.jpg');
        expect(jobImageFileName(108, 510)).toBe('page-108.jpg');
    });
});
