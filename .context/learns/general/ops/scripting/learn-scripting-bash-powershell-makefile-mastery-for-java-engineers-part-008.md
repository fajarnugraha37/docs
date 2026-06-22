# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-008.md

# Part 008 — Process Control: Background Jobs, Signals, Timeouts, Concurrency

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: mengontrol lifecycle proses di Bash: foreground/background jobs, PID, `wait`, signal, trap, timeout, cancellation, fan-out/fan-in, locks, dan concurrency yang aman.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya:

- Part 001: process, stream, exit code, environment.
- Part 002: parsing, expansion, quoting.
- Part 003: POSIX shell baseline.
- Part 004: Bash fundamentals.
- Part 005: error handling.
- Part 006: data handling.
- Part 007: filesystem automation.

Part 008 kembali ke fondasi proses, tetapi lebih dalam:

> Bagaimana script mengelola proses yang berjalan lama, background jobs, timeout, signal, cancellation, dan parallel execution?

Bash sering dipakai untuk workflow seperti:

```bash
run_server &
run_worker &
wait
```

atau:

```bash
for module in api worker scheduler; do
  mvn -pl "$module" test &
done
wait
```

Terlihat sederhana, tetapi ada banyak failure mode:

- satu child gagal, script tetap menunggu child lain tanpa status jelas;
- Ctrl+C hanya membunuh parent, child tetap hidup;
- background job menulis log bercampur;
- PID salah ditunggu;
- timeout membunuh proses wrapper tapi tidak child tree;
- parallel job overload CPU/memory;
- race condition saat menulis file yang sama;
- cleanup tidak berjalan;
- signal tidak diteruskan;
- script hang karena proses tidak pernah selesai;
- CI job cancelled tapi container/port/temp file tertinggal.

Tujuan part ini:

> Membuat concurrency Bash tetap explicit, bounded, observable, dan safe.

---

## 1. Mental Model: Bash Bukan Process Supervisor Penuh

Bash bisa menjalankan dan menunggu proses, tetapi Bash bukan supervisor seperti:

- systemd;
- Kubernetes;
- supervisord;
- Nomad;
- PM2;
- Gradle worker API;
- Java ExecutorService;
- Go context cancellation.

Bash cocok untuk:

- menjalankan beberapa command paralel sederhana;
- menunggu proses selesai;
- memberi timeout;
- cleanup child process;
- orchestration local/CI;
- test matrix kecil;
- diagnostic collection.

Bash kurang cocok untuk:

- long-running service supervision;
- restart policy kompleks;
- health check lifecycle panjang;
- process tree management cross-platform;
- distributed coordination;
- queue worker management;
- high-scale parallelism;
- complex dependency scheduling.

Rule:

> Gunakan Bash untuk bounded process orchestration, bukan sebagai platform supervisor.

---

## 2. Foreground Process

Command normal berjalan foreground:

```bash
mvn test
```

Shell menunggu sampai command selesai.

Exit status command menjadi `$?`.

Dengan `set -e`, failure bisa menghentikan script.

Foreground cocok untuk:

- step sequential;
- command yang harus selesai sebelum lanjut;
- command yang butuh stdin/TTY;
- command yang log-nya ingin langsung terlihat.

---

## 3. Background Process dengan `&`

Menjalankan command di background:

```bash
sleep 10 &
```

Shell langsung lanjut.

PID background process terakhir:

```bash
pid=$!
```

Example:

```bash
sleep 10 &
pid=$!

echo "started sleep pid=$pid"
wait "$pid"
echo "done"
```

`$!` harus disimpan segera setelah command background. Jika menjalankan background command lain, `$!` berubah.

Bad:

```bash
server &
worker &
server_pid=$!  # ini PID worker, bukan server
```

Good:

```bash
server &
server_pid=$!

worker &
worker_pid=$!
```

---

## 4. `wait`: Menunggu Child Process

Basic:

```bash
cmd &
pid=$!

wait "$pid"
status=$?
```

`wait` mengembalikan exit status proses yang ditunggu.

Example:

```bash
false &
pid=$!

if wait "$pid"; then
  echo "success"
else
  status=$?
  echo "failed status=$status"
fi
```

Without PID:

```bash
wait
```

menunggu semua background jobs yang diketahui shell.

