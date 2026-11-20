// Evaluates the `required` and `involved` OWNERS entries of a pull request and writes the `Required Reviews` status.

import {
	DEFAULT_REQUIRED_REVIEWS_REPOSITORY,
	fetchChangedFiles,
	fetchOwnersFile,
	fetchPullRequestEvents,
	fetchPullRequestReviews,
	fetchRequiredReviewsPullRequest,
	fetchTrustedDefaultBranch,
	GITHUB_REQUEST_TIMEOUT_MS,
	isActiveTeamMember,
	normalizeRepository,
	setCommitStatus,
} from './github.mjs';
import { missingApprovals, parseOwnersContent, resolveRequiredTeams, teamHandleToSlug } from './owners.mjs';

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

export const REQUIRED_REVIEWS_STATUS_CONTEXT = 'Required Reviews';
export const LARGE_SCALE_CHANGE_LABEL = 'large-scale-change';
export const LARGE_SCALE_CHANGES_TEAM = 'large-scale-changes';
export const RELEASE_HELPER_LOGIN = 'n8n-release-helper[bot]';
export const REQUIRED_REVIEW_EXEMPTIONS = ['sync/master-to-3x -> 3.x'];
export const EVALUATION_DEADLINE_MS = 60_000;
// Longer than a holder can run: its deadline plus the final and error status writes.
export const EVALUATION_LOCK_WAIT_MS = EVALUATION_DEADLINE_MS + 2 * GITHUB_REQUEST_TIMEOUT_MS + 60_000;
const EVALUATION_FAILED = 'Evaluation failed; see the workflow run';

/** @type {Cache} */
const noCache = (_key, fetch) => fetch();
/** @type {Lock} */
const noLock = (_key, task) => task();

/**
 * @param {string} entry
 * @returns {ExemptRoute}
 */
export function parseExemption(entry) {
	const parts = entry.split('->').map((part) => part.trim());
	if (parts.length > 2 || parts.some((part) => part === '')) {
		throw new Error(`Invalid exemption "${entry}": expected "<head> -> <base>" or "<base>"`);
	}
	const [head, base] = parts.length === 2 ? parts : ['*', parts[0]];
	return { head, base, source: entry };
}

/**
 * @param {string} ref
 * @param {string} pattern
 */
export function matchesBranchPattern(ref, pattern) {
	const escaped = pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	return new RegExp(`^${escaped.join('.*')}$`).test(ref);
}

/**
 * @param {RequiredReviewsPullRequest} pullRequest
 * @param {string[]} [exemptions]
 */
export function findExemption(pullRequest, exemptions = REQUIRED_REVIEW_EXEMPTIONS) {
	if (pullRequest.head.repo?.full_name !== pullRequest.base.repo.full_name) return undefined;
	return exemptions
		.map(parseExemption)
		.find((route) => matchesBranchPattern(pullRequest.head.ref, route.head) && matchesBranchPattern(pullRequest.base.ref, route.base));
}

/** @param {PullRequestReview[]} reviews */
export function latestReviewStates(reviews) {
	const meaningful = reviews
		.filter(/** @returns {review is PullRequestReview & { user: { login: string } }} */ (review) => Boolean(review.user?.login))
		.filter((review) => ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state))
		.toSorted((left, right) => new Date(left.submitted_at ?? 0).getTime() - new Date(right.submitted_at ?? 0).getTime());
	/** @type {Map<string, string>} */
	const states = new Map();
	for (const review of meaningful) states.set(review.user.login, review.state);
	return states;
}

/** @param {PullRequestReview[]} reviews */
export function collectApprovers(reviews) {
	return [...latestReviewStates(reviews)]
		.filter(([, state]) => state === 'APPROVED')
		.map(([login]) => login);
}

/**
 * @param {Record<string, number>} missing
 * @param {number} requiredCount
 * @returns {{ state: 'success' | 'pending', description: string }}
 */
export function buildRequiredReviewsStatus(missing, requiredCount) {
	const missingTeams = Object.entries(missing);
	if (requiredCount === 0) {
		return { state: 'success', description: 'No team approval is required for these changes' };
	}
	if (missingTeams.length === 0) {
		return {
			state: 'success',
			description: `All required team approvals are present (${requiredCount} team${requiredCount === 1 ? '' : 's'})`,
		};
	}
	return {
		state: 'pending',
		description: `Waiting for approval from: ${missingTeams
			.map(([team, needed]) => needed === 1 ? teamHandleToSlug(team) : `${needed} from ${teamHandleToSlug(team)}`)
			.join(', ')}`,
	};
}

