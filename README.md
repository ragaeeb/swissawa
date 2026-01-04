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
- **Node.js**: `>=24`
- **Poppler** (PDF rendering): `pdfinfo`, `pdftocairo`
- **macOCR** (Arabic OCR): macOS Vision-based CLI tool
- **Surya OCR** (optional): ML-based OCR with GPU acceleration

On macOS:

```bash
brew install poppler
```

### Optional: Surya OCR Setup

For ML-based OCR with GPU (MPS) acceleration:

```bash
python3 -m venv ~/surya-env
source ~/surya-env/bin/activate
pip install surya-ocr
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

## Current functionality

- **Flexible PDF Ingest**: Upload via drag & drop or provide a remote URL for server-side download.
- **Fast Page Extraction**: Parallelized PDF-to-JPEG rendering using Poppler.
- **Global Cropping**: Define a crop box once and apply it to the entire book.
- **Dual OCR Engines**: Choose between macOCR (Vision), Surya (ML), or run both in parallel.
- **Engine Selection UI**: Dropdown to select "Both Engines", "macOCR Only", or "Surya Only".
- **GPU Acceleration**: Surya uses MPS (Metal) on M-series Macs with automatic CPU fallback.
- **Side-by-Side Comparison**: When running both engines, results appear in adjacent columns for comparison.
- **Real-time Feedback**: SSE-powered progress bars showing actual percentages for each engine.
- **Deduplication**: SHA-256 hashing avoids re-processing identical files.
- **Arabic-First UI**: Optimized typography using `IBM Plex Sans Arabic` and RTL-aware layout.

## API (App Router)

### Ingest & Jobs
- `POST /api/upload`: Upload PDF (multipart).
- `POST /api/upload-url`: Provide a PDF URL to fetch.
- `GET /api/jobs/:jobId`: Job status and metadata.
- `GET /api/jobs/:jobId/events`: Extraction progress (SSE).
- `DELETE /api/jobs/:jobId`: Cleanup all files and state.

### Images & Crop
- `GET /api/jobs/:jobId/images/:page`: Serve rendered JPEG.
- `POST /api/jobs/:jobId/crop`: Save global crop.
- `GET /api/jobs/:jobId/download`: Download cropped PDF.

### OCR (macOCR)
- `POST /api/jobs/:jobId/ocr`: Trigger `macOCR` process.
- `GET /api/jobs/:jobId/ocr`: Check OCR status.
- `GET /api/jobs/:jobId/ocr/events`: OCR progress stream (SSE).
- `GET /api/jobs/:jobId/ocr/pages/:page`: Fetch extracted text for a specific page.

### OCR (Surya)
- `POST /api/jobs/:jobId/surya`: Trigger Surya OCR process.
- `GET /api/jobs/:jobId/surya`: Check Surya status.
- `GET /api/jobs/:jobId/surya/events`: Surya progress stream (SSE).
- `GET /api/jobs/:jobId/surya/pages/:page`: Fetch Surya text for a specific page.

## Roadmap

- Layout-aware OCR (preserving columns/paragraphs).
- Text post-processing (normalization, diacritics).
- QA/diffing tools for ground truth verification.

See `AGENTS.md` for deep-dive architecture notes and development pitfalls.

## License

MIT — see [`LICENSE.md`](LICENSE.md).

# Inspiration

The name comes from Suhayla: a food that is both sweet and sour at the same time.
