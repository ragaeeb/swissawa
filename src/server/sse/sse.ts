export function formatSseEvent(event: string, data: unknown): string {
    // Per SSE spec, each event is separated by a blank line.
    // We JSON-stringify data for simplicity.
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