/**
 * @param {string} token
 * @param {string} repository
 * @param {number} number
 * @param {RequiredReviewsPullRequest} pullRequest
 */
async function findLargeScaleChangeExemption(token, repository, number, pullRequest) {
	const labels = pullRequest.labels.map((label) => typeof label === 'string' ? label : label.name);
	if (!labels.includes(LARGE_SCALE_CHANGE_LABEL)) return undefined;

	const events = (await fetchPullRequestEvents(token, repository, number)).filter((event) =>
		['labeled', 'unlabeled'].includes(event.event) && event.label?.name === LARGE_SCALE_CHANGE_LABEL,
	);
	const latest = events.at(-1);
	const actor = latest?.event === 'labeled' ? latest.actor?.login : undefined;
	if (!actor) return undefined;
	return await isActiveTeamMember(token, LARGE_SCALE_CHANGES_TEAM, actor) ? actor : undefined;
}

/**
 * The OWNERS entries of the repository's default branch, cached by the OWNERS blob SHA.
 * @param {string} token
 * @param {string} repository
 * @param {{ cache?: Cache }} [options]
 * @returns {Promise<{ sha: string, entries: OwnersEntry[] }>}
 */
export async function getOwnershipRules(token, repository, { cache = noCache } = {}) {
	const trustedBranch = await fetchTrustedDefaultBranch(token, repository);
	const ownersFile = await cache(
		`github:repository-file:${repository}:${trustedBranch.sha}:OWNERS:v1`,
		() => fetchOwnersFile(token, repository, trustedBranch.sha),
	);
	const owners = await cache(
		`github:owners:${repository}:${ownersFile.sha}:v3`,
		async () => ({ entries: parseOwnersContent(ownersFile.content) }),
	);
	return { sha: ownersFile.sha, entries: owners.entries };
}

/**
 * @param {string} token
 * @param {string} repository
 * @param {number} number
 * @param {RequiredReviewsPullRequest} pullRequest
 * @param {Cache} cache
 */
async function getRequiredOwnerships(token, repository, number, pullRequest, cache) {
	const owners = await getOwnershipRules(token, repository, { cache });
	return cache(
		`github:required-ownerships:${repository}:${number}:${pullRequest.base.sha}:${pullRequest.head.sha}:${owners.sha}:v4`,
		async () => resolveRequiredTeams(await fetchChangedFiles(token, repository, number), owners.entries),
	);
}

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
export async function enforceRequiredReviews(options) {
	const { token, pullRequestNumber, expectedHeadSha, targetUrl, cache = noCache, lock = noLock } = options;
	const repository = normalizeRepository(options.repository ?? DEFAULT_REQUIRED_REVIEWS_REPOSITORY);
	/** @type {SetStatus} */
	const setStatus = (state, description) => setCommitStatus(token, repository, expectedHeadSha, {
		state,
		description,
		context: REQUIRED_REVIEWS_STATUS_CONTEXT,
		targetUrl,
	});

	const reportError = async () => {
		try {
			await setStatus('error', EVALUATION_FAILED);
		} catch {
			// The initial pending status still fails closed if reporting the nicer error status also fails.
		}
	};

	await setStatus('pending', 'Evaluating required reviews');

	let errorReported = false;
	try {
		// Cancelling the caller does not always stop an evaluation, so an older one could overwrite a newer verdict.
		return await lock(`required-reviews:${repository}:${expectedHeadSha.toLowerCase()}`, async () => {
			try {
				return await evaluateRequiredReviews(token, repository, pullRequestNumber, expectedHeadSha, setStatus, cache);
			} catch (error) {
				// Report inside the lock, so this error cannot overwrite the verdict of the next evaluation.
				await reportError();
				errorReported = true;
				throw error;
			}
		}, EVALUATION_LOCK_WAIT_MS);
	} catch (error) {
		if (!errorReported) await reportError();
		throw error;
	}
}

/**
 * GitHub only adds a PR to the merge queue when Required Reviews passed on its head.
 * @param {{ token: string, repository: string, headSha: string, targetUrl: string }} options
 */
