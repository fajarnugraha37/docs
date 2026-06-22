# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-028.md

# Part 028 — Refactoring Legacy Scripts

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: cara membedah, menstabilkan, menguji, dan memigrasikan legacy scripts tanpa memutus workflow tim/CI/production: inventory, characterization tests, safety guards, incremental refactoring, wrappers, deprecation, dan strangler pattern.

---

## 0. Posisi Part Ini dalam Seri

Kita sudah membahas:

- Bash, POSIX sh, PowerShell, Make;
- error handling, security, data, filesystem, process control;
- CI/CD, release, deployment, operational scripts;
- interop Bash/PowerShell.

Part 028 membahas situasi yang hampir pasti kamu temui:

> Ada script lama yang penting, rapuh, tidak ada test, tidak ada owner, tapi semua orang takut menyentuhnya.

Legacy script bisa berupa:

```text
deploy.sh
release.sh
build.sh
ci.sh
run.sh
cleanup.sh
migrate.sh
ops.sh
Makefile 600 baris
PowerShell script dari admin lama
```

Masalahnya bukan hanya kualitas kode. Masalahnya adalah script itu sudah menjadi bagian dari sistem sosial dan operasional.

Refactoring legacy scripts harus dilakukan seperti refactoring production code:

- pahami behavior sekarang;
- lindungi behavior yang masih dibutuhkan;
- tambahkan observability;
- buat tests;
- kurangi risiko;
- migrasi bertahap;
- dokumentasikan contract;
- deprecate dengan jelas.

---

## 1. Legacy Script Is Production Code

Jika script:

- dipakai CI;
- deploy production;
- publish artifact;
- cleanup data;
- menjalankan migration;
- dipakai saat incident;
- dipakai banyak developer;

maka script itu production code.

Konsekuensinya:

- harus direview;
- harus punya owner;
- harus punya contract;
- harus punya tests minimal;
- harus punya failure behavior jelas;
- harus tidak menyimpan secrets;
- harus tidak bergantung pada magic laptop state.

Jangan meremehkan script hanya karena file-nya `.sh`, `.ps1`, atau `Makefile`.

---

## 2. Refactoring Goal

Tujuan refactoring bukan “membuat script terlihat modern”.

Tujuan:

```text
Meningkatkan correctness, safety, maintainability, observability,
tanpa breaking existing workflows secara tidak sengaja.
```

Refactoring bagus:

- behavior penting tetap sama;
- bugs/risk berkurang;
- interface lebih jelas;
- tests bertambah;
- script lebih kecil;
- logic dipindah ke tempat yang tepat;
- users diberi migration path.

Refactoring buruk:

- rewrite besar tanpa tests;
- mengubah CLI flags diam-diam;
- menghapus edge case yang dipakai CI;
- menambah strict mode langsung dan memecahkan semua;
- mengganti Bash ke PowerShell tanpa runtime tersedia;
- memindahkan logic ke Makefile yang lebih sulit dites.

---

## 3. First Step: Inventory

Sebelum mengubah, inventarisasi.

Checklist:

```text
Path:
Purpose:
Owner:
Users:
Called by:
Calls:
Runs on:
Requires:
Inputs:
Outputs:
Secrets:
Side effects:
Risk level:
Frequency:
Last modified:
Known bugs:
```

Example:

```text
Path: scripts/deploy.sh
Purpose: deploy service to staging/prod
Users: CI deploy workflow, release engineer
Called by: Makefile deploy/apply, GitHub Actions deploy.yml
Calls: docker, kubectl, curl, jq
Runs on: Ubuntu CI runner
Inputs: ENV, VERSION, DEPLOY_TOKEN
Outputs: logs only
Secrets: DEPLOY_TOKEN
Side effects: kubectl apply production
Risk: high
```

This inventory often reveals hidden dependencies.

---

## 4. Find Call Sites

Search:

```bash
grep -R "deploy.sh" .
```

Also check:

- CI YAML;
- Makefile;
- documentation;
- README;
- runbooks;
- cron jobs;
- Jenkins jobs;
- Dockerfiles;
- other scripts;
- internal wiki;
- shell history if desperate;
- release checklist.

