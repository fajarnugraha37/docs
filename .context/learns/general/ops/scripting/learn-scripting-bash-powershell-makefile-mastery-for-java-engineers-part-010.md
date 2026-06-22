# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-010.md

# Part 010 — Bash Testing, Linting, Formatting, and Reviewability

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: membuat Bash script bisa diuji, dilint, diformat, direview, dan dijadikan bagian dari engineering quality gate.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya membahas:

- process model;
- parsing/quoting;
- POSIX vs Bash;
- Bash fundamentals;
- error handling;
- data handling;
- filesystem safety;
- process control;
- CLI design.

Part 010 menjawab pertanyaan berikut:

> Bagaimana memastikan script tetap benar setelah berubah?

Banyak tim memperlakukan Bash script sebagai “kode kelas dua”:

- tidak dites;
- tidak diformat;
- tidak dilint;
- tidak direview serius;
- tidak punya CI gate;
- tidak punya kontrak output;
- tidak punya fixture;
- tidak punya test failure cases;
- hanya diuji manual saat incident.

Padahal script sering memegang operasi yang sangat penting:

- build;
- release;
- deployment;
- cleanup;
- data migration wrapper;
- credential/bootstrap;
- diagnostics;
- CI pipeline.

Jika Java service butuh test, script yang mendeploy Java service juga butuh quality gate.

---

## 1. Testing Bash Tidak Sama dengan Testing Java

Dalam Java, unit test biasanya memanggil function/class langsung:

```java
assertEquals("prod", normalizeEnv("production"));
```

Dalam Bash, script sering berinteraksi dengan:

- process;
- filesystem;
- environment;
- external command;
- stdout/stderr;
- exit code;
- current directory;
- time;
- network;
- signals.

Karena itu testing Bash lebih mirip testing CLI/integration boundary.

Yang dites bukan hanya “function return value”, tetapi:

- command exits with expected code;
- stdout matches expected output;
- stderr contains useful message;
- files are created/removed safely;
- external tools are invoked with correct args;
- invalid input fails before side effect;
- dry-run does not mutate;
- traps cleanup temp files;
- wrapper forwards args correctly.

---

## 2. Test Pyramid untuk Script

Untuk Bash, test pyramid praktis:

```text
Static checks
  shellcheck, shfmt, executable bit, shebang checks

Unit-ish function tests
  source function library, test pure-ish functions

CLI contract tests
  run script as process, assert exit/stdout/stderr

Integration tests
  use temp dirs, fake commands, fixture files

End-to-end workflow tests
  run against real tools/container where safe
```

Tidak semua script butuh semua level.

Heuristic:

- small helper script: ShellCheck + smoke test cukup;
- deploy/release script: CLI tests + dry-run tests + fake command tests;
- filesystem cleanup script: temp-dir integration tests wajib;
- data parser script: fixture/golden tests;
- CI entrypoint: run in CI as part of self-check.

---

## 3. Static Analysis dengan ShellCheck

ShellCheck adalah static analyzer untuk shell scripts.

Ia menangkap:

- unquoted variables;
- unused variables;
- wrong shebang/dialect;
- unsafe `for x in $(...)`;
- masked return status;
- wrong test syntax;
- array misuse;
- POSIX/Bash mismatch;
- `read` without `-r`;
- many common pitfalls.

Run:

```bash
shellcheck scripts/*.sh
```

Specify dialect:

```bash
shellcheck -s bash scripts/verify.sh
shellcheck -s sh scripts/entrypoint.sh
```

In CI:

```bash
find scripts -type f -name '*.sh' -print0 |
xargs -0 shellcheck
```

Better with no-input handling:

```bash
mapfile -t scripts < <(find scripts -type f -name '*.sh' | sort)

if ((${#scripts[@]} > 0)); then
  shellcheck "${scripts[@]}"
fi
```

Caveat: line-based file list assumes repo paths do not contain newlines. In most repos, enforce that.

---

## 4. ShellCheck Warnings Are Teaching Signals

Example:

```bash
cp $src $dst
```

