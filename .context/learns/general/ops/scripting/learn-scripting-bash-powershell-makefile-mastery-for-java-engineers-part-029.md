# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-029.md

# Part 029 — Capstone: Production-Grade Automation Toolkit for a Java Service

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: menyatukan semua materi menjadi blueprint production-grade automation toolkit untuk Java service: Makefile facade, Bash/PowerShell scripts, CI contracts, release/deploy automation, operational diagnostics, tests, security, portability, dan governance.

---

## 0. Posisi Part Ini dalam Seri

Ini adalah bagian terakhir.

Sampai Part 028, kita sudah membahas:

- shell mental model;
- Bash/POSIX fundamentals;
- parsing, quoting, expansion;
- error handling;
- data/filesystem/process control;
- CLI design;
- testing/linting/security;
- PowerShell object pipeline, strictness, modules;
- Makefile graph/facade;
- portability matrix;
- environment/config contracts;
- CI/CD scripting;
- release/deployment automation;
- operational scripts;
- Bash/PowerShell interop;
- refactoring legacy scripts.

Part 029 menyatukan semuanya dalam satu capstone:

> Bagaimana seharusnya automation toolkit sebuah Java service modern didesain agar aman, jelas, reliable, dan scalable untuk tim?

Kita akan membuat blueprint yang bisa kamu adaptasi ke project nyata.

---

## 1. Target System

Anggap kita punya Java service:

```text
payment-service
```

Karakteristik:

- Java 21;
- Maven wrapper;
- Spring Boot;
- Docker image;
- local dependencies via Docker Compose;
- OpenAPI spec;
- CI verification;
- release image;
- deploy staging/prod;
- operational diagnostics;
- Linux CI;
- sebagian developer Windows menggunakan PowerShell;
- production deploy via CI protected environment.

Goal automation:

```text
Developer can run:
  make help
  make verify
  make run
  make local/up
  make docker/build

CI can run:
  make ci/verify
  make release/metadata
  make docker/build
  make deploy/plan
  make deploy/apply

Ops can run:
  make ops/status
  make ops/collect
```

---

## 2. Design Principles

Toolkit harus mengikuti prinsip berikut:

1. **Boring facade**
   Makefile menyediakan target stabil dan mudah ditemukan.

2. **Build tool owns Java**
   Maven/Gradle tetap memegang compile/test/package.

3. **Scripts own imperative logic**
   Bash/PowerShell scripts menangani validation, API calls, retries, cleanup.

4. **CI owns security boundary**
   Secrets, permissions, protected environments, approvals di CI/platform.

5. **JSON for machine contracts**
   Metadata, deployment plans, results, diagnostics summaries pakai JSON.

6. **Read-only default for ops**
   Operational scripts observe first, mutate only with explicit apply.

7. **No secret in repo/log**
   Secrets tidak ada di Makefile, `.env`, artifacts, atau logs.

8. **Fail fast, fail clear**
   Missing config/tool/context gagal dengan pesan jelas.

9. **Plan/apply for risky actions**
   Deploy/restart/rollback punya `plan` dan `apply`.

10. **Test the automation**
   ShellCheck/PSScriptAnalyzer, Bats/plain tests, Pester where needed.

---

## 3. Repository Layout

Recommended:

```text
payment-service/
  Makefile
  README.md
  .editorconfig
  .gitattributes
  .gitignore

  pom.xml
  mvnw
  mvnw.cmd
  src/

  openapi/
    payment-service.yaml

  docker/
    Dockerfile

  compose.yaml

  scripts/
    lib/
      common.sh
      json.sh
      kube.sh
      logging.sh
      safety.sh

    ci/
      verify.sh

    dev/
      run-local.sh
      doctor.sh
      clean.sh

    release/
      release-check.sh
      build-metadata.sh
      build-image.sh
      push-image.sh

    deploy/
      deploy-release.sh
      rollback-release.sh
      smoke-test.sh

    ops/
      status.sh
      health.sh
      logs.sh
      collect-evidence.sh
      restart-service.sh

    ps/
      Build-Metadata.ps1
      Verify.ps1
      Doctor.ps1

  tests/
    bash/
      test-release-check.sh
      test-deploy-args.sh
    powershell/
      Build-Metadata.Tests.ps1

  build/
    # generated, gitignored
```

This layout separates purpose.

