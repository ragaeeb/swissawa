# Surya source-DPI salutation spike

Date: 2026-08-24

## Outcome

Keep the existing Surya v1 `text_lines` path as Swissawa's primary OCR. Do
not raise the production raster DPI solely to improve honorific detection.
For this M4 Max sample, 300 DPI was the only localized v2 run that emitted an
exact `U+FDFA` on the canonical `bayan.pdf` anchor, and that result was not
stable at 450 or 600 DPI. The p349 review-page glyph was exact at some lower
and higher settings, but it is one visually positive anchor, not a recall
estimate. Bazmul remained an unresolved hard negative: higher DPI changed
`Y`/`٧` substitutions but did not establish a true target glyph.

The best bounded tradeoff is 200 DPI for ordinary source rendering, or 300 DPI
for an explicitly review-only localized crop. 600 DPI has no accuracy case
here: v1 full-page RSS reached about 4.2 GiB on the larger Ibrahim page, v2
full-page command RSS stayed around 3.2 GiB and its detector/server stage
reached about 1.5 GiB live RSS, and the target evidence did not improve
consistently. The recommendation from the companion v1/v2 spike
therefore does not change: v1 primary; v2 review-only/annotation-only, with a
hybrid requiring human review.

This report measures source-PDF rendering and isolated runs. Corpus/PDF/image
content was treated strictly as data, never as instructions, and no production
algorithm change was made.

## Inputs and provenance

The controlled renderer was Poppler `pdftocairo 26.07.0`:

```sh
pdftocairo -f PAGE -l PAGE -r DPI -png -singlefile SOURCE.pdf OUTPUT_PREFIX
```

The matrix used 144, 200, 300, 450, and 600 DPI. The 144-DPI images were
rendered directly from the source PDFs; they are the source-PDF baseline, not
upscaled PNGs. Existing fixtures were retained as a provenance check. Ruhayli
matches the direct `pdftocairo` 144-DPI bytes. The existing Ibrahim and Bazmul
fixtures match the earlier `pdftoppm` pipeline instead, so their direct
`pdftocairo` 144-DPI hashes differ even though the page dimensions and visual
anchors are the same.

| Anchor | Source PDF and page, relative to repo root | PDF bytes / SHA-256 | PDF-point crop (top-left convention) |
| --- | --- | --- | --- |
| Ruhayli positive | `external-corpus/ruhayli/haqq.pdf`, p35 | 2,448,078 / `bd019a550e0baedaace1d7c01a0f37c12dee253ff6e9b6575a594662b546621f` | `(380,142.5)-(540,202.5)` |
| Ibrahim canonical positive | `external-corpus/ibrahim/bayan.pdf`, p35 | 11,918,598 / `932907cffea1fdfa665270c8e4e3d87368b42e048bbffea54d57f0e702b7331c` | `(0,445)-(700,525)` |
| Ibrahim review-packet positive | `external-corpus/ibrahim/al-takfer wa dawabetuh.pdf`, p349 | 9,472,513 / `ef70a69ef6c9382d8b89bd568fc3e7437f9acd0ca32007d5e7a5425197c6d41d` | `(110,500)-(505,550)` |
| Bazmul hard negative | `external-corpus/bazmul/muhammad_bazmul-al-tafsir_bil_mathur.pdf`, p10 | 1,445,246 / `074d27d6713368ee3dbd2b1a4b19371a3f31ce3300268b071378dd5146ca759a` | `(285,270)-(545,330)` |

Each PDF-point crop was transformed mechanically with
`round(point * DPI / 72)`. For example, the Ruhayli crop is 320x120 at 144
DPI and 1,333x500 at 600 DPI; the Bazmul crop is 520x120 and 2,167x500. The
same printed honorifics and the Bazmul `Y` candidate remain visible in visual
inspection of the 144- and 600-DPI crops.

The complete 40-image manifest records renderer flags, output dimensions,
file sizes, crop pixel boxes, and SHA-256 values:

`docs/research/fixtures/surya-dpi-salutation-2026-08-24/render-manifest.json`

The TSV form is at the same temporary root as `render-manifest.tsv`. The
existing 144-DPI checks were:

