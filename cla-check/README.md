# cla-check

Verifies that every contributor on a pull request has signed the n8n Contributor
License Agreement. In-house replacement for the "CLA Bot" GitHub App.

## What it does

- Posts a commit status (default name `CLA Check`) on the head SHA. Add that name
  to a repository ruleset to gate merges on it — the action only reports, it does
  not block on its own.
- Maintains a single PR comment, edited in place across re-runs, listing who still
  needs to sign. A PR that was never flagged gets no comment at all.
- Adds a `cla-signed` label when everyone has signed, removes it otherwise. The
  label is created on first use. Set `apply-label: false` to opt out — the status
  check and PR comment keep working, no labels are touched.
- Reacts 👀 / 👍 / 👎 to `/cla-check` comments.

Verification is **fail-closed**: a contributor whose CLA lookup errors, or a commit
whose author email is not linked to a GitHub account, blocks the check the same way
an unsigned contributor does. Bot-authored commits are skipped.

## Usage

Copy [`examples/ci-cla-check.yml`](./examples/ci-cla-check.yml) to
`.github/workflows/ci-cla-check.yml` in the consuming repo and replace the pinned
SHA.

The caller owns the triggers, `permissions`, `concurrency`, the job-level `if`
guard and `timeout-minutes` — composite actions cannot declare any of those. Copy
that stub verbatim rather than reconstructing it; the concurrency expression in
particular is load-bearing (see the comment in the file).

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `app-id` | yes | — | App ID of the GitHub App used to authenticate API calls |
| `private-key` | yes | — | Private key of the GitHub App |
| `cla-api` | no | n8n prod CLA service | Endpoint queried as `<cla-api>?checkContributor=<login>` |
| `cla-sign-url` | no | n8n prod CLA form | URL contributors visit to sign |
| `status-context` | no | `CLA Check` | Commit status name that rulesets gate on |
| `comment-marker` | no | `<!-- n8n-cla-check -->` | Hidden marker identifying the comment to edit in place |
| `apply-label` | no | `true` | Set to `false` to skip label management entirely |
| `label-name` | no | `cla-signed` | Label applied when everyone has signed |

## Outputs

| Output | Description |
|--------|-------------|
| `all-signed` | `"true"` when every contributor signed and every commit author is linked |
| `unsigned` | Comma-separated logins that have not signed |
| `unlinked` | JSON array of commits whose author email is not linked to a GitHub account |

## Per-repo setup

1. Install the GitHub App on the repo with `pull requests: write`,
   `issues: write`, `commit statuses: write`, `contents: read`. Without
   commit-statuses the check runs but silently cannot report.
2. Make `N8N_ASSISTANT_APP_ID` and `N8N_ASSISTANT_PRIVATE_KEY` available to the
   repo (org-level secrets are fine).
3. Add `CLA Check` to the repo ruleset's required status checks.
4. Drop the `merge_group:` trigger from the stub if the repo has no merge queue.
5. Mention `/cla-check` in `CONTRIBUTING.md` if the repo has one.

## Contributor flow

A contributor who has not signed sees a comment linking the CLA form. After
signing, they comment `/cla-check` on the PR to re-run verification without
needing to push.
