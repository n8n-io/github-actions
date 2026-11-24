import assert from 'node:assert/strict';
import { test } from 'node:test';
import assignReviewers, { runAssignReviewers } from '../../scripts/assign-reviewers.mjs';
import { resolveOwnerTeamHandles, resolveRequiredTeams } from '../../scripts/owners.mjs';

const allLabel = 'Auto-assign reviewers';
const requiredLabel = 'Auto-assign required reviewers';
const assignedLabel = 'Reviewers auto-assigned';
const content = `
* @acme/fallback
src/ @acme/backend required(2)
src/optional/ @acme/optional
ui/ @acme/frontend involved
tests/ @acme/quality required
`;
const files = ['src/service.ts', 'src/optional/helper.ts', 'ui/page.vue', 'tests/service.test.ts'].map(filename => ({ filename }));

function fixture() {
  const calls = [];
  const pr = {
    number: 42, state: 'open', changed_files: files.length, labels: [],
    head: { sha: 'head' }, base: { sha: 'base', repo: { full_name: 'acme/project', default_branch: 'main' } },
  };
  const owners = { type: 'file', encoding: 'base64', content: Buffer.from(content).toString('base64') };
  const state = { files: structuredClone(files), fail: '', onFiles: () => {}, beforeGet: () => {} };
  const method = (name, result = () => ({})) => async (params) => {
    calls.push({ name, params });
    if (state.fail === name) throw new Error(`Failed ${name}`);
    return { data: result(params) };
  };
  const github = {
    rest: {
      pulls: {
        get: method('get', () => { state.beforeGet(); return structuredClone(pr); }),
        listFiles: method('listFiles'),
        requestReviewers: method('requestReviewers'),
      },
      repos: { getContent: method('getContent', () => owners) },
      issues: {
        addLabels: method('addLabels', ({ labels }) => { pr.labels.push(...labels.map(name => ({ name }))); }),
        removeLabel: method('removeLabel', ({ name }) => { pr.labels = pr.labels.filter(label => label.name !== name); }),
      },
    },
    paginate: async (method, params) => {
      assert.equal(method, github.rest.pulls.listFiles);
      assert.equal(params.per_page, 100);
      await method(params);
      state.onFiles();
      return state.files;
    },
  };
  const options = { github, repository: { owner: 'acme', repo: 'project' }, pullRequestNumber: 42, info: () => {} };
  const writes = () => calls.filter(({ name }) => ['requestReviewers', 'addLabels', 'removeLabel'].includes(name));
  return { options, pr, calls, writes, state, owners };
}

test('all owners include optional owners and owners of test files without trigger labels', async () => {
  const { options, calls, writes } = fixture();
  const teams = await runAssignReviewers(options);
  assert.deepEqual(teams, ['optional', 'backend', 'quality', 'frontend']);
  assert.deepEqual(writes(), [
    { name: 'requestReviewers', params: { owner: 'acme', repo: 'project', pull_number: 42, team_reviewers: teams } },
    { name: 'addLabels', params: { owner: 'acme', repo: 'project', issue_number: 42, labels: [assignedLabel] } },
  ]);
  assert.deepEqual(calls.find(({ name }) => name === 'getContent').params,
    { owner: 'acme', repo: 'project', path: 'OWNERS', ref: 'main' });
});

test('required owners include required and involved entries, but not test-only owners', async () => {
  const { options } = fixture();
  assert.deepEqual(await runAssignReviewers({ ...options, owners: 'required' }), ['backend', 'frontend']);
});

test('both sides of a rename use last-match-wins and each team appears once', () => {
  const changes = [{ filename: 'ui/page.vue', previous_filename: 'src/old.ts' }, { filename: 'ui/other.vue' }];
  assert.deepEqual(resolveOwnerTeamHandles(changes, content, false), ['@acme/backend', '@acme/frontend']);
  assert.deepEqual(resolveOwnerTeamHandles([{ filename: 'src/optional/helper.ts' }], content, true), []);
});

test('assignment and required review checks share the same required team resolution', () => {
  assert.deepEqual(resolveOwnerTeamHandles(files, content, true), Object.keys(resolveRequiredTeams(files, content).teams));
});

for (const [labels, teams] of [
  [[allLabel], ['optional', 'backend', 'quality', 'frontend']],
  [[requiredLabel], ['backend', 'frontend']],
  [[requiredLabel, allLabel], ['optional', 'backend', 'quality', 'frontend']],
]) {
  test(`label mode selects owners for ${labels.join(' and ')}`, async () => {
    const { options, pr, writes } = fixture();
    pr.labels = labels.map(name => ({ name }));
    assert.deepEqual(await runAssignReviewers({ ...options, owners: 'labels' }), teams);
    assert.deepEqual(pr.labels, [{ name: assignedLabel }]);
    assert.deepEqual(writes().map(({ name }) => name), ['requestReviewers', 'addLabels', ...labels.map(() => 'removeLabel')]);
  });
}

