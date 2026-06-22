# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-005.md

# Part 005 — Error Handling in Bash: Fail Fast, Fail Clear, Fail Safe

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: membangun error handling Bash yang predictable, eksplisit, aman, dan berguna untuk CI, deployment, local automation, dan operational scripts.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya:

- Part 001: shell sebagai process orchestrator.
- Part 002: parsing, expansion, quoting.
- Part 003: POSIX shell baseline.
- Part 004: Bash fundamentals dan script structure.

Part 005 membahas masalah yang menentukan apakah script bisa dipercaya:

> Apa yang terjadi saat command gagal?

Bash error handling sering disederhanakan menjadi:

```bash
set -euo pipefail
```

Ini bagus sebagai baseline, tetapi tidak cukup.

`set -euo pipefail` tidak otomatis membuat script aman. Ia tidak memahami domain kamu. Ia tidak tahu apakah `grep` exit 1 berarti error atau “tidak ditemukan”. Ia tidak tahu apakah upload artifact sukses sebagian. Ia tidak tahu apakah retry aman. Ia tidak tahu apakah cleanup boleh menghapus path tertentu.

Error handling yang baik harus menjawab:

- failure apa yang mungkin terjadi?
- mana expected dan mana unexpected?
- mana yang boleh di-retry?
- mana yang harus fail fast?
- apa exit code yang diberikan?
- apa pesan error yang membantu?
- apakah cleanup selalu aman?
- apakah partial side effect bisa ditangani?
- apakah pipeline menyembunyikan failure?
- apakah script tetap aman saat diinterupsi?
- apakah CI/operator bisa memahami failure tanpa membaca source?

---

## 1. Filosofi Error Handling Bash

Bash script bukan Java application dengan exception hierarchy, stack trace, type system, dan structured logger.

Bash script beroperasi dengan:

- exit status;
- stdout;
- stderr;
- signal;
- file system state;
- command side effects;
- environment;
- trap;
- shell options;
- convention.

Karena itu error handling Bash harus lebih eksplisit.

Prinsip utama:

1. **Fail fast** untuk precondition yang salah.
2. **Fail clear** dengan pesan yang actionable.
3. **Fail safe** sebelum side effect berbahaya.
4. **Preserve exit status** saat cleanup/logging.
5. **Separate expected negative result from real error.**
6. **Do not hide failure with `|| true` unless intentional.**
7. **Use retry only for retryable operations.**
8. **Use timeout for operations that may hang.**
9. **Keep stdout clean if script returns data.**
10. **Design idempotency before adding retries.**

---

## 2. Failure Taxonomy

Sebelum menulis code, klasifikasikan failure.

| Failure Type | Contoh | Response |
|---|---|---|
| Usage error | argumen salah, option tidak dikenal | exit 2, print usage |
| Missing dependency | `mvn` tidak ada | fail fast |
| Invalid config | env tidak valid, token kosong | fail fast |
| Expected negative result | `grep` no match | handle explicitly |
| External command failure | `mvn test` gagal | propagate/fail clear |
| Network transient | timeout API, 503 | retry with limit |
| Non-retryable remote error | 401/403/400 | fail clear, no retry |
| Partial side effect | artifact uploaded tapi metadata gagal | reconcile/rollback/manual instruction |
| Destructive safety violation | target path suspicious | refuse |
| Interruption | Ctrl+C/SIGTERM | cleanup, exit meaningful |
| Internal bug | unexpected branch | fail with diagnostic |

Bash tidak akan membedakan semua ini untukmu. Script harus mendesainnya.

---

## 3. Exit Code sebagai Contract

Konvensi umum:

- `0`: success
- `1`: generic failure
- `2`: usage/config error
- `126`: command found but not executable
- `127`: command not found
- `130`: interrupted by Ctrl+C/SIGINT

Untuk internal scripts, taxonomy sederhana bisa membantu:

```text
0   success
1   generic operation failure
2   invalid usage or invalid input
10  missing dependency
20  validation failure
30  external command failure
40  network/remote operation failure
50  safety guard violation
130 interrupted
```

Jangan terlalu banyak exit code jika tidak ada consumer yang menggunakannya.

Pattern:

```bash
readonly EXIT_USAGE=2
readonly EXIT_MISSING_DEP=10
readonly EXIT_VALIDATION=20
readonly EXIT_OPERATION=30
readonly EXIT_SAFETY=50
```

Use:

```bash
die_usage() {
  usage
  printf 'ERROR: %s\n' "$*" >&2
  exit "$EXIT_USAGE"
}
```

Tetapi untuk banyak script kecil, cukup:

```bash
exit 2
exit 1
```

Yang penting: konsisten.

---

## 4. Baseline Helpers

Template:

```bash
log() {
  printf '%s\n' "$*" >&2
}

warn() {
  printf 'WARN: %s\n' "$*" >&2
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

die_with_code() {
  local code="$1"
  shift
  printf 'ERROR: %s\n' "$*" >&2
  exit "$code"
}
```