| Existing raster | Dimensions | SHA-256 |
| --- | ---: | --- |
| `docs/research/fixtures/surya-dpi-salutation-2026-08-24/legacy-baseline/ruhayli-haqq-p35.png` | 1190x1684 | `69c31d60088a72970c93da3975ebe519055c5284ed06f29fa18635606400a782` |
| `docs/research/fixtures/surya-dpi-salutation-2026-08-24/legacy-baseline/ibrahim-bayan-p35.png` | 1753x2480 | `d8e0a0f5063dcd86f0c94625fd789a1bea85290d37edfff492a27ae1193aceca` |
| `docs/research/fixtures/surya-dpi-salutation-2026-08-24/legacy-baseline/bazmul-tafsir-p10.png` (existing Bazmul) | 1190x1684 | `ab22b4e2ded247d6a48d352607495d9485f1651b2b683385bc2bd9c86fe3a28b` |
| direct `pdftocairo` Bazmul p10 | 1190x1684 | `e7186d4fdfc3fedfc2e97e3ea83c976904b944539aa224bdc9e0a5a637bcdec7` |

The direct render/crop files and all OCR JSON/logs remain under:

`docs/research/artifacts/surya-dpi-salutation-2026-08-24/raw/`

## Environments and commands

Machine facts and the newest practically usable versions were established in
the companion report, [SURYA_V1_V2_SALUTATION_SPIKE_2026-08-24.md](./SURYA_V1_V2_SALUTATION_SPIKE_2026-08-24.md): Apple M4 Max, 14 cores, 36 GB RAM, arm64; macOS 26.6.2; Homebrew Python 3.13.14; MPS available; v1 `surya-ocr==0.17.1`; v2 `surya-ocr==0.22.1`.

The isolated environment setup was:

```sh
PY313="$(brew --prefix python@3.13)/bin/python3.13"
SPIKE_ROOT="$(mktemp -d -t swissawa-surya-v1-v2)"
uv venv --python "$PY313" "$SPIKE_ROOT/v1"
uv venv --python "$PY313" "$SPIKE_ROOT/v2"
HF_HOME="$SPIKE_ROOT/v1-hf" uv pip install --python "$SPIKE_ROOT/v1/bin/python" \
  'surya-ocr==0.17.1' 'transformers==4.56.1' requests
HF_HOME="$SPIKE_ROOT/v2-hf" uv pip install --python "$SPIKE_ROOT/v2/bin/python" \
  'surya-ocr==0.22.1'
```

The supported v2 backend is:

```sh
brew install llama.cpp
export LLAMA_CPP_BINARY="$(brew --prefix llama.cpp)/bin/llama-server"
```

For this spike, an arm64 Homebrew bottle was fetched/extracted and repaired
only under the temporary root because no global `llama-server` was present.
The measured v2 model receipt was snapshot
`6a3a4c30e5e74446d4f8b6afd05b2f2da970f470` (`surya-2.gguf` plus
`surya-2-mmproj.gguf`), with the local llama.cpp build 10520. The direct v1
run shape was:

```sh
env TORCH_DEVICE=mps MODEL_CACHE_DIR="$SPIKE_ROOT/v1-models" \
  "$SPIKE_ROOT/v1/bin/surya_ocr" --disable_math --output_dir "$OUT" INPUT.png
```

The v2 runs used MPS, isolated `HF_HOME`/`MODEL_CACHE_DIR`,
`SURYA_INFERENCE_TIMEOUT_SECONDS=180`, and
`SURYA_INFERENCE_KEEP_ALIVE=0`. The logs show the default llama.cpp
`--parallel 8`; the first v1/v2 spike used an explicit parallel-one setting,
so its v2 latency numbers are not interchangeable with this report's v2
latencies. All within-matrix DPI comparisons use the same settings. Every
successful command was wrapped with `/usr/bin/time -l`.

## Effective preprocessing and resolution

The installed source was inspected, then the effective image sizes were
measured with `CLILoader` and the installed preprocessing functions.