Caveat:

- `wait` tanpa PID mengembalikan status salah satu/terakhir job, tidak cukup untuk detail semua job;
- untuk parallel jobs, simpan PID masing-masing;
- PID hanya valid untuk child shell saat ini;
- tidak bisa `wait` arbitrary PID yang bukan child langsung.

---

## 5. Basic Parallel Fan-Out/Fan-In

Example:

```bash
pids=()

for module in api worker scheduler; do
  (
    cd "$project_root"
    mvn -pl "$module" test
  ) &
  pids+=("$!")
done

status=0

for pid in "${pids[@]}"; do
  if ! wait "$pid"; then
    status=1
  fi
done

exit "$status"
```

What this does:

- starts tests in parallel;
- records PID;
- waits for all;
- returns non-zero if any failed.

Limitations:

- does not know which module failed unless tracked;
- logs interleave;
- unbounded if module list large;
- if one fails, others still run;
- Ctrl+C handling not shown.

Better tracking:

```bash
pids=()
names=()

for module in api worker scheduler; do
  (
    mvn -pl "$module" test
  ) &
  pids+=("$!")
  names+=("$module")
done

status=0

for i in "${!pids[@]}"; do
  pid="${pids[$i]}"
  name="${names[$i]}"

  if wait "$pid"; then
    printf 'OK: %s\n' "$name" >&2
  else
    child_status=$?
    printf 'FAILED: %s status=%s\n' "$name" "$child_status" >&2
    status=1
  fi
done

exit "$status"
```

---

## 6. Background Subshell for Isolation

Use subshell:

```bash
(
  cd "$module_dir"
  mvn test
) &
pid=$!
```

This is useful because:

- `cd` does not affect parent;
- temporary shell options can be local to subshell;
- function/local state separated;
- command group has one PID from shell perspective.

But note: actual `mvn` is child of the subshell. Killing only the subshell may or may not kill descendant depending timing/process group. Process tree cleanup is more nuanced.

---

## 7. Logs in Parallel Jobs

Parallel logs interleave:

```bash
mvn -pl api test &
mvn -pl worker test &
wait
```

CI logs become hard to read.

Strategies:

### 7.1 Prefix output

```bash
run_with_prefix() {
  local name="$1"
  shift

  "$@" > >(sed "s/^/[$name] /") 2> >(sed "s/^/[$name] /" >&2)
}
```

Use:

```bash
run_with_prefix api mvn -pl api test &
```

Caveats:

- process substitution Bash-specific;
- `sed` processes are extra children;
- exit status of command still okay if function waits directly, but output process failures ignored;
- buffering can change.

### 7.2 Separate log files

```bash
log_dir="$project_root/build/parallel-logs"
mkdir -p -- "$log_dir"

(
  mvn -pl "$module" test
) > "$log_dir/$module.out" 2> "$log_dir/$module.err" &
```

After wait, print failed logs.

This is often better for CI.

### 7.3 Keep parallelism at build tool level

Maven/Gradle may already support parallelism:

```bash
mvn -T 1C test
./gradlew test --parallel
```

Prefer build tool native parallelism when it understands project graph.

---

## 8. Bounded Parallelism

Unbounded:

```bash
for file in *.log; do
  process "$file" &
done
wait
```

If 10,000 files, bad.

Use bounded workers.

### 8.1 Simple Bash 4.3+ `wait -n`

`wait -n` waits for any one job to finish.

```bash
max_jobs=4
running=0
status=0

for item in "${items[@]}"; do
  process_item "$item" &
  running=$((running + 1))

  if ((running >= max_jobs)); then
    if ! wait -n; then
      status=1
    fi
    running=$((running - 1))
  fi
done

while ((running > 0)); do
  if ! wait -n; then
    status=1
  fi
  running=$((running - 1))
done

exit "$status"
```

Caveats:

- `wait -n` requires Bash 4.3+;
- this loses mapping of which job failed unless you log inside job;
- if jobs finish between checks, `running` counter is approximate but works for this controlled pattern;
- with `set -e`, use `if ! wait -n` to handle non-zero.

### 8.2 `xargs -P`

For simple per-item commands:

```bash
printf '%s\0' "${items[@]}" |
xargs -0 -n1 -P4 bash -c 'process_item "$1"' _
```

