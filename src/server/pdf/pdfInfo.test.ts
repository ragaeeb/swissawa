import { describe, expect, it } from 'bun:test';
import { parsePdfInfoFileSizeBytes, parsePdfInfoOutput } from '@/server/pdf/pdfInfo';

describe('parsePdfInfoFileSizeBytes', () => {
    it('should parse bytes', () => {
        expect(parsePdfInfoFileSizeBytes('248043 bytes')).toBe(248043);
    });

    it('should return undefined for unexpected format', () => {
        expect(parsePdfInfoFileSizeBytes('248 KB')).toBeUndefined();
    });
});

describe('parsePdfInfoOutput', () => {
    it('should parse required fields', () => {
        const out = [
            'Title:          Example',
            'Author:         Jane',
            'Pages:          12',
            'Page size:      612 x 792 pts (letter)',
            'File size:      248043 bytes',
        ].join('\n');

        expect(parsePdfInfoOutput(out)).toEqual({
            author: 'Jane',
            creator: undefined,
            fileSizeBytes: 248043,
            pageSize: '612 x 792 pts (letter)',
            pages: 12,
            producer: undefined,
            title: 'Example',
        });
    });

    it('should throw if Pages is missing', () => {
        expect(() => parsePdfInfoOutput('Title: X')).toThrow();
    });
});
