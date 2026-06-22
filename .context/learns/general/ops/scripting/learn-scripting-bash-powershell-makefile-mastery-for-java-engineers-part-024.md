# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-024.md

# Part 024 — CI/CD Scripting: From Laptop Command to Pipeline Contract

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: mengubah command lokal menjadi kontrak pipeline CI/CD yang deterministic, observable, secure, reproducible, dan tidak drift dari developer workflow.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya membahas environment dan configuration contract:

- config vs secret vs state;
- precedence;
- `.env`;
- env vars;
- fail-fast validation;
- CI/local parity;
- secret-safe logging;
- `doctor` target.

Part 024 membahas CI/CD scripting:

> Bagaimana command yang berjalan di laptop menjadi pipeline step yang reliable?

Command lokal:

```bash
make verify
```

atau:

```bash
./mvnw test
```

belum otomatis menjadi pipeline contract.

CI/CD menambah dimensi:

- runner image;
- working directory;
- checkout depth;
- credentials;
- caches;
- artifacts;
- concurrency;
- matrix;
- secrets;
- protected environments;
- non-interactive execution;
- log retention;
- retry semantics;
- reproducibility;
- failure classification.

Pipeline yang bagus bukan hanya “script jalan di CI”. Pipeline yang bagus adalah executable contract.

---

## 1. Laptop Command vs Pipeline Contract

Laptop command biasanya punya banyak ambient assumptions:

```text
Java sudah terinstall.
Docker sudah running.
Git history lengkap.
User sudah login registry.
.env tersedia.
Network bisa akses internal service.
Current directory benar.
Tool versions cocok.
```

Pipeline contract harus menyatakan:

```text
Runner image apa?
Tool versions apa?
Secrets dari mana?
Input apa?
Output/artifact apa?
Exit code apa?
Cache apa?
Timeout berapa?
Failure yang diharapkan seperti apa?
```

Local:

```bash
make verify
```

CI:

```yaml
- name: Verify
  run: make ci/verify
```

`ci/verify` harus berbeda bila CI membutuhkan batch mode, no progress, artifact reports, dan non-interactive behavior.

---

## 2. CI as Runtime, Not Just Remote Shell

CI bukan hanya terminal jarak jauh.

CI punya konsep:

- job;
- step;
- workspace;
- environment variables;
- secret masking;
- cache;
- artifact;
- service containers;
- matrix;
- permissions;
- environment approvals;
- concurrency;
- retry;
- timeout;
- logs.

Script harus CI-aware tanpa menjadi CI-locked.

Good pattern:

```text
Make/script owns command behavior.
CI owns scheduling, permissions, cache, artifacts, and environment.
```

Bad pattern:

```yaml
run: |
  200 lines of deploy logic here
```

CI YAML bukan tempat terbaik untuk complex shell script.

---

## 3. CI Entry Point Strategy

Recommended:

```text
Local developer:
  make verify

CI:
  make ci/verify
```

Makefile:

```make
verify:
	$(MVN) test

ci/verify:
	$(MVN) --batch-mode --no-transfer-progress verify
```

Or if no Make:

```yaml
- run: ./scripts/ci-verify.sh
```

Entry points should be:

- stable;
- documented;
- non-interactive;
- fail-fast;
- produce artifacts;
- return meaningful exit codes.

---

## 4. CI-Specific Targets

Why separate `ci/*`?

CI often needs:

- batch mode;
- full verify;
- no local shortcuts;
- no prompts;
- report generation;
- artifact collection;
- deterministic flags;
- stricter checks.

Example Maven:

```make
MVN ?= ./mvnw
MVN_CI_FLAGS := --batch-mode --no-transfer-progress

ci/verify:
	$(MVN) $(MVN_CI_FLAGS) verify
```

Gradle:

```make
GRADLE ?= ./gradlew
GRADLE_CI_FLAGS := --no-daemon --stacktrace

ci/verify:
	$(GRADLE) $(GRADLE_CI_FLAGS) build
```