Caveats:

- exporting functions to child Bash is tricky;
- quoting matters;
- logs interleave;
- `xargs` behavior varies;
- error handling can be less transparent.

### 8.3 GNU parallel

Powerful, but external dependency. Use only if project standardizes it.

---

## 9. Worker Pool Pattern with Named Function

For Bash, a simple bounded parallel function:

```bash
run_parallel() {
  local max_jobs="$1"
  shift

  local -a items=("$@")
  local running=0
  local status=0
  local item

  for item in "${items[@]}"; do
    process_item "$item" &
    running=$((running + 1))

    if ((running >= max_jobs)); then
      if ! wait -n; then
        status=1
      fi
      running=$((running - 1))
    fi
  done

  while ((running > 0)); do
    if ! wait -n; then
      status=1
    fi
    running=$((running - 1))
  done

  return "$status"
}
```

But `process_item` is global function. This is okay for small scripts, but not a general framework.

For serious parallel orchestration, consider:

- Make `-j`;
- Gradle/Maven parallelism;
- CI matrix;
- GNU parallel;
- a real language.

---

## 10. Signals: What Happens on Ctrl+C?

Ctrl+C sends SIGINT to foreground process group. In interactive shell, child foreground command usually gets it.

For background jobs, behavior differs.

Script:

```bash
long_task &
pid=$!
wait "$pid"
```

If user presses Ctrl+C while script waits, what happens?

- parent Bash may receive SIGINT;
- child may or may not receive depending process group/foreground/background;
- cleanup may not kill background child;
- CI cancellation may send SIGTERM to parent only.

You need traps.

---

## 11. Trap Basics for Signal Handling

```bash
on_interrupt() {
  printf 'Interrupted\n' >&2
  exit 130
}

trap on_interrupt INT
```

SIGTERM:

```bash
trap 'printf "Terminated\n" >&2; exit 143' TERM
```

EXIT cleanup:

```bash
cleanup() {
  local status=$?
  # cleanup here
  exit "$status"
}

trap cleanup EXIT
```

Use signal-specific traps to set status, and EXIT trap for cleanup.

---

## 12. Killing Child Processes on Exit

If script starts background jobs, cleanup should stop them.

```bash
pids=()

cleanup() {
  local status=$?

  if ((${#pids[@]} > 0)); then
    printf 'Stopping child processes...\n' >&2
    kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi

  exit "$status"
}

trap cleanup EXIT INT TERM
```

Problem: if trap handles INT/TERM and exits with original status, original status may be 0 depending context. Better:

```bash
on_exit() {
  local status=$?

  if ((${#pids[@]} > 0)); then
    kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi

  exit "$status"
}

on_int() {
  exit 130
}

on_term() {
  exit 143
}

trap on_exit EXIT
trap on_int INT
trap on_term TERM
```

When INT triggers, `on_int` exits 130, then EXIT trap runs and kills children, preserving 130 if written carefully.

But current `on_exit` captures status at start, so okay.

---

## 13. Process Groups: Killing Trees, Not Just Direct Children

Killing PID:

```bash
kill "$pid"
```

kills that process, not necessarily its children.

If background command launches grandchildren, they can survive.

Example:

```bash
bash -c 'sleep 999 &' &
pid=$!
kill "$pid"
```

The `sleep` may remain.

More robust: start child in its own process group/session and kill group.

Common Linux pattern:

```bash
setsid bash -c 'your command here' &
pid=$!
```

Then kill process group:

```bash
kill -- "-$pid"
```

Caveats:

- `setsid` may not exist everywhere;
- negative PID means process group ID;
- process group details can be tricky;
- not portable to all platforms;
- if `pid` is not group leader, this fails.

Alternative in many CI scripts: track direct child commands and avoid commands that daemonize.

For robust supervision, use a proper supervisor.

---

## 14. `exec` and Signal Behavior

In wrapper scripts, use `exec` to replace shell with target process:

```bash
exec java -jar app.jar
```

Benefits:

- target process receives signals directly;
- no extra shell process;
- target becomes PID of script process;
- better container entrypoint behavior.

Without `exec`:

```bash
java -jar app.jar
```

shell remains parent and waits. Signal forwarding may be less direct.