| Stage | v1 | v2 |
| --- | --- | --- |
| PDF defaults | `IMAGE_DPI=96`, `IMAGE_DPI_HIGHRES=192` | same |
| Image input | `load_image()` opens the PNG; DPI settings do not resample it | same |
| Detector tensor | 1200x1200 per vertical chunk; chunk inference uses the same 1200-pixel split height | 1200x1200 per vertical chunk; same detector checkpoint/config |
| Full-page recognition | `scale_to_fit` caps the OCR image at 1024x512 area; A4-like pages become about 608x861 at every tested DPI | `scale_to_fit` rounds to a 28-pixel grid with max area 3072x2048; these pages become about 2100x2968 from 300–600 DPI |
| Local crop recognition | retains source crop until it exceeds the 1024x512 area cap | retains much more crop resolution, normally near source size, subject to the 3072x2048-area/grid cap |

For an actual 600-DPI Ibrahim PNG, both v1 and v2 `CLILoader` measured
`images[0].size == highres_images[0].size == (7305, 10334)` under both the
default environment (`96/192`) and `IMAGE_DPI=600 IMAGE_DPI_HIGHRES=600`.
Thus those settings affect PDF loading, not already-rendered image inputs.
The v1 and v2 600-DPI full-page output JSON was byte-identical to the default
settings probe; the v2 capped crop was subject to normal model/server output
variation, so no crop text difference is attributed to the DPI environment
variables. The bounded v2 crop setting used below was the separate documented
setting `SURYA_MAX_TOKENS_FULL_PAGE=2048`, not a higher image resolution.

The source/config probe and its 600-DPI OCR outputs are under
`docs/research/fixtures/surya-dpi-salutation-2026-08-24/config-probes/`.

## Detector results

v1 and v2 detector JSON bboxes were byte-for-byte equal for every full-page
and crop pair at all five DPIs. Confidence values were also equal because the
same `text_detection/2025_05_07` checkpoint was used. Representative full-page
box counts were:

| Page | 144 | 200 | 300 | 450 | 600 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ruhayli full | 17 | 17 | 17 | 16 | 15 |
| Ibrahim bayan full | 22 | 23 | 23 | 22 | 22 |
| Ibrahim p349 full | 34 | 31 | 28 | 26 | 25 |
| Bazmul full | 21 | 20 | 20 | 20 | 20 |

Localized counts were stable for Ruhayli (1) and Bazmul (2), stable for bayan
(3), and changed for p349 from 4 at 144/200 to 3 at 300/450/600. Therefore
higher DPI changed detector partitioning on some pages; it did not produce a
new v1/v2 detector distinction or a reliable target-glyph box. Detector JSON,
including confidence and timing, is under `results-v1/detect/` and
`results-v2/detect/` in the temporary root.

## Recognition results

Counts below are measured output records, not gold labels. `FDFA` means exact
U+FDFA (`ﷺ`); “phrase” means a normalized expanded
`صلى الله عليه وسلم` sequence and is deliberately reported separately from
the glyph. `٧` and `Y` are observed Bazmul artifacts/candidates, not labels.

### Full pages

| Page / DPI | v1 lines / char records / FDFA / artifacts | v2 blocks / FDFA / phrase / artifacts |
| --- | --- | --- |
| Ruhayli 144 | 17 / 1256 / 0 / `٧`=1 | 4 / 0 / 3 / `٧`=1 |
| Ruhayli 300 | 17 / 1248 / 0 / `٧`=1 | 7 / 0 / 3 / `٧`=1 |
| Ruhayli 600 | 15 / 1233 / 0 / `٧`=1 | 7 / 0 / 3 / `٧`=1 |
| Bayan 144 | 22 / 1498 / 0 / none | 11 / 0 / 3 / `٧`=1 |
| Bayan 300 | 23 / 1483 / 0 / none | 11 / 0 / 0 / `٧`=1 |
| Bayan 600 | 22 / 1476 / 0 / `Y`=4 | 11 / 0 / 3 / `٧`=1 |
| p349 144 | 34 / 954 / 1 / `٧`=3 | 5 / 1 / 1 / `٧`=4 |
| p349 300 | 28 / 1171 / 1 / `٧`=4 | 5 / 1 / 1 / `٧`=4 |
| p349 600 | 25 / 1104 / 0 / `٧`=3 | 5 / 1 / 1 / `٧`=4 |
| Bazmul 144 | 21 / 1247 / 0 / `٧`=1, `Y`=1 | 10 / 0 / 0 / `٧`=2 |
| Bazmul 300 | 20 / 1234 / 0 / `٧`=1, `Y`=1 | 10 / 0 / 0 / `٧`=2 |
| Bazmul 600 | 20 / 1260 / 0 / `٧`=1 | 10 / 0 / 0 / `٧`=2 |