---

## 4. File Policy

`.gitignore`:

```text
build/
target/
.env
.env.local
local.mk
*.log
*.hprof
diagnostics-*.tar.gz
```

`.gitattributes`:

```text
* text=auto

Makefile text eol=lf
*.mk text eol=lf
*.sh text eol=lf
*.ps1 text eol=lf
*.md text eol=lf
```

`.editorconfig`:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true

[Makefile]
indent_style = tab

[*.mk]
indent_style = tab

[*.sh]
indent_style = space
indent_size = 2

[*.ps1]
indent_style = space
indent_size = 2
```

This prevents basic portability problems.

---

## 5. Makefile Facade

Top-level Makefile:

```make
# Requires GNU Make.
ifndef MAKE_VERSION
$(error GNU Make is required)
endif

.DEFAULT_GOAL := help
.DELETE_ON_ERROR:

APP_NAME := payment-service
MVN ?= ./mvnw
MVN_CI_FLAGS := --batch-mode --no-transfer-progress

ENV ?= dev
SERVICE ?= $(APP_NAME)
PORT ?= 8080
PROFILE ?= unit
VERSION ?=
IMAGE_TAG ?= local
IMAGE ?= $(APP_NAME):$(IMAGE_TAG)
SINCE ?= 30m

.PHONY: help print-% \
        verify test test/unit test/integration build run clean doctor \
        local/up local/down local/logs \
        ci/verify \
        generate/openapi \
        release/check release/metadata docker/build docker/push \
        deploy/plan deploy/apply rollback/plan rollback/apply smoke \
        ops/status ops/health ops/logs ops/collect ops/restart/plan ops/restart/apply \
        scripts/check scripts/format powershell/check

help:
	@echo "Usage:"
	@echo "  make <target> [VAR=value]"
	@echo ""
	@echo "Core:"
	@echo "  verify              Run local verification"
	@echo "  test                Run unit tests"
	@echo "  test/integration    Run integration tests"
	@echo "  build               Build Maven package"
	@echo "  run                 Run service locally"
	@echo "  clean               Safe cleanup"
	@echo "  doctor              Check local tool/config readiness"
	@echo ""
	@echo "Local dependencies:"
	@echo "  local/up            Start local dependencies"
	@echo "  local/down          Stop local dependencies"
	@echo "  local/logs          Follow local dependency logs"
	@echo ""
	@echo "CI/Release:"
	@echo "  ci/verify           CI verification"
	@echo "  release/check       Validate release inputs"
	@echo "  release/metadata    Emit release metadata JSON"
	@echo "  docker/build        Build image"
	@echo "  docker/push         Push image"
	@echo ""
	@echo "Deploy:"
	@echo "  deploy/plan         Plan deployment"
	@echo "  deploy/apply        Apply deployment"
	@echo "  rollback/plan       Plan rollback"
	@echo "  rollback/apply      Apply rollback"
	@echo "  smoke               Run smoke test"
	@echo ""
	@echo "Ops:"
	@echo "  ops/status          Show service status"
	@echo "  ops/health          Check health endpoint"
	@echo "  ops/logs            Fetch bounded logs"
	@echo "  ops/collect         Collect diagnostics bundle"
	@echo "  ops/restart/plan    Plan restart"
	@echo "  ops/restart/apply   Apply restart"
	@echo ""
	@echo "Quality:"
	@echo "  scripts/check       Lint/test shell scripts"
	@echo "  powershell/check    Lint/test PowerShell scripts"
	@echo ""
	@echo "Variables:"
	@echo "  ENV=$(ENV)"
	@echo "  SERVICE=$(SERVICE)"
	@echo "  PORT=$(PORT)"
	@echo "  PROFILE=$(PROFILE)"
	@echo "  VERSION=$(VERSION)"
	@echo "  IMAGE=$(IMAGE)"
	@echo "  SINCE=$(SINCE)"
	@echo ""
	@echo "Examples:"
	@echo "  make verify"
	@echo "  make run ENV=dev PORT=8080"
	@echo "  make docker/build IMAGE=registry/payment-service:abc123"
	@echo "  make deploy/plan ENV=staging VERSION=1.2.3 IMAGE=registry/payment-service@sha256:..."

print-%:
	@echo '$*=$($*)'
	@echo 'origin=$(origin $*)'
	@echo 'flavor=$(flavor $*)'

