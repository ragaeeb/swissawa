export type Coordinates = { x: number; y: number };

export type Size = { readonly height: number; readonly width: number };

export type BoundingBox = Size & { x: number; y: number };

export type Observation = { bbox: BoundingBox; text: string; confidence?: number };

export type ObservationPage = Size & { page: number; observations: Observation[] };

export type MacOCR = { pages: ObservationPage[]; dpi: Coordinates };
