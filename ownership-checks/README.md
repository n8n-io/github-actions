# ownership-checks

Reusable workflow that enforces `OWNERS` and optionally posts an ownership comment.
The workflow publishes `Required Reviews` directly. The `required(k)` rule needs
`k` approvals from team members other than the author. For `involved(k)`, an
author who's an active team member counts as one of the `k` reviewers. Counts are
1–5 and default to 1. The action reads `OWNERS` from the default branch, keeps reviews
and memberships live, and evaluates PRs one run at a time per PR. The verdict
uses only GitHub. The optional ownership comment is best effort and runs in a
separate job that calls DevHub.

## Layout

| Path | Role |
|------|------|
| [`.github/workflows/ownership-checks.yml`](../.github/workflows/ownership-checks.yml) | Dispatches evaluations and optional comments |
| [`actions/call-devhub`](./actions/call-devhub) | Gets a GitHub Actions OIDC token and calls a DevHub CI API, with retries |
| [`actions/required-reviews`](./actions/required-reviews) | Evaluates required reviews and publishes the status using the configured GitHub App |
| [`actions/assign-reviewers`](./actions/assign-reviewers) | Requests all or required owner teams on events selected by the calling repository |

## Reviewer assignment

Use the [assign-reviewers action](./actions/assign-reviewers) to request reviews
without running the required-review workflow. Set `owners` to `all`, `required`,
or `labels`. Each repository chooses its triggers in its own workflow. Examples
cover [label-only assignment](./examples/assign-reviewers-labels.yml) and
[draft-to-ready assignment](./examples/assign-reviewers-ready.yml).

The action shares its OWNERS parser with required-review checks. It is released
as part of `ownership-checks`.

## Authentication

DevHub calls use no shared secret. The job requests a GitHub Actions OIDC token for the
audience `devhub` (`permissions: id-token: write`), and DevHub verifies it.
DevHub only accepts tokens from `n8n-io` repositories and takes the repository
and the run from the token, so a repository can only act on its own pull
requests. DevHub (n8n-io/developer-platform-hub#6) only accepts calls from
this workflow. It accepts any commit of it, so a repository that pins an older
version keeps working, and a fix here reaches a repository when it updates its
pin.

Required reviews need a GitHub App installed on the calling repository. Grant
repository permissions **Contents: read**, **Pull requests: read**, and
**Commit statuses: write**, plus the organization permission **Members: read**.
Pass the credentials for the App trusted by the ruleset as
`required-reviews-app-id` and `required-reviews-app-key`. Limit access to the
private key to participating repositories. The workflow uses a short-lived
installation token scoped to the calling repository. Never use a PR checkout in
this workflow.

## Usage

Add a workflow like this to the repository and replace the pinned SHA and
version comment with the release you are using. The
triggers decide which checks can run; each step ignores the events that cannot
change its result.

```yaml
name: 'CI: Ownership'

on:
  pull_request_target:
    types: [opened, synchronize, reopened, ready_for_review, edited, labeled, unlabeled]
  pull_request_review:
    types: [submitted, dismissed]
  merge_group:
  workflow_dispatch:
    inputs:
      pr_number:
        description: 'Pull request to evaluate again'
        required: true
        type: string

permissions: {}

jobs:
  ownership:
    uses: n8n-io/github-actions/.github/workflows/ownership-checks.yml@<sha> # ownership-checks/v2.0.0
    permissions:
      id-token: write
      pull-requests: read
    with:
      pull-request-number: ${{ inputs.pr_number }}
    secrets:
      required-reviews-app-id: ${{ secrets.REQUIRED_REVIEWS_APP_ID }}
      required-reviews-app-key: ${{ secrets.REQUIRED_REVIEWS_APP_PRIVATE_KEY }}
```

`pull_request_target` is safe here: no job checks out or runs code from the pull
request. It also covers fork pull requests, which get no `id-token` on
`pull_request` events.

Reviews on a fork pull request run without an `id-token`. To evaluate them too,
add a `workflow_run` trigger for a workflow that runs on `pull_request_review`.
The job looks up the open pull request whose head is that run's head:

```yaml
  workflow_run:
    workflows: ['Util: Notify PR Status']
    types: [completed]
```

To evaluate a pull request again, for example after a team membership change,
dispatch the workflow with its number.

## Rolling out the action as publisher

1. Release the new workflow. Before changing the monorepo pin, install and
   configure the App and exercise PR and merge queue publication on a test
   ruleset. The production ruleset must require `Required Reviews` from the
   configured App, not from any publisher. If the App is already the required
   publisher, the ruleset can stay unchanged. Prefer a dedicated App over
   distributing an existing App's broader private key.
2. Update the pin and pass both App secrets in the monorepo caller. To retain
   the existing DevHub App as publisher, map `N8N_DEVHUB_APP_ID` and
   `N8N_DEVHUB_PRIVATE_KEY`. If using a new
   App, coordinate the ruleset update in the same cutover; otherwise GitHub
   ignores the new publisher's status. Let old runs finish and re-evaluate open
   PRs. If the publisher changes, let the queue drain or requeue entries so
   their commits get a status from the new publisher. There may be a short
   merge pause while statuses are repopulated.

To roll back, restore the previous pin and, if it changed, the original
publisher in the ruleset. Re-evaluate the affected PRs.

## Requirements

- An `OWNERS` file at the root of the default branch. Each line is a pattern
  (`*`, a repo-relative directory such as `packages/cli/`, or an exact
  repo-relative path), one
  `@n8n-io/<team>` handle, and optionally `required`. A repository without an
  `OWNERS` file gets an `error` status.
- `DEVHUB_URL` (or `devhub-url`) is only used for the ownership comment. Without
  it, the comment job is skipped.

A DevHub outage does not affect the verdict. Failure to verify approvals
against GitHub still does not produce a pass.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `required-reviews` | no | Write the `Required Reviews` status and pass merge queue commits. Defaults to `true` |
| `ownership-comment` | no | Post or update the PR review overview comment. Defaults to `true` |
| `pull-request-number` | on `workflow_dispatch` | Pull request to evaluate |
| `devhub-url` | no | DevHub base URL for the ownership comment. Defaults to the `DEVHUB_URL` variable |

## Permissions

Grant `pull-requests: read` and `id-token: write` in the caller as shown above.
Only the ownership comment job uses `id-token: write`. When
`required-reviews` is enabled, pass the App ID and private key via
`required-reviews-app-id` and `required-reviews-app-key`.