Usage-specific:

```bash
usage() {
  cat >&2 <<'EOF'
Usage:
  deploy.sh --env <staging|prod> --version <x.y.z>
EOF
}

usage_error() {
  usage
  printf 'ERROR: %s\n' "$*" >&2
  exit 2
}
```

Dependency:

```bash
require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || {
    printf 'ERROR: required command not found: %s\n' "$cmd" >&2
    exit 127
  }
}
```

Required env:

```bash
require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    printf 'ERROR: required environment variable is not set: %s\n' "$name" >&2
    exit 2
  fi
}
```

Use:

```bash
require_env API_TOKEN
require_env API_URL
```

Do not print secret values.

---

## 5. `set -e`: Useful, but Misunderstood

`set -e` means Bash exits when a simple command fails, except in contexts where failure is being tested or controlled.

Example:

```bash
set -e
false
echo "never printed"
```

But:

```bash
set -e
if false; then
  echo "not printed"
fi
echo "still printed"
```

Because command failure in `if` condition is expected.

Also:

```bash
set -e
false || echo "handled"
echo "still printed"
```

Because failure before `||` is handled.

This is good. But it means `set -e` is not a replacement for thinking.

---

## 6. The `grep` Problem: Non-Zero Does Not Always Mean Fatal

`grep` exit statuses:

- `0`: match found
- `1`: no match
- `2`: error

Bad:

```bash
set -e
grep -q "ERROR" app.log
echo "no errors"
```

If no match, `grep` exits 1 and script stops. But “no match” may be success.

Better:

```bash
if grep -q "ERROR" app.log; then
  log "error found"
else
  status=$?
  if ((status == 1)); then
    log "no error found"
  else
    die "grep failed with status $status"
  fi
fi
```

For many commands, you must know their exit semantics.

Examples:

- `grep`: no match is 1.
- `diff`: files differ is 1, error is >1.
- `test`/`[` false condition is 1.
- `curl --fail`: HTTP 400/500 may become non-zero.
- `timeout`: timeout usually distinct code.
- `rsync`: exit codes are detailed and meaningful.

Top-level rule:

> Treat exit codes as API, not generic boolean.

---

## 7. `set -u`: Good for Typos, Needs Defaults

With:

```bash
set -u
```

This fails:

```bash
echo "$OPTIONAL"
```

If `OPTIONAL` is unset.

Use:

```bash
echo "${OPTIONAL:-}"
```

Required:

```bash
: "${APP_ENV:?APP_ENV is required}"
```

Array caveat:

```bash
args=()
printf '%s\n' "${args[@]}"
```

Usually okay.

But references like:

```bash
echo "${args[0]}"
```

fail if unset. Use guard:

```bash
if ((${#args[@]} > 0)); then
  echo "${args[0]}"
fi
```

`set -u` catches typos:

```bash
deploy_env="$APP_ENV"
echo "$deply_env"  # typo, fails
```

Good.

---

## 8. `pipefail`: Necessary for Pipeline Correctness

Without:

```bash
set -e
false | true
echo "still success"
```

With:

```bash
set -euo pipefail
false | true
echo "not printed"
```

Use:

```bash
set -o pipefail
```

to make pipeline status reflect failures in any segment.

But be careful with commands that can close pipe early.

Example:

```bash
some_large_output | head -n 1
```

The left command may receive SIGPIPE because `head` exits after one line. With `pipefail`, pipeline may be considered failure depending on command behavior.

So do not blindly pipefail every display pipeline if SIGPIPE is normal. But for CI/build/deploy scripts, `pipefail` is usually the better default.

---

## 9. `ERR` Trap: Powerful but Easy to Misuse

Bash supports:

```bash
trap 'echo "error on line $LINENO" >&2' ERR
```

Better:

```bash
on_error() {
  local status=$?
  local line=${BASH_LINENO[0]:-unknown}
  local command=${BASH_COMMAND:-unknown}
  printf 'ERROR: command failed with status %s at line %s: %s\n' "$status" "$line" "$command" >&2
  exit "$status"
}

trap on_error ERR
```

But nuances:

- `ERR` trap is not always inherited into functions/subshells unless `set -E`/`errtrace`.
- `BASH_COMMAND` can be misleading in compound commands.
- Error traps can make control flow harder to reason about.
- Logging command may leak secrets.
- If trap runs commands that fail, it can cascade.

Enable inheritance:

```bash
set -Eeuo pipefail
```

`-E` means ERR trap is inherited by shell functions, command substitutions, and subshells in many relevant contexts.

Use `ERR` trap primarily for diagnostics, not as your only error handling strategy.

---

## 10. Recommended Baseline for Serious Bash Script

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

on_error() {
  local status=$?
  local line=${BASH_LINENO[0]:-unknown}
  printf 'ERROR: failed with status %s near line %s\n' "$status" "$line" >&2
  exit "$status"
}

