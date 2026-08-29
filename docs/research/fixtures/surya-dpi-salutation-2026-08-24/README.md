# Surya DPI salutation fixture packet

This packet preserves the regression-critical evidence from the 2026-08-24
source-rendering spike on an Apple M4 Max. The two companion reports in
`docs/research/` contain the full methodology and interpretation.

## Tracked contents

- `full/`: the four direct `pdftocairo 26.07.0` page renders at 144, 200, 300,
  450, and 600 DPI (20 PNGs, 15 MiB).
- `crops/`: the four physically matched candidate crops at all five tested
  DPIs (20 PNGs, 908 KiB). These are review-only localized inputs, not
  upscaled page images.
- `legacy-baseline/`: the six pre-existing baseline rasters retained to make
  the `pdftoppm` versus direct-`pdftocairo` provenance distinction explicit.
- `render-manifest.json` and `render-manifest.tsv`: dimensions, crop boxes,
  renderer settings, byte sizes, and SHA-256 hashes for all 40 DPI renders and
  crops.
- `metrics.json`, `timeout-record.json`, and `config-probes/`: aggregate
  measurements, bounded timeout observations, and the loader/config probes.

The complete raw run, including OCR JSON and command logs, is also retained at:

`docs/research/artifacts/surya-dpi-salutation-2026-08-24/raw/`

That raw directory is intentionally ignored by Git to avoid repository bloat.
The 40 source renders/crops and their `render-manifest.json` inventory are all
Git-visible in this compact packet; the ignored copy is no longer the only
place where any image in the matrix exists.

## Provenance and fidelity labels

The spike compares source-PDF rasterization paths. A fixture must record one of
these `rasterFidelity` interpretations when it is later used for annotation:

- `present-in-raster`: the printed mark is visibly present in the bytes fed to
  OCR; an OCR miss is an image-recognition failure or an abstention.
- `destroyed-by-font-substitution`: PDF text/font extraction identifies a
  symbol-font code or glyph, but the renderer substituted a different visible
  glyph before OCR; this is not recoverable by a crop classifier.
- `unknown`: no validated PDF-font mapping or visual gold label exists yet.

The current four anchors are intentionally not all gold glyph labels. Bazmul
remains an unresolved hard case pending PDF font/code profiling. The reports'
observed `Y` and `٧` values are OCR artifacts/candidates, not truth labels.

The direct-PDF renderer command was:

```sh
pdftocairo -f PAGE -l PAGE -r DPI -png -singlefile SOURCE.pdf OUTPUT_PREFIX
```

For a rerun, verify dimensions and hashes against the manifest before sending
bytes to any OCR engine. Keep the 300-DPI crop as a separate review artifact;
the spike did not justify routine 450/600-DPI processing.
