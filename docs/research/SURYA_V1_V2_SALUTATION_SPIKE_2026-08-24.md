# Surya v1 versus v2 Arabic salutation spike

Date: 2026-08-24

## Outcome

Keep Surya v1 as the supported `text_lines` engine for Swissawa. It is the
smaller operational change, already fits the current adapter, and exposes
line plus character geometry. Add Surya v2 only as an isolated, annotation-only
second opinion: its detector can propose the same line boxes, while its VLM
recognizer provides useful page/block text but did not recover the exact
`U+FDFA` (`ﷺ`) glyph on either visually positive fixture page.

The smallest next implementation step is a read-only v2 evidence runner that
persists the engine/model version, detector box, crop box, block HTML, and both
confidence values. Do not use v2 output to auto-insert an honorific. No
production algorithm change was made in this spike.

## Scope and machine

Corpus and raster content were treated only as test data. The machine was
checked before choosing versions:

| Item | Measured value |
| --- | --- |
| Hardware | MacBook Pro `Mac16,6`, Apple M4 Max, 14 cores, 36 GB RAM, arm64 |
| OS | macOS `26.6.2`, build `25G83`; Darwin `25.6.0` |
| Python used | Homebrew CPython `3.13.14` |
| Other Python | Homebrew CPython `3.14.6` was present but not used |
| Package tools | Homebrew `6.0.18`; uv `0.9.9`; Bun `1.4.0` |
| Relevant installed packages | MLX `0.32.0`; no preinstalled `surya_ocr` or `llama-server` |
| MPS | `torch.backends.mps.is_available()` was `True` in both environments |
| Existing Surya env | `~/surya-env` was absent; it was not created or modified |
| llama.cpp | Not installed globally; a temporary extracted arm64 bottle was used for the v2 proof |

The original benchmark root was temporary and was not versioned. The
reproducible commands, model receipts, input hashes, and measured outputs are
recorded below. No benchmark process remains running.

## Versions and isolated setup

The upstream documentation identifies `surya-ocr==0.17.1` as the pre-v2
version and starts Surya OCR 2 at `0.20.0`; the newest PyPI release observed
on this date was `0.22.1`. The corresponding upstream tag commits checked were:

| Track | Package/tag | Commit | Measured environment |
| --- | --- | --- | --- |
| v1 | `surya-ocr==0.17.1` / `v0.17.1` | `b809df71c15b5ac8bb4e9910b9657b004ae39245` | torch `2.13.0`, transformers `4.56.1`, pypdfium2 `4.30.0`, NumPy `2.5.2`, Pillow `10.4.0` |
| v2 | `surya-ocr==0.22.1` / `v0.22.1` | `3a70081f6a60013dab818c82ab99451aa290f389` | torch `2.13.0`, torchvision `0.28.0`, transformers `5.15.1`, pypdfium2 `5.13.0`, NumPy `2.5.2`, Pillow `10.4.0` |

The v1 model receipt was `text_detection/2025_05_07` plus
`text_recognition/2025_09_23`. The v2 recognition receipt was
`datalab-to/surya-ocr-2-gguf` snapshot
`6a3a4c30e5e74446d4f8b6afd05b2f2da970f470`, containing `surya-2.gguf` and
`surya-2-mmproj.gguf`. The v2 backend reported
`llama-server 0.1.2-dev (build 10520, commit cd644c395)` and was invoked with
`SURYA_INFERENCE_BACKEND=llamacpp`, `SURYA_INFERENCE_PARALLEL=1`, and
`SURYA_INFERENCE_KEEP_ALIVE=0`.

The exact isolated package setup was:

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

For a supported v2 installation, upstream documents the Apple backend as
llama.cpp. The reproducible installation command to use outside this spike is:

```sh
brew install llama.cpp
export LLAMA_CPP_BINARY="$(brew --prefix llama.cpp)/bin/llama-server"
```

The v2 proof used the stable Homebrew formula `llama.cpp` `10520`, commit
`cd644c39545aac3dca63261f99a9bfc35956cb25`, with ggml `0.20.2`, libomp
`22.1.8`, and openssl@3 `3.6.3`. It was fetched, extracted, and repaired only
under the temporary spike root; no global `brew install` was performed.

