// The GitHub REST calls that the required-reviews evaluation makes. Needs Node 20 or later (global fetch).

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

export const DEFAULT_REQUIRED_REVIEWS_REPOSITORY = 'n8n-io/n8n';
export const REQUIRED_REVIEWS_ORG = 'n8n-io';
export const GITHUB_REQUEST_TIMEOUT_MS = 30_000;
export const GITHUB_PULL_REQUEST_FILE_LIMIT = 3000;
export const REPOSITORY_PATTERN = /^n8n-io\/(?!\.{1,2}$)[a-z0-9._-]+$/;
const PAGE_SIZE = 100;
const SHA_PATTERN = /^[a-f0-9]{40,64}$/i;

/**
 * Lowercases the repository and rejects it unless it belongs to the n8n-io organization.
 * @param {string} repository
 */
export function normalizeRepository(repository) {
	const value = String(repository).trim().toLowerCase();
	if (!REPOSITORY_PATTERN.test(value)) throw new Error('Repository must belong to the n8n-io organization.');
	return value;
}

/** @param {unknown} value */
function isObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {string} what
 * @returns {Record<string, unknown>}
 */
function object(value, what) {
	if (!isObject(value)) throw new Error(`GitHub returned an unexpected ${what}.`);
	return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {unknown} value
 * @param {string} what
 */
function string(value, what) {
	if (typeof value !== 'string') throw new Error(`GitHub returned an unexpected ${what}.`);
	return value;
}

/**
 * @param {unknown} value
 * @param {string} what
 */
function count(value, what) {
	if (!Number.isInteger(value) || /** @type {number} */ (value) < 0) throw new Error(`GitHub returned an unexpected ${what}.`);
	return /** @type {number} */ (value);
}

/**
 * @param {unknown} value
 * @param {string} what
 */
function sha(value, what) {
	if (typeof value !== 'string' || !SHA_PATTERN.test(value)) throw new Error(`GitHub returned an unexpected ${what}.`);
	return value;
}

/**
 * @param {unknown} value
 * @param {string} what
 * @returns {GitHubUser | null}
 */
function user(value, what) {
	return value === null ? null : { login: string(object(value, what).login, what) };
}

/** @param {string} token */
export function githubHeaders(token) {
	return {
		Accept: 'application/vnd.github+json',
		'User-Agent': 'n8n-ownership-checks',
		'X-GitHub-Api-Version': '2022-11-28',
		Authorization: `Bearer ${token}`,
	};
}

/**
 * @param {string} token
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<unknown>}
 */
export async function githubRequest(token, url, options = {}) {
	const response = await fetch(url, {
		...options,
		headers: { ...githubHeaders(token), ...options.headers },
		signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) {
		const body = await response.text();
		throw Object.assign(new Error(`GitHub request failed (${response.status}): ${body.slice(0, 500)}`), {
			status: response.status,
		});
	}
	return response.json();
}

/**
 * @template T
 * @param {string} token
 * @param {string} url
 * @param {(item: unknown) => T} parse
 * @returns {Promise<T[]>}
 */
export async function paginate(token, url, parse) {
	/** @type {T[]} */
	const results = [];
	for (let page = 1; page <= 100; page++) {
		const separator = url.includes('?') ? '&' : '?';
		const value = await githubRequest(token, `${url}${separator}per_page=${PAGE_SIZE}&page=${page}`);
		if (!Array.isArray(value)) throw new Error(`GitHub returned an unexpected list for ${url}.`);
		results.push(...value.map(parse));
		if (value.length < PAGE_SIZE) return results;
	}
	throw new Error(`GitHub pagination exceeded 10,000 results for ${url}`);
}

/** @param {string} repository */
function apiRoot(repository) {
	return `https://api.github.com/repos/${normalizeRepository(repository)}`;
}

/**
 * @param {unknown} value
 * @returns {RequiredReviewsPullRequest}
 */
export function parsePullRequest(value) {
	const what = 'pull request';
	const pullRequest = object(value, what);
	const head = object(pullRequest.head, what);
	const base = object(pullRequest.base, what);
	if (!Array.isArray(pullRequest.labels) || !Array.isArray(pullRequest.requested_reviewers)) {
		throw new Error(`GitHub returned an unexpected ${what}.`);
	}
	const number = count(pullRequest.number, what);
	if (number === 0) throw new Error(`GitHub returned an unexpected ${what}.`);
	return {
		number,
		user: user(pullRequest.user, what),
		labels: pullRequest.labels.map((label) => typeof label === 'string' ? label : { name: string(object(label, what).name, what) }),
		requested_reviewers: pullRequest.requested_reviewers.map((reviewer) => /** @type {GitHubUser} */ (user(object(reviewer, what), what))),
		head: {
			sha: sha(head.sha, what),
			ref: string(head.ref, what),
			repo: head.repo === null ? null : { full_name: string(object(head.repo, what).full_name, what) },
		},
		base: {
			sha: sha(base.sha, what),
			ref: string(base.ref, what),
			repo: { full_name: string(object(base.repo, what).full_name, what) },
		},
	};
}

/**
 * @param {unknown} value
 * @returns {ChangedFile}
 */
export function parseChangedFile(value) {
	const what = 'changed file';
	const file = object(value, what);
	return {
		filename: string(file.filename, what),
		...(file.previous_filename === undefined ? {} : { previous_filename: string(file.previous_filename, what) }),
		additions: count(file.additions, what),
		deletions: count(file.deletions, what),
	};
}

/**
 * @param {unknown} value
 * @returns {PullRequestReview}
 */
export function parseReview(value) {
	const what = 'review';
	const review = object(value, what);
	const submittedAt = review.submitted_at;
	return {
		user: user(review.user, what),
		state: string(review.state, what),
		...(submittedAt === undefined ? {} : { submitted_at: submittedAt === null ? null : string(submittedAt, what) }),
	};
}

/**
 * @param {unknown} value
 * @returns {PullRequestEvent}
 */
export function parseEvent(value) {
	const what = 'pull request event';
	const event = object(value, what);
	/** @type {PullRequestEvent} */
	const result = { event: string(event.event, what), actor: user(event.actor, what) };
	if (event.label === null) result.label = null;
	else if (event.label !== undefined) {
		const name = object(event.label, what).name;
		result.label = name === undefined ? {} : { name: string(name, what) };
	}
	return result;
}

/**
 * @param {string} token
 * @param {string} repository
 * @param {number} number
 */
export async function fetchRequiredReviewsPullRequest(token, repository, number) {
	repository = normalizeRepository(repository);
	const pullRequest = parsePullRequest(await githubRequest(token, `${apiRoot(repository)}/pulls/${number}`));
	if (pullRequest.number !== number || pullRequest.base.repo.full_name.toLowerCase() !== repository) {
		throw new Error('GitHub returned a different pull request than requested.');
	}
	return pullRequest;
}

/**
 * Rejects lists at GitHub's limit, which can be incomplete, unless `allowIncomplete` is set.
 * @param {string} token
 * @param {string} repository
 * @param {number} number
 * @param {{ allowIncomplete?: boolean }} [options]
 */
export async function fetchPullRequestFiles(token, repository, number, { allowIncomplete = false } = {}) {
	const files = await paginate(token, `${apiRoot(repository)}/pulls/${number}/files`, parseChangedFile);
	if (files.length >= GITHUB_PULL_REQUEST_FILE_LIMIT && !allowIncomplete) {
		throw new Error('GitHub caps pull request file lists at 3,000 files; cannot verify all changed paths.');
	}
	return files;
}

/** @param {ChangedFile[]} files */
export function changedPaths(files) {
	return [...new Set(files.flatMap((file) => [file.filename, file.previous_filename].filter(
		/** @returns {name is string} */ (name) => Boolean(name),
	)))];
}

/**
 * @param {string} token
 * @param {string} repository
 * @param {number} number
 */
export async function fetchChangedFiles(token, repository, number) {
	return changedPaths(await fetchPullRequestFiles(token, repository, number));
}

/**
 * @param {string} token
 * @param {string} repository
 * @param {number} number
 */
export function fetchPullRequestReviews(token, repository, number) {
	return paginate(token, `${apiRoot(repository)}/pulls/${number}/reviews`, parseReview);
}

/**
 * @param {string} token
 * @param {string} repository
 * @param {number} number
 */
export function fetchPullRequestEvents(token, repository, number) {
	return paginate(token, `${apiRoot(repository)}/issues/${number}/events`, parseEvent);
}

/**
 * @param {string} token
 * @param {string} repository
 */
export async function fetchTrustedDefaultBranch(token, repository) {
	repository = normalizeRepository(repository);
	const name = string(object(await githubRequest(token, apiRoot(repository)), 'repository').default_branch, 'repository');
	if (!name) throw new Error('GitHub returned an unexpected repository.');
	const ref = object(await githubRequest(token, `${apiRoot(repository)}/git/ref/heads/${encodeURIComponent(name)}`), 'branch');
	return { name, sha: sha(object(ref.object, 'branch').sha, 'branch') };
}

/**
 * @param {string} token
 * @param {string} repository
 * @param {string} ref
 */
export async function fetchOwnersFile(token, repository, ref) {
	const what = 'OWNERS file';
	const file = object(await githubRequest(token, `${apiRoot(repository)}/contents/OWNERS?ref=${encodeURIComponent(ref)}`), what);
	if (file.type !== 'file' || file.encoding !== 'base64') throw new Error(`GitHub returned an unexpected ${what}.`);
	return {
		sha: sha(file.sha, what),
		content: Buffer.from(string(file.content, what).replace(/\s/g, ''), 'base64').toString('utf8'),
	};
}

/**
 * @param {string} token
 * @param {string} teamSlug
 * @param {string} username
 */
export async function isActiveTeamMember(token, teamSlug, username) {
	try {
		const membership = object(await githubRequest(
			token,
			`https://api.github.com/orgs/${REQUIRED_REVIEWS_ORG}/teams/${encodeURIComponent(teamSlug)}/memberships/${encodeURIComponent(username)}`,
		), 'team membership');
		return string(membership.state, 'team membership') === 'active';
	} catch (error) {
		if (isObject(error) && /** @type {{ status?: unknown }} */ (error).status === 404) return false;
		throw error;
	}
}

/**
 * @param {string} token
 * @param {string} repository
 * @param {string} commitSha
 * @param {{ state: CommitStatusState, context: string, description: string, targetUrl?: string }} status
 */
export async function setCommitStatus(token, repository, commitSha, status) {
	if (!SHA_PATTERN.test(commitSha)) throw new Error(`Invalid commit SHA "${commitSha}".`);
	await githubRequest(token, `${apiRoot(repository)}/statuses/${commitSha}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			state: status.state,
			context: status.context,
			description: status.description.length > 140 ? `${status.description.slice(0, 139)}…` : status.description,
			...(status.targetUrl ? { target_url: status.targetUrl } : {}),
		}),
	});
}
