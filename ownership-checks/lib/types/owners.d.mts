/**
 * @param {string} content
 * @returns {OwnersEntry[]}
 */
export function parseOwnersContent(content: string): OwnersEntry[];
/** @param {string} filename */
export function isTestFile(filename: string): boolean;
/**
 * @param {string} filename
 * @returns {FileCategory}
 */
export function categorizeFile(filename: string): FileCategory;
/**
 * @param {string} file
 * @param {string} pattern
 */
export function matchesPattern(file: string, pattern: string): boolean;
/**
 * @param {string} file
 * @param {OwnersEntry[]} entries
 * @returns {OwnersEntry | undefined}
 */
export function findOwningEntry(file: string, entries: OwnersEntry[]): OwnersEntry | undefined;
/**
 * @param {Iterable<string>} files
 * @param {OwnersEntry[]} entries
 * @returns {{ teams: RequiredOwnerships, rules: TeamReviewRules }}
 */
export function resolveRequiredTeams(files: Iterable<string>, entries: OwnersEntry[]): {
    teams: RequiredOwnerships;
    rules: TeamReviewRules;
};
/**
 * Approvals still needed; `approvals` excludes the author.
 * @param {TeamReviewRule} rule
 * @param {number} approvals
 * @param {boolean} authorIsMember
 */
export function missingApprovals(rule: TeamReviewRule, approvals: number, authorIsMember: boolean): number;
/**
 * @param {Iterable<string>} files
 * @param {OwnersEntry[]} entries
 * @returns {Ownerships}
 */
export function resolveOwningTeams(files: Iterable<string>, entries: OwnersEntry[]): Ownerships;
/** @param {string} team */
export function teamHandleToSlug(team: string): string;
/**
 * `required`: k team members approve. `involved`: k team members review, and an author in the team counts as one.
 * @typedef {'required' | 'involved'} ReviewRule
 * @typedef {{ rule: ReviewRule, count: number }} ReviewRequirement
 * @typedef {{ pattern: string, team: string, review: ReviewRequirement | null, line: number }} OwnersEntry
 * @typedef {object} TeamReviewRule
 * @property {number} approvals Approvals needed from team members other than the author.
 * @property {number} involved Team members needed, the author included.
 * @typedef {Record<string, string[]>} RequiredOwnerships
 * @typedef {Record<string, TeamReviewRule>} TeamReviewRules
 * @typedef {Record<string, string[]>} Ownerships
 * @typedef {'sourceCode' | 'testFiles' | 'misc'} FileCategory
 */
export const MIN_REVIEW_COUNT: 1;
export const MAX_REVIEW_COUNT: 5;
/**
 * `required`: k team members approve. `involved`: k team members review, and an author in the team counts as one.
 */
export type ReviewRule = "required" | "involved";
/**
 * `required`: k team members approve. `involved`: k team members review, and an author in the team counts as one.
 */
export type ReviewRequirement = {
    rule: ReviewRule;
    count: number;
};
/**
 * `required`: k team members approve. `involved`: k team members review, and an author in the team counts as one.
 */
export type OwnersEntry = {
    pattern: string;
    team: string;
    review: ReviewRequirement | null;
    line: number;
};
/**
 * `required`: k team members approve. `involved`: k team members review, and an author in the team counts as one.
 */
export type TeamReviewRule = {
    /**
     * Approvals needed from team members other than the author.
     */
    approvals: number;
    /**
     * Team members needed, the author included.
     */
    involved: number;
};
/**
 * `required`: k team members approve. `involved`: k team members review, and an author in the team counts as one.
 */
export type RequiredOwnerships = Record<string, string[]>;
/**
 * `required`: k team members approve. `involved`: k team members review, and an author in the team counts as one.
 */
export type TeamReviewRules = Record<string, TeamReviewRule>;
/**
 * `required`: k team members approve. `involved`: k team members review, and an author in the team counts as one.
 */
export type Ownerships = Record<string, string[]>;
/**
 * `required`: k team members approve. `involved`: k team members review, and an author in the team counts as one.
 */
export type FileCategory = "sourceCode" | "testFiles" | "misc";