trap on_error ERR
```

However, this can be too much for small scripts or scripts handling expected non-zero statuses frequently.

An alternative conservative baseline:

```bash
#!/usr/bin/env bash
set -euo pipefail
```

and explicit `die` checks.

Use `ERR` trap when:

- script is large enough that line diagnostics help;
- CI failure should indicate location;
- you avoid printing secrets;
- you understand expected non-zero cases.

---

## 11. Preserving Exit Status in Cleanup

Common bug:

```bash
cleanup() {
  rm -rf "$tmp_dir"
  echo "cleaned up"
}

trap cleanup EXIT
```

If `rm` or `echo` changes status, final exit code may be affected depending structure.

Better:

```bash
cleanup() {
  local status=$?

  if [[ -n "${tmp_dir:-}" && -d "$tmp_dir" ]]; then
    rm -rf -- "$tmp_dir" || true
  fi

  exit "$status"
}

trap cleanup EXIT
```

But note: calling `exit` inside `EXIT` trap can be okay if carefully done, but it can also confuse flow. Pattern:

```bash
on_exit() {
  local status=$?

  if [[ -n "${tmp_dir:-}" && -d "$tmp_dir" ]]; then
    rm -rf -- "$tmp_dir" || {
      printf 'WARN: failed to remove tmp_dir: %s\n' "$tmp_dir" >&2
    }
  fi

  return "$status"
}

