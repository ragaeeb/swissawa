import type { GithubAuthProvider } from '@/server/ocr/github/githubAuth';

type WorkflowRun = {
    id: number;
    html_url: string;
    status: 'queued' | 'in_progress' | 'completed' | string;
    conclusion: string | null;
    name?: string;
    display_title?: string;
    created_at: string;
};

type Artifact = { id: number; name: string; archive_download_url: string; expired: boolean };
type DispatchResult = { dispatchedAtMs: number; requestIdAccepted: boolean };

function parseRepo(repo: string): { owner: string; repo: string } {
    const [owner, name] = repo.split('/');
    if (!owner || !name) {
        throw new Error('SWISSAWA_GH_OCR_REPO must be "owner/repo"');
    }
    return { owner, repo: name };
}

async function githubRequest(
    auth: GithubAuthProvider,
    path: string,
    init?: RequestInit,
    expectStatus?: number | number[],
): Promise<Response> {
    const token = await auth.getAccessToken();
    const response = await fetch(`https://api.github.com${path}`, {
        ...init,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(init?.headers ?? {}),
        },
    });
    if (!expectStatus) {
        return response;
    }
    const expected = Array.isArray(expectStatus) ? expectStatus : [expectStatus];
    if (!expected.includes(response.status)) {
        const body = await response.text().catch(() => '');
        throw new Error(`GitHub API ${path} failed (${response.status}): ${body}`);
    }
    return response;
}

async function githubAbsoluteRequest(auth: GithubAuthProvider, url: string, init?: RequestInit): Promise<Response> {
    const token = await auth.getAccessToken();
    return await fetch(url, {
        ...init,
        headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            ...(init?.headers ?? {}),
        },
    });
}

export type GithubActionsClientOptions = { auth: GithubAuthProvider; repo: string; workflow: string; ref: string };

export class GithubActionsClient {
    private readonly auth: GithubAuthProvider;
    private readonly owner: string;
    private readonly repo: string;
    private readonly workflow: string;
    private readonly ref: string;

    constructor(options: GithubActionsClientOptions) {
        this.auth = options.auth;
        const parsed = parseRepo(options.repo);
        this.owner = parsed.owner;
        this.repo = parsed.repo;
        this.workflow = options.workflow;
        this.ref = options.ref;
    }

    workflowRunUrl(runId: number): string {
        return `https://github.com/${this.owner}/${this.repo}/actions/runs/${runId}`;
    }

    async dispatchWorkflow(inputs: Record<string, string>): Promise<DispatchResult> {
        const path = `/repos/${this.owner}/${this.repo}/actions/workflows/${encodeURIComponent(this.workflow)}/dispatches`;
        const dispatchedAtMs = Date.now();
        try {
            await githubRequest(
                this.auth,
                path,
                { body: JSON.stringify({ inputs, ref: this.ref }), method: 'POST' },
                204,
            );
            return { dispatchedAtMs, requestIdAccepted: true };
        } catch (err) {
            // Backward-compatibility with older workflows that don't define request_id/artifact_name inputs.
            if (!(err instanceof Error) || !err.message.includes('Unexpected inputs provided')) {
                throw err;
            }
            const legacyInputs = { ...inputs };
            delete legacyInputs.request_id;
            delete legacyInputs.artifact_name;
            await githubRequest(
                this.auth,
                path,
                { body: JSON.stringify({ inputs: legacyInputs, ref: this.ref }), method: 'POST' },
                204,
            );
            return { dispatchedAtMs, requestIdAccepted: false };
        }
    }

    async findRunByRequestId(requestId: string): Promise<WorkflowRun | null> {
        const response = await githubRequest(
            this.auth,
            `/repos/${this.owner}/${this.repo}/actions/workflows/${encodeURIComponent(this.workflow)}/runs?event=workflow_dispatch&per_page=30`,
            undefined,
            200,
        );
        const data = (await response.json()) as { workflow_runs?: WorkflowRun[] };
        const runs = data.workflow_runs ?? [];
        for (const run of runs) {
            const title = `${run.display_title ?? ''} ${run.name ?? ''}`;
            if (title.includes(requestId)) {
                return run;
            }
        }
        return null;
    }

    async findMostRecentDispatchedRunSince(sinceMs: number): Promise<WorkflowRun | null> {
        const response = await githubRequest(
            this.auth,
            `/repos/${this.owner}/${this.repo}/actions/workflows/${encodeURIComponent(this.workflow)}/runs?event=workflow_dispatch&per_page=30`,
            undefined,
            200,
        );
        const data = (await response.json()) as { workflow_runs?: WorkflowRun[] };
        const runs = data.workflow_runs ?? [];
        const threshold = sinceMs - 15_000;
        for (const run of runs) {
            const createdAtMs = Date.parse(run.created_at);
            if (Number.isFinite(createdAtMs) && createdAtMs >= threshold) {
                return run;
            }
        }
        return null;
    }

    async getRun(runId: number): Promise<WorkflowRun> {
        const response = await githubRequest(
            this.auth,
            `/repos/${this.owner}/${this.repo}/actions/runs/${runId}`,
            undefined,
            200,
        );
        return (await response.json()) as WorkflowRun;
    }

    async waitForRunCompletion(runId: number, timeoutMs: number, pollIntervalMs: number): Promise<WorkflowRun> {
        const startedAt = Date.now();
        while (true) {
            const run = await this.getRun(runId);
            if (run.status === 'completed') {
                return run;
            }
            if (Date.now() - startedAt > timeoutMs) {
                throw new Error('Timed out waiting for remote workflow completion');
            }
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
    }

    async findArtifactByName(runId: number, artifactName: string): Promise<Artifact | null> {
        const response = await githubRequest(
            this.auth,
            `/repos/${this.owner}/${this.repo}/actions/runs/${runId}/artifacts`,
            undefined,
            200,
        );
        const data = (await response.json()) as { artifacts?: Artifact[] };
        const artifacts = data.artifacts ?? [];
        return artifacts.find((a) => a.name === artifactName && !a.expired) ?? null;
    }

    async findArtifactForRun(runId: number, preferredNames: string[]): Promise<Artifact | null> {
        const response = await githubRequest(
            this.auth,
            `/repos/${this.owner}/${this.repo}/actions/runs/${runId}/artifacts`,
            undefined,
            200,
        );
        const data = (await response.json()) as { artifacts?: Artifact[] };
        const artifacts = (data.artifacts ?? []).filter((a) => !a.expired);
        for (const name of preferredNames) {
            const match = artifacts.find((a) => a.name === name);
            if (match) {
                return match;
            }
        }
        return artifacts[0] ?? null;
    }

    async downloadArtifactZip(artifact: Artifact): Promise<ArrayBuffer> {
        const response = await githubAbsoluteRequest(this.auth, artifact.archive_download_url);
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`Failed to download artifact (${response.status}): ${body}`);
        }
        return await response.arrayBuffer();
    }
}
