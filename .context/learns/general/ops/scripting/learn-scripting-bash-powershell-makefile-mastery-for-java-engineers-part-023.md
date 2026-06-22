# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-023.md

# Part 023 — Environment Management and Configuration Contracts

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: mendesain kontrak environment/configuration untuk scripts dan automation: env vars, `.env`, config files, profiles, secrets, precedence, validation, CI/local/prod parity, dan fail-fast behavior.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya membahas cara memilih substrate automation:

- POSIX sh;
- Bash;
- PowerShell;
- Make;
- Maven/Gradle;
- Java/Go/Python CLI;
- CI YAML;
- Dockerfile/entrypoint.

Part 023 membahas tema lintas semua substrate:

> environment dan configuration contract.

Banyak script gagal bukan karena syntax Bash/PowerShell/Make salah, tetapi karena kontrak konfigurasinya kabur:

```text
Script ini membaca env var apa?
Apakah .env otomatis dimuat?
ENV default ke dev atau prod?
Secret datang dari mana?
Mana config yang boleh di-commit?
Apa precedence antara flag, env var, config file?
Apakah CI sama dengan local?
Apa yang terjadi jika config missing?
```

Automation yang bagus harus punya contract jelas:

- input;
- default;
- required;
- allowed values;
- source;
- precedence;
- validation;
- secret handling;
- output;
- failure mode.

---

## 1. Configuration Is an API

Setiap script punya API.

Bukan hanya flags:

```bash
./deploy.sh --env staging --version 1.2.3
```

Tetapi juga:

```bash
DEPLOY_TOKEN
DEPLOY_URL
KUBECONFIG
AWS_PROFILE
APP_ENV
JAVA_HOME
MAVEN_OPTS
```

Semua itu bagian dari API script.

Jika tidak didokumentasikan, API tetap ada tetapi tersembunyi.

Hidden config creates:

- “works on my machine”;
- CI drift;
- insecure defaults;
- accidental prod deploy;
- difficult debugging;
- onboarding pain;
- flaky scripts.

Rule:

> Treat configuration as explicit contract, not ambient magic.

---

## 2. Config vs Secret vs State

Pisahkan tiga hal:

### 2.1 Config

Non-sensitive setting controlling behavior.

Examples:

```text
ENV=staging
PORT=8080
PROFILE=integration
DEPLOY_URL=https://deploy.example.com
```

Config may be committed if not environment-secret.

### 2.2 Secret

Sensitive credential.

Examples:

```text
DEPLOY_TOKEN
DATABASE_PASSWORD
AWS_SECRET_ACCESS_KEY
GITHUB_TOKEN
```

Secret should not be committed, printed, or stored in Makefile.

### 2.3 State

Current machine/runtime condition.

Examples:

```text
current directory
git branch
docker daemon state
kubectl current context
installed tool versions
files in target/
network availability
```

State can influence scripts but should be validated if important.

Do not confuse config with state.

---

## 3. Common Config Sources

Sources:

1. CLI flags
2. Make variables
3. environment variables
4. `.env` files
5. config files: JSON/YAML/TOML/properties
6. Maven/Gradle profiles
7. CI variables/secrets
8. secret manager
9. OS config: registry, keychain, credential store
10. default values
11. current directory/Git repo state

Each source has tradeoffs.

---

## 4. Precedence Model

Define precedence explicitly.

Common recommendation:

```text
CLI flag > environment variable > config file > default
```

Example:

```text
--env staging
overrides
ENV=dev
overrides
config.json: env=local
overrides
default env=dev
```

But not all config should have default.

For production-risky settings:

```text
ENV has no default for deploy/apply
```

For local run:

```text
ENV defaults to dev
PORT defaults to 8080
```

Precedence must be documented.

---

## 5. Good Defaults vs Dangerous Defaults

Good local defaults:

```text
ENV=dev
PORT=8080
PROFILE=unit
IMAGE_TAG=local
```

Dangerous defaults:

```text
ENV=prod
APPLY=true
DELETE=true
REGION=production
```

For risky operations, require explicit input.

Bad:

```bash
ENV="${ENV:-prod}"
```

Good:

```bash
: "${ENV:?ENV is required: staging|prod}"
```

Even better: script validates allowlist and deploy mode.

---

## 6. Required Config Contract

Document:

```text
Required:
  ENV: dev|staging|prod
  VERSION: SemVer x.y.z

Required secrets:
  DEPLOY_TOKEN: bearer token injected by CI
```

