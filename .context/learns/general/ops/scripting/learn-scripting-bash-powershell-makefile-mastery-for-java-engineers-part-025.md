# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-025.md

# Part 025 — Release and Deployment Automation

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: membangun release/deployment automation yang aman, reproducible, auditable, idempotent, dan cocok untuk Java service modern: artifact identity, versioning, image digest, plan/apply, promotion, rollback, health checks, gates, dan failure handling.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya membahas CI/CD scripting:

- CI entrypoint contract;
- secrets;
- protected environments;
- artifacts;
- cache;
- matrix;
- promotion vs rebuild;
- pipeline contract.

Part 025 memperdalam domain release/deployment.

Release automation adalah area yang sering terlihat seperti “sekadar script deploy”, tetapi sebenarnya menyatukan:

- versioning;
- artifact immutability;
- build provenance;
- container image tags/digests;
- registry;
- CI approvals;
- environment config;
- deployment strategy;
- health check;
- rollback;
- audit;
- idempotency;
- secrets;
- production safety.

Targetnya bukan membuat “script deploy paling canggih”, tetapi memahami mental model dan kontrak yang membuat deploy automation tidak berbahaya.

---

## 1. Release vs Deployment

Bedakan dua istilah:

### Release

Membuat artifact siap dipromosikan.

Examples:

```text
Build jar
Build container image
Generate SBOM
Generate metadata
Tag version
Publish artifact
Publish image
Create release notes
```

### Deployment

Menjalankan release tertentu di environment tertentu.

Examples:

```text
Deploy image digest to staging
Run migration
Update Kubernetes deployment
Wait rollout
Run health check
Promote to prod
Rollback
```

Release menjawab:

```text
Apa yang kita ship?
```

Deployment menjawab:

```text
Ke mana dan bagaimana artifact itu dijalankan?
```

Do not mix them carelessly.

---

## 2. Build Once, Promote Same Artifact

Prinsip penting:

> Build once, promote the same immutable artifact across environments.

Bad:

```text
Build jar for staging.
Build jar again for prod.
```

Masalah:

- artifact bisa berbeda;
- dependency berubah;
- timestamp berbeda;
- source berubah;
- cache berbeda;
- reproducibility hilang.

Better:

```text
Commit abc123
  -> build image digest sha256:...
  -> deploy digest to staging
  -> deploy same digest to prod
```

Release automation harus membawa artifact identity.

---

## 3. Artifact Identity

Artifact identity bisa berupa:

### Maven artifact

```text
groupId:artifactId:version
checksum
repository URL
```

### Container image

```text
registry.example.com/team/service@sha256:...
```

Tag berguna untuk manusia, digest untuk immutability.

### Git commit

```text
commit SHA
tag
dirty flag
branch/ref
```

### Metadata

```json
{
  "service": "payment-service",
  "version": "1.2.3",
  "commit": "abc123",
  "image": "registry.example.com/payment-service@sha256:...",
  "builtAt": "2026-06-22T10:00:00Z"
}
```

Deploy should use immutable identity where possible.

---

## 4. Versioning Strategy

Common version strategies:

### SemVer

```text
1.2.3
```

Good for libraries/releases.

### CalVer

```text
2026.06.22
```

Good for frequent deploys.

### Git SHA

```text
abc1234
```

Good for internal services.

### Hybrid

```text
1.2.3+abc1234
```

or container tags:

```text
1.2.3
abc1234
main-abc1234
```

Choose based on release model.

For services, immutable image digest is more important than tag semantics.

---

## 5. Tags Are Mutable

Container tags can be overwritten:

```text
my-service:latest
my-service:prod
my-service:abc123
```

Even commit tags can be moved if registry allows.

Digest is immutable content address:

```text
my-service@sha256:...
```

Deploy by digest when possible.

Use tags for convenience, digest for correctness.

---

## 6. Release Metadata Contract

