import type { BoundingBox, Observation } from 'kokokor';
import { reconstructParagraphs } from 'kokokor';
import type { Coordinates, ObservationPage } from '@/lib/macOcr';
import type { SkaluPage } from '@/lib/skalu';

export type OcrPageText = { lines: string; paragraphs: string };
export type PageLayout = { horizontalLines: BoundingBox[]; rectangles: BoundingBox[] };
export type PageLayoutsByPage = Record<number, PageLayout>;

const isArabicLetter = (character: string) => /\p{Letter}/u.test(character) && /\p{Script=Arabic}/u.test(character);

const hasNonArabicLetters = (text: string) =>
    [...text.normalize('NFKC')].some(
        (character) => /\p{Letter}/u.test(character) && !/\p{Script=Arabic}/u.test(character),
    );

const hasArabicText = (text: string, minimumLetterCount = 2) => {
    let count = 0;
    for (const character of text.normalize('NFKC')) {
        if (isArabicLetter(character)) {
            count++;
            if (count >= minimumLetterCount) {
                return true;
            }
        }
    }
    return false;
};

const hasMinimumContent = (observation: Observation) =>
    observation.text.normalize('NFKC').replace(/[،,؛;؟?۔.:\-()]/g, '').length > 1;

const sharesTextLineVertically = (first: Observation, second: Observation) => {
    const firstBottom = first.bbox.y + first.bbox.height;
    const secondBottom = second.bbox.y + second.bbox.height;
    return first.bbox.y < secondBottom && second.bbox.y < firstBottom;
};

const isUsefulNumericFragment = (observation: Observation, arabicObservations: Observation[]) => {
    const numberCount = [...observation.text.normalize('NFKC')].filter((character) =>
        /\p{Number}/u.test(character),
    ).length;
    if (numberCount === 0) {
        return false;
    }
    return (
        numberCount >= 2 ||
        hasArabicText(observation.text, 1) ||
        arabicObservations.some((arabicObservation) => sharesTextLineVertically(observation, arabicObservation))
    );
};

export const filterArabicPageObservations = <T extends Observation>(observations: T[]) => {
    const meaningful = observations.filter(hasMinimumContent);
    const arabicObservations = meaningful.filter((observation) => hasArabicText(observation.text));
    if (arabicObservations.length === 0) {
        return [];
    }
    const arabicSet = new Set(arabicObservations);

    return meaningful.filter(
        (observation) =>
            arabicSet.has(observation) ||
            (!hasNonArabicLetters(observation.text) && isUsefulNumericFragment(observation, arabicObservations)),
    );
};

export const mapSkaluLayoutsByPage = (pages: SkaluPage[]): PageLayoutsByPage => {
    const byPage: PageLayoutsByPage = {};
    for (const page of pages) {
        if (!Number.isInteger(page.page) || page.page <= 0) {
            continue;
        }
        byPage[page.page] = {
            horizontalLines: Array.isArray(page.horizontal_lines) ? page.horizontal_lines : [],
            rectangles: Array.isArray(page.rectangles) ? page.rectangles : [],
        };
    }
    return byPage;
};

export const pageToOcrPageText = (params: {
    dpi: Coordinates;
    layout: Partial<PageLayout>;
    page: ObservationPage;
}): OcrPageText => {
    const { dpi, layout, page } = params;
    const observations = filterArabicPageObservations(page.observations);
    const lines = observations.map((observation) => observation.text).join('\n');
    if (observations.length === 0) {
        return { lines: '', paragraphs: '' };
    }

    try {
        const reconstructed = reconstructParagraphs({
            layout: { horizontalLines: layout.horizontalLines ?? [], rectangles: layout.rectangles ?? [] },
            observations,
            page: { dpiX: dpi.x, dpiY: dpi.y, height: page.height, width: page.width },
        });
        return { lines, paragraphs: reconstructed.text || lines };
    } catch {
        return { lines, paragraphs: lines };
    }
};
