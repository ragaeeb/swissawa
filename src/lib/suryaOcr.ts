/**
 * TypeScript types for Surya OCR output.
 * Based on the filtered surya.json format after stripping character-level data.
 */

/** Axis-aligned bounding box in (x1, y1, x2, y2) format */
export type SuryaBBox = [number, number, number, number];

/** A single text line detected by Surya */
export type SuryaTextLine = {
    /** the axis-aligned rectangle for the text line in (x1, y1, x2, y2) format */
    readonly bbox: SuryaBBox;
    /** the text in the line */
    readonly text: string;
};

/** OCR result for a single page */
export type SuryaPageOcrResult = {
    /** The bbox for the image in (x1, y1, x2, y2) format */
    readonly image_bbox: SuryaBBox;
    /** The page number in the file (0-indexed from surya) */
    readonly page: number;
    /** The detected text and bounding boxes for each line */
    readonly text_lines: SuryaTextLine[];
};

/**
 * Raw surya results.json output before filtering.
 * Record where key is filename without extension, value is array of page results.
 */
export type SuryaRawOutput = Record<string, SuryaPageOcrResult[]>;

/**
 * Filtered surya.json output after jq-like processing.
 * Same structure but with character-level data stripped.
 */
export type SuryaOcrOutput = Record<string, SuryaPageOcrResult[]>;
