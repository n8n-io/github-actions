import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGitHubClient, runRequiredReviews } from './evaluate.mjs';
import { resolveRequiredTeams } from './policy.mjs';
import { parseTeamAliases } from '../../scripts/owners.mjs';

const repository = 'n8n-io/n8n';
const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const defaultBranch = 'c'.repeat(40);
const ownersSha = 'd'.repeat(40);

function fixture({ files = [{ filename: 'src/service.ts' }], onFiles = () => {} } = {}) {
  const statuses = [];
  const calls = [];
  const repo = { full_name: repository, default_branch: 'master' };
  const pr = { number: 7, state: 'open', head: { sha: head, ref: 'feature', repo }, base: { sha: base, ref: 'master', repo }, labels: [] };
  const review = { user: { login: 'alice' }, state: 'APPROVED' };
  const membership = { state: 'active' };
  const owners = { text: '* @n8n-io/platform required' };
  const options = {
    repository,
    pullRequestNumber: 7,
    eventHeadSha: head,
    eventName: 'pull_request_review',
    runUrl: `https://github.com/${repository}/actions/runs/1`,
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
        return Response.json({ type: 'file', encoding: 'base64', sha: ownersSha, content: Buffer.from(owners.text).toString('base64') });
      }
      if (path.endsWith('/files')) {
        onFiles(pr);
        return Response.json(files);
      }
      if (path.endsWith('/reviews')) return Response.json([review]);
      if (path.endsWith('/memberships/alice')) return Response.json(membership);
      assert.fail(`Unexpected request: ${path}`);
    }),
  };
  return { options, statuses, calls, review, membership, owners, pr };
}

test('each verdict uses GitHub for ownership, reviews, and team membership', async () => {
  const { options, calls, membership, review, statuses } = fixture();
  assert.equal(await runRequiredReviews(options), 'success');
  membership.state = 'pending';
  assert.equal(await runRequiredReviews(options), 'pending');
  membership.state = 'active';
  review.state = 'DISMISSED';
  assert.equal(await runRequiredReviews(options), 'pending');
  for (const endpoint of ['/files', '/OWNERS', '/reviews']) {
    assert.equal(calls.filter(path => path.endsWith(endpoint)).length, 3);
  }
  assert.equal(calls.filter(path => path.endsWith('/memberships/alice')).length, 2);
  assert.deepEqual(statuses.map(status => status.state), ['pending', 'success', 'pending', 'pending', 'pending', 'pending']);
  assert.ok(statuses.every(status => status.context === 'Required Reviews' && status.target_url === options.runUrl));
});

test('a PR changed during evaluation does not write success', async () => {
  const { options, statuses } = fixture({ onFiles: pr => { pr.base.sha = head; } });
  await assert.rejects(runRequiredReviews(options), /changed during/);
  assert.deepEqual(statuses.map(status => status.state), ['pending', 'error']);
});

test('a failed PR lookup replaces the known status on manual reevaluation', async () => {
  const { options, statuses } = fixture();
  const request = options.github.request;
  options.github.request = (path, init) => path.endsWith('/pulls/7') ? Promise.reject(new Error('GitHub unavailable')) : request(path, init);
  await assert.rejects(runRequiredReviews({ ...options, eventName: 'workflow_dispatch' }), /GitHub unavailable/);
  assert.deepEqual(statuses.map(({ sha, state }) => [sha, state]), [[head, 'error']]);
});

test('a PR already closed at lookup does not receive a status', async () => {
  const { options, pr, calls } = fixture();
  pr.state = 'closed';
  assert.equal(await runRequiredReviews(options), undefined);
  assert.deepEqual(calls, [`/repos/${repository}/pulls/7`]);
});

test('merge queue publishes to the queue SHA without reading the PR', async () => {
  const { options, calls, statuses } = fixture();
  await runRequiredReviews({ ...options, eventName: 'merge_group', sha: base });
  assert.deepEqual(calls, [`/repos/${repository}/statuses/${base}`]);
  assert.equal(statuses[0].state, 'success');
});