export async function passMergeGroup(options) {
	const repository = normalizeRepository(options.repository);
	await setCommitStatus(options.token, repository, options.headSha, {
		state: 'success',
		context: REQUIRED_REVIEWS_STATUS_CONTEXT,
		description: 'Approvals were verified before the PR entered the queue',
		targetUrl: options.targetUrl,
	});
	return { repository, headSha: options.headSha, state: /** @type {const} */ ('success') };
}

/**
 * @param {string} token
 * @param {string} repository
 * @param {number} pullRequestNumber
 * @param {string} expectedHeadSha
 * @param {SetStatus} setStatus
 * @param {Cache} cache
 * @returns {Promise<RequiredReviewsResult>}
 */
async function evaluateRequiredReviews(token, repository, pullRequestNumber, expectedHeadSha, setStatus, cache) {
	const deadline = Date.now() + EVALUATION_DEADLINE_MS;
	const pullRequest = await fetchRequiredReviewsPullRequest(token, repository, pullRequestNumber);
	if (pullRequest.head.sha !== expectedHeadSha) {
		throw new Error(`PR #${pullRequestNumber} head changed from ${expectedHeadSha} to ${pullRequest.head.sha}`);
	}

	/** @type {RequiredOwnerships} */
	let requiredTeams = {};
	/** @type {TeamReviewRules} */
	let teamRules = {};
	/** @type {Record<string, number>} */
	const missing = {};
	/** @type {string[]} */
	let approvers = [];
	/** @type {string | null} */
	let exemption = null;
	/** @type {{ state: 'success' | 'pending', description: string }} */
	let status;

	const supportsN8nExemptions = repository === DEFAULT_REQUIRED_REVIEWS_REPOSITORY;
	const route = supportsN8nExemptions ? findExemption(pullRequest) : undefined;
	const largeScaleChangeActor = route || !supportsN8nExemptions
		? undefined
		: await findLargeScaleChangeExemption(token, repository, pullRequestNumber, pullRequest);

	if (route) {
		exemption = `route:${route.source}`;
		status = { state: 'success', description: `Exempt route: ${route.source}` };
	} else if (largeScaleChangeActor) {
		exemption = `large-scale-change:${largeScaleChangeActor}`;
		status = { state: 'success', description: `Large-scale change exemption by @${largeScaleChangeActor}` };
	} else {
		const ownerships = await getRequiredOwnerships(token, repository, pullRequestNumber, pullRequest, cache);
		requiredTeams = ownerships.teams;
		teamRules = ownerships.rules;
		const reviews = await fetchPullRequestReviews(token, repository, pullRequestNumber);
		approvers = collectApprovers(reviews);
		const requiredCount = Object.keys(requiredTeams).length;

		if (supportsN8nExemptions && requiredCount > 0 && approvers.includes(RELEASE_HELPER_LOGIN)) {
			exemption = `release-helper:${RELEASE_HELPER_LOGIN}`;
			status = { state: 'success', description: 'Owners check skipped by n8n Release Helper' };
		} else {
			const author = pullRequest.user?.login;
			const reviewers = approvers.filter((approver) => approver.toLowerCase() !== author?.toLowerCase());
			for (const [team, rule] of Object.entries(teamRules)) {
				const slug = teamHandleToSlug(team);
				const [memberships, authorIsMember] = await Promise.all([
					Promise.all(reviewers.map((reviewer) => isActiveTeamMember(token, slug, reviewer))),
					rule.involved > 0 && author ? isActiveTeamMember(token, slug, author) : false,
				]);
				const needed = missingApprovals(rule, memberships.filter(Boolean).length, authorIsMember);
				if (needed > 0) missing[team] = needed;
			}
			status = buildRequiredReviewsStatus(missing, requiredCount);
		}
	}

	// A waiter gives up after EVALUATION_LOCK_WAIT_MS; a late verdict could then overwrite its error status.
	if (Date.now() > deadline) throw new Error(`Required review evaluation exceeded ${EVALUATION_DEADLINE_MS / 1000} seconds.`);
	await setStatus(status.state, status.description);
	return {
		repository,
		pullRequestNumber,
		headSha: expectedHeadSha,
		...status,
		requiredTeams,
		teamRules,
		missingTeams: Object.keys(missing),
		missingApprovals: missing,
		approvers,
		exemption,
	};
}