Optional:

```text
Optional:
  DEPLOY_URL: default https://deploy.example.com
  TIMEOUT_SECONDS: default 60
```

Make help:

```make
help:
	@echo "Variables:"
	@echo "  ENV=dev|staging|prod"
	@echo "  VERSION=x.y.z"
	@echo "  TIMEOUT_SECONDS=60"
```

Script help:

```bash
./deploy.sh --help
```

PowerShell help:

```powershell
Get-Help ./Deploy.ps1 -Full
```

---

## 7. Validation Is Not Optional

If a value matters, validate it.

Bash:

```bash
case "${ENV:-}" in
  dev|staging|prod) ;;
  *) echo "ENV must be one of: dev, staging, prod" >&2; exit 2 ;;
esac
```

PowerShell:

```powershell
param(
  [ValidateSet('dev', 'staging', 'prod')]
  [string] $Environment
)
```

Make should delegate validation:

```make
deploy/plan:
	./scripts/deploy-release.sh --env "$(ENV)" --version "$(VERSION)" --plan
```

Java CLI:

```java
enum Environment { DEV, STAGING, PROD }
```

Validation should happen near owner logic.

---

## 8. Fail Fast, Fail Clear

Bad failure:

```text
curl: (6) Could not resolve host:
```

because `DEPLOY_URL` empty.

Good failure:

```text
DEPLOY_URL is required.
Set DEPLOY_URL or pass --deploy-url.
```

Bash helper:

```bash
require_env() {
  name="$1"
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "Required environment variable is not set: $name" >&2
    exit 2
  fi
}
```

Bash indirect expansion safer in Bash:

```bash
require_env() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    die "Required environment variable is not set: $name"
  fi
}
```

PowerShell:

```powershell
function Require-Env {
  param([Parameter(Mandatory)][string] $Name)

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Required environment variable is not set: $Name"
  }

  $value
}
```

---

## 9. Environment Variables

Environment variables are good for:

- deployment environment name;
- simple scalar config;
- CI-provided metadata;
- secrets injected by CI/runtime;
- process-level behavior;
- conventional settings like `JAVA_HOME`.

They are poor for:

- nested structured config;
- arrays/maps;
- multi-line complex data;
- large payloads;
- config requiring schema validation;
- secrets that might leak through process/env inspection.

Use env vars intentionally.

---

## 10. Environment Variables in Bash

Read:

```bash
echo "$APP_ENV"
```

Required:

```bash
: "${APP_ENV:?APP_ENV is required}"
```

Default:

```bash
PORT="${PORT:-8080}"
```

Export to child:

```bash
export APP_ENV
```

Inline for one command:

```bash
APP_ENV=dev java -jar app.jar
```

Avoid unquoted env usage:

```bash
java -Denv=$APP_ENV -jar app.jar
```

Better:

```bash
java -Denv="$APP_ENV" -jar app.jar
```

---

## 11. Environment Variables in PowerShell

Read:

```powershell
$env:APP_ENV
```

Set for current process and children:

```powershell
$env:APP_ENV = 'dev'
```

Validate:

```powershell
if ([string]::IsNullOrWhiteSpace($env:APP_ENV)) {
  throw 'APP_ENV is required'
}
```

Get via .NET:

```powershell
[Environment]::GetEnvironmentVariable('APP_ENV')
```

Unset:

```powershell
Remove-Item Env:APP_ENV
```

Cross-platform note:

- Windows env names case-insensitive;
- Linux env names case-sensitive.

Use canonical uppercase names.

---

## 12. Environment Variables in Make

Make variable:

```make
ENV ?= dev
```

Pass to command:

```make
run:
	APP_ENV="$(ENV)" ./scripts/run-local.sh
```

Export:

```make
export APP_ENV := $(ENV)
```

Prefer inline pass when scope is command-specific.

Do not write:

```make
include .env
export
```

without understanding `.env` syntax and secret risk.

---

## 13. `.env` Files

`.env` files are common for local development.

Example:

```text
APP_ENV=dev
SERVER_PORT=8080
DATABASE_URL=jdbc:postgresql://localhost:5432/app
```

Good uses:

- local non-secret defaults;
- local dev convenience;
- Docker Compose env_file;
- app runtime config for dev.

Risks:

- secrets accidentally committed;
- syntax differs across tools;
- shell `source .env` unsafe for arbitrary content;
- Make `include .env` not same as shell dotenv;
- whitespace/quotes vary;
- production should not depend on developer `.env`.