test('a delayed event reevaluates the current head instead of publishing a verdict on the old SHA', async () => {
  const { options, statuses } = fixture();
  assert.equal(await runRequiredReviews({ ...options, eventHeadSha: base }), 'success');
  assert.deepEqual(statuses.map(({ sha, state }) => [sha, state]), [[head, 'pending'], [base, 'pending'], [head, 'success']]);
});

test('a rejected status write on the stale event head does not block the current head', async () => {
  const { options, statuses } = fixture();
  const request = options.github.request;
  options.github.request = (path, init) => path.endsWith(`/statuses/${base}`) ? Promise.reject(new Error('Commit unavailable')) : request(path, init);
  assert.equal(await runRequiredReviews({ ...options, eventHeadSha: base }), 'success');
  assert.deepEqual(statuses.map(({ sha, state }) => [sha, state]), [[head, 'pending'], [head, 'success']]);
});

test('a capped GitHub diff does not count as a complete list of changed paths', async () => {
  const github = createGitHubClient('test-token', async () => Response.json(Array.from({ length: 100 }, () => ({ filename: 'src/service.ts' }))));
  await assert.rejects(github.pages('/files', 3_000), /reached 3000 entries/);
});

test('OWNERS honors the winning rule, both sides of a rename, and test exclusions', () => {
  const rules = '* @n8n-io/platform required\nlegacy/ @n8n-io/old required\ndocs/ @n8n-io/docs\n';
  const files = [
    { filename: 'src/service.ts', previous_filename: 'legacy/service.ts' },
    ...['legacy/service.spec.ts', 'src/test/helper.ts', 'src/tests/helper.ts', 'src/fixtures/helper.ts', 'src/__mocks__/helper.ts', 'docs/page.md'].map(filename => ({ filename })),
  ];
  assert.deepEqual(resolveRequiredTeams(files, rules).teams, {
    '@n8n-io/old': ['legacy/service.ts'],
    '@n8n-io/platform': ['src/service.ts'],
  });
});

test('OWNERS rejects unsupported glob and absolute path patterns', () => {
  for (const pattern of ['**/*.ts', '/src/', '/src/service.ts']) {
    assert.throws(() => resolveRequiredTeams([], `${pattern} @n8n-io/platform required`), /Unsupported OWNERS pattern on line 1/);
  }
});

test('required and involved counts apply together; the author only counts toward involved', async () => {
  const { options, owners, pr, statuses } = fixture({ files: [{ filename: 'src/service.ts' }, { filename: 'legacy/service.ts' }] });
  const request = options.github.request;
  options.github.request = (path, init) => path.endsWith('/memberships/author') ? Promise.resolve({ state: 'active' }) : request(path, init);
  owners.text = '* @n8n-io/platform involved(2)';
  pr.user = { login: 'author' };
  assert.equal(await runRequiredReviews(options), 'success');
  owners.text = '* @n8n-io/platform involved(3)\nsrc/ @n8n-io/platform required(1)';
  assert.equal(await runRequiredReviews(options), 'pending');
  assert.equal(statuses.at(-1).description, 'Waiting for approval from: platform');
  owners.text = '* @n8n-io/platform involved(2)\nsrc/ @n8n-io/platform required(3)';
  assert.equal(await runRequiredReviews(options), 'pending');
  assert.equal(statuses.at(-1).description, 'Waiting for approval from: 2 from platform');
  pr.user = { login: 'Alice' };
  assert.equal(await runRequiredReviews(options), 'pending');
  assert.equal(statuses.at(-1).description, 'Waiting for approval from: 3 from platform');
  const rules = '* @n8n-io/platform required(2)\nlegacy/ @n8n-io/platform involved(3)';
  assert.deepEqual(resolveRequiredTeams([{ filename: 'src/service.ts', previous_filename: 'legacy/service.ts' }], rules).rules, {
    '@n8n-io/platform': { teams: ['@n8n-io/platform'], approvals: 2, involved: 3 },
  });
  for (const option of ['required(0)', 'involved(6)', 'required involved']) {
    assert.throws(() => resolveRequiredTeams([], `* @n8n-io/platform ${option}`), /Invalid OWNERS/);
  }
});