trap on_exit EXIT
```

For `EXIT` trap, returning status generally preserves status. But explicit `exit "$status"` is also common. Be consistent.

Important:

> Cleanup should not hide the original failure.

---

## 12. Cleanup Must Be Safe and Idempotent

Bad:

```bash
cleanup() {
  rm -rf "$tmp_dir"
}
```

If `tmp_dir` empty due to bug:

```bash
rm -rf ""
```

usually harmless, but variants can be dangerous if path construction is wrong.

Better:

```bash
cleanup() {
  if [[ -n "${tmp_dir:-}" && -d "$tmp_dir" ]]; then
    case "$tmp_dir" in
      /tmp/*)
        rm -rf -- "$tmp_dir"
        ;;
      *)
        warn "refusing to remove suspicious tmp_dir: $tmp_dir"
        ;;
    esac
  fi
}
```

Cleanup should be:

- safe if called multiple times;
- safe if setup partially failed;
- not dependent on unset variables;
- cautious with destructive operations;
- not leaking secrets;
- not masking original error.

---

## 13. Expected Failure Should Be Explicit

Instead of:

```bash
command || true
```

Prefer:

```bash
if ! command; then
  log "command failed but this is acceptable because ..."
fi
```

Or capture status:

```bash
set +e
command
status=$?
set -e

case "$status" in
  0)
    log "success"
    ;;
  1)
    log "expected negative result"
    ;;
  *)
    die "command failed unexpectedly with status $status"
    ;;
esac
```

But toggling `set +e` / `set -e` can become messy. Often better:

```bash
if command; then
  ...
else
  status=$?
  ...
fi
```

Commands in `if` condition are exempt from `errexit`, which is intended.

---

## 14. Avoid Blind `|| true`

Bad:

```bash
rm -rf "$tmp_dir" || true
curl "$url" || true
mvn test || true
```

`|| true` says: failure does not matter.

Sometimes correct:

```bash
docker rm "$container_name" >/dev/null 2>&1 || true
```

If removing a non-existent cleanup container is acceptable.

But prefer clarity:

```bash
if docker rm "$container_name" >/dev/null 2>&1; then
  log "removed container: $container_name"
else
  warn "container not removed or did not exist: $container_name"
fi
```

For cleanup code, `|| true` can be acceptable if failure is not critical and warning is not needed. For build/test/deploy, it is usually wrong.

---

## 15. Timeout: Prevent Hanging Scripts

Some commands can hang:

- network calls;
- waiting for service;
- docker operations;
- tests with deadlock;
- API calls;
- SSH;
- package downloads.

Use `timeout` where available:

```bash
timeout 60s curl --fail --silent --show-error "$url"
```

Caveat:

- GNU `timeout` may not exist on macOS by default;
- BusyBox timeout behavior/options may differ.

For Linux CI, acceptable if dependency is known.

Helper:

```bash
run_with_timeout() {
  local seconds="$1"
  shift

  require_cmd timeout
  timeout "$seconds" "$@"
}
```

Usage:

```bash
run_with_timeout 120s mvn test
```

If portability matters, consider tool-specific timeouts:

```bash
curl --connect-timeout 5 --max-time 30 ...
```

Maven/Gradle/test frameworks have their own timeout mechanisms.

---

## 16. Retry: Only for Safe, Retryable Operations

Retry is not magic. It can amplify damage.

Retryable:

- transient network timeout;
- HTTP 502/503/504;
- package download failure;
- temporary DNS resolution;
- eventually consistent read.

Usually not retryable:

- invalid credentials;
- invalid input;
- compile error;
- test failure;
- schema migration failure without idempotency;
- deploy command that may partially apply state;
- payment/side-effect API without idempotency key.

Generic retry helper:

```bash
retry() {
  local attempts="$1"
  local delay_seconds="$2"
  shift 2

  local attempt=1
  local status=0

  while ((attempt <= attempts)); do
    if "$@"; then
      return 0
    fi

    status=$?

    if ((attempt == attempts)); then
      return "$status"
    fi

    warn "attempt $attempt/$attempts failed with status $status; retrying in ${delay_seconds}s"
    sleep "$delay_seconds"
    attempt=$((attempt + 1))
  done
}
```

Usage:

```bash
retry 3 5 curl --fail --silent --show-error "$url"
```

But for HTTP, better inspect status codes when possible.

---

## 17. Retry with Backoff

Simple exponential backoff:

```bash
retry_backoff() {
  local attempts="$1"
  local delay="$2"
  shift 2

  local attempt=1
  local status=0

  while ((attempt <= attempts)); do
    if "$@"; then
      return 0
    fi

    status=$?

    if ((attempt == attempts)); then
      return "$status"
    fi

    warn "attempt $attempt/$attempts failed with status $status; retrying in ${delay}s"
    sleep "$delay"

    delay=$((delay * 2))
    attempt=$((attempt + 1))
  done
}
```

Add max cap if needed:

```bash
if ((delay > 60)); then
  delay=60
fi
```

Be careful with very long CI times.

---

## 18. Retrying `curl` Safely

Curl has retry options:

```bash
curl \
  --fail \
  --show-error \
  --silent \
  --connect-timeout 5 \
  --max-time 30 \
  --retry 3 \
  --retry-delay 2 \
  --retry-all-errors \
  "$url"
```

Caveat:

- retrying POST may be unsafe unless operation is idempotent or has idempotency key;
- `--retry-all-errors` may retry too broadly;
- behavior depends curl version.

For deploy API:

```bash
payload="$(jq -n --arg version "$version" --arg env "$env" '{version:$version, env:$env}')"

curl \
  --fail \
  --show-error \
  --silent \
  --connect-timeout 5 \
  --max-time 30 \
  --header "Idempotency-Key: deploy-$env-$version" \
  --header "Content-Type: application/json" \
  --data "$payload" \
  "$deploy_url"
```

The idempotency key is a service-side contract. Without it, retry may duplicate side effects.

---

## 19. Pipeline Error Handling Patterns

### 19.1 Simple pipeline with pipefail

```bash
set -euo pipefail

generate_report | upload_report
```

Good if both failure statuses are meaningful.

### 19.2 Expected grep no-match

Bad:

```bash
set -euo pipefail
grep "ERROR" app.log | sort
```

If no match, pipeline fails. Maybe desired, maybe not.

Better:

```bash
if grep "ERROR" app.log > errors.tmp; then
  sort errors.tmp
else
  status=$?
  if ((status == 1)); then
    log "no errors found"
  else
    die "grep failed with status $status"
  fi
fi
```

### 19.3 Capture pipeline status with `PIPESTATUS`

Bash provides:

```bash
cmd1 | cmd2 | cmd3
statuses=("${PIPESTATUS[@]}")
```

But with `set -e`, failure may exit before you inspect unless controlled.

Use:

```bash
set +e
cmd1 | cmd2 | cmd3
pipeline_status=$?
statuses=("${PIPESTATUS[@]}")
set -e

printf 'pipeline=%s statuses=%s\n' "$pipeline_status" "${statuses[*]}" >&2
```

This is advanced and easy to get wrong. Prefer simpler structure when possible.

---

## 20. `if` as Error Boundary

A robust pattern:

```bash
if output="$(some_command)"; then
  log "success"
else
  status=$?
  die "some_command failed with status $status"
fi
```

For command output:

```bash
if version="$(git describe --tags --dirty)"; then
  printf '%s\n' "$version"
else
  status=$?
  die "failed to determine version using git describe; status=$status"
fi
```

This avoids accidental `errexit` and gives context.

---

## 21. Contextual Error Messages

Bad:

```bash
mvn test
```

If it fails, CI log says Maven failed, but script context may be unclear.

Better:

```bash
log "Running unit tests"
mvn test
```

Even better around custom command:

```bash
if ! mvn test; then
  die "unit tests failed; run locally with: mvn test"
fi
```

But with `set -e`, `if ! command` is safe.

For commands that print huge logs, context before execution is often enough.

Error message should answer:

- what failed?
- with what input/context?
- what can operator do next?
- where is relevant log/artifact?
- was side effect applied or not?

Example:

```bash
die "deploy request failed for env=$env version=$version; check deploy system logs with correlation id: $deploy_id"
```

Do not include secrets.

---

## 22. Preflight Checks

Fail before side effects.

For deploy:

```bash
preflight() {
  require_cmd curl
  require_cmd jq

  [[ -n "$env" ]] || die "env is required"
  [[ -n "$version" ]] || die "version is required"
  [[ -n "${DEPLOY_TOKEN:-}" ]] || die "DEPLOY_TOKEN is required"

  case "$env" in
    staging|prod) ;;
    *) die "invalid env: $env" ;;
  esac

  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid version: $version"
}
```

Preflight should check:

- required tools;
- required config;
- authentication presence;
- input validation;
- target environment;
- working directory/project markers;
- dry-run mode;
- permissions if possible;
- current branch/tag if relevant;
- clean working tree if required.

Do not start deploy then discover missing token halfway.

---

## 23. Safety Guards for Destructive Operations

Destructive command needs layered guard.

Bad:

```bash
rm -rf "$target"
```

Better:

```bash
[[ -n "$target" ]] || die "target is empty"
[[ -d "$target" ]] || die "target is not a directory: $target"

case "$target" in
  "$project_root"/build|"$project_root"/target|"$project_root"/.gradle)
    ;;
  *)
    die "refusing to remove unexpected target: $target"
    ;;
esac

rm -rf -- "$target"
```

For deploy to prod:

```bash
if [[ "$env" == "prod" && "$yes" != "true" ]]; then
  die "production deploy requires --yes"
fi
```

For branch guard:

```bash
current_branch="$(git branch --show-current)"
if [[ "$env" == "prod" && "$current_branch" != "main" ]]; then
  die "production deploy must run from main; current branch=$current_branch"
fi
```

Be careful: branch checks can be bypassed or not applicable in detached CI checkout. Use as guard, not sole authorization.

---

## 24. Idempotency and Partial Failure

Suppose:

```bash
create_release "$version"
upload_artifact "$version"
publish_release "$version"
```

If `upload_artifact` succeeds but script dies before `publish_release`, retry may see release already exists.

Design options:

1. Make `create_release` idempotent.
2. Check if release exists before creating.
3. Use unique idempotency key.
4. Split plan/apply phases.
5. Write state marker.
6. Provide manual recovery instructions.
7. Use underlying platform transaction if available.
8. Avoid doing multi-step side effects in Bash if correctness critical.

Pattern:

```bash
ensure_release_exists() {
  if release_exists "$version"; then
    log "release already exists: $version"
    return 0
  fi

  create_release "$version"
}
```

But this can still race under concurrent execution. For critical release system, use server-side idempotency/locking.

---

## 25. Plan/Apply Pattern

For risky scripts:

```bash
./deploy.sh --env prod --version 1.2.3 --plan
./deploy.sh --env prod --version 1.2.3 --apply --yes
```

In Bash:

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

Dry-run must be truthful. Do not call something dry-run if it still mutates state.

Better terms:

- `--plan`: show intended actions, no changes.
- `--dry-run`: call underlying tool in dry-run mode if supported.
- `--apply`: perform changes.
- `--yes`: skip human confirmation but still explicit.

---

## 26. Handling Interruptions

Ctrl+C sends SIGINT. CI cancellation may send SIGTERM.

Pattern:

```bash
interrupted=false

on_interrupt() {
  interrupted=true
  printf 'Interrupted; cleaning up...\n' >&2
  exit 130
}

trap on_interrupt INT TERM
```

But if you also have EXIT cleanup:

```bash
cleanup() {
  local status=$?
  # cleanup here
  exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
```

130 is common for SIGINT. 143 is 128+15 for SIGTERM.

If background jobs are started, you need kill/wait cleanup. Covered more in Part 008.

For now:

> Any script that creates temp files, locks, containers, background jobs, or partial state should have interruption cleanup.

---

## 27. Locking to Prevent Concurrent Failure

Some scripts should not run twice concurrently.

Example: release, migration, cleanup.

Simple `flock` pattern on Linux:

```bash
lock_file="${TMPDIR:-/tmp}/my-script.lock"

exec 9>"$lock_file"

if ! flock -n 9; then
  die "another instance is already running"
fi
```

Caveat:

- `flock` may not exist on macOS by default;
- lock semantics depend filesystem;
- NFS can be tricky;
- choose lock scope carefully.

Portable-ish directory lock:

```bash
lock_dir="${TMPDIR:-/tmp}/my-script.lockdir"

if ! mkdir "$lock_dir" 2>/dev/null; then
  die "another instance is already running"
fi

cleanup_lock() {
  rmdir "$lock_dir" 2>/dev/null || true
}

trap cleanup_lock EXIT
```

`mkdir` is atomic on local filesystem. But stale locks after crash need strategy.

---

## 28. Stale Lock Strategy

If using directory lock:

```bash
lock_dir="${TMPDIR:-/tmp}/deploy.lock"

acquire_lock() {
  if mkdir "$lock_dir" 2>/dev/null; then
    printf '%s\n' "$$" > "$lock_dir/pid"
    return 0
  fi

  if [[ -f "$lock_dir/pid" ]]; then
    local pid
    pid="$(cat "$lock_dir/pid" 2>/dev/null || true)"
    warn "lock held by pid: ${pid:-unknown}"
  fi

  return 1
}
```

Handling stale locks is dangerous:

- killing or removing lock automatically can break safety;
- PID reuse can mislead;
- container/CI PID namespaces complicate;
- distributed execution needs central lock.

For critical systems, use a real coordination mechanism.

---

## 29. Capturing Output and Status Together

Common need:

```bash
output="$(command)"
```

If command fails under `set -e`, assignment in `if` is good:

```bash
if output="$(command 2>&1)"; then
  log "command succeeded"
else
  status=$?
  printf 'ERROR: command failed status=%s output:\n%s\n' "$status" "$output" >&2
  exit "$status"
fi
```

But capturing stderr into output mixes data/log. Use only when diagnostic output needed.

For commands returning data on stdout and logs on stderr, better:

```bash
if output="$(command)"; then
  printf '%s\n' "$output"
else
  status=$?
  die "command failed with status $status"
fi
```

---

## 30. Secret-Safe Error Handling

Never print secrets.

Bad:

```bash
die "curl failed with token=$TOKEN"
```

Bad:

```bash
set -x
curl -H "Authorization: Bearer $TOKEN" ...
```

`set -x` prints commands after expansion. It can leak secrets.

If debug tracing needed:

```bash
if [[ "${DEBUG:-false}" == "true" ]]; then
  set -x
fi
```

But disable around secret commands:

```bash
set +x
curl -H "Authorization: Bearer $TOKEN" ...
if [[ "${DEBUG:-false}" == "true" ]]; then
  set -x
fi
```

Better: do not use global `set -x` in scripts that handle secrets. Use explicit debug logs with redaction.

Redaction helper:

```bash
redact() {
  local value="$1"
  if ((${#value} <= 4)); then
    printf '****'
  else
    printf '****%s' "${value: -4}"
  fi
}
```

Use sparingly.

---

## 31. `set -x` and `PS4`

For debugging:

```bash
set -x
```

Customize trace prefix:

```bash
export PS4='+ ${BASH_SOURCE}:${LINENO}:${FUNCNAME[0]:-main}: '
set -x
```

This helps locate commands.

But again: dangerous with secrets.

Pattern:

```bash
enable_trace() {
  if [[ "${TRACE:-false}" == "true" ]]; then
    export PS4='+ ${BASH_SOURCE}:${LINENO}:${FUNCNAME[0]:-main}: '
    set -x
  fi
}
```

Call only if script does not handle secrets or you carefully disable tracing around secret areas.

---

## 32. Error Handling Around Command Construction

Arrays prevent many errors, but command still can fail.

```bash
cmd=(mvn -P "$profile" test)

log_command "${cmd[@]}"

if "${cmd[@]}"; then
  log "tests passed"
else
  status=$?
  die "tests failed with status $status"
fi
```

With `set -e`, if you run:

```bash
"${cmd[@]}"
```

script exits automatically on failure, but message context may be poor.

Use explicit `if` for important boundaries:

```bash
if ! "${cmd[@]}"; then
  die "maven verification failed for profile=$profile"
fi
```

For many scripts, this pattern is clearer at major steps.

---

## 33. Step Runner Pattern

For multi-step workflows:

```bash
run_step() {
  local name="$1"
  shift

  log "==> $name"

  if "$@"; then
    log "OK: $name"
  else
    local status=$?
    printf 'ERROR: step failed: %s (status=%s)\n' "$name" "$status" >&2
    exit "$status"
  fi
}
```

Use:

```bash
run_step "unit tests" mvn test
run_step "package" mvn package
run_step "docker build" docker build -t "$image_tag" .
```

But this simple version cannot handle shell features like pipes unless wrapped:

```bash
run_step "report" bash -c 'generate | upload'
```

Be careful with quoting and secrets.

For commands with arrays:

```bash
cmd=(docker build -t "$image_tag" .)
run_step "docker build" "${cmd[@]}"
```

This preserves argument boundary.

---

## 34. Step Runner with Function Steps

For complex steps, use functions:

```bash
run_step() {
  local name="$1"
  shift

  log "==> $name"

  if "$@"; then
    log "OK: $name"
  else
    local status=$?
    die "step failed: $name status=$status"
  fi
}

run_tests() {
  mvn test
}

build_image() {
  docker build -t "$image_tag" .
}

run_step "tests" run_tests
run_step "image build" build_image
```

This is often cleaner than passing huge commands.

---

## 35. Error Context Stack

For larger Bash scripts, you can keep current step:

```bash
current_step="initialization"

on_error() {
  local status=$?
  printf 'ERROR: step=%s status=%s line=%s\n' "$current_step" "$status" "${BASH_LINENO[0]:-unknown}" >&2
  exit "$status"
}

trap on_error ERR

current_step="preflight"
preflight

current_step="build"
build

current_step="deploy"
deploy
```

This gives better CI output.

But global mutable `current_step` is a trade-off. Keep it simple.

---

## 36. Case Study: Fragile Script

Original:

```bash
#!/bin/bash
set -e

env=$1
version=$2

mvn test
docker build -t app:$version .
curl -X POST $DEPLOY_URL/deploy/$env/$version
rm -rf /tmp/app-$version
```

Problems:

1. No `set -u` or `pipefail`.
2. Args not validated.
3. Env not whitelisted.
4. Version not validated.
5. Required env not checked.
6. Maven failure has no context.
7. Docker tag not quoted.
8. Curl URL not quoted.
9. Curl failure semantics weak.
10. No timeout.
11. No retry strategy.
12. Cleanup path not guarded.
13. Secrets may be missing.
14. Destructive rm unconditional.
15. No dry-run.
16. No production guard.
17. No project root resolution.
18. No clear exit categories.

---

## 37. Improved Script

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

readonly EXIT_USAGE=2
readonly EXIT_SAFETY=50

usage() {
  cat >&2 <<'EOF'
Usage:
  release-deploy.sh --env <staging|prod> --version <x.y.z> [--dry-run] [--yes]
EOF
}

log() {
  printf '%s\n' "$*" >&2
}

warn() {
  printf 'WARN: %s\n' "$*" >&2
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

usage_error() {
  usage
  printf 'ERROR: %s\n' "$*" >&2
  exit "$EXIT_USAGE"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'ERROR: required command not found: %s\n' "$1" >&2
    exit 127
  }
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    usage_error "required environment variable is not set: $name"
  fi
}

log_command() {
  printf 'Running:' >&2
  printf ' %q' "$@" >&2
  printf '\n' >&2
}

main() {
  local env=""
  local version=""
  local dry_run=false
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
      --dry-run)
        dry_run=true
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

  local semver_re='^[0-9]+\.[0-9]+\.[0-9]+$'
  [[ "$version" =~ $semver_re ]] || usage_error "invalid version: $version"

  if [[ "$env" == "prod" && "$yes" != "true" ]]; then
    printf 'ERROR: production deploy requires --yes\n' >&2
    exit "$EXIT_SAFETY"
  fi

  require_cmd mvn
  require_cmd docker
  require_cmd curl
  require_env DEPLOY_URL
  require_env DEPLOY_TOKEN

  local script_dir
  local project_root
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  project_root="$(cd -- "$script_dir/.." && pwd)"
  cd "$project_root"

  [[ -f pom.xml ]] || die "pom.xml not found at project root: $project_root"

  local image_tag="app:$version"

  log "env=$env version=$version dry_run=$dry_run"

  if [[ "$dry_run" == "true" ]]; then
    log "DRY RUN: would run tests, build image, and call deploy API"
    exit 0
  fi

  log "Running tests"
  if ! mvn test; then
    die "maven tests failed"
  fi

  local docker_cmd=(docker build -t "$image_tag" .)
  log_command "${docker_cmd[@]}"
  if ! "${docker_cmd[@]}"; then
    die "docker build failed for image=$image_tag"
  fi

  local deploy_url="${DEPLOY_URL%/}/deploy/$env/$version"

  log "Calling deploy API env=$env version=$version"
  if ! curl \
      --fail \
      --show-error \
      --silent \
      --connect-timeout 5 \
      --max-time 60 \
      --header "Authorization: Bearer $DEPLOY_TOKEN" \
      --request POST \
      "$deploy_url"; then
    die "deploy API call failed for env=$env version=$version"
  fi

  log "Deployment request submitted env=$env version=$version"
}

main "$@"
```

Still not perfect. But it is far more inspectable.

Remaining design questions:

- Is Docker image pushed?
- Is deploy API idempotent?
- Should tests and build be separate phases?
- Should production deployment require CI-only?
- Should release version exist in artifact registry?
- Should curl retry?
- Should there be smoke test?
- Should command logs avoid exposing URL if sensitive?

Error handling is not only syntax. It is workflow design.

---

## 38. Validating Error Handling

You should test failure paths.

Examples:

```bash
./script.sh
```

Should show usage error.

```bash
./script.sh --env invalid --version 1.2.3
```

Should fail before side effects.

```bash
PATH="" ./script.sh --env staging --version 1.2.3
```

Should fail missing command.

```bash
DEPLOY_TOKEN="" ./script.sh --env staging --version 1.2.3
```

Should fail required env.

```bash
./script.sh --env prod --version 1.2.3
```

Should require `--yes`.

```bash
./script.sh --env staging --version 1.2.3 --dry-run
```

Should not mutate state.

Failure paths are first-class behavior.

---

## 39. Testing with Stub Commands

Create temp directory with fake commands earlier in PATH.

```bash
tmp_bin="$(mktemp -d)"
PATH="$tmp_bin:$PATH"

cat > "$tmp_bin/mvn" <<'EOF'
#!/usr/bin/env bash
echo "fake mvn failing" >&2
exit 42
EOF
chmod +x "$tmp_bin/mvn"

./script.sh --env staging --version 1.2.3
```

This lets you test how script handles Maven failure.

For more structured Bash tests, we will discuss Bats and testing strategy in Part 010.

---

## 40. Failure Observability in CI

CI logs should show:

- which step started;
- which step failed;
- relevant inputs, excluding secrets;
- command when safe;
- exit status;
- artifact/report location;
- suggested local reproduction command.

Example:

```bash
log "Running unit tests"
log "Local reproduction: mvn test"
if ! mvn test; then
  die "unit tests failed; see target/surefire-reports if available"
fi
```

For Gradle:

```bash
die "gradle verification failed; rerun with: ./gradlew test --stacktrace"
```

Do not rely on engineers reading source to know what failed.

---

## 41. Mini Lab

### Lab 1 — `grep` exit status

Create:

```bash
printf 'hello\n' > sample.txt
```

Run:

```bash
grep -q ERROR sample.txt
echo "$?"
```

Then write a script that distinguishes:

- match found;
- no match;
- grep error because file missing.

---

### Lab 2 — `pipefail`

Run:

```bash
bash -c 'set -e; false | true; echo survived'
bash -c 'set -e -o pipefail; false | true; echo survived'
```

Explain difference.

---

### Lab 3 — Cleanup preserves status

Write script:

```bash
#!/usr/bin/env bash
set -euo pipefail

tmp_dir="$(mktemp -d)"

cleanup() {
  local status=$?
  rm -rf -- "$tmp_dir"
  exit "$status"
}

trap cleanup EXIT

false
```

Run and verify exit code is non-zero:

```bash
./script.sh
echo "$?"
```

---

### Lab 4 — Retry helper

Implement `retry 3 1 command`.

Test with fake command that fails twice then succeeds using a counter file.

---

### Lab 5 — Secret-safe debug

Create script that uses `TOKEN`. Add debug logs without printing token. Then try `set -x` and observe why it is dangerous.

---

## 42. Design Exercise: Error Contract for `deploy.sh`

Before coding, write:

```text
Inputs:
  --env staging|prod
  --version x.y.z
  --dry-run
  --yes

Required env:
  DEPLOY_URL
  DEPLOY_TOKEN

Failure cases:
  - usage invalid
  - missing command
  - missing env
  - invalid env
  - invalid version
  - prod without --yes
  - tests fail
  - image build fail
  - deploy API timeout
  - deploy API 401
  - deploy API 5xx
  - interrupted

Exit codes:
  0 success
  2 usage/config
  50 safety guard
  130 interrupted
  1 otherwise

Recovery:
  - for test/build failure: rerun locally
  - for deploy 401: check token
  - for deploy 5xx: safe to retry only if idempotency key used
  - for partial deploy: check deploy system by version/env
```

Then implement Bash around this contract.

This exercise builds the habit of designing failure behavior before command sequence.

---

## 43. Part 005 Summary

Error handling Bash is not just `set -e`.

Key takeaways:

1. `set -euo pipefail` is baseline, not complete strategy.
2. Failure types must be classified.
3. Exit code is script API.
4. `grep`/`diff` and many tools have meaningful non-zero statuses.
5. Expected negative results must be handled explicitly.
6. Avoid blind `|| true`.
7. Use contextual error messages.
8. Preflight checks should happen before side effects.
9. Cleanup must preserve original status.
10. Cleanup must be safe and idempotent.
11. Retry only retryable operations.
12. Timeout potentially hanging operations.
13. Do not leak secrets through logs or `set -x`.
14. Use explicit step boundaries for CI observability.
15. Destructive and production operations need safety guards.
16. Partial failure and idempotency are workflow design problems, not syntax problems.

With this foundation, Part 006 will focus on data handling in Bash: text, lines, null bytes, JSON, CSV, and when Bash should stop being the tool.

---

## 44. Referensi Resmi dan Bacaan Lanjutan

- GNU Bash Reference Manual — The Set Builtin.
- GNU Bash Reference Manual — Bourne Shell Builtins.
- GNU Bash Reference Manual — Signals and traps.
- GNU Bash Reference Manual — Pipelines and exit status.
- GNU Coreutils Manual — `timeout`, `mktemp`, common utility behavior.
- curl documentation — failure, timeout, retry flags.
- ShellCheck documentation — warnings around error handling, quoting, masking return values.
- BashFAQ and BashPitfalls — practical discussions of `set -e`, pipeline, traps, and error handling caveats.

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
- [ ] Part 006 — Data Handling in Bash: Text, Lines, Null Bytes, JSON, CSV
- [ ] Part 007 — Filesystem Automation: Safe File Operations
- [ ] Part 008 — Process Control: Background Jobs, Signals, Timeouts, Concurrency
- [ ] Part 009 — CLI Design for Internal Tools
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
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-004.md">⬅️ Part 004 — Bash Fundamentals Without Toy Examples</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-006.md">Part 006 — Data Handling in Bash: Text, Lines, Null Bytes, JSON, CSV ➡️</a>
</div>