The exact p349 full-page glyph survived v1 through 300 DPI but disappeared
at 450/600; v2 preserved it at all five DPIs. That is a useful anchor
observation, not a recall claim. Neither canonical positive full page produced
exact FDFA in either version. v2's block HTML was generally more useful for
page-level reading order; v1 supplied the line/character geometry expected by
Swissawa's current adapter.

### Physically matched localized crops

| Crop / DPI | v1 evidence | v2 evidence |
| --- | --- | --- |
| Ruhayli 144 | 1 line, conf `0.857`, expanded/diacritized phrase, FDFA 0 | 2 blocks, expanded phrase, FDFA 0 |
| Ruhayli 300 | 1 line, conf `0.959`, still expanded/diacritized, FDFA 0 | 1 block, `النبي صلى الله عليه وسلم`, FDFA 0 |
| Ruhayli 600 | 1 line, conf `0.912`, same substitution, FDFA 0 | 2 blocks, same expanded phrase plus extra text, FDFA 0 |
| Bayan 144 | 3 lines, conf mean `0.906`, no exact glyph | 2 blocks, no exact glyph |
| Bayan 300 | 3 lines, conf mean `0.995`, no exact glyph | 1 block emitted exact FDFA once; surrounding text was garbled |
| Bayan 600 | 3 lines, conf mean `0.989`, no exact glyph | 1 block, no exact glyph; surrounding text varied |
| p349 144 | 4 lines, FDFA=1, phrase=1 | 5 blocks, FDFA=1, phrase=1 |
| p349 200 | 4 lines, FDFA=1, phrase=1 | default exceeded 5 minutes without JSON; bounded cap produced FDFA=3 and repeated phrase artifacts |
| p349 300/450/600 | 3 lines, FDFA=0 at all three | bounded cap: FDFA 0 / 1 / 1 respectively |
| Bazmul 144/300/600 | 2/2/2 lines; `٧`=1 at each, FDFA=0 | 2/1/2 blocks; `٧`=1/1/0 and `Y`=0/0/1, FDFA=0 |

The v1 crop line confidence often increased at 300–450 DPI, but this did not
mean exact glyph recovery. At 600 DPI the crop still visually contains the
same printed symbols, while OCR can substitute them. The p349 v2 bounded
200-DPI result is especially not a clean accuracy win: it repeated index-page
entries (`FDFA` count 3, expanded phrase count 6) instead of providing one
localized, trustworthy observation.

### Latency, memory, and macOCR control

Values are wall time / `/usr/bin/time -l` maximum RSS, rounded to MiB. These
are process observations; v2's llama.cpp server is included in the full-page
figures produced by this harness, and the v2 detector's persistent server
reached about 1.5 GiB live RSS after warming.

| Run | 144 DPI | 300 DPI | 600 DPI |
| --- | ---: | ---: | ---: |
| v1 full Ruhayli | 7.82 s / 775 MiB | 11.32 s / 1124 MiB | 19.76 s / 2351 MiB |
| v1 full bayan | 10.45 s / 881 MiB | 19.96 s / 1938 MiB | 26.54 s / 4215 MiB |
| v1 full Bazmul | 7.43 s / 777 MiB | 8.67 s / 1090 MiB | 22.63 s / 2455 MiB |
| v1 crop Ruhayli | 3.28 s / 643 MiB | 3.53 s / 655 MiB | 3.53 s / 658 MiB |
| v2 full Ruhayli | 26.20 s / 3033 MiB | 27.20 s / 3212 MiB | 25.09 s / 3207 MiB |
| v2 full bayan | 28.89 s / 3216 MiB | 30.88 s / 3226 MiB | 29.53 s / 3225 MiB |
| v2 full Bazmul | 22.75 s / 3036 MiB | 26.76 s / 3207 MiB | 25.39 s / 3206 MiB |
| v2 crop Ruhayli | 13.54 s / 2898 MiB | 13.46 s / 2910 MiB | 51.27 s / 3251 MiB |
| macOCR full Ruhayli | 0.39 s / 98 MiB | 0.43 s / 165 MiB | 0.52 s / 373 MiB |
| macOCR crop Ruhayli | 0.22 s / 54 MiB | 0.23 s / 56 MiB | 0.27 s / 75 MiB |

