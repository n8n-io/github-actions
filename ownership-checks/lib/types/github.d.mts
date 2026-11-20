/**
 * Lowercases the repository and rejects it unless it belongs to the n8n-io organization.
 * @param {string} repository
 */
export function normalizeRepository(repository: string): string;
/** @param {string} token */
export function githubHeaders(token: string): {
    Accept: string;
    'User-Agent': string;
    'X-GitHub-Api-Version': string;
    Authorization: string;
};
/**
 * @param {string} token
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<unknown>}
 */
export function githubRequest(token: string, url: string, options?: RequestInit): Promise<unknown>;
/**
 * @template T
 * @param {string} token
 * @param {string} url
 * @param {(item: unknown) => T} parse
 * @returns {Promise<T[]>}
 */
export function paginate<T>(token: string, url: string, parse: (item: unknown) => T): Promise<T[]>;
/**
 * @param {unknown} value
 * @returns {RequiredReviewsPullRequest}
 */
export function parsePullRequest(value: unknown): RequiredReviewsPullRequest;
/**
 * @param {unknown} value
 * @returns {ChangedFile}
 */
export function parseChangedFile(value: unknown): ChangedFile;
/**
 * @param {unknown} value
 * @returns {PullRequestReview}
 */
export function parseReview(value: unknown): PullRequestReview;
/**
 * @param {unknown} value
 * @returns {PullRequestEvent}
 */
export function parseEvent(value: unknown): PullRequestEvent;
/**
 * @param {string} token
 * @param {string} repository
 * @param {number} number
 */
export function fetchRequiredReviewsPullRequest(token: string, repository: string, number: number): Promise<RequiredReviewsPullRequest>;
/**
 * Rejects lists at GitHub's limit, which can be incomplete, unless `allowIncomplete` is set.
 * @param {string} token
 * @param {string} repository
 * @param {number} number
 * @param {{ allowIncomplete?: boolean }} [options]
 */
export function fetchPullRequestFiles(token: string, repository: string, number: number, { allowIncomplete }?: {
    allowIncomplete?: boolean;
}): Promise<ChangedFile[]>;
/** @param {ChangedFile[]} files */
export function changedPaths(files: ChangedFile[]): string[];
/**
 * @param {string} token
 * @param {string} repository
 * @param {number} number
 */
export function fetchChangedFiles(token: string, repository: string, number: number): Promise<string[]>;
/**
 * @param {string} token
 * @param {string} repository
 * @param {number} number
 */
export function fetchPullRequestReviews(token: string, repository: string, number: number): Promise<PullRequestReview[]>;
/**
 * @param {string} token
 * @param {string} repository
 * @param {number} number
 */
export function fetchPullRequestEvents(token: string, repository: string, number: number): Promise<PullRequestEvent[]>;
/**
 * @param {string} token
 * @param {string} repository
 */
export function fetchTrustedDefaultBranch(token: string, repository: string): Promise<{
    name: string;
    sha: string;
}>;
/**
 * @param {string} token
 * @param {string} repository
 * @param {string} ref
 */
export function fetchOwnersFile(token: string, repository: string, ref: string): Promise<{
    sha: string;
    content: string;
}>;
/**
 * @param {string} token
 * @param {string} teamSlug
 * @param {string} username
 */
export function isActiveTeamMember(token: string, teamSlug: string, username: string): Promise<boolean>;
/**
 * @param {string} token
 * @param {string} repository
 * @param {string} commitSha
 * @param {{ state: CommitStatusState, context: string, description: string, targetUrl?: string }} status
 */
export function setCommitStatus(token: string, repository: string, commitSha: string, status: {
    state: CommitStatusState;
    context: string;
    description: string;
    targetUrl?: string;
}): Promise<void>;
/**
 * @typedef {{ login: string }} GitHubUser
 * @typedef {object} RequiredReviewsPullRequest
 * @property {number} number
 * @property {GitHubUser | null} user
 * @property {Array<string | { name: string }>} labels
 * @property {GitHubUser[]} requested_reviewers
 * @property {{ sha: string, ref: string, repo: { full_name: string } | null }} head
 * @property {{ sha: string, ref: string, repo: { full_name: string } }} base
 * @typedef {{ filename: string, previous_filename?: string, additions: number, deletions: number }} ChangedFile
 * @typedef {{ user: GitHubUser | null, state: string, submitted_at?: string | null }} PullRequestReview
 * @typedef {{ event: string, actor: GitHubUser | null, label?: { name?: string } | null }} PullRequestEvent
 * @typedef {'success' | 'failure' | 'pending' | 'error'} CommitStatusState
 */
export const DEFAULT_REQUIRED_REVIEWS_REPOSITORY: "n8n-io/n8n";
export const REQUIRED_REVIEWS_ORG: "n8n-io";
export const GITHUB_REQUEST_TIMEOUT_MS: 30000;
export const GITHUB_PULL_REQUEST_FILE_LIMIT: 3000;
export const REPOSITORY_PATTERN: RegExp;
export type GitHubUser = {
    login: string;
};
export type RequiredReviewsPullRequest = {
    number: number;
    user: GitHubUser | null;
    labels: Array<string | {
        name: string;
    }>;
    requested_reviewers: GitHubUser[];
    head: {
        sha: string;
        ref: string;
        repo: {
            full_name: string;
        } | null;
    };
    base: {
        sha: string;
        ref: string;
        repo: {
            full_name: string;
        };
    };
};
export type ChangedFile = {
    filename: string;
    previous_filename?: string;
    additions: number;
    deletions: number;
};
export type PullRequestReview = {
    user: GitHubUser | null;
    state: string;
    submitted_at?: string | null;
};
export type PullRequestEvent = {
    event: string;
    actor: GitHubUser | null;
    label?: {
        name?: string;
    } | null;
};
export type CommitStatusState = "success" | "failure" | "pending" | "error";