ShellCheck warns about quote.

Fix:

```bash
cp -- "$src" "$dst"
```

Example:

```bash
for f in $(find . -type f); do
  ...
done
```

ShellCheck warns.

Fix:

```bash
find . -type f -print0 |
while IFS= read -r -d '' f; do
  ...
done
```

Example:

```bash
cat file | grep pattern
```

May warn about useless cat. But sometimes pipeline shape is intentional for readability. Understand warning.

Rule:

> Do not silence ShellCheck because it is annoying. Silence only when you understand and document the reason.

---

## 5. Suppressing ShellCheck Safely

Sometimes warning is intentional.

Example `JAVA_OPTS` intentional splitting:

```bash
# JAVA_OPTS is intentionally split as trusted shell words.
# shellcheck disable=SC2086
exec java $JAVA_OPTS -jar app.jar
```

Bad suppression:

```bash
# shellcheck disable=SC2086
```

with no explanation.

For a block:

```bash
# shellcheck disable=SC1091
. "$script_dir/lib.sh"
```

Reason: ShellCheck cannot follow dynamic source path.

Prefer file-level suppression only rarely:

```bash
# shellcheck shell=bash
```

Good at top if extension not recognized.

---

## 6. Formatting dengan shfmt

`shfmt` formats shell scripts.

Run:

```bash
shfmt -w scripts
```

Check only:

```bash
shfmt -d scripts
```

Common CI:

```bash
shfmt -d scripts
```

If output diff non-empty, fail.

Benefits:

- consistent indentation;
- less style debate;
- easier review;
- catches parse issues.

Choose style once.

Example:

```bash
shfmt -i 2 -ci -sr -w scripts
```

Options vary by preference. Do not over-optimize. The most important thing is consistency.

---

## 7. Shebang and Executable Bit Checks

Scripts can fail because not executable:

```bash
chmod +x scripts/verify.sh
```

CI check:

```bash
find scripts -type f -name '*.sh' -print0 |
while IFS= read -r -d '' file; do
  if [[ ! -x "$file" ]]; then
    printf 'ERROR: script is not executable: %s\n' "$file" >&2
    exit 1
  fi
done
```

But not every `.sh` library should be executable. Alternative convention:

```text
scripts/*.sh          executable commands
scripts/lib/*.bash    source-only libraries
```

Check shebang:

```bash
head -n 1 "$file"
```

Policy:

- executable scripts need shebang;
- Bash scripts use `#!/usr/bin/env bash`;
- POSIX scripts use `#!/bin/sh`;
- sourced libraries should not be directly executable or should guard.

---

## 8. Parse Check

Bash syntax check:

```bash
bash -n script.sh
```

POSIX-ish with dash:

```bash
dash -n script.sh
```

But `bash -n` does not catch runtime expansion errors. It only parses.

CI:

```bash
for script in scripts/*.sh; do
  bash -n "$script"
done
```

For POSIX scripts:

```bash
sh -n "$script"
```

ShellCheck usually parses too, but explicit syntax check is cheap.

---

## 9. Testing Frameworks: Bats

Bats is a popular Bash Automated Testing System.

A simple Bats test:

```bash
#!/usr/bin/env bats

@test "verify --help succeeds" {
  run ./scripts/verify.sh --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
}
```

Bats provides:

- `run` helper;
- `$status`;
- `$output`;
- `$lines`;
- setup/teardown;
- test structure.

Use Bats when:

- script behavior is important;
- CLI contract should be tested;
- you want readable tests;
- team accepts test dependency.

But you can also write plain Bash tests if dependency should be minimal.

---

## 10. Plain Bash Test Harness

Minimal test runner:

```bash
#!/usr/bin/env bash
set -euo pipefail

failures=0

test_case() {
  local name="$1"
  shift

  printf 'TEST %s ... ' "$name"

  if "$@"; then
    printf 'OK\n'
  else
    printf 'FAIL\n'
    failures=$((failures + 1))
  fi
}

assert_eq() {
  local expected="$1"
  local actual="$2"

  if [[ "$expected" != "$actual" ]]; then
    printf 'expected <%s>, got <%s>\n' "$expected" "$actual" >&2
    return 1
  fi
}

test_help() {
  local output
  output="$(./scripts/verify.sh --help)"
  [[ "$output" == *"Usage:"* ]]
}

test_case "help" test_help

if ((failures > 0)); then
  printf '%s test(s) failed\n' "$failures" >&2
  exit 1
fi
```

This is enough for small repos.

---

## 11. Testing Exit Code, stdout, stderr

Plain Bash pattern:

```bash
tmp_dir="$(mktemp -d)"
stdout="$tmp_dir/stdout"
stderr="$tmp_dir/stderr"

set +e
./scripts/deploy.sh --env invalid >"$stdout" 2>"$stderr"
status=$?
set -e

[[ "$status" -eq 2 ]] || fail "expected usage exit 2"
grep -q "invalid env" "$stderr" || fail "expected invalid env message"
[[ ! -s "$stdout" ]] || fail "expected empty stdout"
```

Encapsulate helper:

```bash
run_cmd() {
  stdout="$tmp_dir/stdout"
  stderr="$tmp_dir/stderr"

  set +e
  "$@" >"$stdout" 2>"$stderr"
  status=$?
  set -e
}
```

Then:

```bash
run_cmd ./scripts/deploy.sh --env invalid
assert_status 2
assert_stderr_contains "invalid env"
```

---

## 12. Testing Filesystem Scripts with Temp Dirs

Never test cleanup scripts against real project root casually.

Use temp dir:

```bash
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir/project/target"
touch "$tmp_dir/project/pom.xml"
touch "$tmp_dir/project/target/app.jar"

(
  cd "$tmp_dir/project"
  /path/to/scripts/clean.sh --target maven
)

[[ ! -e "$tmp_dir/project/target" ]]
```

For scripts that resolve their own project root via script location, you may need fixture repo:

```bash
fixture="$tmp_dir/project"
mkdir -p "$fixture/scripts"
cp scripts/clean.sh "$fixture/scripts/clean.sh"
touch "$fixture/pom.xml"
```

Then run fixture script.

---

## 13. Testing Destructive Safety

Test that bad inputs fail before deletion.

Example:

```bash
test_refuses_outside_root() {
  local tmp
  tmp="$(mktemp -d)"
  mkdir -p "$tmp/project"
  touch "$tmp/project/pom.xml"
  mkdir -p "$tmp/important"
  touch "$tmp/important/keep.txt"

  set +e
  "$tmp/project/scripts/clean.sh" --path "$tmp/important" >out 2>err
  status=$?
  set -e

  [[ "$status" -ne 0 ]]
  [[ -f "$tmp/important/keep.txt" ]]
}
```

Better CLI design avoids arbitrary `--path`, but test safety guards anyway.

---

## 14. Fake Commands via PATH

To test script calls `mvn` correctly, create fake `mvn`.

```bash
tmp_bin="$tmp_dir/bin"
mkdir -p "$tmp_bin"

cat > "$tmp_bin/mvn" <<'EOF'
#!/usr/bin/env bash
printf 'mvn args:' >> "$FAKE_MVN_LOG"
printf ' <%s>' "$@" >> "$FAKE_MVN_LOG"
printf '\n' >> "$FAKE_MVN_LOG"
exit "${FAKE_MVN_STATUS:-0}"
EOF
chmod +x "$tmp_bin/mvn"

FAKE_MVN_LOG="$tmp_dir/mvn.log"
PATH="$tmp_bin:$PATH" ./scripts/verify.sh --quick -- -Dtest=Foo
```

Assert:

```bash
grep -q '<-Dtest=Foo>' "$FAKE_MVN_LOG"
```

This is equivalent to mocking external dependencies.

---

## 15. Fake Command That Fails

```bash
cat > "$tmp_bin/mvn" <<'EOF'
#!/usr/bin/env bash
echo "fake mvn failed" >&2
exit 42
EOF
chmod +x "$tmp_bin/mvn"

set +e
PATH="$tmp_bin:$PATH" ./scripts/verify.sh >out 2>err
status=$?
set -e

[[ "$status" -ne 0 ]]
grep -q "fake mvn failed" err
```

