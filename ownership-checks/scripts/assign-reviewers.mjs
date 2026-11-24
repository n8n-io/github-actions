import { resolveOwnerTeamHandles } from './owners.mjs';

/** @typedef {InstanceType<typeof import('@actions/github/lib/utils').GitHub>} GitHub */
/**
 * @typedef Options
 * @property {GitHub} github
 * @property {{owner: string, repo: string}} repository
 * @property {number} pullRequestNumber
 * @property {string} [owners]
 * @property {string} [ownersFile]
 * @property {string} [allOwnersLabel]
 * @property {string} [requiredOwnersLabel]
 * @property {string} [assignedLabel]
 * @property {(message: string) => void} [info]
 */

/** @param {Options} options */
export async function runAssignReviewers({
  github, repository, pullRequestNumber, owners = 'all', ownersFile = 'OWNERS',
  allOwnersLabel = 'Auto-assign reviewers', requiredOwnersLabel = 'Auto-assign required reviewers',
  assignedLabel = 'Reviewers auto-assigned', info = console.log,
}) {
  if (!['all', 'required', 'labels'].includes(owners)) throw new Error('owners must be all, required, or labels');
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber <= 0) throw new Error('Invalid pull request number');
  if (!ownersFile.trim()) throw new Error('owners-file must not be empty');
  const allLabel = allOwnersLabel.toLowerCase();
  const requiredLabel = requiredOwnersLabel.toLowerCase();
  const marker = assignedLabel.toLowerCase();
  if (owners === 'labels' && (!allOwnersLabel || !requiredOwnersLabel ||
    allLabel === requiredLabel || [allLabel, requiredLabel].includes(marker))) {
    throw new Error('Assignment labels must be distinct and trigger labels must not be empty');
  }
  const pull = { ...repository, pull_number: pullRequestNumber };
  const issue = { ...repository, issue_number: pullRequestNumber };
  const { data: pr } = await github.rest.pulls.get(pull);
  if (pr.base.repo.full_name.toLowerCase() !== `${repository.owner}/${repository.repo}`.toLowerCase()) {
    throw new Error('GitHub returned a different repository');
  }
  if (pr.state !== 'open') return [];

  // Queued events can carry labels from before a completed assignment.
  const labels = pr.labels.map(label => label.name.toLowerCase());
  const triggerLabels = owners === 'labels'
    ? pr.labels.map(label => label.name).filter(label => [allLabel, requiredLabel].includes(label.toLowerCase())) : [];
  const removeTriggers = async () => {
    for (const name of triggerLabels) {
      try {
        await github.rest.issues.removeLabel({ ...issue, name });
      } catch (error) {
        if (!(error && typeof error === 'object' && 'status' in error && error.status === 404)) throw error;
      }
    }
  };

  if (assignedLabel && labels.includes(marker)) {
    info(`PR #${pullRequestNumber} already has assigned reviewers.`);
    await removeTriggers();
    return [];
  }
  if (owners === 'labels' && triggerLabels.length === 0) {
    info(`PR #${pullRequestNumber} has no assignment label.`);
    return [];
  }

  const requiredOnly = owners === 'required' || (owners === 'labels' && !labels.includes(allLabel));
  const [files, { data: file }] = await Promise.all([
    github.paginate(github.rest.pulls.listFiles, { ...pull, per_page: 100 }),
    github.rest.repos.getContent({ ...repository, path: ownersFile, ref: pr.base.repo.default_branch }),
  ]);
  // GitHub limits the pull request files endpoint to 3,000 files.
  if (files.length !== pr.changed_files) throw new Error('GitHub did not return all changed files');
  if (Array.isArray(file) || file.type !== 'file' || file.encoding !== 'base64') {
    throw new Error('GitHub did not return an OWNERS file');
  }
  const handles = resolveOwnerTeamHandles(files, Buffer.from(file.content, 'base64').toString('utf8'), requiredOnly);
  if (handles.some(handle => handle.split('/')[0].toLowerCase() !== `@${repository.owner}`.toLowerCase())) {
    throw new Error('OWNERS teams must belong to the repository organization');
  }
  const teams = handles.map(handle => handle.split('/')[1]);
  if (teams.length === 0) {
    info(`No ${requiredOnly ? 'required ' : ''}owning teams matched PR #${pullRequestNumber}.`);
    return [];
  }

  const { data: current } = await github.rest.pulls.get(pull);
  const currentLabels = current.labels.map(label => label.name.toLowerCase());
  if (current.state !== 'open' || current.head.sha !== pr.head.sha || current.base.sha !== pr.base.sha ||
    (assignedLabel && currentLabels.includes(marker)) ||
    (owners === 'labels' && [allLabel, requiredLabel].some(label => currentLabels.includes(label) !== labels.includes(label)))) {
    throw new Error('Pull request changed during assignment; run again');
  }
  info(`Requesting review from: ${teams.join(', ')}`);
  await github.rest.pulls.requestReviewers({ ...pull, team_reviewers: teams });
  if (assignedLabel) await github.rest.issues.addLabels({ ...issue, labels: [assignedLabel] });
  await removeTriggers();
  return teams;
}

/**
 * @param {{github: GitHub, context: typeof import('@actions/github').context, core: typeof import('@actions/core')}} params
 * @param {NodeJS.ProcessEnv} [env]
 */
export default async function assignReviewers({ github, context, core }, env = process.env) {
  const teams = await runAssignReviewers({
    github, repository: context.repo, pullRequestNumber: Number(env.PR_NUMBER),
    owners: env.OWNERS, ownersFile: env.OWNERS_FILE, allOwnersLabel: env.ALL_OWNERS_LABEL,
    requiredOwnersLabel: env.REQUIRED_OWNERS_LABEL, assignedLabel: env.ASSIGNED_LABEL, info: core.info,
  });
  core.setOutput('teams', teams);
}
