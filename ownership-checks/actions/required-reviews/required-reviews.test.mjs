import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ownershipSnapshotReader } from './devhub.mjs';
import { createGitHubClient, runRequiredReviews } from './evaluate.mjs';
import { resolveRequiredTeams } from './policy.mjs';

const repository = 'n8n-io/n8n';
const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const defaultBranch = 'c'.repeat(40);
const ownersSha = 'd'.repeat(40);
const cachedOwnership = snapshot => ({
  ...snapshot, policyVersion: 2, repository, ownersSha,
  requiredTeams: { '@n8n-io/platform': ['src/service.ts'] },
  teamRules: { '@n8n-io/platform': { approvals: 1, involved: 0 } },
});

function fixture() {
  const statuses = [];
  const calls = [];
  const repo = { full_name: repository, default_branch: 'master' };
  const pr = { number: 7, state: 'open', head: { sha: head, ref: 'feature', repo }, base: { sha: base, ref: 'master', repo }, labels: [] };
  const review = { user: { login: 'alice' }, state: 'APPROVED' };
  const membership = { state: 'active' };
  const files = [{ filename: 'src/service.ts' }];
  const options = {
    repository,
    pullRequestNumber: 7,
    eventHeadSha: head,
    eventName: 'pull_request_review',
    runUrl: `https://github.com/${repository}/actions/runs/1`,
    log: () => {},
    github: createGitHubClient('test-token', async (url, init) => {
      const path = new URL(url).pathname;
      calls.push(path);
      if (path.includes('/statuses/')) {
        statuses.push({ sha: path.split('/').at(-1), ...JSON.parse(init.body) });
        return Response.json({});
      }
      if (path.endsWith('/pulls/7')) return Response.json(pr);
      if (path.endsWith('/ref/heads/master')) return Response.json({ object: { sha: defaultBranch } });
      if (path.endsWith('/contents/OWNERS')) {
        assert.equal(new URL(url).searchParams.get('ref'), defaultBranch);
        return Response.json({ type: 'file', encoding: 'base64', sha: ownersSha, content: Buffer.from('* @n8n-io/platform required').toString('base64') });
      }
      if (path.endsWith('/files')) return Response.json(files);
      if (path.endsWith('/reviews')) return Response.json([review]);
      if (path.endsWith('/memberships/alice')) return Response.json(membership);
      assert.fail(`Unexpected request: ${path}`);
    }),
  };
  return { options, statuses, calls, review, membership, files, pr };
}

test('DevHub outage, miss, or mismatch all fall back to GitHub without weakening the verdict', async () => {
  for (const readCache of [
    async () => { throw new Error('DevHub down'); },
    async () => null,
    async snapshot => ({ ...cachedOwnership(snapshot), headSha: base }),
    async snapshot => ({ ...cachedOwnership(snapshot), policyVersion: 1, requiredTeams: {}, teamRules: {} }),
  ]) {
    const { options, calls, statuses, review } = fixture();
    assert.equal(await runRequiredReviews({ ...options, readCache }), 'success');
    review.state = 'DISMISSED';
    assert.equal(await runRequiredReviews({ ...options, readCache }), 'pending');
    assert.deepEqual(statuses.map(status => status.state), ['pending', 'success', 'pending', 'pending']);
    assert.ok(statuses.every(status => status.context === 'Required Reviews' && status.target_url === options.runUrl));
    assert.equal(calls.filter(path => path.endsWith('/files')).length, 2);
  }
});

test('a new pin works against older DevHub and starts using the cache after DevHub is upgraded', async () => {
  const { options, calls, statuses } = fixture();
  let deployed = false;
  const readCache = ownershipSnapshotReader({
    DEVHUB_URL: 'https://devhub.example.com',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example.com/token',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'actions-token',
  }, async (url, init) => {
    if (url.hostname === 'oidc.example.com') {
      assert.equal(url.searchParams.get('audience'), 'devhub');
      return Response.json({ value: 'devhub-token' });
    }
    assert.equal(url.href, 'https://devhub.example.com/api/v1/ci/ownership-snapshot');
    assert.equal(init.headers.Authorization, 'Bearer devhub-token');
    if (!deployed) return new Response(null, { status: 404 });
    return Response.json(cachedOwnership(JSON.parse(init.body)));
  });
  assert.equal(await runRequiredReviews({ ...options, readCache }), 'success');
  deployed = true;
  assert.equal(await runRequiredReviews({ ...options, readCache }), 'success');
  assert.equal(calls.filter(path => path.endsWith('/files')).length, 1);
  assert.ok(statuses.every(status => status.context === 'Required Reviews'));
});