test('label mode does nothing when live labels have no trigger', async () => {
  const { options, pr, calls, writes } = fixture();
  pr.labels = [{ name: 'bug' }];
  assert.deepEqual(await runAssignReviewers({ ...options, owners: 'labels' }), []);
  assert.equal(calls.length, 1);
  assert.deepEqual(writes(), []);
});

test('label selection and cleanup ignore label casing', async () => {
  const { options, pr, writes } = fixture();
  pr.labels = [{ name: allLabel.toUpperCase() }];
  assert.deepEqual(await runAssignReviewers({ ...options, owners: 'labels' }), ['optional', 'backend', 'quality', 'frontend']);
  assert.equal(writes().at(-1).params.name, allLabel.toUpperCase());
  assert.deepEqual(pr.labels, [{ name: assignedLabel }]);
});

test('completion marker matching ignores label casing', async () => {
  const { options, pr, writes } = fixture();
  pr.labels = [{ name: assignedLabel.toUpperCase() }];
  assert.deepEqual(await runAssignReviewers(options), []);
  assert.deepEqual(writes(), []);
});

for (const change of ['remove trigger', 'switch mode', 'add marker']) {
  test(`a label change during assignment stops writes: ${change}`, async () => {
    const { options, pr, state, writes } = fixture();
    pr.labels = [{ name: allLabel }];
    state.onFiles = () => {
      pr.labels = (change === 'remove trigger' ? [] : change === 'switch mode' ? [requiredLabel] : [allLabel, assignedLabel])
        .map(name => ({ name }));
    };
    await assert.rejects(runAssignReviewers({ ...options, owners: 'labels' }), /changed during assignment/);
    assert.deepEqual(writes(), []);
  });
}

test('unrelated label changes do not interrupt assignment', async () => {
  const { options, pr, state } = fixture();
  pr.labels = [{ name: requiredLabel }];
  state.onFiles = () => { pr.labels.push({ name: 'bug' }); };
  assert.deepEqual(await runAssignReviewers({ ...options, owners: 'labels' }), ['backend', 'frontend']);
});

test('a completion marker added during non-label assignment stops writes', async () => {
  const { options, pr, state, writes } = fixture();
  state.onFiles = () => { pr.labels.push({ name: assignedLabel }); };
  await assert.rejects(runAssignReviewers(options), /changed during assignment/);
  assert.deepEqual(writes(), []);
});

test('a queued label run removes triggers without requesting reviews again', async () => {
  const { options, pr, writes } = fixture();
  pr.labels = [allLabel, requiredLabel, assignedLabel].map(name => ({ name }));
  assert.deepEqual(await runAssignReviewers({ ...options, owners: 'labels' }), []);
  assert.deepEqual(writes().map(({ name }) => name), ['removeLabel', 'removeLabel']);
  assert.deepEqual(pr.labels, [{ name: assignedLabel }]);
});

test('ready-for-review mode runs once while the completion marker remains', async () => {
  const { options, writes } = fixture();
  await runAssignReviewers(options);
  assert.deepEqual(await runAssignReviewers(options), []);
  assert.equal(writes().filter(({ name }) => name === 'requestReviewers').length, 1);
});

test('callers can configure the file path and all label names', async () => {
  const { options, pr, calls } = fixture();
  pr.labels = [{ name: 'request-required' }];
  assert.deepEqual(await runAssignReviewers({
    ...options, owners: 'labels', ownersFile: '.github/OWNERS',
    allOwnersLabel: 'request-all', requiredOwnersLabel: 'request-required', assignedLabel: 'done',
  }), ['backend', 'frontend']);
  assert.deepEqual(pr.labels, [{ name: 'done' }]);
  assert.equal(calls.find(({ name }) => name === 'getContent').params.path, '.github/OWNERS');
});

test('an empty completion label disables marker reads and writes', async () => {
  const { options, pr, writes } = fixture();
  pr.labels = [{ name: assignedLabel }];
  await runAssignReviewers({ ...options, assignedLabel: '' });
  assert.deepEqual(writes().map(({ name }) => name), ['requestReviewers']);
});

test('no matching teams leaves trigger labels in place without a completion marker', async () => {
  const { options, pr, state, writes } = fixture();
  state.files = [{ filename: 'tests/service.test.ts' }];
  pr.changed_files = 1;
  pr.labels = [{ name: requiredLabel }];
  assert.deepEqual(await runAssignReviewers({ ...options, owners: 'labels' }), []);
  assert.deepEqual(writes(), []);
  assert.deepEqual(pr.labels, [{ name: requiredLabel }]);
});