verify: scripts/check test build

test: test/unit

test/unit:
	$(MVN) -P unit test

test/integration:
	$(MVN) -P integration verify

build:
	$(MVN) -P "$(PROFILE)" package

run:
	APP_ENV="$(ENV)" SERVER_PORT="$(PORT)" ./scripts/dev/run-local.sh

clean:
	./scripts/dev/clean.sh --target all

doctor:
	./scripts/dev/doctor.sh

local/up:
	docker compose up -d

local/down:
	docker compose down

local/logs:
	docker compose logs -f

ci/verify:
	./scripts/ci/verify.sh

generate/openapi:
	./scripts/dev/generate-openapi.sh

release/check:
	./scripts/release/release-check.sh --version "$(VERSION)"

release/metadata:
	./scripts/release/build-metadata.sh --version "$(VERSION)" --image "$(IMAGE)" --output json

docker/build:
	./scripts/release/build-image.sh --version "$(VERSION)" --image "$(IMAGE)"

docker/push:
	./scripts/release/push-image.sh --image "$(IMAGE)"

deploy/plan:
	./scripts/deploy/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --image "$(IMAGE)" --plan

deploy/apply:
	./scripts/deploy/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --image "$(IMAGE)" --apply

rollback/plan:
	./scripts/deploy/rollback-release.sh --env "$(ENV)" --service "$(SERVICE)" --plan

rollback/apply:
	./scripts/deploy/rollback-release.sh --env "$(ENV)" --service "$(SERVICE)" --apply

smoke:
	./scripts/deploy/smoke-test.sh --env "$(ENV)" --service "$(SERVICE)"

ops/status:
	./scripts/ops/status.sh --env "$(ENV)" --service "$(SERVICE)"

ops/health:
	./scripts/ops/health.sh --env "$(ENV)" --service "$(SERVICE)"

ops/logs:
	./scripts/ops/logs.sh --env "$(ENV)" --service "$(SERVICE)" --since "$(SINCE)"

ops/collect:
	./scripts/ops/collect-evidence.sh --env "$(ENV)" --service "$(SERVICE)"

ops/restart/plan:
	./scripts/ops/restart-service.sh --env "$(ENV)" --service "$(SERVICE)" --plan

ops/restart/apply:
	./scripts/ops/restart-service.sh --env "$(ENV)" --service "$(SERVICE)" --apply

scripts/check:
	shellcheck scripts/**/*.sh
	./tests/bash/test-release-check.sh
	./tests/bash/test-deploy-args.sh

scripts/format:
	shfmt -w scripts/**/*.sh tests/bash/**/*.sh

powershell/check:
	pwsh -NoProfile -Command "Invoke-ScriptAnalyzer -Path scripts/ps -Recurse"
	pwsh -NoProfile -Command "Invoke-Pester -Path tests/powershell"
```

This Makefile is not “smart”. It names workflows and delegates logic.

---

## 6. Shared Bash Library

`scripts/lib/common.sh`:

```bash
#!/usr/bin/env bash

log() {
  printf '==> %s\n' "$*" >&2
}

warn() {
  printf 'WARNING: %s\n' "$*" >&2
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  local name="$1"
  command -v "$name" >/dev/null 2>&1 || die "Required command not found: $name"
}

require_non_empty() {
  local name="$1"
  local value="${2:-}"
  [[ -n "$value" ]] || die "$name is required"
}

validate_env() {
  local env="$1"
  case "$env" in
    dev|staging|prod) ;;
    *) die "Invalid env: $env. Expected dev|staging|prod" ;;
  esac
}

validate_deploy_env() {
  local env="$1"
  case "$env" in
    staging|prod) ;;
    *) die "Invalid deploy env: $env. Expected staging|prod" ;;
  esac
}

validate_semver() {
  local version="$1"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.+][A-Za-z0-9._-]+)?$ ]] \
    || die "Invalid version: $version"
}

validate_image_digest_ref() {
  local image="$1"
  [[ "$image" == *@sha256:* ]] || die "Image must be immutable digest ref containing @sha256:"
}
```

Use shared library carefully:

```bash
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$script_dir/../lib/common.sh"
```

Avoid creating a massive shell framework. Keep helpers small.

---

## 7. CI Verify Script

`scripts/ci/verify.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
# shellcheck source=../lib/common.sh
source "$repo_root/scripts/lib/common.sh"

