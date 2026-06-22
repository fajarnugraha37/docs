# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-009.md

# Part 009 — CLI Design for Internal Tools

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: mendesain script sebagai internal command-line product: contract, UX, arguments, flags, env vars, config, exit code, logging, dry-run, compatibility, dan operability.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya membangun fondasi teknis:

- process model;
- parsing/quoting;
- POSIX vs Bash;
- Bash fundamentals;
- error handling;
- data handling;
- filesystem safety;
- process control.

Part 009 mengubah perspektif:

> Script bukan hanya file `.sh`. Script adalah interface yang dipakai manusia, CI, automation lain, dan kadang production operator.

Ketika kamu membuat:

```bash
./scripts/deploy.sh prod 1.2.3
```

kamu sedang mendesain API.

Hanya saja API-nya berbentuk CLI.

Seperti REST API atau Java public interface, CLI internal butuh:

- input contract;
- output contract;
- error contract;
- backward compatibility;
- documentation;
- validation;
- observability;
- safe defaults;
- deprecation strategy;
- stable behavior.

Script yang buruk sering tidak gagal karena Bash syntax. Ia gagal karena desain interface-nya ambigu:

```bash
./deploy.sh prod
```

Apa maksud `prod`? Environment? Profile? Branch? Version?  
Apakah deploy latest? Dari current branch? Dari local artifact? Dari registry?  
Apakah script akan prompt? Apakah CI bisa memanggilnya?  
Apakah stdout bisa diparse? Apakah dry-run benar-benar aman?  
Apa exit code jika production deploy ditolak?

Part ini membangun mental model CLI sebagai product.

---

## 1. CLI Internal adalah API

Sebagai Java engineer, kamu tahu API buruk punya ciri:

- nama method ambigu;
- parameter positional tidak jelas;
- side effect tidak terdokumentasi;
- error tidak konsisten;
- behavior berubah diam-diam;
- output sulit diparse;
- breaking change tanpa migration;
- caller harus membaca implementasi.

CLI internal bisa punya masalah yang sama.

Contoh buruk:

```bash
./run.sh prod
```

Contoh lebih baik:

```bash
./scripts/deploy.sh --env prod --version 1.2.3 --dry-run
```

Kenapa lebih baik?

- explicit;
- self-documenting;
- bisa diperluas;
- lebih aman;
- lebih mudah divalidasi;
- lebih cocok untuk CI;
- lebih sulit salah urutan argumen.

Rule:

> Treat every script in `scripts/` as a public API for your team.

---

## 2. Nama Command Harus Mewakili Intensi

Buruk:

```text
script.sh
run.sh
doit.sh
new.sh
test2.sh
deploy_new.sh
helper.sh
```

Lebih baik:

```text
verify.sh
build-image.sh
run-local.sh
deploy-release.sh
generate-config.sh
collect-diagnostics.sh
clean-build-artifacts.sh
promote-artifact.sh
```

Nama command harus menjawab:

- action apa?
- object apa?
- scope apa?

Pattern:

```text
<verb>-<object>.sh
```

Examples:

```text
build-image.sh
verify-service.sh
deploy-release.sh
collect-diagnostics.sh
generate-openapi-client.sh
rotate-local-certificates.sh
```

Untuk command multi-subcommand:

```bash
service.sh verify
service.sh run
service.sh clean
service.sh deploy
```

Gunakan multi-subcommand bila operasi masih satu domain yang sama.

---

## 3. One Script per Workflow vs One CLI with Subcommands

### 3.1 One script per workflow

```text
scripts/verify.sh
scripts/run-local.sh
scripts/clean.sh
scripts/deploy.sh
```

Pros:

- simple;
- mudah ditemukan;
- each script small;
- shebang/config independent;
- cocok untuk project kecil-menengah.

Cons:

- helper duplicated;
- interface style bisa tidak konsisten;
- banyak file.

### 3.2 One CLI with subcommands

```bash
./scripts/service.sh verify
./scripts/service.sh run
./scripts/service.sh clean
./scripts/service.sh deploy
```

Pros:

- shared parsing/helper;
- consistent UX;
- easier discoverability through `help`;
- good for mature internal tooling.

Cons:

- file bisa terlalu besar;
- parsing lebih kompleks;
- subcommand-specific options lebih sulit;
- coupling antar workflow.

Heuristic:

- mulai dengan script terpisah;
- jika pattern stabil dan helper banyak duplicate, konsolidasikan;
- jangan membuat framework Bash terlalu awal.

---

## 4. Positional Arguments vs Named Flags

### 4.1 Positional arguments

```bash
deploy.sh prod 1.2.3
```

Pros:

