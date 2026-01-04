import { EventEmitter } from 'node:events';

export type OcrProgressEvent = {
    line: string;
    currentPage?: number;
    totalPages?: number;
    phase?: 'detecting' | 'recognizing'; // surya-specific phases
};

export type OcrEvents = {
    progress: (ev: OcrProgressEvent) => void;
    complete: () => void;
    error: (message: string) => void;
};

class OcrEventBus {
    private emitter = new EventEmitter();

    on<K extends keyof OcrEvents>(event: K, handler: OcrEvents[K]): void {
        this.emitter.on(event, handler as (...args: any[]) => void);
    }

    off<K extends keyof OcrEvents>(event: K, handler: OcrEvents[K]): void {
        this.emitter.off(event, handler as (...args: any[]) => void);
    }

    emit<K extends keyof OcrEvents>(event: K, ...args: Parameters<OcrEvents[K]>): void {
        this.emitter.emit(event, ...args);
    }

    listenerCount(event: keyof OcrEvents): number {
        return this.emitter.listenerCount(event);
    }
}

// Use globalThis to survive HMR in Next.js dev mode.
const G = globalThis as typeof globalThis & {
    __ocrBuses?: Map<string, OcrEventBus>;
    __ocrLastProgress?: Map<string, OcrProgressEvent>;
    __suryaBuses?: Map<string, OcrEventBus>;
    __suryaLastProgress?: Map<string, OcrProgressEvent>;
};
if (!G.__ocrBuses) {
    G.__ocrBuses = new Map();
}
if (!G.__ocrLastProgress) {
    G.__ocrLastProgress = new Map();
}
if (!G.__suryaBuses) {
    G.__suryaBuses = new Map();
}
if (!G.__suryaLastProgress) {
    G.__suryaLastProgress = new Map();
}

const buses = G.__ocrBuses;
const lastProgress = G.__ocrLastProgress;
const suryaBuses = G.__suryaBuses;
const suryaLastProgress = G.__suryaLastProgress;

// macOCR event bus functions
export function ocrBus(jobId: string): OcrEventBus {
    const existing = buses.get(jobId);
    if (existing) {
        return existing;
    }
    const bus = new OcrEventBus();
    buses.set(jobId, bus);
    return bus;
}

export function getLastOcrProgress(jobId: string): OcrProgressEvent | null {
    return lastProgress.get(jobId) ?? null;
}

export function emitOcrProgress(jobId: string, ev: OcrProgressEvent): void {
    lastProgress.set(jobId, ev);
    const bus = ocrBus(jobId);
    console.info('[ocrEventBus.progress]', { jobId, line: ev.line, listeners: bus.listenerCount('progress') });
    bus.emit('progress', ev);
}

export function emitOcrComplete(jobId: string): void {
    const bus = ocrBus(jobId);
    console.info('[ocrEventBus.complete]', { jobId, listeners: bus.listenerCount('complete') });
    bus.emit('complete');
}

export function emitOcrError(jobId: string, message: string): void {
    const bus = ocrBus(jobId);
    console.info('[ocrEventBus.error]', { jobId, listeners: bus.listenerCount('error'), message });
    bus.emit('error', message);
}

// Surya event bus functions
export function suryaBus(jobId: string): OcrEventBus {
    const existing = suryaBuses.get(jobId);
    if (existing) {
        return existing;
    }
    const bus = new OcrEventBus();
    suryaBuses.set(jobId, bus);
    return bus;
}

export function getLastSuryaProgress(jobId: string): OcrProgressEvent | null {
    return suryaLastProgress.get(jobId) ?? null;
}

export function emitSuryaProgress(jobId: string, ev: OcrProgressEvent): void {
    suryaLastProgress.set(jobId, ev);
    const bus = suryaBus(jobId);
    console.info('[suryaEventBus.progress]', {
        jobId,
        line: ev.line,
        listeners: bus.listenerCount('progress'),
        phase: ev.phase,
    });
    bus.emit('progress', ev);
}

export function emitSuryaComplete(jobId: string): void {
    const bus = suryaBus(jobId);
    console.info('[suryaEventBus.complete]', { jobId, listeners: bus.listenerCount('complete') });
    bus.emit('complete');
}

export function emitSuryaError(jobId: string, message: string): void {
    const bus = suryaBus(jobId);
    console.info('[suryaEventBus.error]', { jobId, listeners: bus.listenerCount('error'), message });
    bus.emit('error', message);
}