test('an or alias accepts approvals from members of any of its teams', async () => {
  const { options, owners, pr, statuses } = fixture();
  const members = new Set(['ai-trust/alice', 'ai-agents/author']);
  const request = options.github.request;
  options.github.request = (path, init) => {
    const membership = /\/teams\/([^/]+)\/memberships\/([^/]+)$/.exec(path);
    return membership ? Promise.resolve(members.has(`${membership[1]}/${membership[2]}`) ? { state: 'active' } : null) : request(path, init);
  };
  pr.user = { login: 'author' };
  owners.text = '* @n8n-io/AI required';
  assert.equal(await runRequiredReviews(options), 'success');
  assert.equal(statuses.at(-1).description, 'All required team approvals are present (1 owner)');
  owners.text = '* @n8n-io/ai involved(2)';
  assert.equal(await runRequiredReviews(options), 'success');
  owners.text = '* @n8n-io/ai required(2)';
  assert.equal(await runRequiredReviews(options), 'pending');
  assert.equal(statuses.at(-1).description, 'Waiting for approval from: ai-agents or ai-assistant or ai-trust');
  owners.text = '* @n8n-io/ai required\nsrc/ @n8n-io/developer-experience required';
  assert.equal(await runRequiredReviews(options), 'pending');
  assert.equal(statuses.at(-1).description, 'Waiting for approval from: qa-dx');
});

test('OWNERS resolves or aliases to one rule and and aliases to one rule per team', () => {
  const aliases = parseTeamAliases('@acme/web or @acme/ui @acme/design # either\n@Acme/Release and @acme/qa @acme/ops\n');
  const rules = '* @acme/web required(2)\nrelease/ @acme/release involved\nrelease/notes.md @acme/qa required';
  const files = ['src/page.ts', 'release/plan.md', 'release/notes.md'].map(filename => ({ filename }));
  assert.deepEqual(resolveRequiredTeams(files, rules, aliases), {
    teams: {
      '@acme/design': ['src/page.ts'],
      '@acme/ui': ['src/page.ts'],
      '@acme/qa': ['release/notes.md', 'release/plan.md'],
      '@acme/ops': ['release/plan.md'],
    },
    rules: {
      '@acme/design @acme/ui': { teams: ['@acme/design', '@acme/ui'], approvals: 2, involved: 0 },
      '@acme/qa': { teams: ['@acme/qa'], approvals: 1, involved: 1 },
      '@acme/ops': { teams: ['@acme/ops'], approvals: 0, involved: 1 },
    },
  });
});

test('team aliases reject invalid, duplicate, cross-organization, and nested definitions', () => {
  for (const [text, error] of [
    ['@acme/web any @acme/ui', /Invalid team alias on line 1: the mode must be "or" or "and", not "any"/],
    ['@acme/web', /Invalid team alias on line 1: the mode must be "or" or "and", not ""/],
    ['@acme/web or', /Invalid team alias on line 1: no team handles follow the mode/],
    ['web or @acme/ui', /Invalid team alias on line 1: "web" is not an @org\/name handle/],
    ['@acme/web or acme/ui', /Invalid team alias on line 1: "acme\/ui" is not an @org\/team handle/],
    ['@acme/web or @acme/ui @Acme/UI', /Invalid team alias on line 1: "@Acme\/UI" occurs more than once/],
    ['@acme/web or @other/ui', /Invalid team alias on line 1: "@other\/ui" is not in @acme/],
    ['@acme/web or @acme/ui\n@Acme/Web and @acme/qa', /Duplicate team alias on line 2/],
    ['@acme/web or @acme/ui @acme/all\n@acme/all and @acme/qa', /line 1 targets an alias/],
  ]) {
    assert.throws(() => parseTeamAliases(text), error);
  }
});