- singkat;
- cocok untuk argumen wajib sangat sedikit;
- familiar.

Cons:

- urutan mudah salah;
- self-documentation rendah;
- sulit diperluas;
- optional args membingungkan.

### 4.2 Named flags

```bash
deploy.sh --env prod --version 1.2.3
```

Pros:

- explicit;
- aman untuk operasi serius;
- mudah diperluas;
- cocok untuk CI logs;
- lebih mudah validasi.

Cons:

- lebih verbose;
- parser sedikit lebih panjang.

Guideline:

- gunakan named flags untuk destructive/deploy/release;
- positional boleh untuk command kecil dan obvious seperti `show-version.sh`;
- jangan gabungkan positional ambigu dengan banyak optional flags tanpa help yang jelas.

---

## 5. Required vs Optional Inputs

CLI harus jelas membedakan:

- required flags;
- optional flags;
- env vars;
- config defaults;
- inferred values.

Example:

```text
deploy.sh

Required:
  --env <staging|prod>
  --version <x.y.z>

Optional:
  --dry-run
  --yes
  --timeout <seconds>

Required environment:
  DEPLOY_URL
  DEPLOY_TOKEN
```

In Bash:

```bash
[[ -n "$env" ]] || usage_error "--env is required"
[[ -n "$version" ]] || usage_error "--version is required"
: "${DEPLOY_URL:?DEPLOY_URL is required}"
: "${DEPLOY_TOKEN:?DEPLOY_TOKEN is required}"
```

Do not silently infer dangerous values.

Bad:

```bash
env="${1:-prod}"
```

Defaulting to prod is dangerous.

Better:

```bash
env="${env:-dev}"
```

only for local non-destructive workflows.

---

## 6. Safe Defaults

Defaults should be safe.

Good defaults:

```text
--env dev
--dry-run for deploy preview mode
--timeout 60
--verbose false
--delete false
```

Bad defaults:

```text
env=prod
delete=true
yes=true
latest version from current branch
force=true
```

For destructive commands, require explicit opt-in:

```bash
if [[ "$delete" != "true" ]]; then
  die "delete operation requires --delete"
fi
```

For production:

```bash
if [[ "$env" == "prod" && "$yes" != "true" ]]; then
  die "production operation requires --yes"
fi
```

For especially risky operation, require typed confirmation only in interactive mode or separate approval outside script.

But avoid prompts in CI. CI should pass explicit flags.

---

## 7. Flags as Stable Contract

Once other scripts/CI call your CLI, flags become contract.

Good:

```bash
deploy.sh --env staging --version 1.2.3
```

Avoid changing meaning later.

If changing:

- add new flag;
- keep old flag as deprecated;
- warn for a release window;
- document migration;
- remove later deliberately.

Example:

```bash
--profile
```

used to mean Maven profile, later changed to deployment profile. This is breaking.

Better:

```bash
--maven-profile
--deployment-profile
```

Be precise early.

---

## 8. Boolean Flags

Common:

```bash
--dry-run
--verbose
--debug
--yes
--force
```

Prefer presence/absence over values:

```bash
--dry-run
```

instead of:

```bash
--dry-run=true
```

For env var booleans, validate:

```bash
case "${DRY_RUN:-false}" in
  true|false) ;;
  *) die "DRY_RUN must be true or false" ;;
esac
```

Be careful with `--force`. It is often too vague.

Better:

```bash
--allow-dirty-working-tree
--allow-prod
--delete-existing
--overwrite
--skip-tests
```

Specific dangerous flags are easier to review.

---

## 9. `--force` is a Smell

`--force` means “bypass something”, but what?

Bad:

```bash
deploy.sh --force
```

Does it bypass tests? Branch guard? Prod confirmation? Version exists check? Dirty tree?

Better:

```bash
--skip-tests
--allow-dirty-working-tree
--overwrite-existing-release
--yes
```

Each bypass should be explicit and logged.

If you keep `--force`, define exactly:

```text
--force
  Allows overwriting existing local generated files.
  Does not bypass production confirmation.
  Does not skip tests.
```

But most internal tools benefit from avoiding `--force`.

---

## 10. `--dry-run`, `--plan`, and `--apply`

These are not identical.

### `--dry-run`

Means command simulates execution without side effects.

But if underlying tools still mutate, name is misleading.

### `--plan`

Means print intended actions. No mutation.

### `--apply`

Means perform planned changes.

Useful design:

```bash
deploy.sh --env prod --version 1.2.3 --plan
deploy.sh --env prod --version 1.2.3 --apply --yes
```

In script:

```bash
mode="plan"

case "$mode" in
  plan)
    print_plan
    ;;
  apply)
    apply_changes
    ;;
esac
```