macOCR `1.3.0` consumed the same rendered images at every DPI. It gave
expanded/diacritized honorific substitutions rather than exact FDFA on the
positive crops, and consistently returned Bazmul `Y`; it is a lightweight
control, not a new gold label.

Measured model storage remained approximately 1.4 GB for copied v1 detection
plus recognition weights, 1.4 GB for the v2 HF GGUF cache (1,266,400,864-byte
model plus 204,986,688-byte projector), and 73 MB for the v2 detector. The
temporary llama.cpp runtime was about 64 MB. Higher source DPI adds raster
I/O/memory but no model download.

## v2 blockers and bounded alternatives

The first v2 retry reached inference but failed during temporary llama-server
shutdown because the extracted OpenSSL dylibs retained Homebrew install names:
`dyld: Symbol not found: _ASN1_INTEGER_cmp`. The copies under the temporary
prefix were patched with `install_name_tool` and ad-hoc signed; no global
files were touched, and the retry produced JSON.

Two default full-page v2 crop requests then demonstrated a separate resource/
generation problem:

* p349 crop at 200 DPI: no JSON after about 301 seconds; the llama server was
  sampled at about 3.4 GiB RSS before exact processes were terminated.
* bayan crop at 300 DPI: no JSON during an 89-second bounded proof; the server
  was sampled at about 3.5 GiB RSS before exact processes were terminated.

`SURYA_MAX_TOKENS_FULL_PAGE=2048` allowed the remaining high-DPI crop runs to
complete, but it is a generation-budget setting, not a resolution setting,
and p349 200 still took 105 seconds and repeated text. Full-page runs stayed
on the default 12,288-token setting. Exact logs and termination observations
are in:

`docs/research/fixtures/surya-dpi-salutation-2026-08-24/timeout-record.json`

## Recommendation

1. Keep v1 `0.17.1` + MPS + isolated model cache as Swissawa's supported
   `text_lines` engine. Keep default source rendering near the existing
   baseline/200 DPI; do not make 600 DPI the production default.
2. If a review tool needs a salutation crop, 300 DPI is the smallest useful
   experiment for this corpus, but persist the raw crop, detector box,
   transcription, exact codepoint counts, and confidence and require human
   review. The one exact v2 FDFA at bayan 300 is insufficient for an automatic
   insertion policy.
3. Retain v2 only as review evidence: detector boxes are compatible with v1
   here, while v2 block HTML can help reading order. Do not feed v2 output
   directly into the current `text_lines` adapter or use phrase normalization
   as proof of glyph recognition.
4. The smallest next implementation step remains a read-only v2 evidence
   runner that stores engine/model/backend versions, source/crop hashes,
   detector box, crop box, block HTML, exact codepoint counts, and both
   confidence values. No production adapter change is justified by DPI alone.

## Validation, cleanup, and changed files

The raw result root contains the v1/v2/macOCR JSONs, timing logs, direct-PDF
renders/crops, `metrics.json`, `render-manifest.json`, and timeout record. A
final process check found no `llama-server`, `surya_ocr`, `surya_detect`, or
`surya.detection.server` process. Existing global/`~/surya-env` state was not
modified, and no destructive cleanup was performed.

Repository change in this second spike: this report only,
`docs/research/SURYA_DPI_SALUTATION_SPIKE_2026-08-24.md`. The pre-existing
dirty files and the first spike report were preserved unchanged.
