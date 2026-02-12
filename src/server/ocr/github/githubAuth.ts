export interface GithubAuthProvider {
    getAccessToken(): Promise<string>;
}

export class PatAuthProvider implements GithubAuthProvider {
    async getAccessToken(): Promise<string> {
        const token = process.env.SWISSAWA_GH_PAT;
        if (!token) {
            throw new Error('Missing SWISSAWA_GH_PAT');
        }
        return token;
    }
}