For dangerous operations, default to `plan`.

For normal local commands like `verify.sh`, no need.

---

## 11. Help Text is Part of the Product

Every non-trivial script should support:

```bash
-h
--help
```

Good help includes:

- purpose;
- usage;
- required flags;
- optional flags;
- env vars;
- examples;
- side effects;
- exit code summary if important.

Template:

```bash
usage() {
  cat >&2 <<'EOF'
Usage:
  deploy-release.sh --env <staging|prod> --version <x.y.z> [options]

Deploys an already-built release artifact to the selected environment.

Required:
  --env <name>        Target environment: staging or prod.
  --version <x.y.z>   Release version to deploy.

Options:
  --plan              Print intended actions without changing anything.
  --apply             Perform deployment.
  --yes               Required for production apply.
  --timeout <sec>     Deployment request timeout. Default: 60.
  -h, --help          Show this help.

Environment:
  DEPLOY_URL          Deployment API base URL.
  DEPLOY_TOKEN        Deployment API token.

Examples:
  deploy-release.sh --env staging --version 1.2.3 --plan
  deploy-release.sh --env prod --version 1.2.3 --apply --yes

Side effects:
  In --apply mode, sends deployment request to DEPLOY_URL.
EOF
}
```

For script returning machine-readable stdout, help should go stderr or stdout? Convention varies. For `--help`, stdout is common. In many internal scripts, stderr is acceptable but less standard. Pick a convention.

---

## 12. Usage Error vs Runtime Error

Usage error:

```bash
deploy.sh --env
```

should:

- print usage or relevant snippet;
- exit 2.

Runtime error:

```bash
deploy.sh --env staging --version 1.2.3
# DEPLOY_URL unreachable
```

should:

- not print full usage;
- print actionable error;
- exit non-zero, usually 1 or domain code.

Pattern:

```bash
usage_error() {
  usage
  printf 'ERROR: %s\n' "$*" >&2
  exit 2
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}
```

Do not dump large help for every runtime error. It creates noise.

---

## 13. Exit Code Design

For most internal scripts:

```text
0 success
1 runtime failure
2 usage/config error
130 interrupted
```

For richer automation:

```text
0 success
2 usage error
10 missing dependency
20 validation failure
30 operation failure
40 remote/API failure
50 safety guard violation
130 interrupted
143 terminated
```

Only add code if caller uses it.

CI generally only cares zero/non-zero, but wrapper scripts may distinguish:

```bash
if ./deploy.sh ...; then
  ...
else
  status=$?
  case "$status" in
    50) echo "safety guard blocked deploy" ;;
    *) echo "deploy failed" ;;
  esac
fi
```

Document exit codes if non-trivial.

---

## 14. stdout Contract

Decide what stdout means.

For human command:

```bash
verify.sh
```

stdout/stderr distinction may not matter much, but still useful.

For data-producing command:

```bash
compute-version.sh
```

stdout must be machine-readable.

Example contract:

```text
compute-version.sh:
  stdout: exactly one version string and newline
  stderr: logs
  exit 0: version computed
  exit non-zero: no version
```

Implementation:

```bash
version="$(compute_version)" || die "failed to compute version"
printf '%s\n' "$version"
```

For structured output:

```bash
metadata.sh --json
```

stdout:

```json
{"version":"1.2.3","commit":"abc123"}
```

Do not mix progress logs.

---

## 15. Output Modes: Human vs Machine

Useful pattern:

```bash
--output text
--output json
```

Example:

```bash
status.sh --output text
status.sh --output json
```

Implementation:

```bash
case "$output" in
  text)
    printf 'Version: %s\n' "$version"
    printf 'Commit: %s\n' "$commit"
    ;;
  json)
    jq -n --arg version "$version" --arg commit "$commit" \
      '{version:$version, commit:$commit}'
    ;;
  *)
    usage_error "invalid output mode: $output"
    ;;
esac
```

If JSON output is supported, ensure logs go stderr.

Do not promise JSON if some errors also print non-JSON to stdout.

---

## 16. Verbosity Levels

Common flags:

```text
--quiet
--verbose
--debug
--trace
```

Suggested semantics:

- normal: high-level progress;
- quiet: only essential output/errors;
- verbose: more context;
- debug: internal values, no secrets;
- trace: `set -x`, only for safe scripts.

Implementation:

```bash
quiet=false
verbose=false
debug=false

log() {
  [[ "$quiet" == "true" ]] && return 0
  printf '%s\n' "$*" >&2
}

debug_log() {
  [[ "$debug" == "true" ]] || return 0
  printf 'DEBUG: %s\n' "$*" >&2
}
```

Avoid `set -x` for secret-bearing scripts.

