# ownership-checks

Reusable workflow that runs the `OWNERS` checks in DevHub. DevHub reads the
repository's `OWNERS` file from its default branch and does all the work; this
workflow only tells DevHub which pull request to look at.

| Check | What DevHub does |
|-------|------------------|
| Required reviews | Writes the `Required Reviews` commit status: a member of each team with a `required` entry for a changed file must approve |
| Merge queue | Passes `Required Reviews` on merge queue commits |
| Ownership comment | Posts or updates the PR review overview comment: owning teams, changed lines, and required teams |

All checks run as steps of one job, `Ownership checks`. A pull request shows one
check per event type, and only events that need no check at all show it as
skipped.

## Layout

| Path | Role |
|------|------|
| [`.github/workflows/ownership-checks.yml`](../.github/workflows/ownership-checks.yml) | The reusable workflow. One job, with a step per check |
| [`actions/call-devhub`](./actions/call-devhub) | Gets a GitHub Actions OIDC token and calls a DevHub CI API, with retries |

## Authentication

There is no secret. The job requests a GitHub Actions OIDC token for the
audience `devhub` (`permissions: id-token: write`), and DevHub verifies it.
DevHub only accepts tokens from `n8n-io` repositories and takes the repository
and the run from the token, so a repository can only act on its own pull
requests. DevHub (n8n-io/developer-platform-hub#6) only accepts calls from
this workflow. It accepts any commit of it, so a repository that pins an older
version keeps working, and a fix here reaches a repository when it updates its
pin.

## Usage

Add a workflow like this to the repository and replace the pinned SHA. The
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
    uses: n8n-io/github-actions/.github/workflows/ownership-checks.yml@<sha> # ownership-checks/v1.0.0
    permissions:
      id-token: write
      pull-requests: read
    with:
      pull-request-number: ${{ inputs.pr_number }}
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

## Opting in and out

- **Calling DevHub.** A repository opts in by adding the caller workflow, and
  opts out of a single check with an input:

  ```yaml
      with:
        ownership-comment: false
  ```

- **Blocking merges.** The `Required Reviews` status only blocks merging when a
  ruleset requires it from DevHub's GitHub App. Keep the ruleset and the caller
  workflow in step: a ruleset that requires the status in a repository that
  does not call DevHub blocks every pull request.

## Requirements

- An `OWNERS` file at the root of the default branch. Each line is a pattern
  (`*`, a directory such as `packages/cli/`, or an exact path), one
  `@n8n-io/<team>` handle, and optionally `required`. A repository without an
  `OWNERS` file gets an `error` status.
- DevHub's GitHub App installed on the repository.
- The `DEVHUB_URL` variable, set for the organization or the repository, or the
  `devhub-url` input.

DevHub writes the statuses and the comment, so a status from another app or a
failed run does not replace its verdict. If DevHub cannot be reached, the run
fails and the status stays as it was. A pull request that has no status yet
stays blocked wherever a ruleset requires it. Dispatch the workflow again with
the pull request number once DevHub is back.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `required-reviews` | no | Write the `Required Reviews` status and pass merge queue commits. Defaults to `true` |
| `ownership-comment` | no | Post or update the PR review overview comment. Defaults to `true` |
| `pull-request-number` | on `workflow_dispatch` | Pull request to evaluate |
| `devhub-url` | no | DevHub base URL. Defaults to the `DEVHUB_URL` variable |

## Permissions

The calling job must grant `id-token: write` and `pull-requests: read`. The
workflow uses no secrets.
