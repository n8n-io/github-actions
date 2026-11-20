import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	buildRequiredReviewsStatus,
	collectApprovers,
	enforceRequiredReviews,
	findExemption,
	matchesBranchPattern,
	normalizeRepository,
	parseExemption,
	passMergeGroup,
} from '../index.mjs';

const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);
const RUN_URL = 'https://github.com/n8n-io/n8n/actions/runs/1';

/**
 * A fake GitHub for one pull request (#7) in `repository`.
 * @param {import('node:test').TestContext} t
 */
function mockGitHub(t, repository = 'n8n-io/n8n') {
	const fixture = {
		pullRequest: {
			number: 7,
			user: { login: 'author' },
			labels: /** @type {string[]} */ ([]),
			requested_reviewers: [],
			head: { sha: HEAD_SHA, ref: 'feature', repo: { full_name: repository } },
			base: { sha: BASE_SHA, ref: 'main', repo: { full_name: repository } },
		},
		owners: '* @n8n-io/platform required',
		files: [{ filename: 'src/service.ts', additions: 1, deletions: 0 }],
		reviews: [{ user: { login: 'alice' }, state: 'APPROVED', submitted_at: '2026-10-01T00:00:00Z' }],
		memberships: new Map([['platform:alice', 'active']]),
		failures: /** @type {Map<string, number>} */ (new Map()),
		/** @type {Array<{ state: string, context: string, description: string, target_url?: string }>} */
		statuses: [],
		/** @type {URL[]} */
		requests: [],
	};

	t.mock.method(globalThis, 'fetch', async (/** @type {string} */ input, /** @type {RequestInit} */ options = {}) => {
		const url = new URL(input);
		fixture.requests.push(url);
		assert.equal(new Headers(options.headers).get('authorization'), 'Bearer test-token');
		const root = `/repos/${repository}`;
		const path = url.pathname;
		if (path === `${root}/statuses/${HEAD_SHA}`) {
			fixture.statuses.push(JSON.parse(String(options.body)));
			return Response.json({});
		}
		const failure = fixture.failures.get(path);
		if (failure) return Response.json({ message: 'Upstream failed' }, { status: failure });
		if (path === `${root}/pulls/7`) return Response.json(fixture.pullRequest);
		if (path === root) return Response.json({ default_branch: 'main' });
		if (path === `${root}/git/ref/heads/main`) return Response.json({ object: { sha: 'd'.repeat(40) } });
		if (path === `${root}/contents/OWNERS`) {
			return Response.json({ type: 'file', sha: 'c'.repeat(40), encoding: 'base64', content: Buffer.from(fixture.owners).toString('base64') });
		}
		if (path === `${root}/pulls/7/files`) return Response.json(fixture.files);
		if (path === `${root}/pulls/7/reviews`) return Response.json(fixture.reviews);
		const membership = /^\/orgs\/n8n-io\/teams\/([^/]+)\/memberships\/([^/]+)$/.exec(path);
		if (membership) {
			const state = fixture.memberships.get(`${membership[1]}:${membership[2]}`);
			return state ? Response.json({ state }) : Response.json({ message: 'Not Found' }, { status: 404 });
		}
		throw new Error(`Unexpected request: ${url}`);
	});

	return fixture;
}

const options = { token: 'test-token', pullRequestNumber: 7, expectedHeadSha: HEAD_SHA, targetUrl: RUN_URL };

test('repositories are restricted to the n8n-io organization', () => {
	assert.equal(normalizeRepository(' N8N-IO/Nodes-Base '), 'n8n-io/nodes-base');
	for (const repository of ['other/n8n', 'n8n-io/n8n/other', 'n8n-io/../private', 'n8n-io/', 'n8n-io/.', 'n8n-io/..']) {
		assert.throws(() => normalizeRepository(repository), /n8n-io organization/, repository);
	}
});

describe('exemptions and verdicts', () => {
	test('only exempts matching same-repository branches', () => {
		assert.deepEqual(parseExemption('sync/master-to-3x -> 3.x'), { head: 'sync/master-to-3x', base: '3.x', source: 'sync/master-to-3x -> 3.x' });
		assert.equal(matchesBranchPattern('release/2.0/hotfix', 'release/*'), true);
		const pullRequest = (/** @type {string} */ head, /** @type {string} */ base, headRepository = 'n8n-io/n8n') => ({
			number: 1,
			user: null,
			labels: [],
			requested_reviewers: [],
			head: { sha: HEAD_SHA, ref: head, repo: { full_name: headRepository } },
			base: { sha: BASE_SHA, ref: base, repo: { full_name: 'n8n-io/n8n' } },
		});
		assert.equal(findExemption(pullRequest('sync/master-to-3x', '3.x'))?.source, 'sync/master-to-3x -> 3.x');
		assert.equal(findExemption(pullRequest('sync/master-to-3x', '3.x', 'someone/n8n')), undefined);
		assert.equal(findExemption(pullRequest('sync/master-to-3x', 'master')), undefined);
	});

	test('uses each reviewer’s latest meaningful review state', () => {
		assert.deepEqual(collectApprovers([
			{ user: { login: 'ana' }, state: 'CHANGES_REQUESTED', submitted_at: '2026-01-01T00:00:00Z' },
			{ user: { login: 'ana' }, state: 'APPROVED', submitted_at: '2026-01-02T00:00:00Z' },
			{ user: { login: 'ben' }, state: 'APPROVED', submitted_at: '2026-01-01T00:00:00Z' },
			{ user: { login: 'ben' }, state: 'DISMISSED', submitted_at: '2026-01-03T00:00:00Z' },
			{ user: { login: 'cat' }, state: 'COMMENTED', submitted_at: '2026-01-03T00:00:00Z' },
		]), ['ana']);
	});

	test('builds successful and pending statuses', () => {
		assert.equal(buildRequiredReviewsStatus({}, 0).description, 'No team approval is required for these changes');
		assert.equal(buildRequiredReviewsStatus({}, 2).description, 'All required team approvals are present (2 teams)');
		assert.equal(buildRequiredReviewsStatus({ '@n8n-io/qa-dx': 1, '@n8n-io/cli': 2 }, 2).description, 'Waiting for approval from: qa-dx, 2 from cli');
	});
});