Surya v1 uses `MODEL_CACHE_DIR`, not `HF_HOME`, for its model weights. The
initial v1 run found an existing user cache and did not alter it. For the
reported measurements, those pre-existing weights were copied into the
temporary root and v1 was rerun with:

```sh
env TORCH_DEVICE=mps MODEL_CACHE_DIR="$SPIKE_ROOT/v1-models" \
  "$SPIKE_ROOT/v1/bin/surya_ocr" --disable_math --output_dir "$SPIKE_ROOT/v1-out" \
  FIXTURE.png
```

## Canonical inputs

The same full-page rasters were used for both versions. Two were visually
selected positive honorific pages; the third is the existing Bazmul hard case,
where the apparent mark is deliberately unresolved rather than treated as
ground truth. The source fixture choice was cross-checked against the prior
salutation material in the sibling macOCR repository's
`SALUTATION_RECOGNITION_SPIKE.md` and
`SALUTATION_RECOGNITION_REVIEW_PACKET.md`.

| Fixture | Path relative to repository root | Size | SHA-256 |
| --- | --- | --- | --- |
| Ruhayli positive | `docs/research/fixtures/surya-dpi-salutation-2026-08-24/legacy-baseline/ruhayli-haqq-p35.png` | 1190 x 1684 | `69c31d60088a72970c93da3975ebe519055c5284ed06f29fa18635606400a782` |
| Ibrahim positive | `docs/research/fixtures/surya-dpi-salutation-2026-08-24/legacy-baseline/ibrahim-bayan-p35.png` | 1753 x 2480 | `d8e0a0f5063dcd86f0c94625fd789a1bea85290d37edfff492a27ae1193aceca` |
| Bazmul hard case | `docs/research/fixtures/surya-dpi-salutation-2026-08-24/legacy-baseline/bazmul-tafsir-p10.png` | 1190 x 1684 | `ab22b4e2ded247d6a48d352607495d9485f1651b2b683385bc2bd9c86fe3a28b` |

The existing hard-case crop was also exercised:

`docs/research/artifacts/surya-dpi-salutation-2026-08-24/raw/crops/bazmul-tafsir-p10-crop-dpi144.png`
(`520 x 120`, SHA-256 `a458141bcdd236db28aa213d71ee9719a2b9e92fc003fe8e8b547f7804e47198`).

## Measured full-page results

### Output shape and evidence

| Fixture | v1 output | v2 detector output | v2 full-page recognition |
| --- | --- | --- | --- |
| Ruhayli | 17 text lines; 1,256 character records; line confidence min/mean/max `0.290899 / 0.824502 / 0.995588` | 17 boxes; detector confidence min/mean/max `0.749106 / 0.961285 / 1.000000` | 4 blocks: 2 headers, 1 text block, 1 footnote; page/block confidence `0.964503` |
| Ibrahim | 22 text lines; 1,612 character records; line confidence `0.341568 / 0.880639 / 0.997159` | 22 boxes; detector confidence `0.904449 / 0.963692 / 1.000000` | 11 blocks: headers, text paragraphs, footnotes; page/block confidence `0.969157` |
| Bazmul | 21 text lines; 1,275 character records; line confidence `0.394385 / 0.884187 / 0.999583` | 21 boxes; detector confidence `0.719794 / 0.966018 / 1.000000` | 10 blocks, including text, footnotes, and footer; page/block confidence `0.971078` |

v1 raw lines carried `bbox`, polygon, line confidence, character `bbox`/polygon/
confidence, and an empty `words` array in all three CLI outputs. The
`original_text_good` flag was `false` for every v1 line in this run, so it was
not useful as positive salutation evidence. v2 full output carried block
`bbox`, polygon, label, reading order, HTML, and confidence, but no character
or word geometry.

The v2 detector boxes matched the v1 line boxes exactly after order alignment:
17/17, 22/22, and 21/21 boxes, with every measured IoU equal to `1.0` and no
center displacement. Detection alone therefore provided no geometry gain on
these rasters.

