# Assign owner reviewers

Request reviews from the teams that own changed files. The calling workflow
chooses when to run. No checkout or package installation is needed.

Set `owners` to select the teams:

- `all`: Request every owning team, including teams for test files.
- `required`: Request teams whose winning `required` or `involved` rule matches
  a changed non-test file.
- `labels`: Read the live PR labels. The all-owners label selects `all`. The
  required-owners label selects `required`. If both are present, `all` wins.
  If neither is present, skip assignment.

Label names are matched case-insensitively, as on GitHub. Trigger labels and
the completion marker must have distinct names.

The action uses the same parser as the required-review check. Rules use
last-match-wins. Both paths of a renamed file count. Team handles are normalized
to lowercase, and each team is requested once.
Supported patterns are `*`, a repository-relative directory with a trailing
`/`, or an exact file path, without a leading `/` or `./`. Each rule has one
`@org/team` handle and an optional `required(k)` or `involved(k)` option.
Counts are 1–5 and default to 1.

The action reads the OWNERS file from the calling repository's default branch
through the GitHub API. It does not read or run PR code. Teams must belong to
the repository organization. An incomplete changed-file list fails assignment.

## Inputs and outputs

| Input | Default | Purpose |
|-------|---------|---------|
| `token` | required | Token with **Contents: read** and **Pull requests: write** |
| `pull-request-number` | PR from the event | PR to assign; set this for manual or other events |
| `owners` | `all` | `all`, `required`, or `labels` |
| `owners-file` | `OWNERS` | Path in the default branch |
| `all-owners-label` | `Auto-assign reviewers` | All-owners trigger in label mode |
| `required-owners-label` | `Auto-assign required reviewers` | Required-owners trigger in label mode |
| `assigned-label` | `Reviewers auto-assigned` | Completion marker; empty disables the marker |

The `teams` output is a JSON array of team slugs requested by this run. It is
`[]` when the action skips assignment or no teams match.

After a successful request, the action adds the completion marker. In label
mode, it then removes the trigger labels. On an open PR, a run that sees the
marker skips assignment and removes any trigger labels. Closed PRs are left
unchanged. Remove the marker to allow another assignment.
Set `assigned-label: ''` to allow assignment on every selected event.

If no teams match or a request fails, the action leaves the trigger labels in
place. A label-only workflow does not retry on pushes: remove and reapply a
trigger label to try again. If marker creation fails after the review request,
a retry can repeat that request. Serialize runs for each PR with `concurrency`.
If the PR commits or assignment labels change while files are being fetched,
the action fails before requesting reviews; run it again against the new state.

## Label-only assignment

See [the complete caller](../../examples/assign-reviewers-labels.yml). It retains
the n8n repository's branch, fork, bot, and GitHub App policies. The workflow
runs only when one of the two trigger labels is added, not when a push occurs
or an unrelated label changes.

```yaml
- uses: n8n-io/github-actions/ownership-checks/actions/assign-reviewers@<sha> # ownership-checks/vX.Y.Z
  with:
    token: ${{ steps.app-token.outputs.token }}
    owners: labels
```

## Assign when a draft becomes ready for review

See [the complete caller](../../examples/assign-reviewers-ready.yml).
`ready_for_review` fires when a draft becomes ready. To also cover PRs created
as ready, include `opened` and skip drafts in the job guard.

```yaml
on:
  pull_request:
    types: [ready_for_review]

# In the assignment job:
steps:
  - uses: n8n-io/github-actions/ownership-checks/actions/assign-reviewers@<sha> # ownership-checks/vX.Y.Z
    with:
      token: ${{ github.token }}
      owners: required
```

This is the GitHub draft-to-ready event, not a GitHub Projects status change.
For a different event, configure that event in the caller and pass its PR number.

## Caller responsibilities

- Pin the action to a released commit SHA. The `<sha>` values in examples are
  placeholders, not valid refs.
- Choose events, branch filters, bot and fork policies, job permissions,
  concurrency, and a timeout in the caller.
- Use a GitHub App token if review requests must trigger other workflows.
  Requests made with `GITHUB_TOKEN` do not trigger most downstream workflows.
- The examples use `pull_request` and skip forks. To support forks, a trusted
  `pull_request_target` caller can use this action without a checkout. Never
  add a step that checks out or runs PR code with a write token.
- This action requests team reviews. It does not enforce approvals or set the
  `Required Reviews` status.

Release this action with the `ownership-checks` package. After release, replace
the n8n caller's local script step with the action and remove its checkout.
Delete `.github/scripts/owners/assign-reviewers.mjs` and its test only after
the shared action's SHA is available. Keep `owners.mjs` for OWNERS validation.
