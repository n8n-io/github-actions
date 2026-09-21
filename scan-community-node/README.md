# scan-community-node

Scans an npm package, or the `package.json` in the workspace, for security
problems before it is trusted. Each run executes one scanner, chosen with the
`scanner` input, and writes a summary to the job's step summary.

## Scanners

| `scanner` | Tool | Area of concern |
|-----------|------|-----------------|
| `guarddog` | [GuardDog](https://github.com/DataDog/guarddog) | Malicious and supply-chain behavior (install scripts, obfuscation, exfiltration, typosquatting) |
| `semgrep` | [Semgrep](https://github.com/semgrep/semgrep) | Insecure code patterns (static analysis) |
| `scorecard` | [OpenSSF Scorecard](https://github.com/ossf/scorecard) | Security posture of the source repository (branch protection, pinned dependencies, CI hardening) |
| `osv-scanner` | [OSV-Scanner](https://github.com/google/osv-scanner) | Known vulnerabilities in the dependency tree |
| `gitleaks` | [Gitleaks](https://github.com/gitleaks/gitleaks) | Hardcoded secrets and leaked credentials |

Every scanner reports; none of them fails the step on findings. The step only
fails when a scanner cannot run.

## Two modes

**Published package.** Set `package` (and optionally `version`) to download and
scan an npm package. Nothing needs to be checked out. Findings show up in the
step summary only: they belong to another project and are never uploaded to
this repository's code scanning.

**Workspace.** Leave `package` empty to scan the caller's checkout. The SARIF
report is uploaded to GitHub code scanning, so findings appear under
**Security → Code scanning** next to CodeQL and other analyses. This needs
`security-events: write`; set `upload-sarif: false` to skip the upload.

Semgrep, OSV-Scanner and Gitleaks always emit SARIF. GuardDog and Scorecard do
so only in workspace mode; for a package they produce their native text report.

## Usage

Copy [`examples/ci-security-scan.yml`](./examples/ci-security-scan.yml) to
`.github/workflows/ci-security-scan.yml` in the consuming repo and replace the
pinned SHA. It runs the action in a matrix, one job per scanner, so the five
scans run in parallel.

The caller owns checkout, triggers, `permissions`, `concurrency` and
`timeout-minutes`. Composite actions cannot declare any of those.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `scanner` | yes | — | `guarddog`, `semgrep`, `scorecard`, `osv-scanner` or `gitleaks` |
| `package` | no | — | npm package name, e.g. `express` or `@scope/pkg`. Empty scans the workspace |
| `version` | no | `latest` | Version or dist-tag of `package`. Scorecard ignores it and scores the source repository |
| `sandbox` | no | `true` | Run GuardDog package scans inside its kernel-level sandbox. Set to `false` where the sandbox is unavailable, such as local `act` runs |
| `upload-sarif` | no | `true` | Upload the SARIF report to code scanning in workspace mode |
| `guarddog-version` | no | `3.2.0` | GuardDog version, installed from PyPI with uvx |
| `semgrep-version` | no | `1.177.0` | Semgrep version, installed from PyPI with uvx |

Gitleaks, Scorecard and OSV-Scanner are pinned inside the action.

## Outputs

| Output | Description |
|--------|-------------|
| `sarif` | Workspace-relative path to the SARIF report, empty when the scanner produced none |
| `text` | Workspace-relative path to the native text report, for GuardDog and Scorecard package scans |

Reports are written to `.scan-community-node/` in the workspace.

## Notes

- Package scans with Semgrep, OSV-Scanner and Gitleaks set up Node.js 24 to
  download the tarball with `npm`. GuardDog and Scorecard fetch the package
  themselves.
- In workspace mode, Scorecard runs through `ossf/scorecard-action`, which
  supports `push` and `schedule` on the default branch. Upstream lists
  `pull_request` and `workflow_dispatch` as experimental and does not support
  forks.
- Semgrep runs with `--config auto`, which contacts the Semgrep registry to pick
  rules and sends anonymous metrics.