This validates failure propagation and messaging.

---

## 16. Golden File Tests

Useful for generated output.

Example:

```bash
./scripts/metadata.sh --output json > "$tmp_dir/actual.json"
diff -u tests/golden/metadata.json "$tmp_dir/actual.json"
```

For JSON, compare semantically:

```bash
jq -S . "$tmp_dir/actual.json" > "$tmp_dir/actual.sorted.json"
jq -S . tests/golden/metadata.json > "$tmp_dir/expected.sorted.json"
diff -u "$tmp_dir/expected.sorted.json" "$tmp_dir/actual.sorted.json"
```

Avoid brittle golden files for timestamps/random values. Normalize dynamic fields:

```bash
jq 'del(.timestamp)' actual.json
```

---

## 17. Snapshot vs Contract Tests

Snapshot/golden tests catch changes, but can become noisy.

Contract tests assert important properties:

```bash
jq -e '
  type == "object"
  and (.version | type == "string")
  and (.commit | type == "string")
' actual.json
```

Prefer contract tests when output can evolve additively.

Use golden tests when exact output matters, e.g.:

- generated config;
- help text;
- shell command plan;
- migration script output.

---

## 18. Testing Help Text

Help text is user-facing contract.

Test basics:

```bash
run_cmd ./scripts/deploy.sh --help
assert_status 0
assert_stdout_contains "Usage:"
assert_stdout_contains "--env"
assert_stdout_contains "--version"
```

Do not over-test exact wording unless help text is part of docs contract. Test important flags are present.

---

## 19. Testing `--dry-run`

Dry-run must not mutate.

Pattern:

```bash
before="$(find "$fixture" -type f -print | sort)"

run_cmd ./scripts/clean.sh --dry-run

after="$(find "$fixture" -type f -print | sort)"

assert_eq "$before" "$after"
assert_stderr_contains "DRY RUN"
```

For directories and metadata, compare more carefully.

If dry-run prints plan to stdout, assert stdout plan and filesystem unchanged.

---

## 20. Testing Signal/Cleanup

Harder, but possible.

Example:

```bash
./scripts/start-temp-service.sh &
pid=$!

sleep 1
kill -INT "$pid"
wait "$pid"
status=$?

[[ "$status" -eq 130 ]]
```

Then assert child process gone.

This can be flaky. Keep signal tests minimal and robust.

For many scripts, manual review + simpler cleanup tests are enough.

---

## 21. Testing Timeouts Without Slow Tests

Do not make test wait 60 seconds.

Parameterize timeout:

```bash
./scripts/wait-health.sh --timeout 1
```

Test:

```bash
run_cmd ./scripts/wait-health.sh --url http://127.0.0.1:9 --timeout 1
assert_nonzero
assert_stderr_contains "timed out"
```

Use dependency injection:

```bash
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-60}"
```

In test:

```bash
TIMEOUT_SECONDS=1 ./script.sh
```

---

## 22. Designing Scripts for Testability

Bad:

```bash
main() {
  curl production-url
  rm -rf /real/path
}
main "$@"
```

Hard to test.

Better:

- accept URL via env/flag;
- support dry-run;
- resolve root from configurable fixture or script location;
- isolate pure functions;
- use fake commands via PATH;
- write output to configurable dir;
- avoid hardcoded production endpoints;
- keep side effects behind functions.

Example:

```bash
DEPLOY_URL="${DEPLOY_URL:-}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$project_root/target}"
```

But do not make everything configurable if it weakens safety. Testability and safety must be balanced.

---

## 23. Sourceable Libraries

If helper functions grow, extract:

```text
scripts/lib/common.bash
scripts/verify.sh
scripts/deploy.sh
```

`common.bash`:

```bash
#!/usr/bin/env bash
# shellcheck shell=bash

log() {
  printf '%s\n' "$*" >&2
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}
```

Script:

```bash
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/common.bash
source "$script_dir/lib/common.bash"
```

Test functions:

```bash
source scripts/lib/common.bash
```

Caveat:

- libraries should not execute main logic on source;
- avoid global side effects;
- functions that call `exit` are hard to unit test;
- prefer `return` for reusable validation functions.

---

## 24. Guarding Main for Sourceable Scripts

If a script may be sourced in tests:

```bash
main() {
  ...
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
```

This prevents `main` from running when sourced.

Use for scripts where you want to test functions directly.

For simple CLI-only scripts, not necessary.

---

## 25. Pure-ish Functions Are Easier to Test

Good:

```bash
normalize_env() {
  case "$1" in
    dev|development) printf 'dev\n' ;;
    staging|stage) printf 'staging\n' ;;
    prod|production) printf 'prod\n' ;;
    *) return 1 ;;
  esac
}
```

Test:

```bash
actual="$(normalize_env production)"
assert_eq "prod" "$actual"
```

Harder:

```bash
normalize_env() {
  env="$1"
  export APP_ENV="$env"
  cd ..
  echo prod
}
```

Avoid hidden side effects in helper functions.

---

## 26. Testing Functions That Return Status

```bash
is_valid_env() {
  case "$1" in
    dev|staging|prod) return 0 ;;
    *) return 1 ;;
  esac
}
```

Test:

```bash
is_valid_env dev
is_valid_env invalid && fail "invalid env should fail"
```

Because `set -e` can interfere, use explicit condition:

```bash
if is_valid_env invalid; then
  fail "invalid env should fail"
fi
```

---

## 27. Handling Functions That Call `exit`

Functions like `die` call `exit`, making direct testing harder.

Test in subprocess:

```bash
if ( die "boom" ); then
  fail "die should exit non-zero"
fi
```

Capture:

```bash
set +e
output="$(die "boom" 2>&1)"
status=$?
set -e

[[ "$status" -ne 0 ]]
[[ "$output" == *"boom"* ]]
```

But if `die` exits the current shell and not subshell, it would end test runner. Use subshell.

---

## 28. CI Quality Gate Script

Create:

```text
scripts/check-scripts.sh
```

Example:

```bash
#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

main() {
  require_cmd shellcheck
  require_cmd shfmt

  mapfile -t scripts < <(find scripts -type f \( -name '*.sh' -o -name '*.bash' \) | sort)

  if ((${#scripts[@]} == 0)); then
    printf 'No shell scripts found\n' >&2
    return 0
  fi

  printf 'Running shellcheck\n' >&2
  shellcheck "${scripts[@]}"

  printf 'Checking shfmt\n' >&2
  shfmt -d "${scripts[@]}"

  printf 'Checking Bash syntax\n' >&2
  local script
  for script in "${scripts[@]}"; do
    case "$script" in
      *.sh|*.bash)
        bash -n "$script"
        ;;
    esac
  done
}

main "$@"
```

Caveat: if some `.sh` are POSIX, use dialect-aware logic.

---

## 29. Dialect-Aware Checks

Infer from shebang:

```bash
detect_shell() {
  local file="$1"
  local first_line
  first_line="$(head -n 1 "$file")"

  case "$first_line" in
    *bash*) printf 'bash\n' ;;
    *'/bin/sh'*) printf 'sh\n' ;;
    *) printf 'bash\n' ;;
  esac
}
```

Then:

```bash
shell="$(detect_shell "$script")"
shellcheck -s "$shell" "$script"

case "$shell" in
  bash) bash -n "$script" ;;
  sh) sh -n "$script" ;;
esac
```

This is approximate. Better: enforce conventions.

Example:

```text
scripts/bin/*.bash   Bash executable
scripts/bin/*.sh     POSIX executable
scripts/lib/*.bash   Bash libraries
```

---

## 30. Reviewability Principles

Bash review should focus on:

- argument boundary;
- quoting;
- destructive operations;
- error handling;
- external command semantics;
- stdout/stderr contract;
- input validation;
- path safety;
- concurrency;
- secrets;
- portability contract;
- CI/local parity.

