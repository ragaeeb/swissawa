import { describe, expect, it } from 'bun:test';
import { formatSseEvent } from '@/server/sse/sse';

describe('formatSseEvent', () => {
    it('should format event and JSON payload', () => {
        expect(formatSseEvent('progress', { done: 1 })).toBe('event: progress\ndata: {"done":1}\n\n');
    });

    it('should throw on invalid event names', () => {
        expect(() => formatSseEvent('bad\nname', {})).toThrow();
        expect(() => formatSseEvent('bad\rname', {})).toThrow();
    });
});