Use `exec` when script's final action is to run long-lived process.

Do not use `exec` if script needs to run cleanup after command exits, unless cleanup is handled outside.

---

## 15. Timeout Basics

GNU coreutils `timeout`:

```bash
timeout 60s mvn test
```

If command exceeds 60 seconds, it is terminated.

Common options:

```bash
timeout --kill-after=10s 60s command
```

This sends TERM at 60s, KILL after 10s if still alive.

Caveats:

- GNU-specific options;
- macOS may not have `timeout`;
- BusyBox timeout options differ;
- timeout may kill wrapper but not full process tree depending command behavior;
- exit code usually 124 on timeout.

Handle:

```bash
if timeout 60s command; then
  log "success"
else
  status=$?
  case "$status" in
    124)
      die "command timed out after 60s"
      ;;
    *)
      die "command failed status=$status"
      ;;
  esac
fi
```

---

## 16. Tool-Specific Timeouts

Prefer tool-specific timeout if available.

Curl:

```bash
curl --connect-timeout 5 --max-time 30 ...
```

SSH:

```bash
ssh -o ConnectTimeout=10 ...
```

Maven/Gradle test timeout often configured in test framework/build config.

Java app startup wait should have explicit deadline:

```bash
deadline=$((SECONDS + 60))

until curl --silent --fail "$health_url" >/dev/null; do
  if ((SECONDS >= deadline)); then
    die "service did not become healthy within 60s"
  fi
  sleep 2
done
```

`SECONDS` is Bash variable counting seconds since shell started or assignment.

---

## 17. Waiting for Readiness

Starting service then waiting:

```bash
java -jar app.jar &
app_pid=$!

deadline=$((SECONDS + 60))

until curl --silent --fail "http://localhost:8080/actuator/health" >/dev/null; do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    wait "$app_pid" || status=$?
    die "app exited before becoming healthy status=${status:-unknown}"
  fi

  if ((SECONDS >= deadline)); then
    die "app did not become healthy within 60s"
  fi

  sleep 1
done

log "app is healthy"
```

`kill -0 "$pid"` checks if process exists and permission allows signaling; it does not kill.

Caveats:

- PID may be reused after process exits, but for immediate child and short window usually okay;
- health endpoint may return healthy before app truly ready for all dependencies;
- logs should be captured for failure.

---

## 18. Starting Temporary Service for Integration Test

Pattern:

```bash
pids=()
log_dir="build/test-logs"
mkdir -p -- "$log_dir"

cleanup() {
  local status=$?

  if ((${#pids[@]} > 0)); then
    kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi

  exit "$status"
}

trap cleanup EXIT

java -jar target/app.jar > "$log_dir/app.out" 2> "$log_dir/app.err" &
app_pid=$!
pids+=("$app_pid")

wait_for_health "$app_pid" "http://localhost:8080/actuator/health" 60

mvn -Pintegration test
```

This ensures app is killed when script exits.

Important:

- app logs to file;
- app PID tracked;
- health wait checks process still alive;
- cleanup runs on success/failure.

---

## 19. Handling Background Failure Early

Suppose app dies while tests run.

Simple script:

```bash
app &
app_pid=$!
run_tests
wait "$app_pid"
```

If app dies early, tests may fail later with unclear error.

Better: monitor.

Simpler approach:

```bash
app &
app_pid=$!

if ! wait_for_health "$app_pid" "$health_url" 60; then
  die "app failed readiness"
fi

if ! run_tests; then
  test_status=$?
  if ! kill -0 "$app_pid" 2>/dev/null; then
    wait "$app_pid" || app_status=$?
    die "tests failed and app exited status=${app_status:-unknown}"
  fi
  exit "$test_status"
fi
```

For concurrent monitoring, Bash gets complex. Consider test framework or supervisor if needed.

---

## 20. `wait -n` for “Any Process Failed” Monitoring

Start multiple services:

```bash
service_a &
pid_a=$!
service_b &
pid_b=$!

pids=("$pid_a" "$pid_b")
```

Wait for any to exit:

```bash
if ! wait -n; then
  status=$?
  die "a background service failed status=$status"
fi
```

But after `wait -n`, identifying which process ended is not straightforward in older Bash. Bash 5.1 has `wait -n -p var` in some versions, but portability varies.