A Bash review is not just “does it work”.

Reviewers should ask:

- what can this delete?
- what happens if variable is empty?
- what if command fails?
- is this Bash or POSIX?
- are paths controlled?
- can this hang?
- are secrets logged?
- does dry-run mutate?
- can output be parsed?
- does it work outside current directory?

---

## 31. Code Organization for Review

Prefer:

```bash
main() {
  parse_args "$@"
  preflight
  run_workflow
}
```

Over giant top-level script.

But be careful: Bash does not have clean pass-by-value structures. Do not over-abstract.

Good structure:

```text
constants
usage
logging helpers
validation helpers
command helpers
subcommand functions
main
main "$@"
```

Avoid:

- action at source time before helpers loaded;
- global mutable variables everywhere;
- functions hundreds of lines long;
- dynamic eval dispatch;
- hidden sourcing.

---

## 32. Small Functions, Clear Side Effects

Good:

```bash
require_cmd() { ... }
resolve_project_root() { ... }
build_maven_command() { ... }
run_verify() { ... }
```

Bad:

```bash
do_everything() {
  # parse args
  # modify globals
  # cd
  # rm
  # build
  # deploy
  # cleanup
}
```

Function comments can define contract:

```bash
# stdout: project root path
# stderr: diagnostics
# return: non-zero if not inside project
resolve_project_root() {
  git rev-parse --show-toplevel
}
```

This makes review easier.

---

## 33. Avoid Clever Bash in Team Scripts

Clever:

```bash
${var:?} && cmd+=( ${flag:+--flag} )
```

Clear:

```bash
: "${var:?var is required}"

if [[ "$flag" == "true" ]]; then
  cmd+=(--flag)
fi
```

Clever code increases review cost.

Top engineers write Bash that junior engineers can safely review.

---

## 34. Test Matrix for Scripts

Think about environments:

```text
Shell:
  bash 3.2?
  bash 4?
  bash 5?
  dash?
  busybox ash?

OS:
  Linux
  macOS
  Windows via Git Bash/WSL?

Context:
  local terminal
  CI non-TTY
  container
  project root
  subdirectory

Input:
  normal
  empty
  invalid
  spaces
  starts with dash
  missing files
  command failure
```

You do not need to test everything for every script. But for important scripts, define supported matrix.

Example:

```text
scripts/entrypoint.sh:
  supported: POSIX sh on Alpine/Debian containers

scripts/verify.sh:
  supported: Bash 4+ on Linux CI and dev container

scripts/dev/run-local.sh:
  supported: Bash 3.2+ on macOS/Linux
```

---

## 35. Testing Portability

For POSIX script:

```bash
docker run --rm -v "$PWD:/work" -w /work alpine sh ./scripts/entrypoint.sh --help
```

For Bash script requiring Bash 4+:

```bash
bash ./scripts/verify.sh --help
```

For macOS compatibility, if needed, run in macOS CI.

For BusyBox:

```bash
docker run --rm -v "$PWD:/work" -w /work busybox sh ./script.sh
```

Portability tests should match declared contract.

Do not spend effort making Bash-specific developer script pass BusyBox sh.

---

## 36. Testing Non-Interactive Behavior

CI is non-interactive.

Test:

```bash
./scripts/deploy.sh --env prod --version 1.2.3 </dev/null
```

It should not hang waiting for prompt.

If prod requires confirmation:

```bash
run_cmd ./scripts/deploy.sh --env prod --version 1.2.3 </dev/null
assert_nonzero
assert_stderr_contains "--yes"
```

Prompt should be optional and TTY-gated.

---

## 37. Dependency Checks in Tests

If tests require shellcheck/shfmt/jq/docker, declare.

```bash
require_cmd shellcheck
require_cmd shfmt
require_cmd jq
```

For optional tests:

```bash
if ! command -v docker >/dev/null 2>&1; then
  echo "SKIP: docker not available" >&2
  return 0
fi
```

In CI, prefer deterministic required dependencies.

---

## 38. Testing with Containers

