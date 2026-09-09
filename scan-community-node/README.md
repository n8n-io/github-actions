# scan-community-node

Scans a checkout of an n8n community node package for malicious code patterns
with [DataDog GuardDog](https://github.com/DataDog/guarddog).

## What it does

Runs `guarddog npm scan` on the package directory. GuardDog's source code rules
flag the patterns that matter for code that ends up inside an n8n instance:
download-and-execute, obfuscation, base64 decode followed by eval, reading and
exfiltrating environment variables, silent process execution, reverse shells,
crypto mining, and similar.

Each finding becomes an inline annotation on the affected file, and the job
summary lists all findings with GuardDog's risk score. The full JSON report is
available through the `report` output.

Findings fail the step. Set `fail-on-finding: false` to report only. The step
still fails when GuardDog itself cannot run.

## What it does not do

Only GuardDog's source code rules run on a local checkout. Metadata rules such
as typosquatting, deceptive author, or a newly added install script need the
published package. Run GuardDog against npm after a release to cover those:

```
uvx guarddog npm scan <package-name>
```

## Usage

Copy [`examples/scan-community-node.yml`](./examples/scan-community-node.yml)
to `.github/workflows/scan-community-node.yml` in the node repository and
replace the pinned SHA. The caller owns checkout, triggers, `permissions` and
`timeout-minutes`. Composite actions cannot declare those.

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `path` | no | `.` | Directory that contains the package's `package.json`, relative to the workspace |
| `guarddog-version` | no | `3.2.0` | GuardDog version, installed from PyPI with uvx |
| `fail-on-finding` | no | `true` | Fail the step on findings. `false` reports only. The step still fails when GuardDog cannot run |

## Outputs

| Output | Description |
|--------|-------------|
| `issues` | GuardDog's issue count. Zero means a clean scan |
| `report` | Path to GuardDog's JSON report |