Local `verify` can be faster. CI `ci/verify` can be comprehensive.

---

## 5. Non-Interactive Rule

CI scripts must not prompt.

Bad:

```bash
read -p "Continue? "
```

In CI, this hangs or fails.

Bash:

```bash
if [[ "${CI:-}" == "true" ]]; then
  die "Interactive prompt not allowed in CI"
fi
```

PowerShell:

```powershell
if ($env:CI -eq 'true') {
  throw 'Interactive prompt not allowed in CI'
}
```

For risky operations, use explicit flags:

```bash
./deploy.sh --plan
./deploy.sh --apply
```

CI approval should live in CI environment protection, not terminal prompt.

---

## 6. Batch Mode for Build Tools

Maven:

```bash
./mvnw --batch-mode --no-transfer-progress verify
```

Why:

- no interactive prompts;
- less noisy logs;
- better CI formatting;
- deterministic output.

Gradle:

```bash
./gradlew --no-daemon --stacktrace build
```

Often also:

```bash
./gradlew --scan
```

if organization uses build scans and privacy policy allows.

Makefile:

```make
ci/verify:
	$(MVN) --batch-mode --no-transfer-progress verify
```

Do not use local interactive flags in CI.

---

## 7. Exit Code Contract

CI step success/failure is exit code.

Scripts must:

- exit 0 on success;
- non-zero on failure;
- distinguish usage error if helpful;
- not swallow errors;
- not pipe away failure;
- not ignore native command exit code.

Bash:

```bash
set -Eeuo pipefail
```

PowerShell:

```powershell
$ErrorActionPreference = 'Stop'
```

Native in PowerShell:

```powershell
& mvn test
if ($LASTEXITCODE -ne 0) {
  throw "mvn failed with exit code $LASTEXITCODE"
}
```

Make stops on non-zero recipe line, but shell pipelines need care.

---

## 8. Pipeline Failures

Bad Bash CI:

```bash
./mvnw test | tee test.log
```

Without pipefail, CI may pass if `tee` succeeds.

Good:

```bash
set -o pipefail
./mvnw test | tee test.log
```

POSIX sh lacks `pipefail`.

Alternative:

```bash
./scripts/run-with-log.sh ./mvnw test
```

PowerShell:

```powershell
& ./mvnw test 2>&1 | Tee-Object -FilePath test.log
if ($LASTEXITCODE -ne 0) {
  throw "mvn failed"
}
```

Be explicit.

---

## 9. Working Directory Contract

CI checkout directory may differ.

Never assume:

```bash
cd /home/me/project
```

Use CI workspace or repo root detection.

Make CI step:

```yaml
- run: make ci/verify
```

usually runs in checkout root.

Script should still resolve:

Bash:

```bash
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
cd "$repo_root"
```

PowerShell:

```powershell
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $RepoRoot
```

Make:

```make
ROOT_DIR := $(CURDIR)
```

Document expected working directory.

---

## 10. Checkout Depth and Git Metadata

Many CI checkouts are shallow.

If script runs:

```bash
git describe --tags
```

it may fail or produce different result.

CI config must fetch tags/history if needed.

Example:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

Script should fail clearly if metadata unavailable:

```bash
version="$(git describe --tags --always --dirty)" || die "Could not compute version; ensure tags are fetched"
```

Do not silently fallback to wrong version for release.

---

## 11. Toolchain Setup

CI pipeline should explicitly set up:

- JDK version;
- Maven/Gradle cache;
- Docker/buildx if needed;
- PowerShell if not preinstalled;
- Make/jq/etc.;
- cloud CLI;
- kubectl/helm.

Do not rely on runner image accidental versions for important builds.

Example contract:

```text
Java 21
Maven wrapper
Docker BuildKit enabled
GNU Make
Bash 4+
```

Use wrapper where possible:

```bash
./mvnw
./gradlew
```

Tool versions should be explicit in CI config or devcontainer.

---

## 12. Caching

CI cache improves speed but can introduce invalid state.

Common caches:

- Maven repository;
- Gradle cache;
- npm cache;
- Docker layers;
- build tool cache.

Cache key should include files that affect dependencies:

```text
pom.xml
**/pom.xml
gradle.lockfile
build.gradle
settings.gradle
```

Cache is optimization, not correctness requirement.

Script must work from empty cache.

Never store secrets in cache.

---

## 13. Artifacts

CI artifacts are outputs preserved after job:

- test reports;
- coverage reports;
- build logs;
- packaged jars;
- Docker SBOM;
- deployment plan;
- diagnostics bundle.

Scripts should write artifacts to predictable paths:

```text
build/reports/
target/surefire-reports/
build/metadata.json
build/deploy-plan.json
```

CI uploads:

```yaml
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: test-reports
    path: |
      **/target/surefire-reports/**
      **/build/test-results/**
```

Use `if: always()` for failure diagnostics.

---

## 14. Logs vs Artifacts

Logs are streamed text. Artifacts are files.

Use logs for:

- step progress;
- high-level status;
- failure context.

Use artifacts for:

- full reports;
- JSON plans;
- test results;
- generated files;
- diagnostics.

Do not dump huge reports into logs if artifact is better.

Do not put secrets in either.

---

## 15. Secret Handling in CI

CI secrets should be:

- scoped to jobs/environments;
- not available to pull requests from untrusted forks;
- masked in logs;
- least privilege;
- rotated;
- not cached;
- not printed.

Scripts should check presence:

```bash
: "${DEPLOY_TOKEN:?DEPLOY_TOKEN is required}"
```

but not print value.

Avoid:

```bash
set -x
```

around secrets.

In Bash:

```bash
set +x
# secret operations
set -x
```

But best avoid xtrace in CI deploy scripts.

---

## 16. Protected Environments

Production deployment should use CI/CD protected environment.

CI owns:

- manual approval;
- allowed branches;
- required reviewers;
- secret availability;
- deployment history.

Make target:

```make
deploy/apply:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --apply
```

does not protect production by itself.

CI job:

```yaml
environment: production
```

or equivalent provider feature.

Security boundary is CI/IAM, not Makefile.

---

## 17. Pull Request Security

Dangerous pattern:

```text
PR from fork modifies script.
CI runs modified script with secrets.
```

Avoid exposing secrets to untrusted code.

Strategies:

- no secrets in PR jobs;
- separate trusted deploy workflow;
- require review before privileged workflow;
- use `pull_request_target` carefully;
- do not run repo scripts with secrets from untrusted PR without checkout isolation.

Scripts are code. Treat script changes as privileged if they run with secrets.

---

## 18. Dependency on Ambient Credentials

Local script might rely on:

```text
docker login
aws profile
kubectl context
gcloud auth
```

CI should use explicit credentials.

Script should validate identity before risky action:

```bash
aws sts get-caller-identity
kubectl config current-context
docker context show
```

For CI, prefer short-lived credentials/OIDC where possible.

Do not deploy based on developer laptop ambient cloud state unless intentionally local-only.

---

## 19. Matrix Builds

CI matrix should be in CI config.

Example dimensions:

```text
Java 17, 21
OS ubuntu, windows, macos
Database postgres versions
```

Make should not simulate large matrix with loops.

Make target can be same across matrix:

```yaml
strategy:
  matrix:
    java: ['17', '21']

steps:
  - run: make ci/verify
```

Matrix environment varies, command contract stays same.

---

## 20. OS Matrix and Scripts

If supporting Windows/Linux/macOS:

- use `pwsh` for cross-platform scripts;
- avoid Bash-only commands on Windows;
- or use OS-specific steps.

CI example:

```yaml
- name: Verify
  shell: pwsh
  run: ./scripts/Verify.ps1
```