test('closed pull requests do not request reviews', async () => {
  const { options, pr, writes } = fixture();
  pr.state = 'closed';
  assert.deepEqual(await runAssignReviewers(options), []);
  assert.deepEqual(writes(), []);
});

test('incomplete file lists fail without writing labels or requesting reviews', async () => {
  const { options, pr, writes } = fixture();
  pr.changed_files = 3001;
  await assert.rejects(runAssignReviewers(options), /all changed files/);
  assert.deepEqual(writes(), []);
});

for (const field of ['head', 'base', 'state']) {
  test(`a changed PR ${field} stops assignment before writes`, async () => {
    const { options, pr, state, writes } = fixture();
    state.onFiles = () => { if (field === 'state') pr.state = 'closed'; else pr[field].sha = 'updated'; };
    await assert.rejects(runAssignReviewers(options), /changed during assignment/);
    assert.deepEqual(writes(), []);
  });
}

for (const method of ['getContent', 'listFiles', 'requestReviewers']) {
  test(`a failed ${method} call leaves the trigger and no completion marker`, async () => {
    const { options, pr, state, writes } = fixture();
    pr.labels = [{ name: allLabel }];
    state.fail = method;
    await assert.rejects(runAssignReviewers({ ...options, owners: 'labels' }), /Failed/);
    assert.deepEqual(pr.labels, [{ name: allLabel }]);
    assert.ok(writes().every(({ name }) => name === 'requestReviewers'));
  });
}

test('a failed completion marker write leaves the trigger for a retry', async () => {
  const { options, pr, state, writes } = fixture();
  pr.labels = [{ name: allLabel }];
  state.fail = 'addLabels';
  await assert.rejects(runAssignReviewers({ ...options, owners: 'labels' }), /Failed addLabels/);
  assert.deepEqual(pr.labels, [{ name: allLabel }]);
  assert.ok(writes().every(({ name }) => name !== 'removeLabel'));
});

test('label cleanup retries after the marker was written', async () => {
  const { options, pr, state, writes } = fixture();
  pr.labels = [{ name: allLabel }];
  state.fail = 'removeLabel';
  await assert.rejects(runAssignReviewers({ ...options, owners: 'labels' }), /Failed removeLabel/);
  state.fail = '';
  await runAssignReviewers({ ...options, owners: 'labels' });
  assert.equal(writes().filter(({ name }) => name === 'requestReviewers').length, 1);
  assert.deepEqual(pr.labels, [{ name: assignedLabel }]);
});

test('removing an already absent trigger is safe, but other API failures propagate', async () => {
  const { options, pr } = fixture();
  pr.labels = [{ name: allLabel }, { name: assignedLabel }];
  options.github.rest.issues.removeLabel = async () => { throw Object.assign(new Error('Not found'), { status: 404 }); };
  await runAssignReviewers({ ...options, owners: 'labels' });
  options.github.rest.issues.removeLabel = async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); };
  await assert.rejects(runAssignReviewers({ ...options, owners: 'labels' }), /Forbidden/);
});

for (const rule of ['* @other/team', '* @acme/team required(0)', '**/*.ts @acme/team', '* @acme/team unknown']) {
  test(`invalid OWNERS rule does not request reviews: ${rule}`, async () => {
    const { options, owners, writes } = fixture();
    owners.content = Buffer.from(rule).toString('base64');
    await assert.rejects(runAssignReviewers(options), /OWNERS/);
    assert.deepEqual(writes(), []);
  });
}

for (const invalid of [
  { owners: 'unknown' }, { pullRequestNumber: 0 }, { pullRequestNumber: 1.5 }, { ownersFile: '' },
  { owners: 'labels', allOwnersLabel: '' }, { owners: 'labels', requiredOwnersLabel: allLabel },
  { owners: 'labels', assignedLabel: allLabel },
  { owners: 'labels', requiredOwnersLabel: allLabel.toUpperCase() },
  { owners: 'labels', assignedLabel: requiredLabel.toUpperCase() },
]) {
  test(`invalid inputs fail before API calls: ${JSON.stringify(invalid)}`, async () => {
    const { options, calls } = fixture();
    await assert.rejects(runAssignReviewers({ ...options, ...invalid }));
    assert.deepEqual(calls, []);
  });
}

test('the action entry point maps its inputs and outputs', async () => {
  const { options } = fixture();
  const outputs = [];
  await assignReviewers({
    github: options.github, context: { repo: options.repository },
    core: { info: () => {}, setOutput: (...args) => outputs.push(args) },
  }, { PR_NUMBER: '42', OWNERS: 'required' });
  assert.deepEqual(outputs, [['teams', ['backend', 'frontend']]]);
});