The v2 full recognizer did provide a useful page-level reading order: its
`reading_order` sequence grouped multi-line paragraphs, headers, footnotes,
and the footer into 4, 11, and 10 blocks respectively. Those block boxes span
multiple v1 lines, so this is useful for paragraph navigation but not a
drop-in line/word/character geometry replacement.

### Salutation evidence

Exact-codepoint output was used as the conservative target test; no visual
mark was promoted to a gold glyph label.

| Input | v1 full page | v2 full page | Interpretation |
| --- | --- | --- | --- |
| Ruhayli positive | `U+FDFA` count 0; anchor lines had malformed expanded `صلى...` text | `U+FDFA` count 0; the large text block rendered readable `النبي صلى الله عليه وسلم` forms but no target glyph | Better page/block transcription, no target-glyph evidence |
| Ibrahim positive | `U+FDFA` count 0; anchor line contained a malformed honorific region | `U+FDFA` count 0; paragraph text was less fragmented, but the honorific region remained normalized/substituted | No measured recall improvement |
| Bazmul hard case | Two Latin `Y` candidates, both unresolved | No Latin `Y`; two Arabic `٧` occurrences, including one immediately after `الرسول` and one after `الصحابة` | Neither output is accepted as a target; keep as hard negative/unresolved |

Thus the observed exact-codepoint page-level result was `0/2` positive fixture
pages for both engines. This is not a glyph-level recall or CER/WER score: the
fixtures do not have an annotated count of every printed honorific instance or
a gold transcription. The evidence supports abstention, not a claim that v2
cannot recognize the symbol under other rendering conditions.

### Latency and memory

`/usr/bin/time -l` was used. Values below are wall time and observed maximum
resident set size for the command, rounded to the nearest MiB. The v2 figures
include the local llama.cpp server. The separate macOS `peak memory footprint`
field was not compared because v2 recognition work was performed in a child
server process.

| Engine/stage | Ruhayli | Ibrahim | Bazmul |
| --- | ---: | ---: | ---: |
| v1 full page | 10.79 s / 776 MiB | 16.62 s / 878 MiB | 8.00 s / 778 MiB |
| v2 detector | 12.09 s / 388 MiB | 4.72 s / 406 MiB | 2.13 s / 385 MiB |
| v2 full page + llama.cpp | 21.83 s / 1,928 MiB | 25.91 s / 2,119 MiB | 23.59 s / 1,931 MiB |

The detector CLI kept a persistent detector server between the Ibrahim and
Bazmul measurements; those two detector times are warm-process observations,
not a controlled benchmark. The v2 full-page process was cold-started per
page with `SURYA_INFERENCE_KEEP_ALIVE=0`.

Measured model storage was approximately 1.4 GB for v1’s copied detection plus
recognition weights (76,930,732-byte detector and 1,438,882,494-byte
recognizer). v2 used 1,266,400,864 bytes for the GGUF model and 204,986,688
bytes for the multimodal projector, plus 73 MB for the detector cache: roughly
1.5 GB before the llama.cpp installation and runtime libraries.

## Separate detection plus localized recognition

The v2 detector’s boxes were used as the source geometry (they are exactly the
same boxes as v1 here), with small test crops around the two positive anchors;
the existing Bazmul target crop was used for the hard case.

| Crop | v1 localized result | v2 localized result |
| --- | --- | --- |
| Ruhayli anchor, 320 x 120 | 1 line, confidence `0.857002`, readable `النبي صلى الله عليه وسلم`, `U+FDFA` 0; 5.72 s / 646 MiB | 2 blocks (whole-crop Picture + Text), text `النبي صلى الله عليه وسلم: نسب`, `U+FDFA` 0; 13.75 s / 1,789 MiB |
| Ibrahim anchor, 1400 x 160 | Not rerun as a separate v1 crop | 3 blocks, including footer bleed; honorific region remained garbled, `U+FDFA` 0; 14.30 s / 1,812 MiB |
| Bazmul existing hard crop, 520 x 120 | 2 lines; candidate rendered as Arabic `٧`, `U+FDFA` 0; 3.71 s / 653 MiB | 2 blocks (Picture + Text), no `Y`, no `٧`, no `U+FDFA`; 13.72 s / 1,796 MiB |

