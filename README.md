# n8n-io/github-actions

Shared GitHub Actions used across `n8n-io` repositories.

| Action | Description |
|--------|-------------|
| [`cla-check`](./cla-check) | Verify every contributor on a PR has signed the n8n CLA |

## Consuming an action

Reference the action by path, pinned to a commit SHA with the version in a
trailing comment:

```yaml
- uses: n8n-io/github-actions/cla-check@<sha> # v1.0.0
```

Pin to a SHA rather than a tag. These actions run in workflows that hold
write-scoped tokens, so a moving tag would let a change here take effect in
every consuming repo without review.

## Versioning

Tags are `vMAJOR.MINOR.PATCH` and cover the whole repo, not individual actions.
Bumping one action re-tags all of them; consumers only move when they bump their
own pin.

Bump MAJOR when an action's inputs, outputs or required permissions change in a
way that breaks existing callers.

## Development

```bash
pnpm install
pnpm typecheck
```

Scripts are plain `.mjs` with JSDoc types checked against `@actions/github`.
They have no runtime dependencies — Octokit is supplied by
`actions/github-script`, and `fetch` is a Node global. Nothing is installed when
an action runs.
