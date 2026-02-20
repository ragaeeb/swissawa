import type { AnalyzeApiResponse, SkaluApiResponse } from '@/lib/skalu';

export const runtime = 'nodejs';

const parseJsonBody = (request: Request): Promise<unknown> => request.json().catch(() => null);

const isHttpUrl = (raw: string): boolean => {
    try {
        const u = new URL(raw);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
};

export const POST = async (request: Request): Promise<Response> => {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
        return Response.json({ error: 'Expected application/json' }, { status: 400 });
    }

    const json = await parseJsonBody(request);
    console.log('json', json);
    const url = (json as any)?.url as unknown;
    if (typeof url !== 'string' || !isHttpUrl(url)) {
        return Response.json({ error: 'Invalid url' }, { status: 400 });
    }

    try {
        const form = new FormData();
        form.append('file_url', url);
        form.append('include_visualizations', 'false');

        console.log('fetching', `${process.env.SWISSAWA_SKALU_BASE_URL}/analyze`);

        const res = await fetch(`${process.env.SWISSAWA_SKALU_BASE_URL}/analyze`, { body: form, method: 'POST' });

        if (!res.ok) {
            return Response.json({ error: `Skalu analyze failed (${res.status})` }, { status: 502 });
        }

        console.log('decod response');

        const body = (await res.json()) as SkaluApiResponse;
        console.log('body', body);
        const response: AnalyzeApiResponse = { pages: body.result_data.pages };
        return Response.json(response);
    } catch (err: unknown) {
        return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
    }
};
