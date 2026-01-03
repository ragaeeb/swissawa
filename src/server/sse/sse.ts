export function formatSseEvent(event: string, data: unknown): string {
    if (event.includes('\n') || event.includes('\r')) {
        throw new Error(`Invalid event name (contains control characters): ${event}`);
    }
    // Per SSE spec, each event is separated by a blank line.
    // We JSON-stringify data for simplicity.
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