Localization reduced v2 page context but did not produce a target glyph or a
more trustworthy candidate. It also added a fixed model/server startup cost
and occasionally included crop-edge/footer blocks. On this sample, v1’s
localized recognition was faster and at least as useful for audit text.

## v2 blocker and safe alternatives

The first v2 full-page attempt failed in 1.16 s with the concrete error:
`llama-server binary not found. Install with macOS: brew install llama.cpp ...`
No v2 recognition result was claimed from that attempt.

Safe alternatives were exhausted without modifying global state:

1. `brew info llama.cpp` confirmed an available arm64 bottle (`10520`), while
   `llama-server` was absent from PATH.
2. `brew fetch --force --deps llama.cpp` fetched only the formula and
   dependencies; the bottles were extracted into the temporary spike root.
3. The raw extracted relocatable bottle initially failed with `no backends are
   loaded` and a CLIP/mmproj load error. Only copied temporary Mach-O files
   were repaired (library paths/symlinks and ad-hoc signing); no Homebrew
   prefix or system binary was changed.
4. The repaired arm64 server reported build `10520` and successfully served
   all three full pages and all three localized crops with `-ngl 99`. Surya
   logged the server-ready event and wrote results for every run.
5. All server and detector PIDs started by the spike were stopped. A final
   process/listener check found no `llama-server`, `surya_ocr`, or Surya
   detection server from the spike.

The temporary extracted-bottle repair proves the maximum runtime path, but it
is not the recommended deployment procedure. Use `brew install llama.cpp` for
an actual v2 integration and retain a health check, timeout, and cleanup path
for the child server.

## Swissawa integration implications

The current integration is v1-shaped:

- `src/server/ocr/runSuryaOcr.ts` activates `~/surya-env`, invokes
  `surya_ocr --disable_math`, and reads
  `outputDir/<input-basename>/results.json` as `text_lines`.
- `src/lib/suryaOcr.ts` and `src/server/ocr/splitSuryaOcr.ts` model and convert
  line observations, including optional v1 character evidence.
- v2 full-page output is page-keyed but contains `blocks` with HTML and
  block-level geometry; v2 detector output is a separate `bboxes` result. A
  direct v2 substitution would lose line/character provenance and would not
  satisfy the current `text_lines` adapter.

Recommended architecture:

- Keep v1 pinned as the primary OCR/text-lines path on this Mac: Python 3.13.14,
  `surya-ocr==0.17.1`, `transformers==4.56.1`, torch MPS, and an explicit
  isolated `MODEL_CACHE_DIR`.
- Add v2 only behind a separate engine configuration and process runner. Treat
  its detector boxes and HTML as review evidence, not as an automatic edit
  source.
- If a hybrid is implemented, let v1 supply the existing line/character
  observations and let v2 supply a second block/crop transcription. Require
  agreement or human review before any salutation decision.

Upstream references (documentation, not this machine’s measurements):

- [Surya README and v2 migration notes](https://github.com/datalab-to/surya/blob/master/README.md)
- [Surya v0.22.1 release](https://github.com/datalab-to/surya/releases/tag/v0.22.1)
- [Surya release history](https://github.com/datalab-to/surya/releases)

## Validation and changes

Commands run included isolated v1/v2 installation, version/MPS probes, full
page `surya_ocr`, v2 `surya_detect`, localized crop OCR, `/usr/bin/time -l`,
SHA-256 checks, process cleanup checks, and:

```sh
bun test src/server/ocr/splitSuryaOcr.test.ts
```

Result: 9 tests passed. The combined Surya test invocation also showed the
existing `runSuryaOcr.test.ts` suite could not load because `pdf-lib` was
missing from the current `node_modules`, although it is declared in
`package.json` and `bun.lock`; this is a dependency/bootstrap blocker, not a
new v1/v2 regression.

The only repository file added by this spike is this report:
`docs/research/SURYA_V1_V2_SALUTATION_SPIKE_2026-08-24.md`.
No production source, tests, lockfiles, deployment, global Python environment,
global Homebrew installation, or existing dirty worktree file was changed.