test('a matching cache hit skips file reads but never caches a review or team membership', async () => {
  const { options, calls, membership, review } = fixture();
  const readCache = async snapshot => cachedOwnership(snapshot);
  assert.equal(await runRequiredReviews({ ...options, readCache }), 'success');
  membership.state = 'pending';
  assert.equal(await runRequiredReviews({ ...options, readCache }), 'pending');
  review.state = 'DISMISSED';
  assert.equal(await runRequiredReviews({ ...options, readCache }), 'pending');
  assert.ok(!calls.some(path => /\/(files|OWNERS)$/.test(path)));
  assert.equal(calls.filter(path => path.endsWith('/reviews')).length, 3);
  assert.equal(calls.filter(path => path.endsWith('/memberships/alice')).length, 2);
});

test('an upstream failure or a changed PR does not write success', async () => {
  const { options, statuses, pr } = fixture();
  await assert.rejects(runRequiredReviews({ ...options, readCache: async () => { pr.base.sha = head; return null; } }), /changed during/);
  assert.deepEqual(statuses.map(status => status.state), ['pending', 'error']);

  const unavailable = fixture();
  const request = unavailable.options.github.request;
  unavailable.options.github.request = (path, init) => path.endsWith('/pulls/7') ? Promise.reject(new Error('GitHub unavailable')) : request(path, init);
  await assert.rejects(runRequiredReviews(unavailable.options), /GitHub unavailable/);
  assert.deepEqual(unavailable.statuses.map(status => status.state), ['pending', 'error']);
});

test('merge queue uses the queue SHA and never calls DevHub or reads the PR', async () => {
  const { options, calls, statuses } = fixture();
  await runRequiredReviews({ ...options, eventName: 'merge_group', sha: base, readCache: () => assert.fail('unexpected cache lookup') });
  assert.deepEqual(calls, [`/repos/${repository}/statuses/${base}`]);
  assert.equal(statuses[0].state, 'success');
});

test('a delayed event reevaluates the current head instead of publishing a verdict on the old SHA', async () => {
  const { options, statuses } = fixture();
  assert.equal(await runRequiredReviews({ ...options, eventHeadSha: base }), 'success');
  assert.deepEqual(statuses.map(({ sha, state }) => [sha, state]), [[base, 'pending'], [head, 'pending'], [head, 'success']]);
});

test('a capped GitHub diff does not count as a complete list of changed paths', async () => {
  const github = createGitHubClient('test-token', async () => Response.json(Array.from({ length: 100 }, () => ({ filename: 'src/service.ts' }))));
  await assert.rejects(github.pages('/files', 3_000), /reached 3000 entries/);
});

test('OWNERS fallback honors the winning rule, both sides of a rename, and test exclusions', () => {
  const rules = '* @n8n-io/platform required\nlegacy/ @n8n-io/old required\ndocs/ @n8n-io/docs\n';
  const files = [{ filename: 'src/service.ts', previous_filename: 'legacy/service.ts' }, { filename: 'legacy/service.spec.ts' }, { filename: 'docs/page.md' }];
  assert.deepEqual(resolveRequiredTeams(files, rules).teams, {
    '@n8n-io/old': ['legacy/service.ts'],
    '@n8n-io/platform': ['src/service.ts'],
  });
  assert.throws(() => resolveRequiredTeams(files, '**/*.ts @n8n-io/platform required'), /Unsupported/);
});

test('required and involved counts apply together; the author only counts toward involved', async () => {
  const { options, pr, statuses } = fixture();
  const request = options.github.request;
  options.github.request = (path, init) => path.includes('/contents/OWNERS')
    ? Promise.resolve({ type: 'file', encoding: 'base64', sha: ownersSha, content: Buffer.from('* @n8n-io/platform involved(2)').toString('base64') })
    : path.endsWith('/memberships/author') ? Promise.resolve({ state: 'active' }) : request(path, init);
  pr.user = { login: 'author' };
  assert.equal(await runRequiredReviews(options), 'success');
  const readCache = async (snapshot) => ({ ...cachedOwnership(snapshot), teamRules: { '@n8n-io/platform': { approvals: 3, involved: 2 } } });
  assert.equal(await runRequiredReviews({ ...options, readCache }), 'pending');
  assert.equal(statuses.at(-1).description, 'Waiting for approval from: 2 from platform');
  pr.user = { login: 'Alice' };
  assert.equal(await runRequiredReviews({ ...options, readCache }), 'pending');
  assert.equal(statuses.at(-1).description, 'Waiting for approval from: 3 from platform');
  const rules = '* @n8n-io/platform required(2)\nlegacy/ @n8n-io/platform involved(3)';
  assert.deepEqual(resolveRequiredTeams([{ filename: 'src/service.ts', previous_filename: 'legacy/service.ts' }], rules).rules, {
    '@n8n-io/platform': { approvals: 2, involved: 3 },
  });
  for (const option of ['required(0)', 'involved(6)', 'required involved']) {
    assert.throws(() => resolveRequiredTeams([], `* @n8n-io/platform ${option}`), /Invalid OWNERS/);
  }
});