For scripts intended to run in container image:

```bash
docker build -t myapp-script-test .
docker run --rm myapp-script-test ./scripts/verify.sh --help
```

For entrypoint:

```bash
docker run --rm -e APP_ENV=dev image
```

Test invalid env:

```bash
docker run --rm -e APP_ENV=bad image
```

Check exit non-zero.

Container tests are slower but valuable for entrypoints and release images.

---

## 39. Common Untested Failure Paths

Most teams test happy path only. Add tests for:

- missing required arg;
- invalid enum;
- missing command;
- missing env var;
- command failure;
- dry-run no mutation;
- path outside root;
- symlink target refused;
- non-TTY prompt refusal;
- help works;
- `--` pass-through preserves args;
- output JSON valid;
- cleanup removes temp dir;
- production requires confirmation;
- no secret in logs.

These catch real incidents.

---

## 40. Example Bats Test File

```bash
#!/usr/bin/env bats

setup() {
  TMPDIR_TEST="$(mktemp -d)"
}

teardown() {
  rm -rf "$TMPDIR_TEST"
}

@test "deploy help succeeds" {
  run ./scripts/deploy-release.sh --help
  [ "$status" -eq 0 ]
  [[ "$output" == *"Usage:"* ]]
  [[ "$output" == *"--env"* ]]
  [[ "$output" == *"--version"* ]]
}

@test "deploy rejects invalid env" {
  run ./scripts/deploy-release.sh --env bad --version 1.2.3
  [ "$status" -eq 2 ]
  [[ "$output" == *"invalid env"* || "$output" == *"Usage:"* ]]
}

@test "prod apply requires yes" {
  run env DEPLOY_URL=http://example.invalid DEPLOY_TOKEN=dummy \
    ./scripts/deploy-release.sh --env prod --version 1.2.3 --apply
  [ "$status" -ne 0 ]
  [[ "$output" == *"--yes"* || "$output" == *"requires"* ]]
}
```

Note: Bats merges stdout/stderr into `$output` depending invocation/version. Understand your framework behavior.

---

## 41. Plain Bash Test Helpers Example

```bash
#!/usr/bin/env bash
set -euo pipefail

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

status=0
stdout="$tmp_dir/stdout"
stderr="$tmp_dir/stderr"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

run_cmd() {
  set +e
  "$@" >"$stdout" 2>"$stderr"
  status=$?
  set -e
}

assert_status() {
  local expected="$1"
  [[ "$status" -eq "$expected" ]] || {
    printf 'stdout:\n' >&2
    cat "$stdout" >&2 || true
    printf 'stderr:\n' >&2
    cat "$stderr" >&2 || true
    fail "expected status $expected got $status"
  }
}

assert_stdout_contains() {
  local text="$1"
  grep -q -- "$text" "$stdout" || fail "stdout missing: $text"
}

assert_stderr_contains() {
  local text="$1"
  grep -q -- "$text" "$stderr" || fail "stderr missing: $text"
}

run_cmd ./scripts/deploy-release.sh --help
assert_status 0
assert_stdout_contains "Usage:"
```

This is enough if you want no Bats dependency.

---

## 42. Makefile Targets for Script Quality

```make
.PHONY: lint-scripts format-scripts test-scripts check-scripts

lint-scripts:
	shellcheck $$(find scripts -type f -name '*.sh' -o -name '*.bash')

format-scripts:
	shfmt -w scripts

test-scripts:
	bats tests/scripts

check-scripts: lint-scripts test-scripts
	shfmt -d scripts
```

But beware Make shell quoting. A more robust approach:

```make
.PHONY: check-scripts
check-scripts:
	./scripts/check-scripts.sh
```

Keep Makefile thin; script owns logic.

---

## 43. CI Integration

Example:

```yaml
script:
  - ./scripts/check-scripts.sh
  - ./scripts/test-scripts.sh
```

Or Make:

```yaml
script:
  - make check-scripts
```

Quality gates:

- ShellCheck;
- shfmt check;
- tests;
- maybe run `--help` for all commands;
- maybe dry-run deploy in fixture.