For robust mapping, use per-process log files and health checks.

---

## 21. Cancellation Semantics

When script is cancelled:

- stop child processes;
- remove temp files;
- release locks;
- avoid starting new side effects;
- exit with meaningful status;
- leave enough logs.

Pattern:

```bash
cancelled=false

on_int() {
  cancelled=true
  exit 130
}

on_term() {
  cancelled=true
  exit 143
}

trap on_int INT
trap on_term TERM
```

But if you set variable and do not exit, script continues unless logic checks it. For most scripts, exit on signal.

---

## 22. Killing Gracefully Then Forcefully

```bash
terminate_children() {
  local -a children=("$@")

  ((${#children[@]} > 0)) || return 0

  kill "${children[@]}" 2>/dev/null || true

  local deadline=$((SECONDS + 10))

  while ((SECONDS < deadline)); do
    local alive=0
    local pid
    for pid in "${children[@]}"; do
      if kill -0 "$pid" 2>/dev/null; then
        alive=1
      fi
    done

    ((alive == 0)) && return 0
    sleep 1
  done

  kill -KILL "${children[@]}" 2>/dev/null || true
}
```

Use in cleanup:

```bash
terminate_children "${pids[@]}"
wait "${pids[@]}" 2>/dev/null || true
```

Caveats:

- kills only direct PIDs, not full process tree;
- `kill -KILL` should be last resort;
- for process groups, use group kill if designed.

---

## 23. Background Jobs and `set -e`

This is important:

```bash
set -e

false &
echo "still running"
wait
```

The background command failure does not trigger `errexit` until/if `wait` returns non-zero and is not handled.

Always wait and inspect status.

Bad:

```bash
cmd1 &
cmd2 &
wait
echo "done"
```

If one command fails, `wait` may return non-zero, and with `set -e`, script may exit without clear message.

Better:

```bash
status=0
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then
    status=1
  fi
done

if ((status != 0)); then
  die "one or more background jobs failed"
fi
```

---

## 24. Background Jobs and stdin

Background jobs that read stdin can conflict.

Example:

```bash
while read -r item; do
  process "$item" &
done < items.txt
```

If `process` reads stdin, it may consume from `items.txt`.

Avoid by redirecting stdin:

```bash
process "$item" </dev/null &
```

Pattern:

```bash
(
  process "$item" </dev/null
) &
```

Many commands do not read stdin, but some do unexpectedly.

For background jobs in automation, consider redirecting stdin from `/dev/null`.

---

## 25. Daemonizing Is Usually Wrong in Scripts

Avoid commands that daemonize themselves inside CI/local automation unless you fully understand lifecycle.

Bad:

```bash
some_server --daemon
```

Then script may not know PID or status.

Better:

```bash
some_server --foreground &
pid=$!
```

You can then:

- capture logs;
- wait;
- kill;
- check readiness;
- cleanup.

For Java app:

```bash
java -jar app.jar &
app_pid=$!
```

not:

```bash
nohup java -jar app.jar &
```

unless intentionally detached.

---

## 26. `nohup`, `disown`, and Why You Rarely Need Them

`nohup` ignores SIGHUP and redirects output if needed. `disown` removes job from shell job table.

These are for interactive shell detachment.

In automation scripts, detaching is usually bad because:

- parent cannot clean up;
- CI may finish while process keeps running;
- logs are lost;
- ports remain occupied;
- failure is invisible.

Use only for explicit long-running installation/startup scripts, and even then consider systemd/container supervisor.

---

## 27. Job Control Is Usually Off in Scripts

Interactive shell has job control:

```bash
jobs
fg
bg
```

In non-interactive scripts, job control is usually off.

Do not depend on `%1`, `fg`, `bg` in scripts.

Use PIDs and `wait`.

---

## 28. `coproc`: Advanced, Usually Avoid

Bash has `coproc` for co-processes with pipes. It is powerful but complex.

For most automation:

- use temporary files;
- use stdin/stdout pipeline;
- use a real language if bidirectional process protocol needed.

If you think you need `coproc`, you probably need Python/Go/Java unless the use case is very small and controlled.

---

## 29. Locking and Concurrency

Part 007 covered file locks. In process concurrency, locks prevent multiple scripts from mutating same state.

