// Parses OWNERS files and resolves which teams own, or must review, changed files.

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

export const MIN_REVIEW_COUNT = 1;
export const MAX_REVIEW_COUNT = 5;
const TEAM_TOKEN = /^@[\w.-]+\/[\w.-]+$/;
const REVIEW_TOKEN = /^(required|involved)(?:\((\d+)\))?$/;
const TEST_PATTERNS = [
	'**/*.test.ts',
	'**/*.test.js',
	'**/*.test.mjs',
	'**/*.spec.ts',
	'**/*.spec.js',
	'**/*.spec.mjs',
	'**/test/**',
	'**/tests/**',
	'**/__tests__/**',
	'**/__snapshots__/**',
	'**/*.snap',
	'**/fixtures/**',
	'**/__mocks__/**',
	'packages/quality/policy/**',
	'packages/quality/testing/**',
	'packages/quality/environments/**',
	'packages/quality/efficiency/microbenchmarks/**',
];

/** @param {string} line */
function stripComment(line) {
	const commentStart = line.match(/(^|\s)#/);
	return commentStart ? line.slice(0, commentStart.index) : line;
}

/**
 * @param {string} content
 * @returns {OwnersEntry[]}
 */
export function parseOwnersContent(content) {
	/** @type {OwnersEntry[]} */
	const entries = [];

	content.split('\n').forEach((rawLine, index) => {
		const lineNumber = index + 1;
		const line = stripComment(rawLine).trim();
		if (!line) return;

		const [pattern, ...tokens] = line.split(/\s+/);
		/** @type {string | null} */
		let team = null;
		/** @type {ReviewRequirement | null} */
		let review = null;

		for (const token of tokens) {
			const reviewToken = REVIEW_TOKEN.exec(token);
			if (TEAM_TOKEN.test(token)) {
				if (review) throw new Error(`OWNERS line ${lineNumber}: team "${token}" must come before options`);
				if (team) throw new Error(`OWNERS line ${lineNumber}: only one team per pattern is supported`);
				team = token;
			} else if (reviewToken) {
				if (review) throw new Error(`OWNERS line ${lineNumber}: only one of "required" and "involved" per pattern is supported`);
				const count = Number(reviewToken[2] ?? 1);
				if (count < MIN_REVIEW_COUNT || count > MAX_REVIEW_COUNT) {
					throw new Error(`OWNERS line ${lineNumber}: count in "${token}" must be from ${MIN_REVIEW_COUNT} to ${MAX_REVIEW_COUNT}`);
				}
				review = { rule: /** @type {ReviewRule} */ (reviewToken[1]), count };
			} else {
				throw new Error(`OWNERS line ${lineNumber}: unknown token "${token}"`);
			}
		}

		if (!team) throw new Error(`OWNERS line ${lineNumber}: no team for pattern "${pattern}"`);
		if (pattern !== '*' && /[*?[]/.test(pattern)) {
			throw new Error(`OWNERS line ${lineNumber}: glob pattern "${pattern}" is not supported; use "*", a directory ("dir/"), or an exact path`);
		}
		entries.push({ pattern, team, review, line: lineNumber });
	});

	return entries;
}

/** @param {string} pattern */
function globToRegExp(pattern) {
	let source = '';
	const segments = pattern.split('/');
	for (const [index, segment] of segments.entries()) {
		const last = index === segments.length - 1;
		if (segment === '**') {
			source += last ? '.*' : '(?:[^/]+/)*';
			continue;
		}
		source += segment
			.split('*')
			.map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
			.join('[^/]*');
		if (!last) source += '/';
	}
	return new RegExp(`^${source}$`);
}

const TEST_PATTERN_REGEXPS = TEST_PATTERNS.map(globToRegExp);
const MISC_PATTERN_REGEXPS = ['pnpm-lock.yaml', '**/*.md', '**/*.mdx'].map(globToRegExp);

/** @param {string} filename */
export function isTestFile(filename) {
	return TEST_PATTERN_REGEXPS.some((pattern) => pattern.test(filename));
}

/**
 * @param {string} filename
 * @returns {FileCategory}
 */
export function categorizeFile(filename) {
	if (isTestFile(filename)) return 'testFiles';
	if (MISC_PATTERN_REGEXPS.some((pattern) => pattern.test(filename))) return 'misc';
	return 'sourceCode';
}

/**
 * @param {string} file
 * @param {string} pattern
 */
export function matchesPattern(file, pattern) {
	if (pattern === '*') return true;
	if (pattern.endsWith('/')) return file.startsWith(pattern);
	return file === pattern;
}

/**
 * @param {string} file
 * @param {OwnersEntry[]} entries
 * @returns {OwnersEntry | undefined}
 */
export function findOwningEntry(file, entries) {
	for (let index = entries.length - 1; index >= 0; index--) {
		if (matchesPattern(file, entries[index].pattern)) return entries[index];
	}
}

/**
 * @param {Iterable<string>} files
 * @param {OwnersEntry[]} entries
 * @returns {{ teams: RequiredOwnerships, rules: TeamReviewRules }}
 */
export function resolveRequiredTeams(files, entries) {
	/** @type {RequiredOwnerships} */
	const teams = {};
	/** @type {TeamReviewRules} */
	const rules = {};

	for (const file of [...files].sort()) {
		if (isTestFile(file)) continue;
		const entry = findOwningEntry(file, entries);
		if (!entry?.review) continue;
		(teams[entry.team] ??= []).push(file);
		const rule = (rules[entry.team] ??= { approvals: 0, involved: 0 });
		const key = entry.review.rule === 'required' ? 'approvals' : 'involved';
		rule[key] = Math.max(rule[key], entry.review.count);
	}

	return { teams, rules };
}

/**
 * Approvals still needed; `approvals` excludes the author.
 * @param {TeamReviewRule} rule
 * @param {number} approvals
 * @param {boolean} authorIsMember
 */
export function missingApprovals(rule, approvals, authorIsMember) {
	return Math.max(0, rule.approvals - approvals, rule.involved - (authorIsMember ? 1 : 0) - approvals);
}

/**
 * @param {Iterable<string>} files
 * @param {OwnersEntry[]} entries
 * @returns {Ownerships}
 */
export function resolveOwningTeams(files, entries) {
	/** @type {Ownerships} */
	const teams = {};

	for (const file of [...files].sort()) {
		const entry = findOwningEntry(file, entries);
		if (!entry) continue;
		(teams[entry.team] ??= []).push(file);
	}

	return teams;
}

/** @param {string} team */
export function teamHandleToSlug(team) {
	return team.replace(/^@[^/]+\//, '');
}
