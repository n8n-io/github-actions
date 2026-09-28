# scan-community-node

Reusable workflow that scans an npm package, or the calling repository, for security problems before it is trusted. Each scanner runs as its own job, in parallel, and writes a summary to the run's step summary.

## Layout

Reusable workflows must live in `.github/workflows/`, so the package is split between that directory and this one:

| Path | Role |
|------|------|
| [`.github/workflows/scan-community-node.yml`](../.github/workflows/scan-community-node.yml) | Entry point. Writes the target table and fans out to one job per scanner |
| `.github/workflows/scan-community-node-<scanner>.yml` | One reusable workflow per scanner |
| [`actions/setup`](./actions/setup) | Installs uv and optionally Node.js, and creates `security-report/` |
| [`actions/security-summary`](./actions/security-summary) | Renders the reports in `security-report/` into the step summary |
| [`actions/upload-security-sarif`](./actions/upload-security-sarif) | Uploads the SARIF reports to code scanning when the caller opts in |
| [`examples/ci-security-scan.yml`](./examples/ci-security-scan.yml) | Caller workflow to copy into a consuming repo |

The workflows reference each other and the helper actions with the `$/` self-repository prefix, which resolves against this repository at the running commit even when called from another repository. Nothing here needs to be checked out by the caller. Scorecard and Semgrep do not recognise `$/` yet and report those references as unpinned third-party actions when this repository scans itself ([ossf/scorecard#5191](https://github.com/ossf/scorecard/pull/5191), [semgrep/semgrep-rules#4042](https://github.com/semgrep/semgrep-rules/pull/4042)).

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

Copy [`examples/ci-security-scan.yml`](./examples/ci-security-scan.yml) to `.github/workflows/ci-security-scan.yml` in the consuming repo and replace the pinned SHA. The minimal form is one job:

```yaml
permissions:
  contents: read
  security-events: write

jobs:
  scan:
    uses: n8n-io/github-actions/.github/workflows/scan-community-node.yml@<sha> # v1.0.0
    with:
      package: ${{ inputs.package }}
      upload-sarif: true
```

The called workflows declare no permissions of their own and inherit what the caller grants. `contents: read` is always needed. `security-events: write` is needed only when `upload-sarif` is enabled, and a private repository additionally needs `actions: read` for that upload. A caller that does not upload can leave both out. Triggers and `concurrency` are the caller's as well.

Each scanner is also a reusable workflow of its own and can be called the same way, for example `.github/workflows/scan-community-node-guarddog.yml`.

## Two modes

**Published package.** Set `package` (and optionally `version`) to download and scan an npm package. Its tarball is unpacked and a lockfile is resolved so the whole dependency tree is scanned. Findings show up in the step summary only: they belong to another project and are never uploaded to the caller's code scanning.

**Workspace.** Leave `package` empty to scan the calling repository. With `upload-sarif` enabled the SARIF reports are uploaded to GitHub code scanning, so findings appear under **Security → Code scanning** next to CodeQL and other analyses. Uploading needs GitHub Code Security on the repository.

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `package` | empty | npm package name, e.g. `express` or `@scope/pkg`. Leave empty to scan the calling repository. |
| `version` | `latest` | Package version to scan. Not accepted by the Scorecard workflow, which scores the package's source repository rather than a release. |
| `sandbox` | `true` | Whether GuardDog should run inside its kernel-level sandbox. Accepted only by the entry workflow and the GuardDog workflow. |
| `upload-sarif` | `false` | Whether to upload SARIF reports to GitHub code scanning. Only applies when scanning the calling repository. |

## Results

Every scan writes a human-readable summary to the workflow run's step summary. Each scanner writes its report files into a `security-report/` directory in the workspace.

Semgrep, Gitleaks and CVE Lite CLI always emit SARIF, CVE Lite CLI unless the target has no lockfile. GuardDog and Scorecard emit SARIF when scanning the calling repository and their native text report for a third-party package, since they cannot emit SARIF in that mode.

## Testing

[`ci-scan-community-node.yml`](../.github/workflows/ci-scan-community-node.yml) runs on pull requests that touch this package: once against a published package and once against this repository.
