/**
 * Small, text-only regression fixtures for the source-profiler prototype.
 *
 * These are intentionally not PDFs. They preserve the two observations from
 * the salutation spike while keeping unit tests independent of local files and
 * of Poppler versions.
 */
export const BAZMUL_AGAARABESQUE_Y_FIXTURE = {
    fontsOutput: [
        'name                                 type              encoding         emb sub uni object ID',
        '------------------------------------ ----------------- ---------------- --- --- --- ---------',
        'AGAArabesque                         TrueType          WinAnsi          no  no  no      25  0',
    ].join('\n'),
    glyphs: [
        {
            charCode: 0x79,
            extractedText: 'y',
            fontName: 'AGAArabesque',
            page: 10,
            printedForm: 'substituted-letterform',
        },
    ],
    substitutionsOutput: [
        'name                                 object ID substitute font                      substitute font file',
        '------------------------------------ --------- ------------------------------------ ------------------------------------',
        'AGAArabesque                             25  0 Verdana                              /System/Library/Fonts/Supplemental/Verdana.ttf',
    ].join('\n'),
} as const;

export const IBRAHIM_T38_PIPE_FIXTURE = {
    fontsOutput: [
        'name                                 type              encoding         emb sub uni object ID',
        '------------------------------------ ----------------- ---------------- --- --- --- ---------',
        'T38                                  Type 3            Custom           yes no  no    8985  0',
    ].join('\n'),
    glyphs: [{ extractedText: '|', fontName: 'T38', glyphId: 'T38', page: 349, printedForm: 'compact-glyph' }],
} as const;
