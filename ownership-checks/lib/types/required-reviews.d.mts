/**
 * @param {string} entry
 * @returns {ExemptRoute}
 */
export function parseExemption(entry: string): ExemptRoute;
/**
 * @param {string} ref
 * @param {string} pattern
 */
export function matchesBranchPattern(ref: string, pattern: string): boolean;
/**
 * @param {RequiredReviewsPullRequest} pullRequest
 * @param {string[]} [exemptions]
 */
export function findExemption(pullRequest: RequiredReviewsPullRequest, exemptions?: string[]): ExemptRoute | undefined;
/** @param {PullRequestReview[]} reviews */
export function latestReviewStates(reviews: PullRequestReview[]): Map<string, string>;
/** @param {PullRequestReview[]} reviews */
export function collectApprovers(reviews: PullRequestReview[]): string[];
/**
 * @param {Record<string, number>} missing
 * @param {number} requiredCount
 * @returns {{ state: 'success' | 'pending', description: string }}
 */
export function buildRequiredReviewsStatus(missing: Record<string, number>, requiredCount: number): {
    state: "success" | "pending";
    description: string;
};
/**
 * The OWNERS entries of the repository's default branch, cached by the OWNERS blob SHA.
 * @param {string} token
 * @param {string} repository
 * @param {{ cache?: Cache }} [options]
 * @returns {Promise<{ sha: string, entries: OwnersEntry[] }>}
 */
export function getOwnershipRules(token: string, repository: string, { cache }?: {
    cache?: Cache;
}): Promise<{
    sha: string;
    entries: OwnersEntry[];
}>;
/**
 * @typedef {object} EnforcementOptions
 * @property {string} token A token that can read the repository, its pull requests and team memberships, and write commit statuses.
 * @property {string} [repository]
 * @property {number} pullRequestNumber
 * @property {string} expectedHeadSha
 * @property {string} [targetUrl]
 * @property {Cache} [cache]
 * @property {Lock} [lock]
 */
/**
 * Writes `pending`, evaluates, then writes the verdict. Any failure ends in an `error` status, never `success`.
 * @param {EnforcementOptions} options
 * @returns {Promise<RequiredReviewsResult>}
 */
export function enforceRequiredReviews(options: EnforcementOptions): Promise<RequiredReviewsResult>;
/**
 * GitHub only adds a PR to the merge queue when Required Reviews passed on its head.
 * @param {{ token: string, repository: string, headSha: string, targetUrl: string }} options
 */
export function passMergeGroup(options: {
    token: string;
    repository: string;
    headSha: string;
    targetUrl: string;
}): Promise<{
    repository: string;
    headSha: string;
    state: "success";
}>;
/**
 * @import { PullRequestReview, RequiredReviewsPullRequest } from './github.mjs'
 * @import { OwnersEntry, RequiredOwnerships, TeamReviewRules } from './owners.mjs'
 */
/**
 * Stores values under keys that never change meaning. The default stores nothing.
 * @typedef {<T>(key: string, fetch: () => Promise<T>) => Promise<T>} Cache
 */
/**
 * Runs `task` while no other evaluation with the same key runs. The default runs it at once.
 * @typedef {<T>(key: string, task: () => Promise<T>, waitMs: number) => Promise<T>} Lock
 */
/**
 * @typedef {object} RequiredReviewsResult
 * @property {string} repository
 * @property {number} pullRequestNumber
 * @property {string} headSha
 * @property {'success' | 'pending'} state
 * @property {string} description
 * @property {RequiredOwnerships} requiredTeams
 * @property {TeamReviewRules} teamRules
 * @property {string[]} missingTeams
 * @property {Record<string, number>} missingApprovals
 * @property {string[]} approvers
 * @property {string | null} exemption
 */
/** @typedef {{ head: string, base: string, source: string }} ExemptRoute */
/** @typedef {(state: 'success' | 'pending' | 'error', description: string) => Promise<void>} SetStatus */
export const REQUIRED_REVIEWS_STATUS_CONTEXT: "Required Reviews";
export const LARGE_SCALE_CHANGE_LABEL: "large-scale-change";
export const LARGE_SCALE_CHANGES_TEAM: "large-scale-changes";
export const RELEASE_HELPER_LOGIN: "n8n-release-helper[bot]";
export const REQUIRED_REVIEW_EXEMPTIONS: string[];
export const EVALUATION_DEADLINE_MS: 60000;
export const EVALUATION_LOCK_WAIT_MS: number;
export type EnforcementOptions = {
    /**
     * A token that can read the repository, its pull requests and team memberships, and write commit statuses.
     */
    token: string;
    repository?: string | undefined;
    pullRequestNumber: number;
    expectedHeadSha: string;
    targetUrl?: string | undefined;
    cache?: Cache | undefined;
    lock?: Lock | undefined;
};
/**
 * Stores values under keys that never change meaning. The default stores nothing.
 */
export type Cache = <T>(key: string, fetch: () => Promise<T>) => Promise<T>;
/**
 * Runs `task` while no other evaluation with the same key runs. The default runs it at once.
 */
export type Lock = <T>(key: string, task: () => Promise<T>, waitMs: number) => Promise<T>;
export type RequiredReviewsResult = {
    repository: string;
    pullRequestNumber: number;
    headSha: string;
    state: "success" | "pending";
    description: string;
    requiredTeams: RequiredOwnerships;
    teamRules: TeamReviewRules;
    missingTeams: string[];
    missingApprovals: Record<string, number>;
    approvers: string[];
    exemption: string | null;
};
export type ExemptRoute = {
    head: string;
    base: string;
    source: string;
};
export type SetStatus = (state: "success" | "pending" | "error", description: string) => Promise<void>;
import type { RequiredReviewsPullRequest } from './github.mjs';
import type { PullRequestReview } from './github.mjs';
import type { OwnersEntry } from './owners.mjs';
import type { RequiredOwnerships } from './owners.mjs';
import type { TeamReviewRules } from './owners.mjs';
