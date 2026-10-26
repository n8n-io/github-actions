# approve-and-set-automerge

Approves a pull request as the n8n release helper GitHub App and optionally
enables squash automerge. This is a reusable workflow, so it is called as a job
rather than as a step.

## Usage

The default setup inherits the caller's secrets and uses the organization-wide
`N8N_RELEASE_HELPER_APP_ID` and `N8N_RELEASE_HELPER_PRIVATE_KEY` secrets:

```yaml
jobs:
  approve-and-automerge:
    uses: n8n-io/github-actions/.github/workflows/approve-and-set-automerge.yml@<sha>
    with:
      pull-request-number: ${{ needs.create-pr.outputs.pull-request-number }}
      enable-automerge: true
    secrets: inherit
```

Pin the workflow to a commit SHA rather than a branch or tag.
Omit `enable-automerge` to approve the pull request without enabling automerge.

To use another GitHub App, pass its credentials explicitly instead of inheriting
secrets:

```yaml
jobs:
  approve-and-automerge:
    uses: n8n-io/github-actions/.github/workflows/approve-and-set-automerge.yml@<sha>
    with:
      pull-request-number: ${{ needs.create-pr.outputs.pull-request-number }}
      enable-automerge: true
    secrets:
      app-id: ${{ secrets.MY_APP_ID }}
      private-key: ${{ secrets.MY_APP_PRIVATE_KEY }}
```

The GitHub App must be installed on the target repository with `contents: write`
and `pull requests: write` permissions. The repository must allow squash merges
and automerge.

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `pull-request-number` | yes | Pull request to approve |
| `enable-automerge` | no | Enable squash automerge after approval. Defaults to `false` |

## Secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `app-id` | no | GitHub App ID; defaults to `N8N_RELEASE_HELPER_APP_ID` inherited from the caller |
| `private-key` | no | GitHub App private key; defaults to `N8N_RELEASE_HELPER_PRIVATE_KEY` inherited from the caller |
