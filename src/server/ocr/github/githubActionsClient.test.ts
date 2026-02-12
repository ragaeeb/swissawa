import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { GithubActionsClient } from '@/server/ocr/github/githubActionsClient';
import type { GithubAuthProvider } from '@/server/ocr/github/githubAuth';

class TestAuthProvider implements GithubAuthProvider {
    async getAccessToken(): Promise<string> {
        return 'token';
    }
}

describe('GithubActionsClient', () => {
    const auth = new TestAuthProvider();

    beforeEach(() => {
        mock.restore();
    });

    it('dispatches workflow and expects 204', async () => {
        // @ts-expect-error test mock
        global.fetch = mock(async (_url: string, init?: RequestInit) => {
            expect(init?.method).toBe('POST');
            return new Response(null, { status: 204 });
        });

        const client = new GithubActionsClient({ auth, ref: 'main', repo: 'owner/repo', workflow: 'ocr-remote.yml' });
        const dispatch = await client.dispatchWorkflow({ request_id: 'abc' });
        expect(dispatch.requestIdAccepted).toBeTrue();
    });

    it('retries dispatch without unsupported inputs when workflow rejects them', async () => {
        let call = 0;
        // @ts-expect-error test mock
        global.fetch = mock(async () => {
            call += 1;
            if (call === 1) {
                return Response.json(
                    {
                        message: 'Unexpected inputs provided: ["artifact_name", "request_id"]',
                    },
                    { status: 422 },
                );
            }
            return new Response(null, { status: 204 });
        });

        const client = new GithubActionsClient({ auth, ref: 'main', repo: 'owner/repo', workflow: 'ocr-remote.yml' });
        const dispatch = await client.dispatchWorkflow({
            artifact_name: 'ocr-results-1',
            pdf_url: 'https://example.com/input.pdf',
            request_id: 'abc',
        });
        expect(dispatch.requestIdAccepted).toBeFalse();
        expect(call).toBe(2);
    });

    it('finds run by request id in run display title', async () => {
        // @ts-expect-error test mock
        global.fetch = mock(async () => {
            return Response.json({
                workflow_runs: [{ created_at: new Date().toISOString(), display_title: 'remote-ocr:req-123', id: 99 }],
            });
        });

        const client = new GithubActionsClient({ auth, ref: 'main', repo: 'owner/repo', workflow: 'ocr-remote.yml' });
        const run = await client.findRunByRequestId('req-123');
        expect(run?.id).toBe(99);
    });

    it('returns null when artifact not found', async () => {
        // @ts-expect-error test mock
        global.fetch = mock(async () => Response.json({ artifacts: [] }));

        const client = new GithubActionsClient({ auth, ref: 'main', repo: 'owner/repo', workflow: 'ocr-remote.yml' });
        const artifact = await client.findArtifactByName(10, 'ocr-results');
        expect(artifact).toBeNull();
    });

    it('finds most recent dispatch run since a timestamp', async () => {
        const nowIso = new Date().toISOString();
        // @ts-expect-error test mock
        global.fetch = mock(async () => Response.json({ workflow_runs: [{ created_at: nowIso, id: 77 }] }));

        const client = new GithubActionsClient({ auth, ref: 'main', repo: 'owner/repo', workflow: 'ocr-remote.yml' });
        const run = await client.findMostRecentDispatchedRunSince(Date.now() - 1000);
        expect(run?.id).toBe(77);
    });

    it('falls back artifact lookup to preferred names then first artifact', async () => {
        // @ts-expect-error test mock
        global.fetch = mock(async () =>
            Response.json({
                artifacts: [
                    { archive_download_url: 'https://a.example', expired: false, id: 1, name: 'other' },
                    { archive_download_url: 'https://b.example', expired: false, id: 2, name: 'ocr-results' },
                ],
            }),
        );

        const client = new GithubActionsClient({ auth, ref: 'main', repo: 'owner/repo', workflow: 'ocr-remote.yml' });
        const artifact = await client.findArtifactForRun(10, ['custom-name', 'ocr-results']);
        expect(artifact?.name).toBe('ocr-results');
    });

    it('throws on timeout while waiting for completion', async () => {
        // @ts-expect-error test mock
        global.fetch = mock(async () => {
            return Response.json({
                conclusion: null,
                created_at: new Date().toISOString(),
                html_url: 'https://example.com',
                id: 1,
                status: 'in_progress',
            });
        });

        const client = new GithubActionsClient({ auth, ref: 'main', repo: 'owner/repo', workflow: 'ocr-remote.yml' });
        await expect(client.waitForRunCompletion(1, 1, 1)).rejects.toThrow('Timed out');
    });
});
