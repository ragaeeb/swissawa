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

- **Bun**: `>=1.3.9`
- **Node.js**: `>=24`
- **Poppler** (PDF rendering): `pdfinfo`, `pdftocairo`
- **macOCR** (Arabic OCR): macOS Vision-based CLI with `--diagnostics` support
- **Surya OCR v1** (optional): pinned legacy ML adapter with GPU acceleration

On macOS:

```bash
brew install poppler
```

### Optional: Surya OCR Setup

The current adapter consumes Surya v1's `text_lines` output. Surya 2 uses a
different `blocks` schema and model-server runtime, so do not install an
unbounded latest version into this environment:

```bash
python3 -m venv ~/surya-env
source ~/surya-env/bin/activate
pip install "surya-ocr==0.17.1"
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
- **Auditable OCR Evidence**: Paged output retains stable source IDs, unchanged raw text, UTF-16 ranges, Vision candidates, and Surya localization evidence. Suggested edits are stored separately and never mutate OCR text.
- **Canonical Review Raster**: Page-level review workflows can render and cache one pinned 200-DPI sRGB PNG, attach PDF font-substitution provenance, and pass the exact same bytes to macOCR and Surya. The existing whole-document API still uses its legacy PDF path until page-number semantics are migrated.
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
- `GET /api/jobs/:jobId/ocr/file`: Fetch full OCR JSON file.

### UploadThing
- `POST /api/uploadthing`: UploadThing route handler.
- `POST /api/uploadthing/ingest`: Convert UploadThing file key into a swissawa job.

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

## Remote OCR (PAT-first)

This repo supports a cloud-offloaded macOCR backend using GitHub Actions.

### Environment variables

Current runtime auth in this repo is **PAT-first** (`SWISSAWA_GH_PAT`).  
The auth layer is abstracted so you can migrate to GitHub App tokens later without changing provider call sites.

Use this as a copy/paste baseline:

```bash
# OCR backend mode
SWISSAWA_MAC_OCR_BACKEND=local

# Remote OCR (required only when SWISSAWA_MAC_OCR_BACKEND=github_actions)
SWISSAWA_GH_PAT=
SWISSAWA_GH_OCR_REPO=ragaeeb/macOCR
SWISSAWA_GH_OCR_WORKFLOW=ocr-remote.yml
SWISSAWA_GH_OCR_REF=main
SWISSAWA_GH_OCR_POLL_INTERVAL_MS=5000
SWISSAWA_GH_OCR_TIMEOUT_MS=900000

# Upload mode
UPLOADTHING_TOKEN=
NEXT_PUBLIC_SWISSAWA_UPLOAD_MODE=direct
```

### How to get each value

- `SWISSAWA_MAC_OCR_BACKEND`:
  - `local` keeps classic DX (local upload + local macOCR).
  - `github_actions` offloads macOCR to GitHub Actions.
- `SWISSAWA_GH_PAT`:
  - Create a token in GitHub settings.
  - Fine-grained PAT (preferred): grant repository **Actions: Read and write** on the OCR repo.
  - If using classic PAT with private repos, `repo` scope works.
- `SWISSAWA_GH_OCR_REPO`:
  - `<owner>/<repo>` of the remote OCR repo (for example `ragaeeb/macOCR`).
- `SWISSAWA_GH_OCR_WORKFLOW`:
  - Workflow file name in that repo (for example `ocr-remote.yml`).
- `SWISSAWA_GH_OCR_REF`:
  - Git ref to dispatch against (usually `main`).
- `SWISSAWA_GH_OCR_POLL_INTERVAL_MS`:
  - How often swissawa polls run status. Start with `5000`.
- `SWISSAWA_GH_OCR_TIMEOUT_MS`:
  - Max wait before timeout. Default `900000` (15 minutes).
- `UPLOADTHING_TOKEN`:
  - In UploadThing dashboard, open your app and copy the token from **API Keys**.
  - For v7 this is a single token carrying app info + secret.
- `NEXT_PUBLIC_SWISSAWA_UPLOAD_MODE`:
  - `direct` uses current server upload route.
  - `uploadthing` uses UploadThing client upload + `/api/uploadthing/ingest`.

### PAT setup (current runtime path)

1. Open GitHub Settings -> Developer settings -> Personal access tokens.
2. Create a fine-grained token (recommended) scoped to your OCR repo.
3. Grant repository permission: `Actions: Read and write`.
4. Save token as `SWISSAWA_GH_PAT` in your environment.
5. Set `SWISSAWA_MAC_OCR_BACKEND=github_actions` and test `POST /api/jobs/:jobId/ocr`.

### GitHub App setup (recommended for production, migration-ready)

The app code currently uses PAT auth at runtime.  
Use this section to prepare migration values and install the app with correct permissions.

1. Create app:
   - GitHub -> Settings -> Developer settings -> GitHub Apps -> New GitHub App.
   - Set name and homepage URL.
   - Webhook: keep **inactive** for polling-only MVP.
   - Visibility: choose private ("Only on this account") unless you need multi-account installs.
2. Configure repository permissions (minimum for this OCR flow):
   - `Actions: Read and write` (dispatch workflows + read runs/artifacts).
   - `Contents: Read` (repo metadata/workflow context reads).
   - `Metadata: Read` is included automatically.
3. Install app:
   - Open the app settings page -> `Install App`.
   - Install on the account/org owning the OCR repo.
   - Choose target repo(s), including your OCR repo.
4. Generate private key:
   - In app settings, under `Private keys`, click `Generate a private key`.
   - Download and store it securely (GitHub only stores the public portion).
5. Record IDs:
   - `App ID`: on the app settings page.
   - `Installation ID`: get via API (`GET /repos/{owner}/{repo}/installation`) or from app installation context.
6. Keep migration env names ready (planned, not active in runtime yet):
   - `SWISSAWA_GH_APP_ID`
   - `SWISSAWA_GH_APP_PRIVATE_KEY`
   - `SWISSAWA_GH_APP_INSTALLATION_ID`

### Local DX defaults

- Keep local upload + local macOCR:
  - `SWISSAWA_MAC_OCR_BACKEND=local`
  - `NEXT_PUBLIC_SWISSAWA_UPLOAD_MODE=direct`

### Deployed cloud mode

- Use UploadThing ingest + GitHub Actions OCR:
  - `SWISSAWA_MAC_OCR_BACKEND=github_actions`
  - `NEXT_PUBLIC_SWISSAWA_UPLOAD_MODE=uploadthing`

Auth decision and migration notes to GitHub App are documented in:
`docs/decisions/0001-remote-ocr-auth.md`.

### Reference docs (verified)

- GitHub workflow dispatch endpoint and required permissions:
  - <https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event>
- GitHub workflow runs:
  - <https://docs.github.com/en/rest/actions/workflow-runs>
- GitHub artifacts:
  - <https://docs.github.com/en/rest/actions/artifacts>
- Registering a GitHub App:
  - <https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app>
- Choosing GitHub App permissions:
  - <https://docs.github.com/apps/creating-github-apps/setting-up-a-github-app/choosing-permissions-for-a-github-app>
- Installing your own GitHub App:
  - <https://docs.github.com/en/developers/apps/managing-github-apps/installing-github-apps>
- Managing GitHub App private keys:
  - <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps>
- Generating installation access tokens:
  - <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app>
- UploadThing v7 token model:
  - <https://docs.uploadthing.com/v7>
- UploadThing docs home:
  - <https://docs.uploadthing.com/>

## License

MIT — see [`LICENSE.md`](LICENSE.md).

# Inspiration

The name comes from Suhayla: a food that is both sweet and sour at the same time.