Or per OS:

```yaml
- if: runner.os == 'Windows'
  run: pwsh ./scripts/Verify.ps1

- if: runner.os != 'Windows'
  run: make ci/verify
```

Be honest about compatibility.

---

## 21. Service Containers

CI can run dependencies:

- PostgreSQL;
- Redis;
- Kafka;
- LocalStack;
- Selenium.

CI service container config belongs in CI YAML or docker compose wrapper.

Make can expose:

```make
local/up:
	docker compose up -d
```

CI may use service containers instead of compose.

Avoid assuming local Docker Compose network is same as CI service network. Document differences.

---

## 22. Timeouts

CI job timeout should be explicit.

Scripts should also have operation-level timeouts.

Bash:

```bash
timeout 60 ./scripts/wait-health.sh
```

But `timeout` may not exist on macOS by default.

PowerShell:

```powershell
Invoke-RestMethod -Uri $Uri -TimeoutSec 30
```

CI:

```yaml
timeout-minutes: 20
```

Use both:

- CI job timeout prevents infinite job.
- Script timeout gives clearer domain failure.

---

## 23. Retries

Retry is useful for transient operations:

- downloading dependencies;
- flaky network API;
- service readiness;
- registry push maybe.

Do not retry deterministic failures:

- compilation error;
- test failure;
- validation error;
- permission denied.

Retry should be bounded and logged.

Bash:

```bash
for attempt in 1 2 3; do
  if curl --fail "$URL"; then
    break
  fi
  sleep 5
done
```

Better in script helper with clear final failure.

---

## 24. Concurrency Control

CI can run multiple pipelines simultaneously.

Problems:

- two deploys to same env;
- two publishes same version;
- shared test environment conflict;
- same Docker tag overwritten.

CI should own concurrency groups/environment locks.

Script should still validate idempotency.

Make cannot solve global concurrency.

---

## 25. Idempotency in CI Scripts

CI may retry a failed job.

Script should handle:

- artifact already exists;
- Docker tag already pushed;
- deployment already at version;
- migration already applied;
- temp directory exists.

For publish/deploy, decide:

- fail if exists;
- skip if identical;
- overwrite only with explicit flag.

Document idempotency behavior.

---

## 26. Artifacts and Checksums

For release:

```bash
sha256sum target/app.jar > target/app.jar.sha256
```

Cross-platform PowerShell:

```powershell
Get-FileHash -Path target/app.jar -Algorithm SHA256
```

Store metadata:

```json
{
  "artifact": "app.jar",
  "sha256": "...",
  "version": "1.2.3",
  "commit": "abc123"
}
```

CI should publish artifact and checksum together.

---

## 27. Pipeline Stages

Typical:

```text
verify -> package -> publish artifact/image -> deploy staging -> test staging -> deploy prod
```

Each stage has input/output contract.

Example:

### verify

Input:

```text
source code
JDK
dependencies
```

Output:

```text
test reports
coverage
```

### package

Output:

```text
jar
image
metadata
SBOM maybe
```

### deploy

Input:

```text
version/image
environment
credentials
```

Output:

```text
deployment record
health result
```

Write scripts around stage contracts.

---

## 28. Promotion vs Rebuild

Release engineering principle:

> Build once, promote the same artifact.

Bad:

```text
build jar separately for staging and prod
```

Better:

```text
build image once -> tag/digest -> deploy same digest to staging/prod
```

CI scripts should pass artifact identity:

```text
image digest
artifact checksum
version
commit
```

Make target should not hide rebuilds in deploy.

---

## 29. Deterministic Inputs

CI should record:

- commit SHA;
- version;
- image digest;
- build tool version;
- JDK version;
- environment;
- script version;
- config source.

Deployment plan should include these.

This helps audit and rollback.

---

## 30. Script Logging in CI

Good logs:

```text
==> Preflight
==> Running tests
==> Building image my-service:abc123
==> Uploading artifact
```

Bad logs:

```text
Done
```

or:

```text
Massive debug dump with secrets
```

Use log levels where possible:

- normal: high-level steps;
- verbose/debug: details;
- artifacts: full reports.

Bash logging helpers from earlier parts apply.

PowerShell streams apply.

---

## 31. Shell Selection in CI

Be explicit.

GitHub Actions:

```yaml
- shell: bash
  run: ./scripts/ci-verify.sh
```

or:

```yaml
- shell: pwsh
  run: ./scripts/Verify.ps1
```

Do not rely on default shell if script requires Bash.

If using Make, runner shell still affects recipe execution. Make recipe uses `/bin/sh` by default on Unix.

---

## 32. CI and Make

Makefile:

```make
ci/verify:
	./scripts/ci-verify.sh
```

CI:

```yaml
- run: make ci/verify
```

This is good if CI image has Make.

If Windows runner lacks Make, use PowerShell entrypoint:

```yaml
- shell: pwsh
  run: ./scripts/Verify.ps1
```

Do not force Make if it adds friction without value.

---

## 33. CI and PowerShell

PowerShell script:

```powershell
#requires -Version 7.0

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Write-Information "Running verification" -InformationAction Continue

& ./mvnw --batch-mode --no-transfer-progress verify
if ($LASTEXITCODE -ne 0) {
  throw "Maven verify failed with exit code $LASTEXITCODE"
}
```

CI:

```yaml
- shell: pwsh
  run: ./scripts/Verify.ps1
```

This can work cross-platform if `pwsh` and wrapper are available.

---

## 34. CI and Bash

Bash script:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