For PowerShell:

```powershell
Select-String -Path .\**\* -Pattern 'Deploy.ps1'
```

Do not assume script is unused because Git search finds nothing. It may be called by external CI config or manual process.

---

## 5. Characterize Current Behavior

Before refactor, capture behavior.

Run:

```bash
./script.sh --help
./script.sh invalid
./script.sh happy-path
```

Record:

- exit code;
- stdout;
- stderr;
- files created;
- external commands called;
- environment variables read;
- current directory assumptions.

You are creating characterization tests:

> Tests that describe current behavior, even if behavior is ugly.

This prevents accidental breakage.

---

## 6. Add a Safety Harness

For risky scripts, do not run real side effects during characterization.

Techniques:

1. Fake commands earlier in PATH.
2. Dry-run mode if exists.
3. Run in temp directory.
4. Use test namespace/environment.
5. Stub network endpoint.
6. Use container sandbox.
7. Use `make -n`.
8. Add wrapper that logs commands.

Fake command example:

```bash
tmpbin="$(mktemp -d)"
PATH="$tmpbin:$PATH"

cat > "$tmpbin/kubectl" <<'SH'
#!/usr/bin/env sh
echo "FAKE kubectl $@" >&2
exit 0
SH
chmod +x "$tmpbin/kubectl"

PATH="$tmpbin:$PATH" ./deploy.sh --env staging --version 1.2.3
```

This lets you see what would be called.

---

## 7. Characterization Test for Bash Script

Simple test harness:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

fail() { echo "FAIL: $*" >&2; exit 1; }

run() {
  local name="$1"; shift
  echo "==> $name"
  "$@"
}

run "help exits 0" bash -c './scripts/deploy.sh --help >/tmp/out 2>/tmp/err'
```

Better use Bats if available.

Plain Bash test for exit code:

```bash
set +e
./scripts/deploy.sh --help >out.txt 2>err.txt
status=$?
set -e

[[ "$status" -eq 0 ]] || fail "expected 0 got $status"
grep -q "Usage" out.txt || fail "expected Usage in stdout"
```

Start small.

---

## 8. Characterization Test for PowerShell Script

Pester style:

```powershell
Describe 'Deploy.ps1' {
  It 'prints help' {
    $result = pwsh -NoProfile -File ./scripts/Deploy.ps1 -Help
    $LASTEXITCODE | Should -Be 0
  }
}
```

For function-level tests, import module/script if designed for it.

Legacy `.ps1` may not be sourceable safely if it runs immediately. First refactor may be adding a main guard pattern.

---

## 9. Golden Output vs Contract Assertions

Golden output:

```text
Compare entire stdout to expected file.
```

Pros:

- easy;
- captures behavior.

Cons:

- brittle;
- breaks on harmless formatting.

Contract assertions:

```text
Exit code is 2.
stderr contains "ENV is required".
No kubectl command called.
```

Better for scripts.

For machine JSON output, canonicalize:

```bash
jq -S . actual.json > actual.sorted.json
jq -S . expected.json > expected.sorted.json
diff -u expected.sorted.json actual.sorted.json
```

---

## 10. Risk Ranking

Rank scripts:

### Low risk

- local helper;
- read-only;
- no secrets;
- no production.

### Medium risk

- CI verification;
- artifact build;
- Docker build;
- local cleanup.

### High risk

- deploy;
- publish artifacts;
- database migration;
- delete/cleanup shared resources;
- secret handling;
- production ops.

High-risk scripts need more incremental changes.

---

## 11. Stabilize Interface Before Internals

Do not refactor internals first if interface unclear.

Define:

```text
Usage:
Inputs:
Outputs:
Exit codes:
Side effects:
Compatibility:
```

Add `--help`.

Bash:

```bash
usage() {
  cat <<'USAGE'
Usage:
  deploy.sh --env ENV --version VERSION --plan
  deploy.sh --env ENV --version VERSION --apply
USAGE
}
```

PowerShell comment help:

```powershell
<#
.SYNOPSIS
Deploys a release.
#>
```

Make help:

```make
help:
	@echo "deploy/plan ENV=staging VERSION=1.2.3"