cd "$repo_root"

log "Preflight"
require_command java
require_command git

log "Running Maven CI verify"
./mvnw --batch-mode --no-transfer-progress verify

log "CI verify completed"
```

Properties:

- no prompts;
- batch mode;
- explicit repo root;
- clear logs;
- exit code preserved.

---

## 8. Local Run Script

`scripts/dev/run-local.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
source "$repo_root/scripts/lib/common.sh"

cd "$repo_root"

APP_ENV="${APP_ENV:-dev}"
SERVER_PORT="${SERVER_PORT:-8080}"

case "$APP_ENV" in
  dev|local) ;;
  *) die "APP_ENV must be dev|local for run-local.sh" ;;
esac

log "Running payment-service locally"
log "APP_ENV=$APP_ENV SERVER_PORT=$SERVER_PORT"

exec ./mvnw spring-boot:run \
  -Dspring-boot.run.jvmArguments="-Dserver.port=$SERVER_PORT" \
  -Dspring-boot.run.profiles="$APP_ENV"
```

Local run has safe defaults. Deploy does not.

---

## 9. Doctor Script

`scripts/dev/doctor.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
source "$repo_root/scripts/lib/common.sh"

cd "$repo_root"

status=0

check_command() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    printf 'OK   command: %s\n' "$name"
  else
    printf 'MISS command: %s\n' "$name"
    status=1
  fi
}

check_file() {
  local path="$1"
  if [[ -e "$path" ]]; then
    printf 'OK   file: %s\n' "$path"
  else
    printf 'MISS file: %s\n' "$path"
    status=1
  fi
}

check_command java
check_command docker
check_command git
check_command jq
check_file ./mvnw
check_file compose.yaml
check_file docker/Dockerfile

if docker info >/dev/null 2>&1; then
  printf 'OK   docker daemon\n'
else
  printf 'MISS docker daemon not reachable\n'
  status=1
fi

exit "$status"
```

Doctor is explicit readiness check, not hidden precondition.

---

## 10. Release Metadata Script

`scripts/release/build-metadata.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
source "$repo_root/scripts/lib/common.sh"

cd "$repo_root"

VERSION=""
IMAGE=""
OUTPUT="json"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2:?--version requires value}"; shift 2 ;;
    --image) IMAGE="${2:?--image requires value}"; shift 2 ;;
    --output) OUTPUT="${2:?--output requires value}"; shift 2 ;;
    --help|-h)
      cat <<'USAGE'
Usage:
  build-metadata.sh --version VERSION --image IMAGE [--output json]
USAGE
      exit 0
      ;;
    *) die "Unknown argument: $1" ;;
  esac
done

require_non_empty VERSION "$VERSION"
validate_semver "$VERSION"
require_command git
require_command jq

commit="$(git rev-parse HEAD)"
short_commit="$(git rev-parse --short HEAD)"
dirty="false"
if [[ -n "$(git status --porcelain)" ]]; then
  dirty="true"
fi
built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

jq -n \
  --arg service "payment-service" \
  --arg version "$VERSION" \
  --arg commit "$commit" \
  --arg shortCommit "$short_commit" \
  --arg image "$IMAGE" \
  --arg builtAt "$built_at" \
  --argjson dirty "$dirty" \
  '{
    service: $service,
    version: $version,
    commit: $commit,
    shortCommit: $shortCommit,
    image: $image,
    builtAt: $builtAt,
    dirty: $dirty
  }'
```

This emits machine JSON on stdout and logs only to stderr if needed.

---

## 11. PowerShell Metadata Alternative

`scripts/ps/Build-Metadata.ps1`:

```powershell
#requires -Version 7.0

[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidatePattern('^[0-9]+\.[0-9]+\.[0-9]+')]
  [string] $Version,

  [string] $Image = '',

  [ValidateSet('Json')]
  [string] $Output = 'Json'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$commit = (& git rev-parse HEAD)
if ($LASTEXITCODE -ne 0) { throw 'git rev-parse HEAD failed' }

$shortCommit = (& git rev-parse --short HEAD)
if ($LASTEXITCODE -ne 0) { throw 'git rev-parse --short HEAD failed' }

$status = (& git status --porcelain)
if ($LASTEXITCODE -ne 0) { throw 'git status failed' }

