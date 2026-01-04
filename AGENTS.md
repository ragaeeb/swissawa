# Agents guide (`swissawa`)

This file is for AI coding agents (and humans) to quickly understand the intent of this repo, where things live, and how to safely make changes.

Repo: [ragaeeb/swissawa](https://github.com/ragaeeb/swissawa)

## Intent

`swissawa` aims to support an OCR workflow for **Arabic Islamic books** in PDF form, plus the post-processing and QA steps required to produce high-quality text.

This repo includes a baseline “PDF → page images” pipeline, a global cropping tool, and an OCR engine:

- **PDF Ingest**: Upload a file (streamed) or provide a URL (server-side download).
- **Processing**: Extract metadata + render pages to low-res JPEGs using Poppler.
- **Global Crop**: Set a `CropBox` (normalized 0..1) applied to all pages.
- **OCR Engine**: Run `macOCR` (macOS Vision-based) on the cropped PDF.
- **Side-by-side UI**: View scanned page images next to extracted Arabic text (optimized with `IBM Plex Sans Arabic`).
- **Progress Tracking**: Real-time progress for both extraction and OCR via Server-Sent Events (SSE).
- **Deduplication**: SHA-256 hashing to reuse processing artifacts for identical PDFs.
- **Dual OCR Engines**: Supports both macOCR (macOS Vision) and Surya (ML-based) with parallel execution.

## Tech constraints / conventions

- **Package manager**: Bun (`bun@>=1.3.5`)
- **Runtime / tooling**: Node.js `>=24` (Next.js tooling)
- **TypeScript target**: `ESNext` (see `tsconfig.json`)
- **Formatting/Lint**: Biome (`bun run lint`, `bun run format`)
- **API routing**: **App Router** route handlers under `src/app/api/**` (avoid `pages/api`)
- **Typography**: Arabic text uses `IBM Plex Sans Arabic` for legibility.

## Local requirements

- **Poppler**: `pdfinfo`, `pdftocairo`
- **macOCR**: CLI tool for macOS Vision-based OCR.

On macOS:

```bash
brew install poppler
# macOCR must be in PATH
```

- **Surya OCR**: Python-based OCR with ML models. Requires virtual environment at `~/surya-env`:

```bash
python3 -m venv ~/surya-env
source ~/surya-env/bin/activate
pip install surya-ocr
```

## Key flows

### Upload/URL → extract → progress

1. Browser uploads PDF to `POST /api/upload` or submits URL to `POST /api/upload-url`.
2. Server streams/downloads the file to `os.tmpdir()` under `swissawa/<jobId>/input.pdf`.
3. Background job:
   - runs `pdfinfo` for metadata
   - runs `pdftocairo` in parallel to generate JPEGs
4. Browser opens `GET /api/jobs/:jobId/events` (SSE) for progress.

### Crop → OCR → View

1. User sets a global crop in the UI (`CropBox` 0..1).
2. Server saves crop to `ocr/crop.json`.
3. User runs OCR via `POST /api/jobs/:jobId/ocr` (macOCR) or `POST /api/jobs/:jobId/surya`:
   - Server crops the PDF using `pdf-lib`.
   - Server spawns `macOCR --language ar-SA` or `surya_ocr --disable_math`.
   - Progress is streamed via `/ocr/events` or `/surya/events`.
   - **Parallel execution**: Select "Both Engines" in UI to run both simultaneously.
4. Browser fetches paged results via `/ocr/pages/:page` or `/surya/pages/:page`.

## Important paths

- **UI**: `src/app/page.tsx`, `src/components/PageOcrTable.tsx`
- **API routes**:
  - `src/app/api/upload/route.ts` & `/upload-url/route.ts`
  - `src/app/api/jobs/[jobId]/events/route.ts` (Extraction SSE)
  - `src/app/api/jobs/[jobId]/ocr/route.ts` (Start OCR / Status)
  - `src/app/api/jobs/[jobId]/ocr/events/route.ts` (OCR SSE)
  - `src/app/api/jobs/[jobId]/ocr/pages/[page]/route.ts` (Get OCR text)
  - `src/app/api/jobs/[jobId]/surya/route.ts` (Start Surya OCR / Status)
  - `src/app/api/jobs/[jobId]/surya/events/route.ts` (Surya SSE)
  - `src/app/api/jobs/[jobId]/surya/pages/[page]/route.ts` (Get Surya text)
- **OCR Logic**: `src/server/ocr/runMacOcr.ts`, `src/server/ocr/runSuryaOcr.ts`, `src/server/ocr/ocrEventBus.ts`
- **Job store**: `src/server/jobs/jobStore.ts` (in-memory + filesystem fallback)

## Lessons learned / common pitfalls (CRITICAL)

- **Next.js HMR resets module state**: In development, `globalThis` MUST be used to store event buses or singleton stores that need to persist across reloads (see `ocrEventBus.ts`).
- **CLI Output Buffering**: Many CLI tools (like `macOCR`) buffer stdout when piped. Use `script -q /dev/null <cmd>` on macOS to force line-buffering so SSE can show real-time progress.
- **Arabic Typography**: Standard fonts like "Amiri" are hard to read in digital tables. `IBM Plex Sans Arabic` is currently preferred. Always use `dir="rtl"` and `text-right` for Arabic content.
- **SSE Missed Events**: If a process finishes before the SSE client connects, the client might hang. Always check current status immediately upon SSE connection and send a terminal event if already finished.
- **Race Conditions in React**: When fetching paged data (like OCR text per row), use `AbortController` in `useEffect` to prevent setting state for a job/page that is no longer active.
- **Build Safety with SearchParams**: Using `useSearchParams()` at the root level of a page causes Next.js to bail out of static rendering. Use manual `window.location` parsing or wrap in `<Suspense>` to keep the build safe.
- **Surya Virtual Environment**: Surya runs in a Python venv at `~/surya-env`. The runner activates it via `bash -c "source ... && surya_ocr ..."`.
- **GPU Fallback**: Surya prefers MPS (Metal) on macOS but falls back to CPU if MPS fails. Set `TORCH_DEVICE` environment variable accordingly.
- **Large JSON Filtering**: Surya outputs massive results.json with character-level data. Filter using `filterSuryaRawOutput()` to strip `chars`, `confidence`, `polygon`, `words` before storage.
- **Surya Page Indexing**: Surya's `results.json` uses **1-indexed** pages (`"page": 1` for first page). Do NOT add +1 when converting to ObservationPage format - they're already 1-indexed.
- **AbortError in React**: When fetching data in `useEffect`, wrap fetch in try-catch and silently return `null` for AbortError. Otherwise component unmounts spam the console with errors.
- **Progress UI Priority**: When showing progress, prioritize the raw `line` field (contains actual percentages like "25%|████") over generic `phase` labels. Users want to see real progress, not just "Recognizing text…".
- **Dual SSE Connections**: When running both OCR engines, each engine has its own SSE endpoint. Use separate `EventSource` refs and ensure cleanup in `useEffect` return function.

## Debugging tips for future agents

- **Check surya output location**: Surya outputs to `<outputDir>/input/results.json` (where `input` is derived from `input.pdf` basename). Not directly in `<outputDir>`.
- **Verify page JSON files**: If pages show "Loading..." after OCR completes, check that `surya/pages/1.json` exists. If it's missing but `2.json` exists, there's an indexing bug.
- **Test with real results.json**: Copy actual Surya output (`results.json`) to project root and inspect the `page` field values directly - don't assume they're 0-indexed.
- **SSE debugging**: Add console.info in `createEventSource` to see connection/disconnect events. Check for `[jobs.surya.sse.connect]` logs on the server.
- **CPU spinning after completion**: If observed, check that child processes are properly terminated. The `spawn` mock in tests should verify cleanup.

## Performance notes

- **Chunked Extraction**: Extraction is parallelized based on CPU count.
- **Paged OCR results**: OCR JSON can be massive (MBs of data). Never send the full JSON in one request; use the paged API (`/ocr/pages/:page`).
- **Disk Persistence**: Always write a `snapshot.json` to the job directory. This allows the server to recover job state if the Node process restarts.

## License

MIT — see `LICENSE.md`.