log() { printf '==> %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

log "Running Maven verify"
./mvnw --batch-mode --no-transfer-progress verify
```

CI:

```yaml
- shell: bash
  run: ./scripts/ci-verify.sh
```

Ensure executable bit or call `bash ./scripts/ci-verify.sh`.

---

## 35. Pipeline Contract Template

```markdown
# Pipeline Contract: ci/verify

## Purpose
Verify code for pull requests and main branch.

## Entry Point
make ci/verify

## Runtime
Ubuntu runner, Java 21, GNU Make, Maven Wrapper.

## Inputs
- Source checkout
- No secrets required

## Outputs
- Test reports: target/surefire-reports
- Coverage report: target/site/jacoco

## Exit Codes
- 0 success
- non-zero failure

## Caches
- Maven repository cache keyed by pom.xml files

## Artifacts
Uploaded on success/failure.

## Non-Interactive
No prompts.

## Timeout
20 minutes.

## Security
Safe for untrusted PRs, no secrets.
```

Write this for critical pipelines.

---

## 36. Deploy Pipeline Contract Template

```markdown
# Pipeline Contract: deploy/apply

## Purpose
Deploy prebuilt image to target environment.

## Entry Point
make deploy/apply ENV=<env> VERSION=<version>

## Runtime
Protected CI environment.

## Inputs
- ENV: staging|prod
- VERSION: SemVer
- IMAGE_DIGEST: immutable image digest
- DEPLOY_TOKEN: CI secret
- KUBECONFIG or OIDC identity

## Outputs
- Deployment plan JSON
- Deployment result JSON
- Logs
- Health check report

## Exit Codes
- 0 deployed/no-op success
- 2 usage/config error
- 1 operational failure

## Safety
- No default prod
- Plan available
- Apply requires protected environment approval
- Validates cluster/context
- Does not rebuild artifact

## Idempotency
If requested version already deployed, returns success with no-op result.

## Timeout
30 minutes.
```

This is how top-tier teams reason about CI/CD automation.

---

## 37. Example GitHub Actions Skeleton

```yaml
name: verify

on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: read

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '21'
          cache: maven

      - name: Verify
        run: make ci/verify

      - name: Upload test reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-reports
          path: |
            **/target/surefire-reports/**
            **/target/failsafe-reports/**
```

CI handles Java setup and artifacts. Make handles verify command.

---

## 38. Example Deploy Skeleton

```yaml
name: deploy

on:
  workflow_dispatch:
    inputs:
      environment:
        required: true
        type: choice
        options: [staging, prod]
      version:
        required: true
        type: string

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    environment: ${{ inputs.environment }}
    permissions:
      contents: read
      id-token: write

    steps:
      - uses: actions/checkout@v4

      - name: Deploy plan
        run: make deploy/plan ENV="${{ inputs.environment }}" VERSION="${{ inputs.version }}"

      - name: Deploy apply
        run: make deploy/apply ENV="${{ inputs.environment }}" VERSION="${{ inputs.version }}"
```

This is simplified, but shows separation:

- CI owns manual dispatch and environment approval.
- Make exposes deploy entrypoints.
- Script implements deploy logic.

---

## 39. Common CI Anti-Patterns

### 39.1 Long inline scripts in YAML

Hard to test locally.

### 39.2 Secrets available in PR jobs

Dangerous.

### 39.3 Build and deploy rebuild separately

Artifact mismatch.

### 39.4 No artifacts on failure

Debugging painful.

### 39.5 Hidden CI behavior in script

`if CI then completely different thing` without docs.

### 39.6 Relying on latest tool versions

Breaks unexpectedly.

### 39.7 No timeouts

Hanging jobs.

### 39.8 Ignoring exit codes through pipes

False green builds.

### 39.9 Deployment from mutable tags only

No immutable artifact identity.

### 39.10 Make target does production deploy by default

Unsafe UX.

---

## 40. Review Checklist

### Entry Point

- Is the CI command stable?
- Can it run locally where appropriate?
- Is CI-specific target named?

### Runtime

- Are tools and versions explicit?
- Is shell specified?
- Is working directory known?

### Config and Secrets

- Are required variables documented?
- Are secrets scoped and not printed?
- Are untrusted PRs safe?

### Failure

- Does non-zero propagate?
- Are pipeline failures handled?
- Are logs actionable?

### Artifacts

- Are test reports uploaded?
- Are deploy plans/results stored?
- Are artifacts uploaded on failure?

### Reproducibility

- Is checkout depth sufficient?
- Are caches correct but not required?
- Is artifact identity recorded?

### Safety

- Are deploys protected?
- Is prod explicit?
- Are permissions least privilege?
- Are concurrency/race risks handled?

---

## 41. Mini Lab

### Lab 1 — Make CI Target

Add:

```make
ci/verify:
	./mvnw --batch-mode --no-transfer-progress verify
```

Run locally.

---

### Lab 2 — Artifact Path

Make your test step produce test reports and identify upload paths.

---

### Lab 3 — Pipefail Failure

Create a command that fails piped to `tee`. Observe with/without `pipefail`.

---

### Lab 4 — Secret-Safe Logging

Write script that checks secret presence without printing value.

---

### Lab 5 — Pipeline Contract

Write `ci/verify.md` contract using template.

---

## 42. Design Exercise: Full CI Contract for Java Service

Design CI pipeline:

Stages:

```text
verify
package
docker build
publish image
deploy staging
smoke test staging
deploy prod
```

For each stage define:

- entrypoint;
- inputs;
- outputs;
- secrets;
- artifacts;
- cache;
- timeout;
- permissions;
- idempotency;
- failure behavior.

Then map:

- Make target;
- script;
- build tool;
- CI responsibility.

---

## 43. Part 024 Summary

CI/CD scripting turns local automation into executable pipeline contracts.

Key takeaways:

1. CI is a runtime with its own contracts, not just remote shell.
2. Use stable entrypoints like `make ci/verify` or `scripts/ci-verify.sh`.
3. Keep CI YAML orchestration-focused; move complex logic to scripts.
4. CI scripts must be non-interactive.
5. Use batch/no-progress flags for Maven/Gradle.
6. Exit codes are pipeline truth; preserve them.
7. Beware pipe failure masking.
8. Explicitly set up toolchains.
9. Cache is optimization, not correctness.
10. Upload artifacts, especially on failure.
11. Protect secrets from untrusted PRs.
12. CI owns permissions, approvals, matrix, and concurrency.
13. Build once, promote immutable artifacts.
14. Deployment needs plan/apply, protected environments, and audit-friendly metadata.
15. Document pipeline contracts for critical workflows.

Part 025 will cover release and deployment automation in depth.

---

## 44. Referensi Resmi dan Bacaan Lanjutan

- CI provider documentation for workflows/jobs/steps.
- GitHub Actions / GitLab CI / Jenkins / Buildkite concepts.
- Maven batch mode and CI usage.
- Gradle CI best practices.
- Docker build and image digest documentation.
- Artifact and cache documentation for CI providers.
- Secret management and protected environment documentation.
- SLSA / provenance concepts for build pipelines.
- Release engineering best practices.
- Deployment safety patterns: plan/apply, promotion, rollback, health checks.

---

## 45. Status Seri

Seri belum selesai.

Progress:

- [x] Part 000 — Orientation: Scripting as Engineering Control Plane
- [x] Part 001 — Shell Mental Model: Process, Stream, Exit Code, Environment
- [x] Part 002 — Command Execution Semantics: Parsing, Expansion, Quoting
- [x] Part 003 — POSIX Shell Baseline: Portable Script Before Bash-Specific Script
- [x] Part 004 — Bash Fundamentals Without Toy Examples
- [x] Part 005 — Error Handling in Bash: Fail Fast, Fail Clear, Fail Safe
- [x] Part 006 — Data Handling in Bash: Text, Lines, Null Bytes, JSON, CSV
- [x] Part 007 — Filesystem Automation: Safe File Operations
- [x] Part 008 — Process Control: Background Jobs, Signals, Timeouts, Concurrency
- [x] Part 009 — CLI Design for Internal Tools
- [x] Part 010 — Bash Testing, Linting, Formatting, and Reviewability
- [x] Part 011 — Security Model for Shell Scripts
- [x] Part 012 — PowerShell Mental Model: Objects, Pipeline, Providers
- [x] Part 013 — PowerShell Language Fundamentals for Java Engineers
- [x] Part 014 — PowerShell Error Handling, Strictness, and Observability
- [x] Part 015 — PowerShell Data Automation: JSON, XML, CSV, REST, Objects
- [x] Part 016 — Cross-Platform PowerShell: Windows, Linux, macOS, Containers
- [x] Part 017 — PowerShell Modules and Reusable Automation Architecture
- [x] Part 018 — Makefile Mental Model: Dependency Graph, Targets, Recipes
- [x] Part 019 — Practical Makefile Syntax and Execution Semantics
- [x] Part 020 — Makefile for Java Projects: Maven, Gradle, Docker, CI Facade
- [x] Part 021 — Makefile as Workflow Orchestrator, Not Build System Replacement
- [x] Part 022 — Script Portability Matrix: Bash, POSIX sh, PowerShell, Make, Java
- [x] Part 023 — Environment Management and Configuration Contracts
- [x] Part 024 — CI/CD Scripting: From Laptop Command to Pipeline Contract
- [ ] Part 025 — Release and Deployment Automation
- [ ] Part 026 — Operational Scripts: Diagnostics, Runbooks, Incident Tools
- [ ] Part 027 — Advanced Bash and PowerShell Interop
- [ ] Part 028 — Refactoring Legacy Scripts
- [ ] Part 029 — Capstone: Production-Grade Automation Toolkit for a Java Service


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-023.md">⬅️ Part 023 — Environment Management and Configuration Contracts</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-025.md">Part 025 — Release and Deployment Automation ➡️</a>
</div>