$result = [PSCustomObject]@{
  service = 'payment-service'
  version = $Version
  commit = (($commit -join '').Trim())
  shortCommit = (($shortCommit -join '').Trim())
  image = $Image
  builtAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  dirty = ($status.Count -gt 0)
}

$result | ConvertTo-Json -Depth 5
```

Pick one canonical metadata path. The other can exist for cross-platform UX, but contract-test output shape.

---

## 12. Build Image Script

`scripts/release/build-image.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
source "$repo_root/scripts/lib/common.sh"

cd "$repo_root"

VERSION=""
IMAGE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2:?}"; shift 2 ;;
    --image) IMAGE="${2:?}"; shift 2 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

require_non_empty VERSION "$VERSION"
require_non_empty IMAGE "$IMAGE"
validate_semver "$VERSION"
require_command docker
require_command git

commit="$(git rev-parse HEAD)"
built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

log "Building image: $IMAGE"

docker build \
  --file docker/Dockerfile \
  --label "org.opencontainers.image.title=payment-service" \
  --label "org.opencontainers.image.version=$VERSION" \
  --label "org.opencontainers.image.revision=$commit" \
  --label "org.opencontainers.image.created=$built_at" \
  --tag "$IMAGE" \
  .
```

No secrets in build args/labels.

---

## 13. Deploy Script

`scripts/deploy/deploy-release.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
source "$repo_root/scripts/lib/common.sh"

cd "$repo_root"

ENVIRONMENT=""
VERSION=""
IMAGE=""
MODE=""

usage() {
  cat <<'USAGE'
Usage:
  deploy-release.sh --env ENV --version VERSION --image IMAGE --plan
  deploy-release.sh --env ENV --version VERSION --image IMAGE --apply

Required:
  --env      staging|prod
  --version  SemVer version
  --image    immutable image ref, preferably registry/name@sha256:...
  --plan     print deployment plan only
  --apply    apply deployment
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENVIRONMENT="${2:?--env requires value}"; shift 2 ;;
    --version) VERSION="${2:?--version requires value}"; shift 2 ;;
    --image) IMAGE="${2:?--image requires value}"; shift 2 ;;
    --plan) MODE="plan"; shift ;;
    --apply) MODE="apply"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

validate_deploy_env "$ENVIRONMENT"
validate_semver "$VERSION"
require_non_empty IMAGE "$IMAGE"
[[ "$MODE" =~ ^(plan|apply)$ ]] || die "Specify --plan or --apply"

require_command jq
require_command kubectl

namespace="payments"
deployment="payment-service"

case "$ENVIRONMENT" in
  staging) expected_context="staging-cluster" ;;
  prod) expected_context="prod-cluster" ;;
esac

current_context="$(kubectl config current-context)"
[[ "$current_context" == "$expected_context" ]] || die "Wrong kubectl context. expected=$expected_context actual=$current_context"

current_image="$(
  kubectl -n "$namespace" get deployment "$deployment" \
    -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true
)"

plan="$(
  jq -n \
    --arg environment "$ENVIRONMENT" \
    --arg namespace "$namespace" \
    --arg deployment "$deployment" \
    --arg currentImage "$current_image" \
    --arg targetImage "$IMAGE" \
    --arg version "$VERSION" \
    --arg mode "$MODE" \
    '{
      environment: $environment,
      namespace: $namespace,
      deployment: $deployment,
      currentImage: $currentImage,
      targetImage: $targetImage,
      version: $version,
      mode: $mode
    }'
)"

printf '%s\n' "$plan"

if [[ "$MODE" == "plan" ]]; then
  log "Plan generated; no changes applied"
  exit 0
fi

if [[ "$current_image" == "$IMAGE" ]]; then
  log "Target image already deployed; no-op"
  exit 0
fi

log "Applying deployment"
kubectl -n "$namespace" set image "deployment/$deployment" "$deployment=$IMAGE"
kubectl -n "$namespace" rollout status "deployment/$deployment" --timeout=180s

log "Deployment applied"
```

Real production script may use platform API rather than raw `kubectl`, but skeleton shows contract.

---

## 14. Smoke Test Script

`scripts/deploy/smoke-test.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
source "$repo_root/scripts/lib/common.sh"

