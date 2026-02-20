import type { MacOcrProvider, StartMacOcrParams } from '@/server/ocr/providers/macOcrProvider';
import { runMacOcr } from '@/server/ocr/runMacOcr';

export class LocalMacOcrProvider implements MacOcrProvider {
    async start(params: StartMacOcrParams): Promise<void> {
        await runMacOcr(params);
    }
}