Do not wait until deploy pipeline to discover script syntax error.

---

## 44. Review Checklist for Pull Requests

When reviewing script changes:

### Interface

- Did CLI flags change?
- Is backward compatibility preserved?
- Is help updated?
- Are examples updated?

### Safety

- Any new `rm`, `mv`, `cp`, `rsync`, `find -delete`?
- Are paths validated?
- Is dry-run updated?
- Are symlinks considered?

### Correctness

- Are variables quoted?
- Are arrays used for commands?
- Are exit statuses handled?
- Are expected failures distinguished?

### Observability

- Are errors actionable?
- Are logs on stderr?
- Are secrets redacted?

### Tests

- Are happy path and failure path tested?
- Are fake commands used where appropriate?
- Are fixtures isolated?
- Does CI run checks?

### Portability

- Does shebang match syntax?
- Did Bashisms enter POSIX script?
- Are GNU-only utilities acceptable?

---

## 45. Anti-Patterns

### 45.1 No CI check

```text
Script only runs during release.
```

This means syntax bugs appear during release.

### 45.2 Manual-only validation

```text
I tested it locally once.
```

Not enough for deploy/cleanup scripts.

### 45.3 Suppress all ShellCheck

```bash
# shellcheck disable=all
```

Almost never acceptable.

### 45.4 Tests hit production

Never.

### 45.5 Tests require developer machine state

Bad tests depend on:

- current working directory;
- real HOME config;
- real tokens;
- real Docker daemon unless integration test explicitly;
- real network unless controlled.

### 45.6 Snapshot everything

Golden tests that fail on harmless timestamp/order changes create noise.

### 45.7 Over-frameworking Bash

Do not build a Java testing framework in Bash. Keep tests simple.

---

## 46. Design Exercise: Add Quality Gate to Existing Scripts

For current project scripts, design:

```text
scripts/check-scripts.sh
tests/scripts/
Makefile target: check-scripts
CI step
```

Quality gate should:

1. discover scripts;
2. run ShellCheck with correct dialect;
3. run shfmt check;
4. run syntax check;
5. run Bats/plain Bash tests;
6. test `--help` for public scripts;
7. test dry-run for destructive scripts;
8. fail on missing executable bit for command scripts.

Document supported shell/runtime.

---

## 47. Part 010 Summary

Bash scripts need engineering quality gates.

Key takeaways:

1. Treat scripts as production code when they control build/release/deploy/cleanup.
2. Use ShellCheck as baseline static analysis.
3. Use shfmt to remove style debate.
4. Check shebang, executable bit, and syntax.
5. Test CLI behavior: exit code, stdout, stderr.
6. Use temp dirs for filesystem tests.
7. Use fake commands via PATH for external dependencies.
8. Test failure paths, not only happy paths.
9. Test dry-run non-mutation.
10. Keep stdout/stderr contracts testable.
11. Extract sourceable libraries carefully.
12. Use `main` guard if sourcing for tests.
13. Prefer simple test harnesses over over-engineering.
14. Integrate script checks into CI.
15. Review scripts for safety, portability, observability, and compatibility.

Part 011 will cover the security model for shell scripts: injection, path hijacking, secrets, temp files, `eval`, `curl | bash`, least privilege, and CI/CD security.

---

## 48. Referensi Resmi dan Bacaan Lanjutan

- ShellCheck documentation and wiki — shell static analysis and rule explanations.
- shfmt documentation — shell formatting.
- Bats documentation — Bash Automated Testing System.
- GNU Bash Reference Manual — shell functions, traps, parameters, arrays, exit status.
- POSIX Utility Syntax Guidelines — conventions for CLI behavior.
- Google Shell Style Guide — reviewable shell style perspective.
- BashFAQ/BashPitfalls — common shell correctness and testing pitfalls.

---

## 49. Status Seri

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
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-009.md">⬅️ Part 009 — CLI Design for Internal Tools</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-011.md">Part 011 — Security Model for Shell Scripts ➡️</a>
</div>