ENVIRONMENT=""
SERVICE="payment-service"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENVIRONMENT="${2:?}"; shift 2 ;;
    --service) SERVICE="${2:?}"; shift 2 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

validate_env "$ENVIRONMENT"

url="https://${SERVICE}.${ENVIRONMENT}.example.com/actuator/health"

log "Running smoke health check: $url"

response="$(curl --fail --silent --show-error --max-time 10 "$url")" \
  || die "Health request failed"

status="$(jq -r '.status // empty' <<<"$response")"
case "$status" in
  UP|OK) log "Smoke check passed" ;;
  *) die "Smoke check failed: status=$status" ;;
esac

printf '%s\n' "$response"
```

A real smoke test may include version endpoint and critical read-only business path.

---

## 15. Ops Collect Script

`scripts/ops/collect-evidence.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
source "$repo_root/scripts/lib/common.sh"

ENVIRONMENT=""
SERVICE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENVIRONMENT="${2:?}"; shift 2 ;;
    --service) SERVICE="${2:?}"; shift 2 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

validate_env "$ENVIRONMENT"
require_non_empty SERVICE "$SERVICE"
require_command kubectl
require_command jq

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
out_dir="$repo_root/build/diagnostics/${SERVICE}-${ENVIRONMENT}-${timestamp}"
mkdir -p "$out_dir/logs"

cat > "$out_dir/metadata.json" <<JSON
{
  "service": "$SERVICE",
  "environment": "$ENVIRONMENT",
  "collectedAt": "$timestamp",
  "redaction": "basic"
}
JSON

namespace="payments"

log "Collecting Kubernetes resources"
kubectl -n "$namespace" get deploy,rs,pod,svc -l "app=$SERVICE" -o wide \
  > "$out_dir/k8s-resources.txt" 2>"$out_dir/k8s-resources.err" || true

log "Collecting events"
kubectl -n "$namespace" get events --sort-by=.lastTimestamp \
  > "$out_dir/k8s-events.txt" 2>"$out_dir/k8s-events.err" || true

log "Collecting logs"
kubectl -n "$namespace" logs "deployment/$SERVICE" --since=30m --all-containers=true \
  > "$out_dir/logs/deployment.log" 2>"$out_dir/logs/deployment.err" || true

log "Diagnostics collected at: $out_dir"

jq -n --arg status "complete-or-partial" --arg path "$out_dir" \
  '{status: $status, path: $path}'
```

This avoids collecting secrets and bounds logs.

---

## 16. Script Testing Strategy

Minimum:

```text
shellcheck scripts/**/*.sh
shfmt check
unit tests for argument parsing
fake commands for kubectl/docker/curl
Pester tests for PowerShell JSON shape
make help smoke
make -n deploy/apply
```

Example fake command test:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/bin"
cat > "$tmp/bin/kubectl" <<'SH'
#!/usr/bin/env sh
if [ "$1" = "config" ]; then
  echo staging-cluster
  exit 0
fi
echo "kubectl $*" >> "$TMP_CALLS"
exit 0
SH
chmod +x "$tmp/bin/kubectl"

export TMP_CALLS="$tmp/calls.txt"
PATH="$tmp/bin:$PATH" ./scripts/deploy/deploy-release.sh \
  --env staging \
  --version 1.2.3 \
  --image registry/payment@sha256:abc \
  --plan > "$tmp/plan.json"

jq -e '.environment == "staging"' "$tmp/plan.json" >/dev/null
```

---

## 17. CI Pipeline Contract

Recommended stages:

```text
verify
build-image
publish-image
deploy-staging
smoke-staging
deploy-prod
```

Contracts:

### verify

```text
Entry: make ci/verify
Secrets: none
Artifacts: test reports
Safe for PR: yes
```

### build-image

```text
Entry: make docker/build IMAGE=...
Secrets: registry maybe not needed for local build
Artifacts: metadata
```

### publish-image

```text
Entry: make docker/push IMAGE=...
Secrets: registry credentials
Artifacts: image digest, release metadata
```

### deploy-staging/prod

```text
Entry: make deploy/apply ENV=... IMAGE=digest VERSION=...
Secrets: deployment credentials
Protected: prod yes
Artifacts: plan/result
```

---