Generate metadata during build:

```json
{
  "service": "payment-service",
  "version": "1.2.3",
  "commit": "abc123456",
  "branch": "main",
  "dirty": false,
  "imageTag": "registry/payment-service:1.2.3",
  "imageDigest": "sha256:...",
  "builder": "ci",
  "builtAt": "2026-06-22T10:00:00Z"
}
```

Metadata should be:

- machine-readable;
- archived as CI artifact;
- included with release;
- referenced by deploy.

Do not include secrets.

---

## 7. Make Targets for Release

Example:

```make
VERSION ?=
IMAGE ?=

.PHONY: release/check release/package release/publish release/metadata

release/check:
	./scripts/release-check.sh --version "$(VERSION)"

release/package:
	./mvnw --batch-mode --no-transfer-progress package

release/metadata:
	./scripts/build-metadata.sh --version "$(VERSION)" --json

release/publish:
	./scripts/publish-release.sh --version "$(VERSION)" --image "$(IMAGE)"
```

For risky workflows, script owns validation.

---

## 8. Release Check Script Responsibilities

`release-check.sh` should validate:

- version format;
- Git clean or CI commit identity;
- release tag does not already exist;
- artifact version matches requested version;
- changelog/release notes if required;
- tests passed if stage contract requires;
- required tools installed;
- registry access present;
- branch/ref allowed.

Make should not implement all this inline.

---

## 9. Maven Release Concerns

For Java libraries:

- version in `pom.xml`;
- snapshot vs release;
- artifact repository;
- signing;
- checksums;
- staging repository;
- release tags.

For services:

- Maven artifact may be intermediate;
- container image often final deploy unit.

Avoid mixing library release process and service deployment model.

Maven command examples:

```bash
./mvnw --batch-mode verify
./mvnw --batch-mode deploy
```

But release policy should be explicit.

---

## 10. Gradle Release Concerns

Gradle projects may publish:

```bash
./gradlew publish
```

Service image may be built by:

- Dockerfile;
- Jib;
- Spring Boot build image;
- Gradle Docker plugin;
- external CI step.

Whatever tool builds image, deployment should reference immutable artifact.

---

## 11. Container Image Build

Make target:

```make
IMAGE ?= registry.example.com/payment-service:$(VERSION)

docker/build:
	docker build -t "$(IMAGE)" .
```

But release build should avoid vague defaults.

```make
release/image:
	./scripts/build-image.sh --version "$(VERSION)" --image "$(IMAGE)"
```

`build-image.sh` can:

- validate version;
- pass labels;
- use BuildKit;
- generate metadata;
- output digest;
- avoid secrets leakage.

---

## 12. Image Labels

Add OCI labels in Docker build:

```bash
docker build \
  --label org.opencontainers.image.revision="$COMMIT" \
  --label org.opencontainers.image.version="$VERSION" \
  --label org.opencontainers.image.created="$BUILT_AT" \
  -t "$IMAGE" .
```

These labels improve traceability.

Do not put secrets in labels.

---

## 13. Image Digest Capture

After push:

```bash
docker push "$IMAGE"
docker inspect --format='{{index .RepoDigests 0}}' "$IMAGE"
```

But local `RepoDigests` behavior can be tricky.

Registry tools or buildx metadata can help.

Script should output:

```json
{
  "image": "registry.example.com/payment-service:1.2.3",
  "digestRef": "registry.example.com/payment-service@sha256:..."
}
```

Deploy uses `digestRef`.

---

## 14. Deployment Plan

Before apply, create a plan.

Plan includes:

```json
{
  "environment": "staging",
  "service": "payment-service",
  "currentVersion": "1.2.2",
  "targetVersion": "1.2.3",
  "currentImage": "...@sha256:old",
  "targetImage": "...@sha256:new",
  "strategy": "rolling",
  "migrations": {
    "required": false
  }
}
```

Plan answers:

```text
What will change?
```

This is useful for:

- human review;
- CI logs;
- audit;
- dry-run;
- rollback planning.

---

## 15. Plan/Apply Pattern

Make:

```make
deploy/plan:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --plan

deploy/apply:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --apply
```

Script:

```bash
case "$mode" in
  plan) create_plan ;;
  apply) apply_plan ;;
esac
```

Never make apply implicit.

Bad:

```bash
./deploy.sh --dry-run=false
```

Better:

```bash
deploy/plan
deploy/apply
```

Explicit mode reduces accidents.

---

## 16. Deployment Input Contract

Required:

```text
ENV
VERSION or IMAGE_DIGEST
DEPLOY_TOKEN / cloud identity
```

Optional:

```text
TIMEOUT_SECONDS
STRATEGY
HEALTH_URL
```

No default prod.

Validate:

```bash
case "$ENV" in
  staging|prod) ;;
  *) die "ENV must be staging or prod" ;;
esac
```

Version:

```bash
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Invalid version"
```

Image digest:

```bash
[[ "$IMAGE" == *@sha256:* ]] || die "Deploy requires image digest"
```

---

## 17. Idempotent Deploy

Idempotent deploy behavior:

```text
If target version already deployed, succeed with no-op.
```

Script should detect current state:

```text
current image == target image
```

Then output:

```json
{
  "status": "noop",
  "reason": "target already deployed"
}
```

Do not fail just because previous attempt partially succeeded if desired state is already achieved.

---

## 18. Deployment State Discovery

For Kubernetes:

```bash
kubectl get deployment payment-service -o json
```

For ECS/Cloud Run/etc.:

```bash
cloud CLI/API
```

For custom platform:

```bash
GET /deployments/current
```

State discovery should be explicit and validated.

Do not rely on stale local files for current production state.

---

## 19. Kubernetes Context Safety

Before deploy:

```bash
current_context="$(kubectl config current-context)"
```

Validate expected context:

```bash
[[ "$current_context" == "$EXPECTED_CONTEXT" ]] || die "Wrong kubectl context"
```

In CI, prefer explicit kubeconfig/identity per environment.

For prod, CI protected environment should supply prod credentials only after approval.

---

## 20. Cloud Identity Validation

AWS:

```bash
aws sts get-caller-identity
```

GCP:

```bash
gcloud auth list
gcloud config get-value project
```

Azure:

```bash
az account show
```

Validate account/project/subscription.

Do not deploy to “whatever account is active”.

---

## 21. Health Checks

Deployment apply should verify:

- rollout completed;
- app health endpoint returns healthy;
- version endpoint matches target;
- smoke test passes.

Example:

```bash
curl --fail --silent "$HEALTH_URL"
```

Better: script with timeout/retry/backoff.

PowerShell:

```powershell
Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 10
```

Health check should distinguish:

- network failure;
- HTTP status failure;
- application unhealthy;
- wrong version deployed.

---

## 22. Wait and Timeout

Deploy needs bounded wait.

Pseudo:

```bash
deadline=$((SECONDS + TIMEOUT_SECONDS))
until healthy; do
  if (( SECONDS > deadline )); then
    die "Timed out waiting for health"
  fi
  sleep 5
done
```

Avoid infinite waits.

CI job timeout is not enough; script timeout gives domain error.

---

## 23. Rollback

Rollback strategy depends platform.

Options:

1. Roll back to previous image.
2. Revert deployment config.
3. Use platform rollout undo.
4. Promote previous release.
5. Manual intervention.

Automation should know:

- previous version/image;
- rollback command;
- rollback safety;
- migration compatibility;
- health check after rollback.

Rollback is not magic. Database migrations can make rollback unsafe.

---

## 24. Database Migration Boundary

DB migrations are high-risk.

Questions:

- run before or after app deploy?
- backward compatible?
- can old app run with new schema?
- can new app run with old schema?
- rollback possible?
- migration idempotent?
- locking?
- duration?
- online/offline?
- approvals?

Automation should not blindly:

```bash
mvn flyway:migrate && deploy
```

without strategy.

For mature systems, use expand/contract migration patterns.

---

## 25. Backward-Compatible Deployment

Safe deployment usually requires:

```text
version N app works with schema N and N+1
version N+1 app works with schema N and N+1
```

Then:

1. Expand schema.
2. Deploy new app.
3. Contract old schema later.

Script can orchestrate, but design must come from application architecture.

Automation cannot fix incompatible migration strategy.

---

## 26. Deployment Strategies

Common:

- recreate;
- rolling update;
- blue/green;
- canary;
- feature flag rollout;
- shadow traffic.

Automation needs to know strategy:

```bash
--strategy rolling
--strategy canary --percent 10
```

But complex rollout control often belongs to platform:

- Kubernetes deployment;
- Argo Rollouts;
- Flagger;
- Spinnaker;
- cloud deployment service;
- feature flag platform.

Script should invoke platform, not reimplement it.

---

## 27. Canary Automation

Canary flow:

1. Deploy small percentage.
2. Wait.
3. Check metrics/health.
4. Increase traffic.
5. Continue or rollback.

This is too complex for ad-hoc Make recipe.

Use deployment platform or real CLI/script with strong tests and metrics integration.

Make target can be:

```make
deploy/canary:
	platform deploy canary --env "$(ENV)" --image "$(IMAGE)"
```

---

## 28. Observability During Deploy

Deployment result should include:

- target version;
- image digest;
- environment;
- rollout status;
- health status;
- duration;
- logs/artifact link;
- operator/CI run;
- rollback reference.

Structured output:

```json
{
  "status": "success",
  "environment": "staging",
  "version": "1.2.3",
  "imageDigest": "sha256:...",
  "durationSeconds": 123
}
```

Store as CI artifact.

---

## 29. Release Notes

Release automation may generate notes from:

- Git commits;
- PR titles;
- issue links;
- changelog file;
- conventional commits.

Be careful auto-generating user-facing release notes from raw commit messages.

For internal deploy, metadata summary may be enough.

For external product release, human review likely needed.

---

## 30. Git Tags

Tagging release:

```bash
git tag "v$VERSION"
git push origin "v$VERSION"
```

Safety:

- ensure tag not exists;
- tag correct commit;
- signed tags if required;
- protected tag rules;
- CI identity;
- avoid local uncommitted changes.

Tagging should be part of release contract, not hidden side effect.

---

## 31. Branch and Ref Policy

Release may be allowed only from:

```text
main
release/*
tag v*
```

CI should enforce triggers. Script can validate:

```bash
branch="$(git rev-parse --abbrev-ref HEAD)"
[[ "$branch" == "main" ]] || die "Release must run from main"
```

In detached CI HEAD, branch detection differs. Prefer CI-provided ref variables when available, with fallback.

---

## 32. Immutable Artifact Promotion

Promotion flow:

```text
build image -> push digest -> deploy digest to staging -> test -> deploy same digest to prod
```

Do not rebuild in prod deploy.

Deploy input should be:

```text
IMAGE_DIGEST
```

or metadata file from build stage.

CI artifact:

```text
release-metadata.json
```

Downstream stage reads it.

---

## 33. Artifact Repository

For Maven artifacts:

- repository URL;
- credentials;
- group/artifact/version;
- checksum;
- signing;
- staging/release repo.

For service deployment, Maven artifact may be less relevant than container image.

Still archive:

- jar;
- checksum;
- SBOM;
- metadata.

---

## 34. SBOM and Provenance

Modern release pipelines may include:

- SBOM;
- dependency list;
- build provenance;
- signatures;
- vulnerability scan.

Automation should produce/attach these if organization requires.

Make target:

```make
release/sbom:
	./scripts/generate-sbom.sh
```

But signing/provenance/security tooling often belongs to CI/platform.

---

## 35. Failure Classification

Deploy failures:

```text
usage/config error
artifact not found
auth failure
platform API failure
rollout timeout
health check failed
wrong version
migration failure
network transient
```

Do not collapse all into:

```text
deploy failed
```

Scripts should produce actionable errors.

Exit codes can optionally distinguish:

```text
2 usage/config
1 operational
```

But logs/structured result are more important.

---

## 36. Partial Failure

Partial deploy can happen:

- image pushed but metadata upload failed;
- deployment updated but health failed;
- migration succeeded but app failed;
- tag created but artifact publish failed.

Automation should record state and guide next action.

Idempotency helps rerun safely.

Avoid workflows where rerun makes things worse.

---

## 37. Dry Run vs Plan vs No-Op

Terms:

### Dry run

Does not mutate, may validate only.

### Plan

Computes intended changes.

### No-op

Apply mode detects target already achieved and changes nothing.

Use precise terms.

`deploy/plan` should not mutate.

`deploy/apply` may no-op if already deployed.

---

## 38. Manual Approval

Manual approval belongs in CI/platform.

Do not rely on:

```bash
read -p "Deploy prod?"
```

for production.

CI environment approval gives:

- audit trail;
- reviewer identity;
- policy;
- secret scoping.

Script can still require explicit `--apply`.

---

## 39. Release Script Architecture

`deploy-release.sh` structure:

```bash
main() {
  parse_args "$@"
  validate_inputs
  load_config
  preflight
  plan_deployment

  case "$MODE" in
    plan) write_plan ;;
    apply)
      apply_deployment
      wait_rollout
      health_check
      write_result
      ;;
  esac
}
```

Each function small and testable.

Make calls script.

CI protects script execution.

---

## 40. Bash Deploy Skeleton

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '==> %s\n' "$*" >&2; }

usage() {
  cat <<'USAGE'
Usage:
  deploy-release.sh --env ENV --image IMAGE --plan
  deploy-release.sh --env ENV --image IMAGE --apply

Required:
  --env    staging|prod
  --image  immutable image ref with @sha256:
USAGE
}

ENVIRONMENT=""
IMAGE=""
MODE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENVIRONMENT="${2:?--env requires value}"; shift 2 ;;
    --image) IMAGE="${2:?--image requires value}"; shift 2 ;;
    --plan) MODE="plan"; shift ;;
    --apply) MODE="apply"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ "$ENVIRONMENT" =~ ^(staging|prod)$ ]] || die "--env must be staging or prod"
[[ "$IMAGE" == *@sha256:* ]] || die "--image must be immutable digest ref"
[[ "$MODE" =~ ^(plan|apply)$ ]] || die "Specify --plan or --apply"

require_tool() {
  command -v "$1" >/dev/null 2>&1 || die "Required tool not found: $1"
}

require_tool kubectl

log "Planning deployment"
# Build plan here.

if [[ "$MODE" == "plan" ]]; then
  log "Plan only; no changes applied"
  exit 0
fi

log "Applying deployment"
# kubectl set image ...
# kubectl rollout status ...
# health check ...
```

Skeleton only; real implementation depends platform.

---

## 41. PowerShell Deploy Skeleton

```powershell
#requires -Version 7.0

