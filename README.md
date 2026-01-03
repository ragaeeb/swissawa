`swissawa` is a full-stack Next.js app for building an **OCR pipeline for Arabic Islamic books** distributed as PDFs, including **post-processing** and QA tooling.

[![Build and Version](https://github.com/ragaeeb/swissawa/actions/workflows/build.yml/badge.svg)](https://github.com/ragaeeb/swissawa/actions/workflows/build.yml)
[![codecov](https://codecov.io/gh/ragaeeb/swissawa/graph/badge.svg?token=YVZ3UV0KQN)](https://codecov.io/gh/ragaeeb/swissawa)
[![wakatime](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/5554cc8f-07db-497d-875e-bbbce568717b.svg)](https://wakatime.com/badge/user/a0b906ce-b8e7-4463-8bce-383238df6d4b/project/5554cc8f-07db-497d-875e-bbbce568717b)
[![Vercel Deploy](https://deploy-badge.vercel.app/vercel/swissawa)](https://swissawa.vercel.app)
[![Bun](https://img.shields.io/badge/bun-%3E%3D1.3.5-000000?logo=bun&logoColor=white)](https://bun.sh/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Next.js](https://img.shields.io/badge/next.js-16-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=000000)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/typescript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/tailwindcss-4.1-38B2AC?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Biome](https://img.shields.io/badge/biome-2.3-60A5FA?logo=biome&logoColor=white)](https://biomejs.dev/)
[![semantic-release](https://img.shields.io/badge/semantic--release-enabled-e10079?logo=semantic-release&logoColor=white)](https://semantic-release.gitbook.io/semantic-release/)
[![ESNext](https://img.shields.io/badge/target-ESNext-111827)](https://www.typescriptlang.org/tsconfig/#target)
[![Poppler](https://img.shields.io/badge/poppler-required-1f6feb)](https://poppler.freedesktop.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE.md)

- Repo: [ragaeeb/swissawa](https://github.com/ragaeeb/swissawa)

## Getting Started

### Requirements

- **Bun**: `>=1.3.5`
- **Node.js**: `>=24` (used by Next.js tooling; Bun is the package manager)
- **Poppler** (for fast PDF metadata + page rendering):
  - `pdfinfo`
  - `pdftocairo`

On macOS:

```bash
brew install poppler
```

### Run dev server

```bash
bun dev
```

Open `http://localhost:3000`.

### Tests

```bash
bun test
```

### Formatting / linting

```bash
bun run lint
bun run format
```

## Current functionality (baseline)

- **Drag & drop PDF upload** (streams to disk to support large PDFs)
- **Server-side PDF → low-res JPEG pages** using Poppler (`pdftocairo`)
- **Progress updates via SSE**
- **Image serving via API routes**, displayed using `next/image` for optimized rendering
- **Global crop**: draw a crop on one page and apply to all previews
- **Download cropped PDF** (server-generated; preserves page size by default)
- **Cleanup cached files** (delete uploaded PDF + extracted images)
- **Deduplication**: reuse extracted images across re-uploads via SHA-256 content hashing

Temporary files are written under `os.tmpdir()` (e.g. `.../T/swissawa/<jobId>/...` on macOS).

## API (App Router)

- `POST /api/upload`: upload a PDF (multipart/form-data), returns `{ jobId, sha256, reused }`
- `GET /api/jobs/:jobId/events`: SSE stream (`snapshot`, `pdf`, `progress`, `complete`, `error`)
- `GET /api/jobs/:jobId`: job status; optional paging via `?from=&to=`
- `DELETE /api/jobs/:jobId`: delete cached files for a job (temp dir + hash index) and evict in-memory state
- `GET /api/jobs/:jobId/images/:page`: serve a rendered JPEG page
- `GET /api/jobs/:jobId/crop`: get the saved crop (or `null`)
- `POST /api/jobs/:jobId/crop`: set the saved crop (`{ crop: { x,y,width,height } }`, normalized 0..1)
- `GET /api/jobs/:jobId/download`: download the original PDF if no crop, otherwise a cropped PDF
  - Optional: `?shrink=1` to physically shrink pages (can make scanned PDFs look “lower quality” due to extra zoom)

## Notes

- **Upload size limit**: controlled by `SWISSAWA_MAX_UPLOAD_BYTES` (defaults to 64MB).

## Project goal / roadmap (high-level)

The long-term intent is to support:

- Arabic OCR workflows (layout-aware, RTL-friendly)
- Post-processing (normalization, diacritics handling, tokenization, line/paragraph reconstruction)
- QA tooling (diffs against ground truth, confidence heatmaps, error review queues)

See `AGENTS.md` for a guided architecture map, pitfalls, and development conventions.

## Future ideas (serverless-ready architecture)

Today’s baseline implementation is optimized for local/dev and a traditional server:

- Uses **Poppler** binaries (`pdfinfo`, `pdftocairo`)
- Writes to `os.tmpdir()`
- Uses an in-memory job store
- Streams progress via **SSE**

This is not a great fit for pure serverless platforms (e.g. Vercel/Netlify) due to ephemeral disk, cold starts/scale-out, execution time limits, and long-lived connections.

Some options to make this serverless-friendly:

- **Direct-to-storage upload + external worker (recommended)**:
  - Use [UploadThing](https://uploadthing.com/) for browser → storage uploads (your server only authenticates/authorizes)
  - Trigger background processing via a worker/queue (e.g. Trigger.dev) to:
    - download the PDF
    - render page images
    - write progress + outputs to durable storage (S3/R2/UploadThing/etc.)
  - Frontend reads progress from a DB/KV (polling or SSE that only reads state)

- **Pure JS/WASM rendering in serverless**:
  - Replace Poppler with a PDF renderer that runs without native binaries (often pdf.js-based)
  - Still requires durable storage for the PDF + images and persistent job state

- **Hybrid hosting**:
  - Keep the Next.js web app on Vercel/Netlify, but run the extraction/OCR worker on a container VM (Fly.io/Render/Railway)
  - Keep progress + artifacts in a DB/object storage so the UI remains stateless

## License

MIT — see [`LICENSE.md`](LICENSE.md).

# Inspiration

The name of the project comes from Suhayla: a food that is both sweet and sour at the same time.