---

## 17. Environment Variables vs Flags

Flags are explicit per invocation:

```bash
deploy.sh --env staging
```

Env vars are useful for ambient config:

```bash
DEPLOY_URL=https://deploy.example.com
DEPLOY_TOKEN=...
```

Guideline:

- use flags for operation-specific choices;
- use env for credentials and environment-specific config;
- avoid env for dangerous choices like `ENV=prod` unless explicit;
- document env vars in help;
- validate env vars early.

Precedence if both exist:

```text
flag > env var > config file > default
```

Example:

```bash
env="${APP_ENV:-dev}"

# later parse --env overrides env
```

Document precedence.

---

## 18. Config Files

Use config files when inputs are many or structured.

Example `tool.json`:

```json
{
  "defaultEnv": "dev",
  "modules": ["api", "worker"],
  "ports": {
    "dev": 8080,
    "staging": 8081
  }
}
```

Script:

```bash
config_file="tool.json"
env="$(jq -er '.defaultEnv' "$config_file")"
```

Config precedence:

```text
defaults < config file < env vars < CLI flags
```

But do not overcomplicate.

If config is structured, prefer JSON + `jq`. Avoid sourcing arbitrary shell config unless it is trusted code.

---

## 19. Argument Parser Pattern for Subcommands

Skeleton:

```bash
main() {
  if (($# == 0)); then
    usage
    exit 2
  fi

  local command="$1"
  shift

  case "$command" in
    verify)
      cmd_verify "$@"
      ;;
    run)
      cmd_run "$@"
      ;;
    clean)
      cmd_clean "$@"
      ;;
    help|-h|--help)
      usage
      ;;
    *)
      usage
      printf 'ERROR: unknown command: %s\n' "$command" >&2
      exit 2
      ;;
  esac
}
```

Each subcommand parses its own flags:

```bash
cmd_verify() {
  local quick=false

  while (($# > 0)); do
    case "$1" in
      --quick)
        quick=true
        shift
        ;;
      -h|--help)
        usage_verify
        return 0
        ;;
      --)
        shift
        break
        ;;
      -*)
        usage_verify
        printf 'ERROR: unknown verify option: %s\n' "$1" >&2
        return 2
        ;;
      *)
        break
        ;;
    esac
  done

  # execute
}
```

This avoids global parser complexity.

---

## 20. `--` End of Options

Support `--` when forwarding args.

Example:

```bash
verify.sh --quick -- -DskipDocker=true -Dtest="My Test"
```

Parser:

```bash
while (($# > 0)); do
  case "$1" in
    --quick)
      quick=true
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      usage_error "unknown option: $1"
      ;;
    *)
      break
      ;;
  esac
done

extra_args=("$@")
```

Then:

```bash
cmd=(mvn test)
cmd+=("${extra_args[@]}")
"${cmd[@]}"
```

This is essential for wrapper scripts.

---

## 21. Avoid Ambiguous Pass-Through

Bad:

```bash
verify.sh -DskipTests
```

Is `-DskipTests` script option or Maven option?

Better:

```bash
verify.sh -- -DskipTests
```

The `--` boundary makes intent clear.

Help should say:

```text
Arguments after -- are passed to Maven unchanged.
```

For wrapper tools, this is a strong convention.

---

## 22. Interactive Prompt Design

Prompts are useful for local safety, bad for CI.

Detect non-interactive:

```bash
is_tty() {
  [[ -t 0 && -t 1 ]]
}
```

Prompt only if TTY:

```bash
confirm() {
  local prompt="$1"

  if ! is_tty; then
    return 1
  fi

  local answer
  read -r -p "$prompt [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "yes" ]]
}
```

For production:

```bash
if [[ "$env" == "prod" && "$yes" != "true" ]]; then
  if confirm "Deploy to production?"; then
    :
  else
    die "production deploy not confirmed"
  fi
fi
```

But in CI, prefer explicit `--yes` or CI approval step.

---

## 23. CI-Friendly Design

CLI should be usable in CI:

- no mandatory prompt;
- deterministic output;
- non-zero on failure;
- clear logs;
- no hidden local state;
- config via flags/env;
- stable working directory behavior;
- artifacts written to known paths;
- secret-safe logs.

Bad CI YAML:

```yaml
script:
  - cd ..
  - ./deploy.sh prod
```

Better:

```yaml
script:
  - ./scripts/deploy-release.sh --env "$DEPLOY_ENV" --version "$VERSION" --apply
```

Even better: CI YAML thin, script owns logic.

---

## 24. Human-Friendly Design

For local developer:

- good help;
- examples;
- safe defaults;
- clear errors;
- actionable recovery;
- progress logs;
- dry-run;
- no surprising deletion;
- works from any directory;
- validates dependencies.