[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateSet('staging', 'prod')]
  [string] $Environment,

  [Parameter(Mandatory)]
  [ValidatePattern('@sha256:')]
  [string] $Image,

  [Parameter(Mandatory)]
  [ValidateSet('Plan', 'Apply')]
  [string] $Mode
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Require-Command {
  param([Parameter(Mandatory)][string] $Name)

  if ($null -eq (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

Require-Command kubectl

$plan = [PSCustomObject]@{
  environment = $Environment
  image = $Image
  mode = $Mode
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
}

if ($Mode -eq 'Plan') {
  $plan | ConvertTo-Json -Depth 5
  exit 0
}

Write-Information "Applying deployment to $Environment" -InformationAction Continue
# Invoke kubectl / platform API.
```

PowerShell is good for structured plan/result JSON.

---

## 42. Makefile Release Facade

```make
ENV ?=
VERSION ?=
IMAGE ?=

.PHONY: release/check release/metadata docker/build docker/push deploy/plan deploy/apply

release/check:
	./scripts/release-check.sh --version "$(VERSION)"

release/metadata:
	./scripts/build-release-metadata.sh --version "$(VERSION)" --json

docker/build:
	./scripts/docker-build.sh --version "$(VERSION)" --image "$(IMAGE)"

docker/push:
	./scripts/docker-push.sh --image "$(IMAGE)"

deploy/plan:
	./scripts/deploy-release.sh --env "$(ENV)" --image "$(IMAGE)" --plan

deploy/apply:
	./scripts/deploy-release.sh --env "$(ENV)" --image "$(IMAGE)" --apply
```

Make names workflow. Scripts own logic. CI owns approvals/secrets.

---

## 43. CI Release Pipeline

Stages:

```text
verify
build-image
publish-image
deploy-staging
smoke-staging
deploy-prod
```

Key rules:

- deploy uses image digest from build-image;
- prod deploy uses same digest as staging;
- protected environment for prod;
- metadata artifact passed between stages;
- no secrets in verify PR job;
- deploy jobs scoped secrets.

---

## 44. Deployment Result Artifact

Write `deployment-result.json`:

```json
{
  "status": "success",
  "environment": "staging",
  "service": "payment-service",
  "version": "1.2.3",
  "image": "registry/payment-service@sha256:...",
  "startedAt": "2026-06-22T10:00:00Z",
  "finishedAt": "2026-06-22T10:02:03Z",
  "durationSeconds": 123,
  "health": "ok"
}
```

Upload as CI artifact.

This improves audit/debug.

---

## 45. Smoke Tests

After deploy:

- health endpoint;
- version endpoint;
- critical API call;
- dependency check;
- synthetic transaction if safe.

Smoke tests should be:

- fast;
- deterministic;
- non-destructive;
- environment-aware;
- timeout-bounded.

Make target:

```make
smoke:
	./scripts/smoke-test.sh --env "$(ENV)"
```

---

## 46. Rollback Automation

Make targets:

```make
rollback/plan:
	./scripts/rollback-release.sh --env "$(ENV)" --plan

rollback/apply:
	./scripts/rollback-release.sh --env "$(ENV)" --apply
```

Rollback script should know previous stable artifact.

Sources:

- deployment history;
- CI artifact;
- platform rollout history;
- release registry.

Do not assume rollback safe if migrations irreversible.

---

## 47. Release Checklist

Before production deploy:

- artifact built once;
- immutable digest known;
- tests passed;
- vulnerability policy satisfied if required;
- deployment plan reviewed;
- config validated;
- secrets scoped;
- backup/migration plan if needed;
- rollback plan known;
- health checks defined;
- observability dashboard ready;
- CI protected approval completed.

Automate what can be automated. Document what remains manual.

---

## 48. Common Anti-Patterns

### 48.1 Deploy builds artifact

```bash
deploy.sh
  mvn package
  docker build
  deploy
```

This couples build and deploy, breaks promotion.

### 48.2 Deploy latest

```bash
kubectl set image app=my-service:latest
```

Mutable and unauditable.

### 48.3 Prod default

```bash
ENV="${ENV:-prod}"
```

Dangerous.

### 48.4 No plan/apply split

Every deploy command mutates immediately.

### 48.5 No health check

Deploy command returns after API call, not after service healthy.

### 48.6 Rollback assumed but untested

Rollback only exists in imagination.

### 48.7 Secrets logged

`set -x` around deploy command.

### 48.8 Rebuild per environment

Staging/prod artifacts differ.

---

## 49. Review Checklist

### Release

- Is artifact immutable?
- Is version validated?
- Is metadata generated?
- Are checksums/digests captured?
- Is build once/promote same artifact followed?

### Deployment

- Is env explicit?
- Is plan/apply separated?
- Is current state discovered?
- Is deploy idempotent?
- Are context/identity validated?
- Are health checks run?
- Are timeouts bounded?

### Safety

- No default prod?
- CI protected environment?
- Secrets not logged?
- Rollback plan defined?
- Migration compatibility considered?

### Observability

- Are deployment results structured?
- Are artifacts archived?
- Is image/version/commit visible?
- Are failures classified clearly?

---

## 50. Mini Lab

### Lab 1 — Release Metadata

Write script that outputs:

```json
service, version, commit, builtAt
```

No secrets.

---

### Lab 2 — Plan/Apply CLI

Create deploy script with:

```text
--plan
--apply
```

Plan prints JSON. Apply echoes simulated action.

---

### Lab 3 — Immutable Image Validation

Validate image string must contain:

```text
@sha256:
```

---

### Lab 4 — Health Check Loop

Write bounded retry loop for health endpoint.

---

### Lab 5 — Deployment Result

Write `deployment-result.json` after simulated deploy.

---

## 51. Design Exercise: Java Service Release Pipeline

Design release pipeline for Java service:

```text
verify
package jar
build image
push image
capture digest
generate metadata
deploy staging
smoke test
deploy prod
rollback
```

For each step define:

- owner: Maven/Gradle, script, Make, CI, platform;
- inputs;
- outputs;
- artifacts;
- secrets;
- failure handling;
- idempotency;
- audit record.

Then implement Make facade and one script skeleton.

---

## 52. Part 025 Summary

Release and deployment automation is about identity, safety, and repeatability.

Key takeaways:

1. Separate release from deployment.
2. Build once, promote same immutable artifact.
3. Tags are convenient but mutable; digests are safer.
4. Generate machine-readable release metadata.
5. Use plan/apply for deployment.
6. Never default deploy to prod.
7. Deploy should be idempotent where possible.
8. Validate environment, version, image, context, and identity.
9. CI/platform owns approvals and production permissions.
10. Health checks and rollout waits are part of deploy completion.
11. Rollback must be designed and tested, not assumed.
12. Database migrations require compatibility strategy.
13. Store deployment result artifacts for audit/debug.
14. Make should be facade; scripts/CLIs/platform should own logic.
15. Deployment automation should produce clear, actionable failure information.

Part 026 will cover operational scripts: diagnostics, runbooks, incident tools, and production investigation helpers.

---

## 53. Referensi Resmi dan Bacaan Lanjutan

- Docker image digest and OCI image specification.
- Maven/Gradle publishing documentation.
- Kubernetes deployment and rollout documentation.
- Cloud deployment platform documentation.
- CI/CD protected environment and secrets documentation.
- Release engineering best practices.
- Blue/green and canary deployment patterns.
- Database migration expand/contract pattern.
- SBOM and provenance concepts.
- SLSA and supply-chain security materials.
- Twelve-Factor App build/release/run separation.

---

## 54. Status Seri

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
- [x] Part 025 — Release and Deployment Automation
- [ ] Part 026 — Operational Scripts: Diagnostics, Runbooks, Incident Tools
- [ ] Part 027 — Advanced Bash and PowerShell Interop
- [ ] Part 028 — Refactoring Legacy Scripts
- [ ] Part 029 — Capstone: Production-Grade Automation Toolkit for a Java Service

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-024.md">⬅️ Part 024 — CI/CD Scripting: From Laptop Command to Pipeline Contract</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-026.md">Part 026 — Operational Scripts: Diagnostics, Runbooks, Incident Tools ➡️</a>
</div>