Example:

```bash
exec 9>"$project_root/.test-env.lock"

if ! flock -n 9; then
  die "test environment already in use"
fi
```

Use when:

- starting service on fixed port;
- mutating shared local database;
- writing shared cache;
- deploying same environment;
- modifying release symlink.

If no `flock`, directory lock.

Concurrency without locking is okay only when tasks are independent.

---

## 30. Fixed Ports and Race Conditions

Integration test starting service on fixed port:

```bash
java -Dserver.port=8080 -jar app.jar &
```

Problems:

- port already used;
- parallel CI jobs collide;
- previous app not cleaned up;
- readiness hits wrong process.

Better:

- use random port if app supports it;
- allocate port safely;
- pass port to tests;
- use isolated container network;
- lock around fixed port.

Naive free port check is race-prone:

```bash
port="$(find_free_port)"
java -Dserver.port="$port" ...
```

Another process can take port before app binds.

Better if Java app supports `server.port=0` then discovers actual port from logs/actuator/file. Or use test framework.

Bash can orchestrate, but robust port allocation is hard.

---

## 31. Parallel Build/Test: Prefer Native Tools

Instead of Bash:

```bash
for module in modules/*; do
  (cd "$module" && mvn test) &
done
wait
```

Consider:

```bash
mvn -T 1C test
```

or Gradle:

```bash
./gradlew test --parallel
```

Why?

Build tools understand:

- dependency graph;
- module ordering;
- shared caches;
- reporting;
- fail-fast modes;
- worker limits;
- test isolation;
- incremental build state.

Bash parallelism is okay for independent tasks, but not replacement for build engine.

---

## 32. CI Matrix vs Bash Parallelism

If tasks are heavy and independent, CI matrix is often better:

- clearer logs per job;
- better resource scheduling;
- retry individual job;
- parallelism controlled by CI;
- artifacts separated;
- failure attribution clear.

Use Bash parallelism for small local fan-out. Use CI matrix for large verification matrix.

Example:

```text
Bash parallel:
  run shellcheck on many scripts
  compress many independent logs
  query several endpoints

CI matrix:
  Java 17 vs 21
  Linux vs Windows
  database versions
  module test shards
```

---

