import type { BoundingBox, Size } from 'kokokor';

export type SkaluPage = Size & { horizontal_lines?: BoundingBox[]; page: number; rectangles?: BoundingBox[] };

export type SkaluApiResponse = { result_data: { pages: SkaluPage[] } };

export type AnalyzeApiResponse = { pages: SkaluPage[] };