Example error:

```text
ERROR: required command not found: jq
Install jq or run through the project dev container.
```

Better than:

```text
jq: command not found
```

But don't overdo. Keep messages concise.

---

## 25. Logging Style

Good:

```text
==> Preflight
==> Building image app:1.2.3
==> Pushing image
OK: deployment requested id=dep-123
```

Bad:

```text
starting
done
error
```

Use consistent prefixes:

```bash
step() {
  printf '==> %s\n' "$*" >&2
}

ok() {
  printf 'OK: %s\n' "$*" >&2
}

warn() {
  printf 'WARN: %s\n' "$*" >&2
}
```

Do not add colors by default in CI unless TTY-aware.

---

## 26. Colors

Colors help humans but pollute logs/machine output.

Only use color if stdout/stderr is TTY:

```bash
if [[ -t 2 ]]; then
  red=$'\033[31m'
  green=$'\033[32m'
  reset=$'\033[0m'
else
  red=""
  green=""
  reset=""
fi
```

Respect `NO_COLOR` convention if desired:

```bash
if [[ -n "${NO_COLOR:-}" ]]; then
  red=""
  green=""
  reset=""
fi
```

Keep color optional.

Never color machine-readable stdout.

---

## 27. Progress Indicators

Avoid fancy spinners in CI. They can make logs noisy.

For long operations:

```bash
step "Running Maven tests"
mvn test
```

For waiting loops:

```bash
log "Waiting for service health: $url"
```

Maybe periodic log:

```bash
if ((attempt % 5 == 0)); then
  log "Still waiting for service..."
fi
```

Do not print every 100ms.

---

## 28. Versioning Internal CLI

If a script is used by many repos/jobs, version it.

Options:

- keep script in repo and version with repo;
- package scripts as internal tool;
- expose `--version`;
- include changelog;
- avoid breaking changes.

Simple:

```bash
readonly TOOL_VERSION="0.3.0"

case "$1" in
  --version)
    printf '%s\n' "$TOOL_VERSION"
    exit 0
    ;;
esac
```

For per-repo scripts, Git history is often enough.

---

## 29. Deprecation Strategy

If replacing flag:

```bash
--profile
```

with:

```bash
--maven-profile
```

Support old flag temporarily:

```bash
--profile)
  warn "--profile is deprecated; use --maven-profile"
  maven_profile="$2"
  shift 2
  ;;
```

Set removal date/version in warning:

```text
WARN: --profile is deprecated and will be removed after 2026-09-01; use --maven-profile
```

For internal tools, this prevents breaking CI unexpectedly.

---

## 30. Stability and Backward Compatibility

Avoid breaking:

- flag names;
- default behavior;
- stdout format;
- exit codes used by callers;
- file output paths;
- config schema;
- env var names.

If output is human-only, you can evolve more freely.

If output is machine-readable, treat as API.

Example:

```bash
metadata.sh --json
```

Do not change:

```json
{"version":"1.2.3"}
```

to:

```json
{"projectVersion":"1.2.3"}
```

without migration.

Add fields instead:

```json
{"version":"1.2.3","commit":"abc123"}
```

Additive changes are safer.

---

## 31. Discoverability

Common entrypoints:

```text
Makefile
scripts/
README.md
docs/dev.md
```

Makefile can expose:

```make
help:
	@echo "Available targets:"
	@echo "  verify     Run verification"
	@echo "  run        Run service locally"
	@echo "  clean      Clean build artifacts"
```

Scripts should be named clearly and support `--help`.

For larger tool:

```bash
service.sh help
service.sh help deploy
```

Subcommand help is valuable.

---

## 32. Documentation Close to Script

At top of script:

```bash
# verify.sh
#
# Runs local verification equivalent to CI.
# Intended for developers and CI.
#
# stdout:
#   no machine-readable contract
#
# side effects:
#   creates target/ and build reports
```

Do not duplicate huge docs, but include enough intent.

README can show common usage.

---

## 33. Security UX

Do not ask users to pass secrets via flags:

Bad:

```bash
deploy.sh --token abc123
```

Why bad?

- shell history;
- process list;
- CI logs;
- accidental echo.

Prefer env var or secret manager:

```bash
DEPLOY_TOKEN=... deploy.sh --env staging --version 1.2.3
```

Even env vars can leak to child process/environment dumps, but generally better than CLI args.

Do not print secrets.

If missing token:

```text
ERROR: DEPLOY_TOKEN is required
```

Not:

```text
ERROR: token is abc123 invalid
```

---

## 34. Config Precedence Example

