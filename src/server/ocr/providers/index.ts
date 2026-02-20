import { GithubActionsMacOcrProvider } from '@/server/ocr/providers/githubActionsMacOcrProvider';
import { LocalMacOcrProvider } from '@/server/ocr/providers/localMacOcrProvider';
import type { MacOcrProvider } from '@/server/ocr/providers/macOcrProvider';

export function getMacOcrProvider(): MacOcrProvider {
    const backend = process.env.SWISSAWA_MAC_OCR_BACKEND ?? 'local';
    if (backend === 'github_actions') {
        return new GithubActionsMacOcrProvider();
    }
    return new LocalMacOcrProvider();
}