## 33. Example: Parallel ShellCheck with Bounded Jobs

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

  local max_jobs="${MAX_JOBS:-4}"
  [[ "$max_jobs" =~ ^[0-9]+$ && "$max_jobs" -gt 0 ]] || die "MAX_JOBS must be positive integer"

  mapfile -t scripts < <(find scripts -type f -name '*.sh' | sort)

  ((${#scripts[@]} > 0)) || {
    printf 'No scripts found\n' >&2
    return 0
  }

  local running=0
  local status=0
  local script

  for script in "${scripts[@]}"; do
    (
      printf 'Checking %s\n' "$script" >&2
      shellcheck "$script"
    ) &
    running=$((running + 1))

    if ((running >= max_jobs)); then
      if ! wait -n; then
        status=1
      fi
      running=$((running - 1))
    fi
  done

  while ((running > 0)); do
    if ! wait -n; then
      status=1
    fi
    running=$((running - 1))
  done

  return "$status"
}

main "$@"
```

Caveat: file names with newline are not handled by `mapfile` line output. For repo scripts, acceptable if enforced.

---

## 34. Example: Temporary App for Integration Test

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

pids=()
log_dir=""

log() {
  printf '%s\n' "$*" >&2
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  local status=$?

  if ((${#pids[@]} > 0)); then
    log "Stopping background processes"
    kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi

  if [[ "$status" -ne 0 && -n "${log_dir:-}" && -d "$log_dir" ]]; then
    log "Failure logs are in: $log_dir"
  fi

  exit "$status"
}

trap cleanup EXIT

wait_for_health() {
  local pid="$1"
  local url="$2"
  local timeout_seconds="$3"

  local deadline=$((SECONDS + timeout_seconds))

  while true; do
    if curl --silent --fail "$url" >/dev/null 2>&1; then
      return 0
    fi

    if ! kill -0 "$pid" 2>/dev/null; then
      local app_status=0
      wait "$pid" || app_status=$?
      die "app exited before health check passed; status=$app_status"
    fi

    if ((SECONDS >= deadline)); then
      die "health check timed out after ${timeout_seconds}s: $url"
    fi

    sleep 1
  done
}

main() {
  mkdir -p build/test-logs
  log_dir="$(cd build/test-logs && pwd)"

  [[ -f target/app.jar ]] || die "target/app.jar not found; run build first"

  java -jar target/app.jar > "$log_dir/app.out" 2> "$log_dir/app.err" &
  app_pid=$!
  pids+=("$app_pid")

  wait_for_health "$app_pid" "http://localhost:8080/actuator/health" 60

  mvn -Pintegration test
}

main "$@"
```

This is a practical pattern for local integration automation.

---

## 35. Example: Fail-Fast Parallel Jobs with Cleanup

Goal: if one job fails, stop others.

```bash
#!/usr/bin/env bash
set -euo pipefail

pids=()

cleanup() {
  local status=$?
  if ((${#pids[@]} > 0)); then
    kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi
  exit "$status"
}

trap cleanup EXIT

run_job() {
  local name="$1"
  shift

  "$@" > "build/${name}.out" 2> "build/${name}.err"
}

main() {
  mkdir -p build

  run_job api mvn -pl api test &
  pids+=("$!")

  run_job worker mvn -pl worker test &
  pids+=("$!")

  run_job scheduler mvn -pl scheduler test &
  pids+=("$!")

  if ! wait -n; then
    echo "A job failed; stopping remaining jobs" >&2
    exit 1
  fi

  # One job completed successfully. Need wait remaining.
  local status=0
  local pid
  for pid in "${pids[@]}"; do
    if ! wait "$pid" 2>/dev/null; then
      status=1
    fi
  done

  return "$status"
}

main "$@"
```

This example is not perfect:

- `wait -n` success does not mean all success;
- after one success, it waits all;
- after one failure, `exit 1` triggers cleanup killing remaining;
- logs are per job.

For complex fail-fast with identity, Bash gets awkward.

---

## 36. Process Control Anti-Patterns

### 36.1 Starting background jobs without wait

Bad:

```bash
run_task &
echo "done"
```

The script exits while task continues or is killed depending shell/session.

### 36.2 Not storing PID immediately

Bad:

```bash
server &
do_something
pid=$!
```

`$!` may no longer be server PID if another background job started.

### 36.3 Killing only parent wrapper

Bad:

```bash
bash -c 'long_child' &
pid=$!
kill "$pid"
```

Grandchild may survive.

### 36.4 Unbounded parallelism

Bad:

```bash
for x in "${items[@]}"; do
  process "$x" &
done
wait
```

unless item count is known small.

### 36.5 Ignoring background failures

Bad:

```bash
cmd1 &
cmd2 &
wait
```

without status attribution.

### 36.6 Daemonizing in CI

Bad:

```bash
nohup java -jar app.jar &
```

unless explicitly intended.

### 36.7 Interactive commands in background

Bad:

```bash
read -p "Continue?" &
```

Background job may block or read wrong stdin.

---

## 37. Observability for Process Workflows

For each background process, log:

- name;
- PID;
- command or safe summary;
- log file location;
- start time;
- readiness result;
- exit status.

Example:

```bash
log "Started app pid=$app_pid logs=$log_dir/app.out"
```

On failure:

```bash
log "App stderr:"
tail -n 100 "$log_dir/app.err" >&2 || true
```

Do not dump huge logs unless useful. In CI, tail relevant section.

---

## 38. Designing Process Invariants

Example integration script invariants:

```text
If exit 0:
- app started successfully
- health check passed
- integration tests passed
- app process stopped
- logs stored in build/test-logs

If exit non-zero:
- app process stopped if it was started
- logs preserved
- exit message indicates failed phase
- no orphan process remains
```

For parallel verification:

```text
If exit 0:
- all modules completed successfully
- each module log exists
- no background jobs remain

If exit non-zero:
- failed module(s) identifiable
- remaining jobs either completed or were cancelled
- final status non-zero
```

This turns process control into engineering design.

---

## 39. Checklist: Process Control Review

### Background jobs

- Is every background job PID captured immediately?
- Is every PID waited?
- Is failure status checked?
- Are names/logs mapped to PIDs?

### Cleanup

- Are child processes killed on EXIT/INT/TERM?
- Are temp files/locks released?
- Does cleanup preserve exit status?
- Are long-running children prevented from becoming orphans?

### Signals

- Are Ctrl+C and CI cancellation handled?
- Is exit code meaningful, e.g., 130/143?
- Are final actions skipped after cancellation?

### Timeouts

- Can any command hang?
- Is there a timeout or tool-specific deadline?
- Is timeout failure distinguishable from normal failure?

### Parallelism

- Is parallelism bounded?
- Are tasks independent?
- Are shared files/ports/resources locked?
- Are logs readable?
- Is native tool/CI parallelism better?

### Readiness

- If service starts, is readiness checked?
- Does readiness verify the right process?
- What happens if service exits early?

---

## 40. Mini Lab

### Lab 1 — Capture PID and wait

```bash
sleep 2 &
pid=$!
echo "pid=$pid"
wait "$pid"
echo "status=$?"
```

Change `sleep 2` to `false` and inspect status.

---

### Lab 2 — Parallel jobs with failure

Start three jobs:

```bash
(sleep 1; exit 0) &
(sleep 2; exit 3) &
(sleep 1; exit 0) &
```

Capture PIDs and report which failed.

---

### Lab 3 — Cleanup child on Ctrl+C

Write script that starts:

```bash
sleep 999 &
```

Add trap cleanup. Run and press Ctrl+C. Verify no `sleep 999` remains.

---

### Lab 4 — Timeout

Run:

```bash
timeout 2s sleep 10
echo "$?"
```

Handle status 124 explicitly.

---

### Lab 5 — Bounded parallelism

Implement processing 10 items with max 3 concurrent jobs using `wait -n`.

Each job:

```bash
sleep "$((RANDOM % 3 + 1))"
```

Make one fail and verify final status non-zero.

---

## 41. Design Exercise: Integration Test Harness

Design `scripts/integration-test.sh`:

Requirements:

- build jar if missing or accept `--jar`;
- start app in background;
- redirect logs to `build/integration-logs`;
- wait for health endpoint with timeout;
- run integration tests;
- cleanup app on success/failure/interrupt;
- if app exits early, fail with app log tail;
- support `--port`;
- refuse if fixed port is in use or use app port 0 strategy;
- exit non-zero on test/app failure;
- no orphan process.

Write invariants before implementation.

This exercise integrates:

- filesystem logs;
- process lifecycle;
- timeout;
- health check;
- cleanup;
- error messages.

---

## 42. Part 008 Summary

Process control in Bash is powerful but easy to get subtly wrong.

Key takeaways:

1. Bash is good for bounded orchestration, not full supervision.
2. Capture `$!` immediately after starting background jobs.
3. Always `wait` for background jobs and inspect status.
4. Map PIDs to names/logs for observability.
5. Use subshells for isolated per-job context.
6. Avoid unbounded parallelism.
7. Prefer native build tool or CI parallelism for large workloads.
8. Handle INT/TERM/EXIT to clean up children.
9. Killing a PID may not kill the full process tree.
10. Use `exec` for final long-running process in wrapper/entrypoint.
11. Use timeouts and readiness checks for services.
12. Redirect logs for background services.
13. Avoid daemonizing in CI scripts.
14. Use locks for shared resources like ports, caches, release dirs.
15. Design process workflows with invariants: no orphan process, clear failure, bounded resources.

Part 009 will shift from mechanics to product design: CLI design for internal tools.

---

## 43. Referensi Resmi dan Bacaan Lanjutan

- GNU Bash Reference Manual — Job Control, Lists, Pipelines, Signals, Traps, `wait`.
- GNU Coreutils Manual — `timeout`, `kill`, `sleep`.
- POSIX Signal concepts — process termination and signal conventions.
- ShellCheck documentation — warnings related to traps, background jobs, and quoting.
- BashFAQ/BashPitfalls — discussions of `set -e`, background jobs, subshells, traps, and process management.
- Maven and Gradle documentation — native parallel execution options.
- curl documentation — timeout options and health-check style usage.

---

## 44. Status Seri

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
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-007.md">⬅️ Part 007 — Filesystem Automation: Safe File Operations</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-009.md">Part 009 — CLI Design for Internal Tools ➡️</a>
</div>