```bash
config_file="tool.json"
env=""
timeout=""

# defaults
default_env="dev"
default_timeout="60"

# config
if [[ -f "$config_file" ]]; then
  config_env="$(jq -r '.defaultEnv // empty' "$config_file")"
  config_timeout="$(jq -r '.timeoutSeconds // empty' "$config_file")"
fi

# env vars
env="${APP_ENV:-${config_env:-$default_env}}"
timeout="${APP_TIMEOUT:-${config_timeout:-$default_timeout}}"

# CLI flags later override
```

But this can get complex. Use only when needed.

Document:

```text
Precedence:
  CLI flags > environment variables > tool.json > built-in defaults
```

---

## 35. Example: Well-Designed `verify.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  verify.sh [options] [-- <maven-args>...]

Runs local verification equivalent to CI.

Options:
  --profile <name>   Verification profile: unit, integration. Default: unit.
  --quick            Skip slower checks.
  --output <mode>    text or json. Default: text.
  -v, --verbose      Print more logs.
  -h, --help         Show help.

Arguments after -- are passed to Maven unchanged.

Examples:
  verify.sh
  verify.sh --profile integration
  verify.sh --quick -- -DskipDocker=true

Exit codes:
  0 success
  2 usage error
  1 verification failure
EOF
}

log() {
  [[ "${quiet:-false}" == "true" ]] && return 0
  printf '%s\n' "$*" >&2
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

usage_error() {
  usage >&2
  printf 'ERROR: %s\n' "$*" >&2
  exit 2
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

main() {
  local profile="unit"
  local quick=false
  local output="text"
  local verbose=false

  while (($# > 0)); do
    case "$1" in
      --profile)
        (($# >= 2)) || usage_error "--profile requires value"
        profile="$2"
        shift 2
        ;;
      --quick)
        quick=true
        shift
        ;;
      --output)
        (($# >= 2)) || usage_error "--output requires value"
        output="$2"
        shift 2
        ;;
      -v|--verbose)
        verbose=true
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      --)
        shift
        break
        ;;
      -*)
        usage_error "unknown option: $1"
        ;;
      *)
        break
        ;;
    esac
  done

  case "$profile" in
    unit|integration) ;;
    *) usage_error "invalid profile: $profile" ;;
  esac

  case "$output" in
    text|json) ;;
    *) usage_error "invalid output mode: $output" ;;
  esac

  require_cmd mvn

  local script_dir
  local project_root
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  project_root="$(cd -- "$script_dir/.." && pwd)"

  cd "$project_root"
  [[ -f pom.xml ]] || die "pom.xml not found at project root: $project_root"

  local cmd=(mvn -P "$profile")

  if [[ "$quick" == "true" ]]; then
    cmd+=(-DskipITs=true)
  fi

  cmd+=(test)
  cmd+=("$@")

  log "Running verification profile=$profile quick=$quick"

  local start
  start="$SECONDS"

  if ! "${cmd[@]}"; then
    die "verification failed"
  fi

  local duration=$((SECONDS - start))

  case "$output" in
    text)
      printf 'verification=success profile=%s durationSeconds=%s\n' "$profile" "$duration"
      ;;
    json)
      jq -n \
        --arg profile "$profile" \
        --argjson durationSeconds "$duration" \
        '{verification:"success", profile:$profile, durationSeconds:$durationSeconds}'
      ;;
  esac
}

main "$@"
```

This script has:

- help;
- explicit flags;
- pass-through after `--`;
- output modes;
- exit code distinction;
- project root resolution;
- command array;
- clean stdout contract.

---

## 36. Example: Well-Designed `deploy-release.sh`

Key design choices:

- default `--plan`, not apply;
- production requires `--yes`;
- flags explicit;
- secrets via env;
- JSON payload via jq;
- no secret logging.

```bash
#!/usr/bin/env bash
set -euo pipefail

mode="plan"