Rule:

> `.env` is local convenience, not universal configuration protocol.

---

## 14. Do Not Blindly Source `.env`

Bad:

```bash
set -a
source .env
set +a
```

If `.env` contains shell syntax, it executes.

For trusted local `.env`, maybe acceptable. For untrusted/committed inputs, avoid.

Safer local-only pattern:

```bash
if [[ -f .env ]]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    [[ "$key" =~ ^# ]] && continue
    export "$key=$value"
  done < .env
fi
```

But parsing `.env` correctly is surprisingly subtle.

Better: let application framework/loaders handle `.env`, or use explicit config file parser.

---

## 15. `.env.example`

Commit:

```text
.env.example
```

Example:

```text
APP_ENV=dev
SERVER_PORT=8080
DATABASE_URL=jdbc:postgresql://localhost:5432/app
# DEPLOY_TOKEN is required only in CI, do not store here
```

Do not commit real `.env`.

`.gitignore`:

```text
.env
.env.local
```

But `.env.example` should be reviewed.

---

## 16. local.mk for Make

Instead of including `.env`, use:

```make
-include local.mk
```

`local.mk`:

```make
ENV := dev
PROFILE := integration
PORT := 9090
```

`.gitignore`:

```text
local.mk
```

`local.mk.example`:

```make
ENV := dev
PROFILE := unit
PORT := 8080
```

This is Make syntax, not dotenv syntax.

Do not put secrets in `local.mk` if avoidable.

---

## 17. Config Files

Use config files when:

- structured config;
- multiple fields;
- nested settings;
- needs comments if YAML/TOML/properties;
- shared across scripts/app;
- not secret;
- versioned defaults.

Formats:

- JSON: strict, machine-friendly, no comments.
- YAML: human-friendly, but parsing complexity.
- TOML: good for config, less universal in Java.
- `.properties`: Java-native, simple key-value.
- XML: legacy/Java ecosystem, verbose.

Choose based on ecosystem and parser availability.

---

## 18. JSON Config in PowerShell

```powershell
$config = Get-Content -Raw -Path config.json | ConvertFrom-Json
```

Validate:

```powershell
if ($config.environment -notin @('dev', 'staging', 'prod')) {
  throw "Invalid environment: $($config.environment)"
}
```

Write:

```powershell
$config | ConvertTo-Json -Depth 10
```

PowerShell is strong here.

---

## 19. JSON Config in Bash

Use `jq`.

```bash
env="$(jq -r '.environment' config.json)"
```

Validate:

```bash
case "$env" in
  dev|staging|prod) ;;
  *) die "Invalid environment: $env" ;;
esac
```

Do not use `grep`.

Bad:

```bash
grep environment config.json | cut -d: -f2
```

---

## 20. Java Properties

For Java apps:

```properties
app.env=dev
server.port=8080
```

Properties are simple, but less expressive.

Scripts can parse with care, but Java app should own app config.

Automation should avoid becoming second application config parser unless needed.

---

## 21. Profiles

Profiles appear in many layers:

- Maven profiles:
  ```bash
  ./mvnw -P integration test
  ```

- Spring profiles:
  ```bash
  SPRING_PROFILES_ACTIVE=dev
  ```

- Docker Compose profiles:
  ```bash
  docker compose --profile kafka up
  ```

- CI environment:
  ```text
  staging/prod
  ```

Avoid using one overloaded word `PROFILE` for everything.

Prefer explicit names:

```text
MAVEN_PROFILE
SPRING_PROFILE
COMPOSE_PROFILE
ENV
```

Make:

```make
MAVEN_PROFILE ?= unit
SPRING_PROFILE ?= dev
```

---

## 22. Environment Name

Common values:

```text
local
dev
test
staging
prod
```

Be precise.

`test` can mean:

- test environment;
- unit test;
- CI test;
- staging-like?

Prefer:

```text
ENV=dev|staging|prod
```

For local app profile:

```text
APP_ENV=local
SPRING_PROFILES_ACTIVE=local
```

Deploy environment:

```text
DEPLOY_ENV=staging
```

Avoid ambiguity in dangerous scripts.

---

## 23. Configuration Precedence Example

For `run-local.sh`:

```text
CLI --env > APP_ENV env var > .env file > default dev
CLI --port > SERVER_PORT env var > .env file > default 8080
```