describe('enforcement', () => {
	test('writes pending first and succeeds with an active owning-team approver', async (t) => {
		const github = mockGitHub(t);
		const result = await enforceRequiredReviews(options);
		assert.equal(github.requests[0].pathname, `/repos/n8n-io/n8n/statuses/${HEAD_SHA}`);
		assert.deepEqual(github.statuses.map((status) => status.state), ['pending', 'success']);
		assert.ok(github.statuses.every((status) => status.context === 'Required Reviews' && status.target_url === RUN_URL));
		assert.deepEqual(result.requiredTeams, { '@n8n-io/platform': ['src/service.ts'] });
		assert.deepEqual(result.approvers, ['alice']);
	});

	test('stays pending until an active team member other than the author approves', async (t) => {
		const github = mockGitHub(t);
		github.memberships.set('platform:alice', 'pending');
		github.memberships.set('platform:author', 'active');
		github.reviews.push({ user: { login: 'author' }, state: 'APPROVED', submitted_at: '2026-10-01T00:00:00Z' });
		const result = await enforceRequiredReviews(options);
		assert.equal(result.state, 'pending');
		assert.deepEqual(result.missingApprovals, { '@n8n-io/platform': 1 });
		assert.equal(github.statuses.at(-1)?.description, 'Waiting for approval from: platform');
	});

	test('an involved team counts its member author as one reviewer', async (t) => {
		const github = mockGitHub(t);
		github.owners = '* @n8n-io/platform involved';
		github.reviews = [];
		github.memberships.set('platform:author', 'active');
		assert.equal((await enforceRequiredReviews(options)).state, 'success');
	});

	for (const path of ['/repos/n8n-io/n8n/pulls/7', '/repos/n8n-io/n8n/contents/OWNERS', '/repos/n8n-io/n8n/pulls/7/reviews']) {
		test(`a GitHub failure at ${path} ends in an error status`, async (t) => {
			const github = mockGitHub(t);
			github.failures.set(path, 403);
			await assert.rejects(enforceRequiredReviews(options), /403/);
			assert.deepEqual(github.statuses.map((status) => status.state), ['pending', 'error']);
		});
	}

	test('malformed OWNERS and a changed head end in an error status', async (t) => {
		const github = mockGitHub(t);
		github.owners = 'src/ required';
		await assert.rejects(enforceRequiredReviews(options), /no team/);
		github.owners = '* @n8n-io/platform required';
		github.pullRequest.head.sha = 'e'.repeat(40);
		await assert.rejects(enforceRequiredReviews(options), /head changed/);
		assert.deepEqual(github.statuses.map((status) => status.state), ['pending', 'error', 'pending', 'error']);
	});

	test('a malformed GitHub response ends in an error status', async (t) => {
		const github = mockGitHub(t);
		github.files = [/** @type {any} */ ({ filename: 42 })];
		await assert.rejects(enforceRequiredReviews(options), /unexpected changed file/);
		assert.deepEqual(github.statuses.map((status) => status.state), ['pending', 'error']);
	});

	test('passes the cache and lock keys to the caller', async (t) => {
		mockGitHub(t);
		/** @type {string[]} */
		const cached = [];
		/** @type {Array<[string, number]>} */
		const locked = [];
		await enforceRequiredReviews({
			...options,
			cache: async (key, fetch) => { cached.push(key); return fetch(); },
			lock: async (key, task, waitMs) => { locked.push([key, waitMs]); return task(); },
		});
		assert.deepEqual(cached, [
			`github:repository-file:n8n-io/n8n:${'d'.repeat(40)}:OWNERS:v1`,
			`github:owners:n8n-io/n8n:${'c'.repeat(40)}:v3`,
			`github:required-ownerships:n8n-io/n8n:7:${BASE_SHA}:${HEAD_SHA}:${'c'.repeat(40)}:v4`,
		]);
		assert.deepEqual(locked, [[`required-reviews:n8n-io/n8n:${HEAD_SHA}`, 180_000]]);
	});

	test('passes a merge queue commit without reading the pull request', async (t) => {
		const github = mockGitHub(t);
		const result = await passMergeGroup({ token: 'test-token', repository: 'n8n-io/n8n', headSha: HEAD_SHA, targetUrl: RUN_URL });
		assert.equal(result.state, 'success');
		assert.equal(github.requests.length, 1);
		assert.equal(github.statuses[0].description, 'Approvals were verified before the PR entered the queue');
	});
});