usage() {
  cat <<'EOF'
Usage:
  deploy-release.sh --env <staging|prod> --version <x.y.z> [--plan|--apply] [--yes]

Deploys an existing release version.

Required:
  --env <name>        staging or prod
  --version <x.y.z>   release version

Mode:
  --plan              print intended actions without mutation (default)
  --apply             perform deployment

Options:
  --yes               required for prod apply
  -h, --help          show help

Environment:
  DEPLOY_URL
  DEPLOY_TOKEN

Examples:
  deploy-release.sh --env staging --version 1.2.3
  deploy-release.sh --env prod --version 1.2.3 --apply --yes
EOF
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

usage_error() {
  usage >&2
  printf 'ERROR: %s\n' "$*" >&2
  exit 2
}

main() {
  local env=""
  local version=""
  local yes=false

  while (($# > 0)); do
    case "$1" in
      --env)
        (($# >= 2)) || usage_error "--env requires value"
        env="$2"
        shift 2
        ;;
      --version)
        (($# >= 2)) || usage_error "--version requires value"
        version="$2"
        shift 2
        ;;
      --plan)
        mode="plan"
        shift
        ;;
      --apply)
        mode="apply"
        shift
        ;;
      --yes)
        yes=true
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        usage_error "unknown argument: $1"
        ;;
    esac
  done

  [[ -n "$env" ]] || usage_error "--env is required"
  [[ -n "$version" ]] || usage_error "--version is required"

  case "$env" in
    staging|prod) ;;
    *) usage_error "invalid env: $env" ;;
  esac

  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage_error "invalid version: $version"

  if [[ "$mode" == "apply" ]]; then
    : "${DEPLOY_URL:?DEPLOY_URL is required}"
    : "${DEPLOY_TOKEN:?DEPLOY_TOKEN is required}"
  fi

  if [[ "$env" == "prod" && "$mode" == "apply" && "$yes" != "true" ]]; then
    die "prod apply requires --yes"
  fi

  if [[ "$mode" == "plan" ]]; then
    cat <<EOF
Plan:
  action: deploy release
  env: $env
  version: $version
  mode: plan
  mutation: none
EOF
    return 0
  fi

  local payload
  payload="$(jq -n --arg env "$env" --arg version "$version" '{env:$env, version:$version}')"

  printf 'Deploying env=%s version=%s\n' "$env" "$version" >&2

  curl \
    --fail \
    --show-error \
    --silent \
    --connect-timeout 5 \
    --max-time 60 \
    --header "Authorization: Bearer $DEPLOY_TOKEN" \
    --header 'Content-Type: application/json' \
    --data "$payload" \
    "${DEPLOY_URL%/}/deploy"
}

main "$@"
```

This is far safer than positional deploy scripts.

---

## 37. Example: Subcommand CLI Skeleton

```bash
#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  service.sh <command> [options]

Commands:
  verify      Run verification
  run         Run service locally
  clean       Clean build artifacts
  metadata    Print build metadata
  help        Show help

Examples:
  service.sh verify --quick
  service.sh run --env dev -- --server.port=9090
  service.sh metadata --output json
EOF
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

usage_error() {
  usage >&2
  printf 'ERROR: %s\n' "$*" >&2
  exit 2
}

cmd_verify() {
  echo "verify not implemented" >&2
}

cmd_run() {
  echo "run not implemented" >&2
}

cmd_clean() {
  echo "clean not implemented" >&2
}

cmd_metadata() {
  echo "metadata not implemented" >&2
}

main() {
  (($# > 0)) || usage_error "command is required"

  local command="$1"
  shift

  case "$command" in
    verify)
      cmd_verify "$@"
      ;;
    run)
      cmd_run "$@"
      ;;
    clean)
      cmd_clean "$@"
      ;;
    metadata)
      cmd_metadata "$@"
      ;;
    help|-h|--help)
      usage
      ;;
    *)
      usage_error "unknown command: $command"
      ;;
  esac
}