```

---

## 12. Add Logging Without Changing Behavior Too Much

Legacy scripts often fail silently.

Add minimal logs to stderr:

```bash
log() { printf '==> %s\n' "$*" >&2; }
```

Use:

```bash
log "Validating inputs"
log "Deploying service=$SERVICE env=$ENV version=$VERSION"
```

Do not print secrets.

PowerShell:

```powershell
Write-Information "Validating inputs" -InformationAction Continue
```

For strict machine stdout, logs must go stderr/information stream appropriately.

---

## 13. Add Preflight

Before dangerous action, check tools/config.

Bash:

```bash
require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

require_command kubectl
require_command jq
```

PowerShell:

```powershell
function Require-Command {
  param([string] $Name)
  if ($null -eq (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}
```

Preflight reduces mid-script surprises.

---

## 14. Add Dry-Run or Plan Mode

For risky scripts, add non-mutating mode.

Legacy:

```bash
./deploy.sh staging 1.2.3
```

Add:

```bash
./deploy.sh --env staging --version 1.2.3 --plan
./deploy.sh --env staging --version 1.2.3 --apply
```

Preserve old interface temporarily:

```bash
if [[ $# -eq 2 ]]; then
  warn "Deprecated usage. Use --env and --version."
  ENV="$1"
  VERSION="$2"
  MODE="apply"
fi
```

But be careful: default apply for old interface may be necessary for compatibility. Deprecate with timeline.

---

## 15. Add Strict Mode Gradually

Bash strict mode:

```bash
set -Eeuo pipefail
```

Adding all at once can break legacy scripts because:

- unset variables;
- expected non-zero commands;
- pipelines;
- word splitting;
- traps.

Incremental approach:

1. Add `set -E`.
2. Quote variables.
3. Fix expected non-zero cases.
4. Add `set -u`.
5. Add `pipefail`.
6. Add tests.
7. Add `set -e` carefully.

Or add strict mode in new extracted functions/scripts first.

PowerShell:

```powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
```

Also can break assumptions. Add with tests.

---

## 16. Quote Variables Before Behavior Changes

Legacy Bash often has:

```bash
rm -rf $DIR
cp $SRC $DST
for f in $(ls *.jar); do ...
```

Before adding strict mode, fix obvious quoting:

```bash
rm -rf -- "$DIR"
cp -- "$SRC" "$DST"
```

But be careful: quoting can change behavior if script relied on word splitting.

Characterization tests help.

---

## 17. Extract Functions

From:

```bash
# 300 lines top-level
```

To:

```bash
parse_args "$@"
validate_inputs
preflight
plan
apply
main "$@"
```

Bash:

```bash
main() {
  parse_args "$@"
  validate_inputs
  preflight
  if [[ "$MODE" == "plan" ]]; then
    plan
  else
    apply
  fi
}

main "$@"
```

PowerShell:

```powershell
function Invoke-Main {
  param(...)
}

Invoke-Main @PSBoundParameters
```

Functions make testing easier.

---

## 18. Separate Pure Logic from Side Effects

Pure-ish:

```bash
validate_env
build_payload
compute_image_ref
```

Side effects:

```bash
kubectl apply
docker push
curl POST
rm -rf
```

Test pure logic easily.

Wrap side effects:

```bash
run_kubectl() {
  kubectl "$@"
}
```

Then tests can fake `kubectl`.

---

## 19. Introduce Command Wrappers

Bash:

```bash
run() {
  log "+ $*"
  "$@"
}
```

But logging `$*` can be misleading/unsafe with spaces/secrets. Use carefully.

For native command with exit:

```bash
kubectl_apply() {
  kubectl apply -f "$1"
}
```

PowerShell:

```powershell
function Invoke-NativeChecked {
  param([string] $FilePath, [string[]] $ArgumentList)
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE"
  }
}
```

Command wrappers centralize error handling.

---

## 20. Replace Positional Args with Flags

Legacy:

```bash
./deploy.sh prod 1.2.3
```

Problems:

- ambiguous;
- hard to extend;
- no self-documentation.

New:

```bash
./deploy.sh --env prod --version 1.2.3 --apply
```

Migration:

```bash
if [[ $# -eq 2 && "$1" != --* ]]; then
  warn "Deprecated positional args; use --env and --version"
  ENV="$1"
  VERSION="$2"
  MODE="apply"
else
  parse_flags "$@"
fi
```

Set deprecation date.

---

## 21. Preserve Backward Compatibility with Wrapper

Instead of changing old script directly:

```text
deploy.sh        old interface wrapper
deploy-v2.sh     new implementation
```

`deploy.sh`:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

echo "WARNING: deploy.sh is deprecated; use deploy-v2.sh" >&2

if [[ $# -eq 2 ]]; then
  exec ./scripts/deploy-v2.sh --env "$1" --version "$2" --apply
fi

exec ./scripts/deploy-v2.sh "$@"
```

This allows migration without breaking all callers.

---

## 22. Strangler Fig Pattern

For big legacy script:

1. Leave old script as entrypoint.
2. Extract one behavior to new script/function.
3. Old script calls new implementation for that path.
4. Add tests.
5. Repeat.
6. Eventually old script is thin wrapper.
7. Deprecate/remove old script.

This avoids risky rewrite.

Example:

```text
legacy-release.sh
  -> calls new build-metadata.ps1
  -> calls new docker-build.sh
  -> calls new deploy-release.sh
```

---

## 23. Move Complex Data Logic Out

Legacy Bash parsing JSON:

```bash
VERSION=$(grep version package.json | cut -d'"' -f4)
```

Refactor:

- use `jq`;
- or PowerShell JSON script;
- or Java/Python CLI.

Small fix:

```bash
VERSION="$(jq -r '.version' package.json)"
```

Better for structured metadata:

```bash
metadata="$(pwsh -NoProfile -File ./scripts/Build-Metadata.ps1 -Output Json)"
VERSION="$(jq -r '.version' <<<"$metadata")"
```

Use correct parser.

---

## 24. Move Business Logic to Real Code

If script contains domain rules:

```bash
if premium customer and region is EU and feature flag...
```

move to application/tooling code.

Scripts should orchestrate. Domain logic belongs in typed/tested code.

For Java team:

```bash
java -jar internal-tool.jar validate-release --config release.json
```

Then script/Make calls tool.

---

## 25. Replace Hidden Globals with Parameters

Legacy:

```bash
ENV=prod
SERVICE=payment
```

inside script.

Refactor:

```bash
--env
--service
```

with safe defaults only for safe workflows.

PowerShell params:

```powershell
param(
  [ValidateSet('dev','staging','prod')]
  [string] $Environment
)
```

Make variables pass to script.

---

## 26. Remove Ambient Context Assumptions

Legacy:

```bash
kubectl apply -f k8s/prod.yaml
```

without context validation.

Refactor:

```bash
validate_kube_context "$ENV"
kubectl apply -f "k8s/$ENV.yaml"
```

Also validate:

- AWS/GCP/Azure account;
- Docker registry login;
- Git branch/ref;
- current directory;
- tool versions.

---

## 27. Add Secret Safety

Legacy:

```bash
set -x
curl -H "Authorization: Bearer $TOKEN" ...
```

Refactor:

- disable xtrace around secrets;
- avoid CLI args for secrets;
- do not echo payloads with secrets;
- redact logs;
- read token from env/secret file;
- validate presence without printing.

Example:

```bash
: "${DEPLOY_TOKEN:?DEPLOY_TOKEN is required}"
curl -H "Authorization: Bearer ${DEPLOY_TOKEN}" ...
```

No `set -x`.

---

## 28. Replace `eval`

Legacy:

```bash
cmd="kubectl apply -f $file"
eval "$cmd"
```

Refactor:

```bash
kubectl apply -f "$file"
```

If dynamic args:

```bash
args=(apply -f "$file")
kubectl "${args[@]}"
```

PowerShell:

```powershell
& kubectl @argsList
```

Never use eval/Invoke-Expression unless there is no alternative and input is trusted/controlled.

---

## 29. Refactor Unsafe File Operations

Legacy:

```bash
rm -rf $BUILD_DIR/*
```

Refactor:

```bash
[[ -n "${BUILD_DIR:-}" ]] || die "BUILD_DIR required"
[[ "$BUILD_DIR" == "$REPO_ROOT/build"* ]] || die "Refusing unsafe BUILD_DIR: $BUILD_DIR"
rm -rf -- "$BUILD_DIR"
```

Better:

```bash
./scripts/clean.sh --target build --apply
```

Destructive scripts need scope guards.

---

## 30. Add Output Modes

Legacy script prints human text only.

Add:

```text
--output text
--output json
```

or separate:

```text
script emits JSON on stdout; logs on stderr
```

For CI integration, JSON output is valuable.

PowerShell can output object/JSON. Bash can use jq.

---

## 31. Add Machine-Readable Result

Deployment result:

```json
{
  "status": "success",
  "environment": "staging",
  "version": "1.2.3",
  "durationSeconds": 45
}
```

Diagnostics result:

```json
{
  "status": "partial",
  "bundle": "build/diagnostics/..."
}
```

This improves pipeline integration and audit.

---

## 32. Split Script by Responsibility

Legacy:

```text
ci.sh does lint, test, build, docker, deploy, cleanup
```

Refactor:

```text
scripts/ci-verify.sh
scripts/build-image.sh
scripts/publish-image.sh
scripts/deploy-release.sh
scripts/clean.sh
```

Make facade:

```make
ci/verify:
	./scripts/ci-verify.sh

docker/build:
	./scripts/build-image.sh

deploy/apply:
	./scripts/deploy-release.sh --apply
```

Small scripts are easier to test/review.

---

## 33. Refactor Makefile

Legacy Makefile symptoms:

- no `.PHONY`;
- default target deploys/builds unexpectedly;
- 500 lines;
- complex shell recipes;
- secrets;
- hidden includes;
- no help;
- duplicated Maven/Gradle logic.

Refactor steps:

1. Set `.DEFAULT_GOAL := help`.
2. Add `.PHONY`.
3. Add `help`.
4. Move long recipes to scripts.
5. Document variables.
6. Add `print-%`.
7. Split includes only if needed.
8. Remove secrets.
9. Add `ci/*`, `deploy/plan`, `deploy/apply`.
10. Keep Make facade boring.

---

## 34. Refactor PowerShell Script to Module

Legacy:

```text
Deploy.ps1 with many helper functions and side effects.
```

Refactor:

```text
modules/Company.Deploy/
  Public/
    New-DeploymentPlan.ps1
    Invoke-Deployment.ps1
  Private/
    Invoke-NativeChecked.ps1
scripts/
  Deploy.ps1
```

Script becomes thin CLI.

Module functions become testable with Pester.

Do this when reuse/complexity justifies it.

---

## 35. Deprecation Strategy

When changing interface:

1. Add new interface.
2. Keep old interface wrapper.
3. Print warning to stderr.
4. Update docs/CI/Make.
5. Track usage.
6. Set removal date.
7. Remove after migration.

Example warning:

```text
WARNING: positional arguments are deprecated and will be removed after 2026-09-01.
Use: deploy.sh --env staging --version 1.2.3 --apply
```

Do not break users silently.

---

## 36. Migration Checklist

For each caller:

- old command;
- new command;
- owner;
- status;
- migration PR;
- validation run;
- rollback plan.

Example:

| Caller | Old | New | Status |
|---|---|---|---|
| Makefile deploy/apply | `deploy.sh prod 1.2.3` | `deploy-v2.sh --env prod --version 1.2.3 --apply` | done |
| GitHub deploy.yml | old | new | pending |
| Runbook | old docs | new docs | pending |

---

## 37. Observability During Refactor

Add logs that help compare old/new.

For dual run in safe mode:

```bash
old_output="$(./legacy.sh --plan ...)"
new_output="$(./new.sh --plan ...)"
diff ...
```

For production-risky operations, compare plan only, not apply.

Store results as CI artifacts.

---

## 38. Parallel Run / Shadow Mode

For read-only or plan operations:

```text
Run old and new implementation.
Compare output.
Do not apply new yet.
```

Example:

```bash
./legacy-deploy.sh --plan > old-plan.json
./deploy-v2.sh --plan > new-plan.json
diff <(jq -S . old-plan.json) <(jq -S . new-plan.json)
```

This builds confidence.

---

## 39. Kill Switch

For risky migration, provide fallback.

Make:

```make
USE_LEGACY_DEPLOY ?= false

deploy/apply:
ifeq ($(USE_LEGACY_DEPLOY),true)
	./scripts/legacy-deploy.sh "$(ENV)" "$(VERSION)"
else
	./scripts/deploy-v2.sh --env "$(ENV)" --version "$(VERSION)" --apply
endif
```

Use temporarily. Remove once migration complete.

Do not keep dual paths forever.

---

## 40. Documentation Update

Refactor is incomplete until docs updated:

- README;
- `make help`;
- script `--help`;
- runbooks;
- CI docs;
- onboarding;
- troubleshooting;
- deprecation notes.

Legacy scripts often survive because docs still point to them.

---

## 41. Code Review Strategy

Review legacy refactor in small PRs:

1. Add tests only.
2. Add help/docs.
3. Add logging/preflight.
4. Extract functions.
5. Add new wrapper.
6. Migrate one caller.
7. Remove old path.

Avoid giant rewrite PR.

Reviewers need to see behavior preservation.

---

## 42. When to Rewrite

Rewrite is justified when:

- script is small and well understood;
- behavior contract is clear;
- tests or safety harness exist;
- old script is beyond repair;
- new tool/substrate is clearly better;
- rollback path exists.

Rewrite is risky when:

- production deploy;
- unknown callers;
- no tests;
- complex edge cases;
- unclear ownership;
- hidden secrets/state.

Prefer strangler pattern for high-risk scripts.

---

## 43. Legacy Script Risk Smells

- no `set -e` or error checking;
- unquoted variables;
- `eval`;
- `rm -rf $VAR`;
- default prod;
- secrets in file;
- parsing JSON with grep;
- no `--help`;
- positional args only;
- no tests;
- CI YAML inline logic;
- hidden current directory assumptions;
- `kubectl` without context validation;
- `curl | bash`;
- swallowing errors with `|| true`;
- hardcoded paths/users;
- old PowerShell Windows-only assumptions.

Treat these as refactoring targets.

---

## 44. Prioritization

Do not refactor everything at once.

Prioritize by:

1. risk;
2. frequency;
3. pain;
4. upcoming changes;
5. security exposure;
6. CI flakiness;
7. ownership.

High-risk + high-change scripts should be stabilized first.

Low-risk rarely used scripts can wait.

---

## 45. Example Refactor Plan: Legacy Deploy

### Current

```bash
deploy.sh prod 1.2.3
```

Problems:

- positional args;
- default context;
- no plan;
- no health check;
- no tests;
- no artifact identity;
- logs secrets.

### Plan

1. Inventory call sites.
2. Add characterization tests with fake kubectl/curl.
3. Add `--help`.
4. Add wrapper preserving old positional usage.
5. Create `deploy-v2.sh --env --version --plan/--apply`.
6. Add context validation.
7. Add no-secret logging.
8. Add health check.
9. Make `deploy/plan` and `deploy/apply` call v2.
10. Update CI.
11. Run plan in shadow mode.
12. Deprecate old usage.
13. Remove old after migration.

---

## 46. Example Refactor: CI YAML Inline Script

Current:

```yaml
- run: |
    set -e
    ./mvnw test
    docker build ...
    docker push ...
    kubectl apply ...
```

Refactor:

```make
ci/verify:
	./scripts/ci-verify.sh

docker/build:
	./scripts/build-image.sh

deploy/apply:
	./scripts/deploy-release.sh --env "$(ENV)" --image "$(IMAGE)" --apply
```

CI:

```yaml
- run: make ci/verify
- run: make docker/build IMAGE=...
- run: make deploy/apply ENV=staging IMAGE=...
```

CI still owns secrets/permissions.

---

## 47. Example Refactor: PowerShell Admin Script

Current:

```powershell
# giant script with functions and immediate execution
```

Refactor:

1. Add param block.
2. Add strict mode.
3. Move reusable functions to module.
4. Add Pester tests.
5. Script imports module and calls one public function.
6. Add comment-based help.
7. Add `-WhatIf` for destructive actions.
8. Add `SupportsShouldProcess`.

---

## 48. Review Checklist

### Discovery

- All call sites known?
- Owner identified?
- Risk classified?
- Runtime documented?

### Safety

- Tests/harness before change?
- Dangerous operations guarded?
- Secrets removed from logs?
- Context validated?
- Dry-run/plan added?

### Interface

- Help added?
- Flags documented?
- Backward compatibility preserved or deprecation plan?
- Exit codes understood?
- stdout/stderr contract clear?

### Internals

- Functions extracted?
- Side effects isolated?
- Strictness added safely?
- Eval removed?
- JSON parsed properly?

### Migration

- Callers migrated?
- Docs updated?
- Old path deprecated?
- Fallback defined?
- Removal date set?

---

## 49. Mini Lab

### Lab 1 — Inventory

Pick a script and fill inventory table.

### Lab 2 — Fake Command Harness

Create fake `kubectl` in temp PATH and run deploy script safely.

### Lab 3 — Add `--help`

Add usage output without changing core behavior.

### Lab 4 — Add Characterization Test

Assert exit code and output for `--help` and invalid args.

### Lab 5 — Wrapper Migration

Create `script-v2.sh` and make old `script.sh` delegate with warning.

---

## 50. Design Exercise: Refactor Legacy Release Script

Given a script that:

```text
builds jar
builds Docker image
pushes image
deploys Kubernetes
runs no health check
uses positional args
logs token
```

Design refactor:

- target architecture;
- new scripts;
- Make targets;
- CI changes;
- tests;
- migration steps;
- deprecation plan;
- rollback/fallback;
- risk mitigation.

---

## 51. Part 028 Summary

Legacy script refactoring is risk management, not beautification.

Key takeaways:

1. Treat important scripts as production code.
2. Inventory before changing.
3. Find all call sites.
4. Characterize current behavior.
5. Use safety harnesses and fake commands.
6. Add help, logging, and preflight early.
7. Add tests before deep refactor.
8. Introduce strict mode gradually.
9. Extract functions and isolate side effects.
10. Replace positional args with flags carefully.
11. Preserve compatibility through wrappers.
12. Use strangler pattern for high-risk scripts.
13. Move structured parsing/business logic to better tools.
14. Remove `eval`, unsafe file operations, and secret logging.
15. Migrate callers gradually and document deprecation.
16. Avoid giant rewrites unless risk is low and contract is clear.

Part 029 will be the capstone: building a production-grade automation toolkit for a Java service.

---

## 52. Referensi Resmi dan Bacaan Lanjutan

- Martin Fowler: Strangler Fig Application pattern.
- Michael Feathers: characterization tests concept.
- ShellCheck documentation.
- Bats testing framework.
- Pester testing framework.
- PSScriptAnalyzer.
- GNU Make manual for refactoring Makefiles.
- Secure scripting practices for shell and PowerShell.
- Release engineering and CI/CD migration best practices.
- Internal developer platform practices for standardizing scripts.

---

## 53. Status Seri

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
- [x] Part 026 — Operational Scripts: Diagnostics, Runbooks, Incident Tools
- [x] Part 027 — Advanced Bash and PowerShell Interop
- [x] Part 028 — Refactoring Legacy Scripts
- [ ] Part 029 — Capstone: Production-Grade Automation Toolkit for a Java Service


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-027.md">⬅️ Part 027 — Advanced Bash and PowerShell Interop</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-029.md">Part 029 — Capstone: Production-Grade Automation Toolkit for a Java Service ➡️</a>
</div>