## 18. Example CI Verify Workflow

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

      - name: Upload reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: reports
          path: |
            **/target/surefire-reports/**
            **/target/failsafe-reports/**
```

CI YAML remains thin.

---

## 19. Example Deploy Workflow

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
      image:
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

      - name: Setup tools
        run: |
          kubectl version --client=true

      - name: Deployment plan
        run: make deploy/plan ENV="${{ inputs.environment }}" VERSION="${{ inputs.version }}" IMAGE="${{ inputs.image }}"

      - name: Deployment apply
        run: make deploy/apply ENV="${{ inputs.environment }}" VERSION="${{ inputs.version }}" IMAGE="${{ inputs.image }}"

      - name: Smoke test
        run: make smoke ENV="${{ inputs.environment }}"

      - name: Collect diagnostics on failure
        if: failure()
        run: make ops/collect ENV="${{ inputs.environment }}" SERVICE=payment-service

      - name: Upload diagnostics
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: diagnostics
          path: build/diagnostics/**
```

In real systems, kube credentials/OIDC setup is provider-specific. The key is boundary.

---

## 20. Security Controls

Toolkit rules:

- No secrets in Makefile.
- No secrets in `.env.example`.
- `.env` ignored.
- Deploy credentials only in protected CI jobs.
- Prod deploy requires CI environment approval.
- Scripts validate `ENV`.
- Scripts validate cloud/kubectl context.
- No `eval`.
- No `curl | bash`.
- No default prod.
- No unbounded `rm -rf`.
- No secret-bearing artifacts.

Add security review for scripts under:

```text
scripts/deploy/
scripts/release/
scripts/ops/*apply*
```

---

## 21. Portability Contract

Document:

```markdown
## Automation Compatibility

| Entry Point | Runtime | OS |
|---|---|---|
| Makefile | GNU Make | Linux/devcontainer/CI |
| scripts/*.sh | Bash 4+ | Linux/macOS/devcontainer |
| scripts/ps/*.ps1 | PowerShell 7+ | Windows/Linux/macOS |
| mvnw/mvnw.cmd | Java 21 | Windows/Linux/macOS |
| Dockerfile | Docker | Linux container runtime |

Windows-native developers should use:
  pwsh ./scripts/ps/Verify.ps1
or devcontainer for Make targets.
```

False portability is worse than honest constraints.

---

## 22. Documentation

README section:

```markdown
## Common Commands

```bash
make help
make doctor
make verify
make local/up
make run
make docker/build
```

## Release

```bash
make release/check VERSION=1.2.3
make docker/build VERSION=1.2.3 IMAGE=registry/payment-service:1.2.3
```

## Deploy

```bash
make deploy/plan ENV=staging VERSION=1.2.3 IMAGE=registry/payment-service@sha256:...
make deploy/apply ENV=staging VERSION=1.2.3 IMAGE=registry/payment-service@sha256:...
```

## Ops

```bash
make ops/status ENV=prod SERVICE=payment-service
make ops/collect ENV=prod SERVICE=payment-service
```
```

Docs must reflect actual targets.

---

## 23. Governance

For serious teams:

```text
CODEOWNERS:
  scripts/deploy/* @platform-team
  scripts/release/* @release-engineering
  Makefile @platform-team
  .github/workflows/deploy.yml @platform-team
```

Pull request checklist:

```text
- [ ] Does this change a script run by CI/prod?
- [ ] Are secrets handled safely?
- [ ] Are new config variables documented?
- [ ] Are tests updated?
- [ ] Does make help reflect new targets?
- [ ] Is backward compatibility considered?
```

Automation is platform code.

---

## 24. Maturity Model

### Level 0 — Ad hoc

Random commands in README.

### Level 1 — Scripts

Basic scripts, no tests.

### Level 2 — Facade

Makefile or standard entrypoints.

### Level 3 — Contracts

Help, config docs, CI entrypoints, plan/apply.

### Level 4 — Tested Automation

Lint/tests, fake commands, CI artifacts.

### Level 5 — Secure Operations

Protected deploys, secrets scoped, audit artifacts, diagnostics.

### Level 6 — Platformized

Shared CLI/modules, standardized across repos, paved road.

Goal is not always Level 6. Goal is appropriate maturity for risk.

---

## 25. Capstone Checklist

### Make

- `.DEFAULT_GOAL := help`
- `.PHONY` complete
- variables documented
- no complex logic inline
- `ci/*`, `deploy/plan`, `deploy/apply`, `ops/*`
- `print-%`

### Bash

- strict mode where appropriate
- quoted variables
- no eval
- no secret logging
- clear usage
- validates env/version/image/context
- JSON with jq
- tests/fakes for risky scripts

### PowerShell

- `#requires -Version 7.0`
- `Set-StrictMode`
- `$ErrorActionPreference = 'Stop'`
- `$LASTEXITCODE` checked
- params with validation
- JSON output contract
- PSScriptAnalyzer/Pester

### CI

- stable entrypoints
- toolchain explicit
- secrets scoped
- artifacts uploaded
- protected prod
- no long inline logic
- timeouts

### Release/deploy

- build once/promote
- immutable artifact identity
- metadata
- plan/apply
- health checks
- rollback strategy

### Ops

- read-only defaults
- diagnostics bundle
- bounded logs
- redaction
- context validation
- no evidence destruction before mutation

---

## 26. Final Learning Path After This Series

After this series, recommended next topics:

1. **CI/CD platform mastery**
   - GitHub Actions/GitLab/Jenkins/Buildkite at deep level.
   - OIDC, protected environments, reusable workflows.

2. **Supply chain security**
   - SBOM, provenance, SLSA, signing, artifact attestations.

3. **Internal Developer Platform**
   - paved roads, golden paths, service templates, Backstage-like catalogs.

4. **Release engineering**
   - canary, progressive delivery, feature flags, deployment metrics.

5. **Observability automation**
   - logs/metrics/traces, incident tooling, SLO runbooks.

6. **Build systems**
   - Gradle advanced, Bazel/Pants/Nx if monorepo scale demands it.

7. **Platform CLI design**
   - Go/Java CLIs, Cobra/Picocli, packaging, versioning.

8. **Security engineering**
   - least privilege automation, secrets lifecycle, audit design.

9. **Testing infrastructure**
   - hermetic tests, fake CLIs, containerized integration tests.

10. **Configuration/platform governance**
   - policy-as-code, OPA/Conftest, Terraform/Pulumi/CDK automation.

---

## 27. Series Completion Summary

This series covered the automation control plane from first principles to production toolkit.

You should now have mental models for:

- process, streams, exit codes, environment;
- shell parsing and quoting;
- Bash/POSIX tradeoffs;
- robust Bash error/data/filesystem/process handling;
- CLI design and testing;
- shell security;
- PowerShell object automation;
- PowerShell modules;
- Make dependency graph and workflow facade;
- Java project Makefile design;
- portability decisions;
- config contracts;
- CI/CD pipeline contracts;
- release/deployment safety;
- operational diagnostics;
- Bash/PowerShell interop;
- legacy script refactoring;
- production-grade automation architecture.

The top 1% difference is not memorizing syntax.

The difference is knowing:

```text
which layer should own what,
what contract exists at every boundary,
how failure propagates,
how secrets stay safe,
how automation is tested,
how production risk is reduced,
and how the next engineer can understand it under pressure.
```

---

## 28. Final Capstone Exercise

Build the toolkit for a real or sample Java service.

Minimum deliverables:

```text
Makefile
scripts/lib/common.sh
scripts/ci/verify.sh
scripts/dev/run-local.sh
scripts/dev/doctor.sh
scripts/release/build-metadata.sh
scripts/release/build-image.sh
scripts/deploy/deploy-release.sh
scripts/deploy/smoke-test.sh
scripts/ops/collect-evidence.sh
tests/bash/
README automation section
CI verify workflow
deploy workflow skeleton
```

Constraints:

- no secrets committed;
- `make help` complete;
- deploy uses plan/apply;
- release metadata JSON;
- diagnostics bundle;
- CI uploads artifacts;
- scripts have basic tests;
- dangerous commands fakeable in tests.

Review with checklist from this part.

---

## 29. Status Seri

Seri selesai.

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
- [x] Part 026 — Operational Scripts: Diagnostics, Runbooks, Incident Tools
- [x] Part 027 — Advanced Bash and PowerShell Interop
- [x] Part 028 — Refactoring Legacy Scripts
- [x] Part 029 — Capstone: Production-Grade Automation Toolkit for a Java Service

**Seri ini selesai.**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-028.md">⬅️ Part 028 — Refactoring Legacy Scripts</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