main "$@"
```

This becomes useful when your project scripts share common root resolution/helpers.

---

## 38. CLI Design Checklist

### Naming

- Is command name specific?
- Does it use verb-object naming?
- Is it discoverable in `scripts/` or Makefile?

### Input

- Are required inputs explicit?
- Are dangerous choices named flags?
- Are positional args minimal and obvious?
- Is `--` supported for pass-through?
- Are env vars documented?
- Is precedence documented?

### Safety

- Are defaults safe?
- Is production/destructive action opt-in?
- Is `--force` avoided or precise?
- Is dry-run/plan truthful?
- Are secrets excluded from CLI args/logs?

### Output

- Is stdout human or machine contract?
- Are logs on stderr?
- Is JSON valid when requested?
- Are colors TTY-aware?

### Errors

- Usage errors exit 2?
- Runtime errors are actionable?
- Exit codes documented if meaningful?
- Does help avoid hiding actual runtime error?

### Compatibility

- Are flags stable?
- Are breaking changes avoided?
- Is deprecation handled?
- Is output schema additive?

### CI

- Non-interactive mode works?
- No mandatory prompts?
- Logs are readable?
- Artifacts/output paths stable?

---

## 39. Mini Lab

### Lab 1 — Improve a bad CLI

Given:

```bash
deploy.sh prod 1.2.3 true
```

Redesign interface with named flags.

Define:

- required flags;
- optional flags;
- env vars;
- exit codes;
- examples.

---

### Lab 2 — Add `--help`

Write help for `clean.sh`:

```bash
clean.sh --target maven|gradle|all --dry-run
```

Include side effects.

---

### Lab 3 — Implement `--output json`

For a script that prints version and commit, support:

```bash
metadata.sh --output text
metadata.sh --output json
```

Ensure logs go stderr.

---

### Lab 4 — Pass-through args

Implement:

```bash
verify.sh --quick -- -Dtest=MyTest -DskipDocker=true
```

Ensure Maven receives exactly the args after `--`.

---

### Lab 5 — Prompt only on TTY

Write confirm function that refuses in non-interactive mode unless `--yes` is passed.

---

## 40. Design Exercise: Project Service CLI

Design `scripts/service.sh` with:

```text
service.sh verify [--quick] [-- <maven args>...]
service.sh run [--env dev|staging-like] [--debug] [-- <app args>...]
service.sh clean [--target maven|gradle|all] [--dry-run]
service.sh metadata [--output text|json]
service.sh help [command]
```

For each subcommand define:

- purpose;
- inputs;
- outputs;
- side effects;
- exit codes;
- examples;
- whether safe for CI;
- whether it can mutate filesystem;
- whether it can use secrets;
- compatibility concerns.

Then implement skeleton only. Do not rush to full logic.

This exercise mirrors how real internal tooling grows.

---

## 41. Part 009 Summary

CLI design turns scripts into reliable internal tools.

Key takeaways:

1. A script is an API.
2. Command names should express intent.
3. Use named flags for serious/destructive workflows.
4. Required vs optional inputs must be explicit.
5. Defaults should be safe.
6. Avoid vague `--force`; prefer specific bypass flags.
7. Help text is part of the product.
8. Usage errors and runtime errors should differ.
9. stdout should have a clear contract.
10. Machine-readable output must remain clean and stable.
11. Env vars are useful for credentials/config, but must be documented.
12. `--` is essential for pass-through wrappers.
13. Prompts must not break CI.
14. Logs should be readable, secret-safe, and stderr-oriented.
15. Backward compatibility matters once CI or other scripts depend on your CLI.
16. Design CLI before implementation for high-risk workflows.

Part 010 will cover Bash testing, linting, formatting, and reviewability.

---

## 42. Referensi Resmi dan Bacaan Lanjutan

- GNU Bash Reference Manual — shell functions, parameters, arrays, exit status.
- POSIX Utility Syntax Guidelines — conventions for options and operands.
- GNU Coding Standards — command-line interface conventions.
- ShellCheck documentation — CLI and argument parsing related warnings.
- jq Manual — JSON output construction for machine-readable CLI output.
- Twelve-Factor App config principles — useful perspective for env/config separation.
- Common Unix CLI conventions — stdout/stderr, exit status, `--help`, `--version`, `--`.

---

## 43. Status Seri

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
- [ ] Part 010 — Bash Testing, Linting, Formatting, and Reviewability
- [ ] Part 011 — Security Model for Shell Scripts
- [ ] Part 012 — PowerShell Mental Model: Objects, Pipeline, Providers
- [ ] Part 013 — PowerShell Language Fundamentals for Java Engineers
- [ ] Part 014 — PowerShell Error Handling, Strictness, and Observability
- [ ] Part 015 — PowerShell Data Automation: JSON, XML, CSV, REST, Objects
- [ ] Part 016 — Cross-Platform PowerShell: Windows, Linux, macOS, Containers
- [ ] Part 017 — PowerShell Modules and Reusable Automation Architecture
- [ ] Part 018 — Makefile Mental Model: Dependency Graph, Targets, Recipes
- [ ] Part 019 — Practical Makefile Syntax and Execution Semantics
- [ ] Part 020 — Makefile for Java Projects: Maven, Gradle, Docker, CI Facade
- [ ] Part 021 — Makefile as Workflow Orchestrator, Not Build System Replacement
- [ ] Part 022 — Script Portability Matrix: Bash, POSIX sh, PowerShell, Make, Java
- [ ] Part 023 — Environment Management and Configuration Contracts
- [ ] Part 024 — CI/CD Scripting: From Laptop Command to Pipeline Contract
- [ ] Part 025 — Release and Deployment Automation
- [ ] Part 026 — Operational Scripts: Diagnostics, Runbooks, Incident Tools
- [ ] Part 027 — Advanced Bash and PowerShell Interop
- [ ] Part 028 — Refactoring Legacy Scripts
- [ ] Part 029 — Capstone: Production-Grade Automation Toolkit for a Java Service


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-008.md">⬅️ Part 008 — Process Control: Background Jobs, Signals, Timeouts, Concurrency</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-010.md">Part 010 — Bash Testing, Linting, Formatting, and Reviewability ➡️</a>
</div>