For `deploy-release.sh`:

```text
CLI --env required
CLI --version required
DEPLOY_TOKEN env var required
DEPLOY_URL env var > default staging/prod URL map
No .env loading in CI deploy
```

Different workflows can have different precedence.

Document per script.

---

## 24. Bash Config Parsing Pattern

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Usage:
  run-local.sh [--env ENV] [--port PORT]

Options:
  --env   local|dev
  --port  port number
USAGE
}

APP_ENV="${APP_ENV:-dev}"
SERVER_PORT="${SERVER_PORT:-8080}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      APP_ENV="${2:?--env requires value}"
      shift 2
      ;;
    --port)
      SERVER_PORT="${2:?--port requires value}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$APP_ENV" in
  local|dev) ;;
  *) echo "APP_ENV must be local or dev" >&2; exit 2 ;;
esac

exec java -Dserver.port="$SERVER_PORT" -jar target/app.jar
```

Clear precedence: env defaults, CLI overrides.

---

## 25. PowerShell Config Pattern

```powershell
#requires -Version 7.0

[CmdletBinding()]
param(
  [ValidateSet('local', 'dev')]
  [string] $Environment = $(if ($env:APP_ENV) { $env:APP_ENV } else { 'dev' }),

  [ValidateRange(1, 65535)]
  [int] $Port = $(if ($env:SERVER_PORT) { [int]$env:SERVER_PORT } else { 8080 })
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

& java "-Dserver.port=$Port" '-jar' 'target/app.jar'
if ($LASTEXITCODE -ne 0) {
  throw "java failed with exit code $LASTEXITCODE"
}
```

PowerShell parameters make validation concise.

---

## 26. Make Config Pattern

```make
ENV ?= dev
PORT ?= 8080

.PHONY: run
run:
	APP_ENV="$(ENV)" SERVER_PORT="$(PORT)" ./scripts/run-local.sh
```

Make does not own validation deeply. Script validates.

Help:

```make
help:
	@echo "Variables:"
	@echo "  ENV=$(ENV)       local|dev"
	@echo "  PORT=$(PORT)     local server port"
```

---

## 27. CI Config

CI variables:

```text
GITHUB_SHA
GITHUB_REF
CI
BUILD_NUMBER
```

CI secrets:

```text
DEPLOY_TOKEN
REGISTRY_PASSWORD
```

CI should inject secrets only into jobs that need them.

Script should fail if missing:

```bash
: "${DEPLOY_TOKEN:?DEPLOY_TOKEN is required}"
```

Do not fallback to local secret for CI deploy unless explicitly intended.

In CI, prefer non-interactive:

```text
CI=true
```

Scripts can detect:

```bash
if [[ "${CI:-}" == "true" ]]; then
  ...
fi
```

But do not make too many hidden CI branches.

---

## 28. CI vs Local Differences

Some differences are valid:

```text
local verify: fast unit checks
ci/verify: full verify with batch mode
```

But differences should be named.

Make:

```make
verify:
	$(MVN) test

ci/verify:
	$(MVN) --batch-mode verify
```

Avoid silent branch:

```bash
if [[ "$CI" == "true" ]]; then
  do completely different thing
fi
```

unless documented.

---

## 29. Secrets Handling

Rules:

1. Do not commit secrets.
2. Do not put secrets in Makefile.
3. Do not print secrets.
4. Do not pass secrets as CLI args if avoidable.
5. Prefer env vars/secret files/secret manager.
6. Redact logs.
7. Avoid `set -x` around secrets.
8. Avoid transcript/log dumps that include secrets.
9. Scope secrets to least privilege.
10. Validate presence without printing value.

Bad:

```bash
echo "DEPLOY_TOKEN=$DEPLOY_TOKEN"
```

Good:

```bash
echo "DEPLOY_TOKEN is set"
```

or no log.

---

## 30. Secret as File vs Env Var

Some systems provide secrets as files:

```text
/run/secrets/db_password
/var/run/secrets/kubernetes.io/serviceaccount/token
```

Pros:

- avoids process env exposure;
- can have file permissions;
- works with Docker/Kubernetes.

Cons:

- need file reading;
- risk accidental cat/log;
- lifecycle/rotation complexity.

Script pattern:

```bash
password="$(cat "$DB_PASSWORD_FILE")"
```

Validate file:

```bash
[[ -r "$DB_PASSWORD_FILE" ]] || die "Secret file not readable: $DB_PASSWORD_FILE"
```

Do not print content.

---

## 31. Command-Line Args and Secrets

Avoid:

```bash
./deploy.sh --token "$DEPLOY_TOKEN"
```

CLI args can appear in process lists/history/logs.

Prefer:

```bash
DEPLOY_TOKEN="$DEPLOY_TOKEN" ./deploy.sh --env staging
```

or secret manager integration.

Not all systems expose env safely either, but CLI args are often worse.

---

## 32. Tool Context Config

Many tools use ambient context:

```text
kubectl current-context
aws profile/default region
gcloud active account/project
docker context
git branch
```

Do not trust ambient context for dangerous operations.

Validate:

```bash
current_context="$(kubectl config current-context)"
[[ "$current_context" == "$EXPECTED_CONTEXT" ]] || die "Wrong kubectl context"
```

AWS:

```bash
aws sts get-caller-identity
```

Docker:

```bash
docker context show
```

For production deploy, CI identity should be explicit.

---

## 33. Repository Root

Scripts often need project root.

Bash:

```bash
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
```

PowerShell:

```powershell
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
```

Make:

```make
ROOT_DIR := $(CURDIR)
```

But `$(CURDIR)` is where make invoked, not necessarily Makefile dir if `-C` involved? GNU Make sets `CURDIR` after `-C`. For Makefile dir:

```make
MAKEFILE_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
```

Simpler: document invocation from repo root, or use scripts to resolve.

---

## 34. Current Directory Is Ambient State

Bad script:

```bash
cat config/app.json
```

Works only from repo root.

Better:

```bash
config_path="$repo_root/config/app.json"
```

Make can call scripts from root, but scripts should still be robust if reused.

At minimum, fail clearly:

```bash
[[ -f pom.xml ]] || die "Run from repository root"
```

Better: resolve script-relative root.

---

## 35. Tool Version Config

Automation depends on versions:

```text
Java 21
Maven wrapper version
Gradle wrapper version
Docker
kubectl
PowerShell 7+
Bash 4+
GNU Make
jq
```

Document:

```text
Requires:
  Java 21
  GNU Make
  Docker
  jq 1.6+
```

Validate when important:

```bash
command -v jq >/dev/null || die "jq is required"
```

PowerShell:

```powershell
#requires -Version 7.0
```

Java:

```bash
java -version
```

For team consistency:

- devcontainer;
- SDKMAN/asdf/jEnv;
- Maven/Gradle wrapper;
- CI setup steps.

---

## 36. Configuration Drift

Drift happens when:

- local uses `.env`;
- CI uses secrets;
- staging uses config map;
- prod uses different names;
- Make defaults differ from app defaults;
- scripts infer environment differently.

Mitigation:

- single config contract;
- shared validation;
- explicit docs;
- fail-fast;
- config examples;
- CI smoke checks;
- avoid duplicated defaults.

Example duplicated default:

```make
PORT ?= 8080
```

and app default:

```yaml
server.port: 9090
```

Now `make run` differs from app.

Keep defaults aligned or explicit.

---

## 37. Configuration Contract Table

Example:

| Name | Required | Source | Default | Allowed | Secret | Used By |
|---|---:|---|---|---|---:|---|
| ENV | yes for deploy | CLI/Make | none | staging, prod | no | deploy |
| VERSION | yes for release | CLI/Make | none | semver | no | release |
| DEPLOY_TOKEN | yes | CI secret env | none | non-empty | yes | deploy |
| PORT | no | Make/env | 8080 | 1-65535 | no | run |
| MAVEN_PROFILE | no | Make | unit | unit,integration | no | test |
| DEPLOY_URL | no | env/config | env map | URL | no | deploy |

This table is powerful documentation.

---

## 38. Config Validation Script

Create a `doctor` target:

```make
.PHONY: doctor
doctor:
	./scripts/doctor.sh
```

`doctor.sh` checks:

- Java version;
- Docker running;
- required tools;
- repo root;
- local `.env` presence;
- ports availability;
- config files valid.

Do not run expensive checks on every command. Provide explicit `doctor`.

PowerShell:

```make
doctor:
	pwsh -NoProfile -File ./scripts/Doctor.ps1
```

---

## 39. Environment-Specific Config

Avoid hardcoding huge `case` statements in Make.

Bad:

```make
ifeq ($(ENV),prod)
URL := ...
endif
```

Better in script/config:

```json
{
  "staging": {
    "deployUrl": "https://deploy.staging.example.com"
  },
  "prod": {
    "deployUrl": "https://deploy.prod.example.com"
  }
}
```

PowerShell/Bash reads and validates.

For simple two-value local defaults, Make is okay. For real environment maps, use config file/app/platform.

---

## 40. Config and Immutability

For releases, config should be explicit and reproducible.

Bad:

```bash
VERSION="$(git describe --tags)"
deploy "$VERSION"
```

without recording exact commit/config.

Better:

```bash
deploy --version "$VERSION" --commit "$GIT_SHA"
```

Metadata:

```json
{
  "version": "1.2.3",
  "commit": "abc123",
  "image": "registry/app:abc123",
  "environment": "staging"
}
```

Automation should produce audit-friendly config summary, without secrets.

---

## 41. Output Config Summary Safely

Before risky operation:

```text
Deployment plan:
  environment: staging
  version: 1.2.3
  image: registry/app:abc123
  deployUrl: https://deploy.staging.example.com
  token: <present>
```

Do not print secret value.

For JSON plan:

```json
{
  "environment": "staging",
  "version": "1.2.3",
  "tokenPresent": true
}
```

This helps review and CI logs.

---

## 42. Interactive Prompts

Avoid prompts in CI.

Bash:

```bash
if [[ "${CI:-}" == "true" ]]; then
  die "Refusing interactive prompt in CI"
fi
```

PowerShell:

```powershell
if ($env:CI -eq 'true') {
  throw 'Refusing interactive prompt in CI'
}
```

For prod operations, prefer explicit flags and CI approvals over prompts.

Bad:

```bash
read -p "Deploy prod? "
```

Good:

```bash
deploy/plan
deploy/apply
```

with CI protected environment.

---

## 43. Config in Docker

Docker build-time:

```dockerfile
ARG APP_VERSION
```

Runtime:

```dockerfile
ENV APP_ENV=prod
```

Be careful:

- `ARG` is build-time, not runtime.
- `ENV` in image sets default runtime env.
- secrets should not be build args.
- runtime config should often be injected by orchestrator.

Entrypoint should validate required runtime env.

```sh
: "${APP_ENV:?APP_ENV is required}"
```

But do not bake prod secrets into image.

---

## 44. Config in Kubernetes

Kubernetes separates:

- ConfigMap: non-secret config;
- Secret: sensitive data;
- env vars;
- mounted files;
- downward API.

Scripts deploying to Kubernetes should not hardcode secrets. Use manifests/helm/kustomize/platform.

Automation can validate intended environment, but cluster policy should enforce.

---

## 45. Config in Maven/Gradle

Maven profiles:

```bash
./mvnw -P integration verify
```

Gradle properties:

```bash
./gradlew test -Pprofile=integration
```

Avoid overloading app runtime config into build profiles unless intended.

Build-time profile and runtime environment are different.

Example:

```text
MAVEN_PROFILE=integration
APP_ENV=dev
DEPLOY_ENV=staging
```

Use clear names.

---

## 46. Config in Java App

Application config often uses:

- Spring profiles;
- environment variables;
- property files;
- command-line args;
- config server;
- Kubernetes ConfigMaps/Secrets.

Automation should not duplicate application config resolution unless needed.

For local run:

```make
run:
	SPRING_PROFILES_ACTIVE="$(SPRING_PROFILE)" ./mvnw spring-boot:run
```

But app should define behavior.

---

## 47. Configuration Ownership

Assign ownership:

| Config | Owner |
|---|---|
| Java dependency version | Maven/Gradle |
| Runtime port default | Application |
| Local override | `.env` / local config |
| CI secret | CI platform |
| Deploy environment URL | deployment config/platform |
| Make target variable default | Makefile |
| Tool version | wrapper/devcontainer/CI |
| Production approval | CI/CD platform |

Ambiguous ownership creates drift.

---

## 48. Common Anti-Patterns

### 48.1 Default prod

```bash
ENV="${ENV:-prod}"
```

### 48.2 Hidden `.env` dependency

Script fails without `.env`, but docs do not mention.

### 48.3 Secret in Makefile

```make
TOKEN := ...
```

### 48.4 Grepping config

```bash
grep url config.json
```

### 48.5 Different names for same thing

```text
ENV
APP_ENV
STAGE
PROFILE
TARGET_ENV
```

all used inconsistently.

### 48.6 Ambient cloud context

Deploy uses current `kubectl` context without validation.

### 48.7 Logging full config object

Includes secrets.

### 48.8 CI/local silent divergence

`if CI then completely different behavior`.

---

## 49. Review Checklist

### Contract

- Are required config values documented?
- Are defaults safe?
- Is precedence defined?
- Are secrets distinguished from config?
- Are allowed values validated?

### Sources

- Are `.env`, env vars, config files, CLI flags used intentionally?
- Is local config separated from CI/prod config?
- Are tool contexts validated?

### Safety

- No default prod?
- No secrets in Makefile/repo/logs?
- Risky operations require explicit env/version/apply?
- Prompts avoided in CI?

### Portability

- Are env var names canonical?
- Are path/config assumptions OS-safe?
- Are required tools/version checked?

### Drift

- Are defaults duplicated?
- Is CI/local difference documented?
- Is there a `doctor` or validation target?

---

## 50. Mini Lab

### Lab 1 — Config Contract Table

Create table for your current service:

```text
ENV
VERSION
PORT
MAVEN_PROFILE
SPRING_PROFILE
DEPLOY_TOKEN
DEPLOY_URL
```

Define source/default/required/secret/allowed.

---

### Lab 2 — Bash Validation

Write Bash function:

```bash
require_env
validate_env
validate_semver
```

Use in deploy script.

---

### Lab 3 — PowerShell Validation

Write PowerShell params with:

```powershell
ValidateSet
ValidatePattern
ValidateRange
```

---

### Lab 4 — Make Help

Update Makefile `help` to show variables and examples.

---

### Lab 5 — Doctor Script

Create `make doctor` that checks:

- Java;
- Docker;
- Maven wrapper;
- required local config;
- port availability.

---

## 51. Design Exercise: Configuration Contract for Deployment

Design deploy config:

Inputs:

```text
ENV
VERSION
IMAGE
DEPLOY_TOKEN
DEPLOY_URL
KUBECONFIG/context
TIMEOUT_SECONDS
DRY_RUN/APPLY
```

Define:

- source;
- precedence;
- validation;
- whether secret;
- log redaction;
- CI/local behavior;
- failure message;
- owner.

Then implement:

```make
deploy/plan
deploy/apply
```

delegating to Bash or PowerShell script.

---

## 52. Part 023 Summary

Environment and configuration are part of your automation API.

Key takeaways:

1. Treat config as explicit contract.
2. Separate config, secret, and ambient state.
3. Define precedence: CLI > env > config file > default, or your chosen model.
4. Use safe defaults only for safe operations.
5. Never default deploy/apply to prod.
6. Validate all important values.
7. Fail fast with clear messages.
8. Use `.env` for local convenience, not production truth.
9. Do not blindly source untrusted `.env`.
10. Do not put secrets in Makefile or logs.
11. Avoid passing secrets as CLI args.
12. Validate ambient tool contexts like kubectl/aws/docker.
13. Keep config ownership clear.
14. Document contract in tables/help/examples.
15. Avoid CI/local drift by naming different targets explicitly.
16. Provide `doctor` checks for local environment readiness.

Part 024 will cover CI/CD scripting: turning laptop commands into reliable pipeline contracts.

---

## 53. Referensi Resmi dan Bacaan Lanjutan

- Twelve-Factor App — Config.
- Bash parameter expansion documentation.
- PowerShell parameter validation documentation.
- GNU Make variables and environment documentation.
- Docker ARG and ENV documentation.
- Kubernetes ConfigMap and Secret documentation.
- CI provider documentation for variables, secrets, environments, and protected deployments.
- Spring Boot externalized configuration documentation.
- Maven profiles and Gradle properties documentation.
- Secret management best practices.

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
- [ ] Part 024 — CI/CD Scripting: From Laptop Command to Pipeline Contract
- [ ] Part 025 — Release and Deployment Automation
- [ ] Part 026 — Operational Scripts: Diagnostics, Runbooks, Incident Tools
- [ ] Part 027 — Advanced Bash and PowerShell Interop
- [ ] Part 028 — Refactoring Legacy Scripts
- [ ] Part 029 — Capstone: Production-Grade Automation Toolkit for a Java Service


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-022.md">⬅️ Part 022 — Script Portability Matrix: Bash, POSIX sh, PowerShell, Make, Java</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-024.md">Part 024 — CI/CD Scripting: From Laptop Command to Pipeline Contract ➡️</a>
</div>
