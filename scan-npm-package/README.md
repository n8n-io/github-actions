# scan-npm-package

Reusable workflow that scans a published npm package, or the calling repository, for security problems before it is trusted. Each scanner runs as its own job, in parallel, and writes a summary to the run's step summary.

## Layout

| Path | Role |
|------|------|
| [`.github/workflows/scan-npm-package.yml`](../.github/workflows/scan-npm-package.yml) | The reusable workflow. Writes the target table and runs one job per scanner |
| [`actions/guarddog`](./actions/guarddog), [`semgrep`](./actions/semgrep), [`scorecard`](./actions/scorecard), [`cve-lite`](./actions/cve-lite), [`gitleaks`](./actions/gitleaks) | One composite action per scanner, each also usable as a step in your own job |
| [`actions/setup`](./actions/setup) | Installs uv and optionally Node.js, and creates `security-report/` |
| [`actions/fetch-package`](./actions/fetch-package) | Downloads and unpacks a package outside the workspace, optionally resolving a lockfile |
| [`actions/security-summary`](./actions/security-summary) | Renders the reports in `security-report/` into the step summary |
| [`actions/upload-security-sarif`](./actions/upload-security-sarif) | Uploads the SARIF reports to code scanning when the caller opts in |

Reusable workflows must live in `.github/workflows/`, which is why the workflow sits there and everything else here. Third-party actions are pinned to commit SHAs, the Python scanner CLIs to versions in a `requirements.txt` next to each action, and Dependabot updates both. The workflow and the actions reference each other with the `$/` self-repository prefix, which resolves against this repository at the running commit even when called from another repository, so a caller checks nothing out. Scorecard and Semgrep do not recognise `$/` yet and report those references as unpinned third-party actions when this repository scans itself ([ossf/scorecard#5191](https://github.com/ossf/scorecard/pull/5191), [semgrep/semgrep-rules#4042](https://github.com/semgrep/semgrep-rules/pull/4042)).

## Scanners

| Job | Tool | Area of concern |
|-----|------|-----------------|
| `scan-for-malware` | [GuardDog](https://github.com/DataDog/guarddog) | Malicious and supply-chain behavior (install scripts, obfuscation, exfiltration, typosquatting) |
| `scan-for-insecure-code` | [Semgrep](https://github.com/semgrep/semgrep) | Insecure code patterns (static analysis) |
| `scan-for-misconfiguration` | [OpenSSF Scorecard](https://github.com/ossf/scorecard) | Security posture of the source repository (branch protection, pinned dependencies, CI hardening) |
| `scan-for-vulnerabilities` | [CVE Lite CLI](https://github.com/OWASP/cve-lite-cli) | Known vulnerabilities (CVEs) in the dependency tree, matched against OSV and the npm advisory API, with the upgrade commands that fix them |
| `scan-for-secrets` | [Gitleaks](https://github.com/gitleaks/gitleaks) | Hardcoded secrets and leaked credentials |

Every scanner reports; none of them fails its job on findings. A job fails only when a scanner cannot run.

## Usage

Add a workflow like this to the consuming repository and replace the pinned SHA. On push, pull request and schedule it scans the repository itself; dispatched with a package name it scans that published package instead.

```yaml
name: 'CI: Security Scan'

on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: '0 3 * * 1'
  workflow_dispatch:
    inputs:
      package:
        description: 'npm package to scan. Leave empty to scan this repository.'
        required: false
        type: string

# The called workflow declares no permissions and runs with the calling job's,
# which default to this grant. security-events: write is needed only for the
# SARIF upload, and a private repository additionally needs actions: read for it.
permissions:
  contents: read
  security-events: write

jobs:
  scan:
    uses: n8n-io/github-actions/.github/workflows/scan-npm-package.yml@<sha> # v1.0.0
    with:
      package: ${{ inputs.package }}
      upload-sarif: ${{ inputs.package == '' }}
```

The upload is skipped on pull requests from forks, whose token is read-only. Triggers and `concurrency` are the caller's as well.

A single scanner can also run as a step in your own job, for example `uses: n8n-io/github-actions/scan-npm-package/actions/gitleaks@<sha>` after the `setup` action.

## Two modes

**Published package.** Set `package` (and optionally `version`) to download and scan an npm package. Its tarball is unpacked outside the workspace, and the dependency scan resolves a lockfile so the whole tree is covered. Findings show up in the step summary only: they belong to another project and are never uploaded to the caller's code scanning.

**Repository.** Leave `package` empty to scan the calling repository, which needs a `package.json`. With `upload-sarif` enabled the SARIF reports are uploaded to GitHub code scanning, so findings appear under **Security → Code scanning** next to CodeQL and other analyses. Uploading needs GitHub Code Security on the repository.

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `package` | empty | npm package name, e.g. `express` or `@scope/pkg`. Leave empty to scan the calling repository. |
| `version` | `latest` | Package version or dist-tag to scan. Scorecard ignores it, since it scores the package's source repository rather than a release. |
| `sandbox` | `true` | Whether GuardDog should run inside its kernel-level sandbox. |
| `upload-sarif` | `false` | Whether to upload SARIF reports to GitHub code scanning. Only applies when scanning the calling repository. |

## Results

Every scan writes a human-readable summary to the workflow run's step summary. Each scanner writes its report files into a `security-report/` directory in the workspace.

Semgrep and Gitleaks always emit SARIF, and CVE Lite CLI does unless the target has no lockfile. GuardDog and Scorecard emit SARIF when scanning the calling repository and their native text report for a published package, since they cannot emit SARIF in that mode.

## Testing

[`ci-scan-npm-package.yml`](../.github/workflows/ci-scan-npm-package.yml) runs on pull requests that touch this package: once against a published package and once against this repository.
