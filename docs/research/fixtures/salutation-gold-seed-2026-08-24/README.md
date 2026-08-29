# Salutation gold seed packet

This is a small, human-reviewed seed annotation packet for the salutation
recognition work. It is **not an evaluation corpus** and must not be used to
claim recall, precision, CER, or WER. The packet contains three provisional
visual anchors, one unresolved rendering hard case, and three symbol-free
hard-negative crops.

## Provenance

`annotations.json` is the source of truth for the labels, split keys, PDF
SHA-256 values, 300-DPI full-raster hashes, crop hashes, and annotation state.
The positive-anchor crops deliberately reference the existing tracked images
with paths such as:

```text
../surya-dpi-salutation-2026-08-24/crops/<name>-crop-dpi300.png
```

Those bytes were rendered directly from the source PDF with Poppler
`pdftocairo 26.07.0` at 300 DPI. The manifest referenced by the JSON records
the full render and PDF provenance. The three files under `negatives/` are
copied byte-for-byte from the visually checked hard-negative preparation. They
were cropped from the corresponding 300-DPI full raster with `sips`; its crop
offset arguments are recorded in each entry.

Every entry records both the full-raster SHA-256 and the crop SHA-256. Verify
both before using an image in a later annotation or classifier run.

## Labels and limitations

The canonical `rasterFidelity` vocabulary is:

- `present-in-raster`: the printed mark is visible in the exact image bytes
  sent to OCR or review.
- `destroyed-by-font-substitution`: PDF font/code evidence indicates that the
  intended symbol font was substituted before rasterization. Bazmul belongs
  here and is excluded from pixel recall.
- `unknown`: provenance or visual identity is not established.

Printed form is separate from semantic class. Ruhayli is expanded text; the
two Ibrahim anchors are compact glyphs. Bazmul's visible substituted
letterform is unresolved: its semantic class remains `unknown` until a legally
obtained AGAArabesque specimen validates the source font/code mapping.

The three negative entries use `semanticClass: none` and
`targetPresence: absent`; they are for specificity/hard-negative work only and
all have `includeInPixelRecall: false`. Bazmul uses
`targetPresence: unknown` because the source font/code mapping is unresolved
and the raster no longer contains trustworthy target pixels.

## Split rule

Split by `editionKey` and `bookKey`, never by crop. Keep every crop from one
book/edition in the same split. In particular, keep Ibrahim `bayan` and
Ibrahim `al-takfer-wa-dawabetuh` as separate edition keys, and do not use the
Bazmul unresolved case as a positive or recall denominator.

Human review of this packet confirms only the listed crops. It does not label
every printed salutation on the source pages and does not establish a gold
corpus. A real evaluation set still needs broader book/edition coverage,
negative sampling, independently checked glyph counts, and a second annotator.
