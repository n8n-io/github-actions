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

Tags are `<action>/vMAJOR.MINOR.PATCH`, so each action versions independently and
releasing one leaves the others alone. The tag is a marker for humans reading the
release notes — consumers pin to the SHA it points at, not to the tag.

Bump MAJOR when an action's inputs, outputs or required permissions change in a
way that breaks existing callers.

## Releasing

Run the [Release workflow](./.github/workflows/release.yml) from `main`, pick the
action and the bump size. It typechecks, resolves the next version from the
action's existing tags, tags the dispatched SHA and publishes a release whose
notes contain the exact `uses:` line to paste into consuming repos. An action
with no tags yet gets `v1.0.0` regardless of the bump chosen.

Tick **dry run** to see the resolved version and rendered notes in the job
summary without tagging.

A new action must be added to the workflow's `package` dropdown — CI fails if a
directory with an `action.yml` is missing from it.

## Development

```bash
pnpm install
pnpm typecheck
```

Scripts are plain `.mjs` with JSDoc types checked against `@actions/github`.
They have no runtime dependencies — Octokit is supplied by
`actions/github-script`, and `fetch` is a Node global. Nothing is installed when
an action runs.
