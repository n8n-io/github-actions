# scan-community-node

Reusable workflow that scans an npm package, or the calling repository's
`package.json`, for security problems before it is trusted. Each scanner runs
as its own job, in parallel, and writes a summary to the run's step summary.

The workflow file is [`.github/workflows/scan-community-node.yml`](../.github/workflows/scan-community-node.yml).
Reusable workflows must live in that directory; this folder holds its
documentation and the example caller.

## Scanners

| Job | Tool | Area of concern |
|-----|------|-----------------|
| `guarddog` | [GuardDog](https://github.com/DataDog/guarddog) | Malicious and supply-chain behavior (install scripts, obfuscation, exfiltration, typosquatting) |
| `semgrep` | [Semgrep](https://github.com/semgrep/semgrep) | Insecure code patterns (static analysis) |
| `scorecard` | [OpenSSF Scorecard](https://github.com/ossf/scorecard) | Security posture of the source repository (branch protection, pinned dependencies, CI hardening) |
| `osv-scanner` | [OSV-Scanner](https://github.com/google/osv-scanner) | Known vulnerabilities in the dependency tree |
| `gitleaks` | [Gitleaks](https://github.com/gitleaks/gitleaks) | Hardcoded secrets and leaked credentials |

Every scanner reports; none of them fails its job on findings. A job fails
only when a scanner cannot run.

## Two modes

**Published package.** Set `package` (and optionally `version`) to download and
scan an npm package. The calling repository is not checked out. Findings show
up in the step summary only: they belong to another project and are never
uploaded to the caller's code scanning.

**Workspace.** Leave `package` empty to scan the calling repository. The
workflow checks it out and uploads the SARIF report to GitHub code scanning,
so findings appear under **Security → Code scanning** next to CodeQL and other
analyses. This needs `security-events: write` from the caller; set
`upload-sarif: false` to skip the upload.

Semgrep, OSV-Scanner and Gitleaks always emit SARIF. GuardDog and Scorecard do
so only in workspace mode; for a package they produce their native text report.

## Usage

Copy [`examples/ci-security-scan.yml`](./examples/ci-security-scan.yml) to
`.github/workflows/ci-security-scan.yml` in the consuming repo and replace the
pinned SHA:

```yaml
jobs:
  scan:
    uses: n8n-io/github-actions/.github/workflows/scan-community-node.yml@<sha> # v1.0.0
    with:
      package: ${{ inputs.package }}
```

The called workflow declares no `permissions`, so the caller's grant applies to
its jobs: `contents: read` always, plus `security-events: write` for the SARIF
upload in workspace mode. Triggers and `concurrency` are the caller's as well.

## Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `package` | string | — | npm package name, e.g. `express` or `@scope/pkg`. Empty scans the calling repository |
| `version` | string | `latest` | Version or dist-tag of `package`. Scorecard ignores it and scores the source repository |
| `scanners` | string | all five | Comma-separated subset of `guarddog`, `semgrep`, `scorecard`, `osv-scanner`, `gitleaks` |
| `sandbox` | boolean | `true` | Run GuardDog package scans inside its kernel-level sandbox. Set to `false` where the sandbox is unavailable, such as local `act` runs |
| `upload-sarif` | boolean | `true` | Upload SARIF reports to code scanning in workspace mode |
| `guarddog-version` | string | `3.2.0` | GuardDog version, installed from PyPI with uvx |
| `semgrep-version` | string | `1.177.0` | Semgrep version, installed from PyPI with uvx |

Gitleaks, Scorecard and OSV-Scanner are pinned inside the workflow.

## Notes

- Pull requests from forks get a read-only `GITHUB_TOKEN`, so the SARIF upload
  would fail with 403 there, and Scorecard does not support forks. The workflow
  detects fork PRs, skips the upload and, for workspace scans, drops the
  Scorecard job. The other scanners still report to the step summary.
- A published package cannot tune or suppress its own scan. Its `.semgrepignore`,
  `.gitleaks.toml` and `.gitleaksignore` are discarded and inline `nosemgrep` and
  `gitleaks:allow` comments are ignored. Workspace scans honor the repository's
  own configuration.
- In workspace mode, Scorecard runs through `ossf/scorecard-action`, which
  supports `push` and `schedule` on the default branch. Upstream lists
  `pull_request` and `workflow_dispatch` as experimental.
- Semgrep runs with `--config auto`, which contacts the Semgrep registry to pick
  rules and sends anonymous metrics.
- Reports are written to `.scan-community-node/` in the job's workspace.
