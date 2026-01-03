# Agents guide (`swissawa`)

This file is for AI coding agents (and humans) to quickly understand the intent of this repo, where things live, and how to safely make changes.

Repo: [ragaeeb/swissawa](https://github.com/ragaeeb/swissawa)

## Intent

`swissawa` aims to support an OCR workflow for **Arabic Islamic books** in PDF form, plus the post-processing and QA steps required to produce high-quality text.

This repo currently includes a baseline “PDF → page images” pipeline, plus early “crop + download” tooling:

- Upload a PDF (streamed to disk for large files)
- Extract metadata + render pages to low-res JPEGs
- Stream progress to the browser via SSE
- Display page previews using `next/image`
- Set a **global crop** (draw once, applied to all previews)
- Download the **cropped PDF** from the server
- Cleanup cached files (delete temp dir + dedupe index)

## Tech constraints / conventions

- **Package manager**: Bun (`bun@>=1.3.5`)
- **Runtime / tooling**: Node.js `>=24` (Next.js tooling)
- **TypeScript target**: `ESNext` (see `tsconfig.json`)
- **Formatting/Lint**: Biome (`bun run lint`, `bun run format`)
- **API routing**: **App Router** route handlers under `src/app/api/**` (avoid `pages/api`)

## Local requirements

- Poppler must be available on the machine:
  - `pdfinfo`
  - `pdftocairo`

On macOS:

```bash
brew install poppler
```

## Key flows

### Upload → extract → progress

1. Browser uploads PDF to `POST /api/upload` (multipart/form-data).
2. Server streams the file to `os.tmpdir()` under `swissawa/<jobId>/input.pdf`.
3. Background job:
   - runs `pdfinfo` to collect metadata and total pages
   - runs `pdftocairo` in **chunked + parallel** mode to generate low-res JPEG pages
4. Browser opens `GET /api/jobs/:jobId/events` and receives:
   - `snapshot` (initial job state)
   - `pdf` (metadata)
   - `progress` updates
   - `complete` or `error`

### Crop → apply to previews → download

- Crop is stored as a normalized `CropBox` (`x,y,width,height` in **0..1**, top-left origin).
- UI uses `react-image-crop`; server-side download uses `pdf-lib` to set `CropBox`/`TrimBox` (and optionally `MediaBox`).
- Download endpoint: `GET /api/jobs/:jobId/download`
  - Default preserves original page size (avoids “looks lower quality” surprises on scanned PDFs)
  - Optional `?shrink=1` physically shrinks pages (viewer may auto-zoom more)

### Cleanup

- Cleanup endpoint: `DELETE /api/jobs/:jobId`
  - Removes `os.tmpdir()/swissawa/<jobId>/...`
  - Removes any `os.tmpdir()/swissawa/by-hash/<sha256>.json` records pointing at that jobId
  - Evicts in-memory job state

### Image file naming gotcha (important)

Poppler often writes images using **zero-padded page numbers**, e.g.:

- `page-001.jpg`, `page-040.jpg`, `page-108.jpg`

The resolver in `src/server/pdf/imageResolve.ts` exists specifically to prevent regressions where the server tries to serve `page-1.jpg` and returns 404s.

## Important paths

- **UI**: `src/app/page.tsx`
- **API routes**:
  - `src/app/api/upload/route.ts`
  - `src/app/api/jobs/[jobId]/events/route.ts` (SSE)
  - `src/app/api/jobs/[jobId]/route.ts` (status)
  - `src/app/api/jobs/[jobId]/images/[page]/route.ts` (serve JPEG)
  - `src/app/api/jobs/[jobId]/crop/route.ts` (get/set crop)
  - `src/app/api/jobs/[jobId]/download/route.ts` (download original/cropped PDF)
- **Job store**: `src/server/jobs/jobStore.ts`
- **Temp paths**: `src/server/jobs/jobPaths.ts`
- **Job snapshots**: `src/server/jobs/jobSnapshot.ts` (persist job state on disk for refresh/HMR)
- **Dedupe index**: `src/server/jobs/hashIndex.ts` (sha256 → jobId)
- **Crop persistence**: `src/server/crop/cropStore.ts`
- **Crop PDF generation**: `src/server/pdf/cropPdf.ts`
- **PDF parsing**: `src/server/pdf/pdfInfo.ts`
- **PDF extraction**: `src/server/pdf/runner.ts`, `src/server/pdf/extract.ts`
- **Image resolution**: `src/server/pdf/imageResolve.ts` (+ regression tests)

## Tests

Run:

```bash
bun test
```

Guideline:
- Add unit tests for any parsing/formatting/path logic and for bug regressions (e.g., padding logic, directory inference).
- Avoid component tests for now (no React Testing Library yet).

## Lessons learned / common pitfalls (read this first)

- **Poppler filename padding**: Poppler often writes `page-001.jpg`. Always resolve images via `src/server/pdf/imageResolve.ts` to avoid 404s after extraction.
- **Dev refresh/HMR resets memory**: The in-memory job store can disappear; always keep filesystem fallbacks (job snapshot + image resolver).
- **Deduplication needs cleanup**: If you delete a job dir but leave its `by-hash` record, future uploads will “reuse” a dead jobId. Cleanup must remove both.
- **react-image-crop callback gotcha**: `onComplete(pixelCrop, percentCrop)`—using the wrong arg causes crop “jumping” on mouse-up.
- **Crop units mismatch**: UI percent crop is **0..100**, server crop box is **0..1**. Conversions live in `src/lib/cropConvert.ts`.
- **Thumbnails vs crop**: `object-cover` will “pre-crop” before `clip-path`. Use `object-contain` if you want the crop to visually match saved values.
- **Cropped PDF “quality”**: Shrinking `MediaBox` makes viewers auto-zoom more; default download preserves page size and uses `TrimBox`/`CropBox`.

## Latest achievements (so you know what’s already done)

- **Upload + SSE progress** (App Router) with Poppler extraction (chunked + parallel).
- **Persistent resume** via job snapshots on disk + hash-based dedupe.
- **Global crop UI** using `react-image-crop` + server storage.
- **Download cropped PDF** via `pdf-lib` (+ caching; optional `?shrink=1`).
- **Cleanup endpoint + UI** to delete cached files and dedupe records.

## Performance notes

Arabic books can be thousands of pages.

- Prefer **paged / progressive UI** (don’t return an array of 10k URLs in one JSON response).
- In the backend, keep extraction chunked and parallelized (CPU-bound; concurrency should be tied to CPU count).
- Keep images low-res/low-quality by default; allow later tuning.

## Safety / future hardening

This code currently stores uploads under `os.tmpdir()` and keeps job state in-memory for simplicity.
Before productionizing:

- Add job persistence and cleanup (TTL) for tmp dirs
- Add upload limits, auth, and CSRF protections as needed
- Consider queueing / rate-limiting / per-job concurrency caps
- Validate PDFs more robustly (malformed PDFs, encrypted PDFs)

## License

MIT — see `LICENSE.md`.


