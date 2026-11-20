import { collectApprovers, missingApprovals, resolveRequiredTeams } from './policy.mjs';

const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const requiredTeamsShape = /^@[\w.-]+\/[\w.-]+$/;
const baseHead = pr => ({ baseSha: pr.base.sha, headSha: pr.head.sha });

export function createGitHubClient(token, fetcher = fetch) {
  async function request(path, { payload, allowMissing = false } = {}) {
    const response = await fetcher(`https://api.github.com${path}`, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
    return response.json();
  }

  async function pages(path, limit = 10_000) {
    const values = [];
    for (let page = 1; page <= limit / 100; page++) {
      const batch = await request(`${path}?per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error('GitHub did not return a list');
      values.push(...batch);
      if (values.length >= limit) break;
      if (batch.length < 100) return values;
    }
    throw new Error(`GitHub list reached ${limit} entries; cannot verify all results`);
  }

  return { request, pages };
}

export function isMatchingSnapshot(value, repository, snapshot) {
  const record = input => input && typeof input === 'object' && !Array.isArray(input);
  const count = input => Number.isInteger(input) && input >= 0 && input <= 5;
  return value?.policyVersion === 2 && value.repository === repository && Object.entries(snapshot).every(([key, expected]) => value[key] === expected) &&
    shaPattern.test(value.ownersSha) && record(value.requiredTeams) && record(value.teamRules) &&
    Object.keys(value.teamRules).length === Object.keys(value.requiredTeams).length &&
    Object.entries(value.requiredTeams).every(([team, paths]) => {
      const rule = value.teamRules[team];
      return requiredTeamsShape.test(team) && Array.isArray(paths) && paths.length > 0 && paths.every(path => typeof path === 'string' && path.length > 0) &&
        rule && count(rule.approvals) && count(rule.involved) && (rule.approvals > 0 || rule.involved > 0);
    });
}

export async function runRequiredReviews({ github, repository, eventName, sha, pullRequestNumber, eventHeadSha, runUrl, readCache, log = console.log }) {
  repository = repository.toLowerCase();
  if (!/^n8n-io\/(?!\.{1,2}$)[a-z0-9._-]+$/.test(repository)) throw new Error('Expected an n8n-io repository');
  const root = `/repos/${repository}`;
  const status = (head, state, description) => {
    if (!shaPattern.test(head)) throw new Error('Invalid status SHA');
    return github.request(`${root}/statuses/${head}`, {
      payload: { context: 'Required Reviews', state, description: description.length > 140 ? `${description.slice(0, 139)}…` : description, target_url: runUrl },
    });
  };

  if (eventName === 'merge_group') {
    await status(sha, 'success', 'Approvals were verified before the PR entered the queue');
    return 'success';
  }

  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber <= 0) throw new Error('Invalid pull request number');
  const prPath = `${root}/pulls/${pullRequestNumber}`;
  let statusHead = eventHeadSha;
  if (statusHead) await status(statusHead, 'pending', 'Evaluating required reviews');

  try {
    const pr = await github.request(prPath);
    if (pr.number !== pullRequestNumber || pr.base.repo.full_name.toLowerCase() !== repository) throw new Error('GitHub returned a different pull request');
    if (pr.state === 'closed') return;
    if (pr.state !== 'open') throw new Error('GitHub did not return a valid pull request state');
    const { baseSha, headSha } = baseHead(pr);
    if (headSha !== statusHead) {
      statusHead = headSha;
      await status(headSha, 'pending', 'Evaluating required reviews');
    }
    const assertSamePullRequest = async () => {
      const current = await github.request(prPath);
      if (current.head.sha !== headSha || current.base.sha !== baseSha || current.base.ref !== pr.base.ref || current.head.ref !== pr.head.ref || current.state !== 'open') {
        throw new Error('Pull request changed during evaluation');
      }
    };

    const membershipChecks = new Map();
    const isMember = async (team, login) => {
      const path = `/orgs/n8n-io/teams/${encodeURIComponent(team)}/memberships/${encodeURIComponent(login.toLowerCase())}`;
      if (!membershipChecks.has(path)) membershipChecks.set(path, github.request(path, { allowMissing: true }));
      return (await membershipChecks.get(path))?.state === 'active';
    };

    const verdict = await (async () => {
      const n8n = repository === 'n8n-io/n8n';
      if (n8n && pr.head.repo?.full_name === pr.base.repo.full_name && pr.head.ref === 'sync/master-to-3x' && pr.base.ref === '3.x') {
        return ['success', 'Exempt route: sync/master-to-3x -> 3.x'];
      }
      if (n8n && pr.labels.some(label => label.name === 'large-scale-change')) {
        const events = await github.pages(`${root}/issues/${pullRequestNumber}/events`);
        const latest = events.filter(event => ['labeled', 'unlabeled'].includes(event.event) && event.label?.name === 'large-scale-change').at(-1);
        if (latest?.event === 'labeled' && latest.actor?.login && await isMember('large-scale-changes', latest.actor.login)) {
          return ['success', `Large-scale change exemption by @${latest.actor.login}`];
        }
      }

      const defaultBranch = pr.base.repo.default_branch;
      if (!defaultBranch) throw new Error('GitHub did not return the default branch');
      const ref = await github.request(`${root}/git/ref/heads/${encodeURIComponent(defaultBranch)}`);
      const defaultBranchSha = ref.object.sha;
      if (!shaPattern.test(defaultBranchSha)) throw new Error('Invalid default-branch SHA');
      const snapshot = { pullRequestNumber, baseSha, headSha, defaultBranchSha };
      let rules;
      if (readCache) {
        try {
          const result = await readCache(snapshot);
          if (isMatchingSnapshot(result, repository, snapshot)) rules = result.teamRules;
        } catch {
          // The cache is optional; GitHub remains the source of truth.
        }
      }
      if (rules) {
        log('Ownership snapshot: DevHub cache hit');
      } else {
        log('Ownership snapshot: reading from GitHub');
        const [owners, files] = await Promise.all([
          github.request(`${root}/contents/OWNERS?ref=${defaultBranchSha}`),
          github.pages(`${prPath}/files`, 3_000),
        ]);
        if (owners.type !== 'file' || owners.encoding !== 'base64' || !shaPattern.test(owners.sha) || typeof owners.content !== 'string') {
          throw new Error('GitHub did not return an OWNERS file');
        }
        ({ rules } = resolveRequiredTeams(files, Buffer.from(owners.content, 'base64').toString('utf8')));
      }

      const teams = Object.entries(rules);
      if (!teams.length) return ['success', 'No team approval is required for these changes'];
      const approvers = collectApprovers(await github.pages(`${prPath}/reviews`));
      if (n8n && approvers.includes('n8n-release-helper[bot]')) return ['success', 'Owners check skipped by n8n Release Helper'];

      const author = pr.user?.login;
      const reviewers = approvers.filter(approver => approver.toLowerCase() !== author?.toLowerCase());
      const missing = [];
      for (const [handle, rule] of teams) {
        const team = handle.split('/')[1];
        const authorIsMember = rule.involved > 0 && author ? await isMember(team, author) : false;
        let approvals = 0;
        for (const login of reviewers) {
          if (missingApprovals(rule, approvals, authorIsMember) === 0) break;
          if (await isMember(team, login)) approvals++;
        }
        const needed = missingApprovals(rule, approvals, authorIsMember);
        if (needed > 0) missing.push(needed === 1 ? team : `${needed} from ${team}`);
      }
      return missing.length
        ? ['pending', `Waiting for approval from: ${missing.join(', ')}`]
        : ['success', `All required team approvals are present (${teams.length} team${teams.length === 1 ? '' : 's'})`];
    })();

    await assertSamePullRequest();
    await status(headSha, ...verdict);
    return verdict[0];
  } catch (error) {
    if (statusHead) await status(statusHead, 'error', 'Evaluation failed; see the workflow run').catch(() => {});
    throw error;
  }
}
