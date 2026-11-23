import { createGitHubClient, runRequiredReviews } from './evaluate.mjs';

const env = process.env;

try {
  if (!env.OWNERSHIP_TOKEN) throw new Error('Missing GitHub App installation token');
  await runRequiredReviews({
    github: createGitHubClient(env.OWNERSHIP_TOKEN),
    repository: env.GITHUB_REPOSITORY,
    eventName: env.GITHUB_EVENT_NAME,
    sha: env.GITHUB_SHA,
    pullRequestNumber: Number(env.PR_NUMBER),
    eventHeadSha: env.EVENT_HEAD_SHA,
    runUrl: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Required reviews failed');
  process.exitCode = 1;
}
