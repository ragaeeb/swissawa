'use client';

interface StatusDisplayProps {
    status: string;
    jobId: string | null;
    extractedPages: number;
    pages: number | null;
    progressPct: number;
    meta: Record<string, unknown> | null;
}

export const StatusDisplay = ({ status, jobId, extractedPages, pages, progressPct, meta }: StatusDisplayProps) => {
    return (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm">
                        <span className="font-medium">Status:</span> {status}
                        {jobId ? (
                            <span className="ml-2 text-zinc-500 dark:text-zinc-400">(job {jobId.slice(0, 8)}…)</span>
                        ) : null}
                    </div>
                    {pages ? (
                        <div className="text-sm text-zinc-600 dark:text-zinc-400">
                            {extractedPages}/{pages} pages
                        </div>
                    ) : null}
                </div>

                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
                    <div
                        className="h-full bg-zinc-950 transition-[width] dark:bg-zinc-50"
                        style={{ width: `${progressPct}%` }}
                    />
                </div>

                {meta ? (
                    <div className="grid gap-2 text-sm md:grid-cols-2">
                        {Object.entries(meta).map(([k, v]) => (
                            <div key={k} className="flex gap-2">
                                <div className="w-32 shrink-0 text-zinc-600 dark:text-zinc-400">{k}</div>
                                <div className="min-w-0 truncate">{String(v)}</div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-sm text-zinc-600 dark:text-zinc-400">
                        Upload a PDF to see metadata and previews.
                    </div>
                )}
            </div>
        </div>
    );
};
