# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-027.md

# Part 027 — Advanced Bash and PowerShell Interop

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: mendesain interoperabilitas antara Bash dan PowerShell secara aman: process boundary, argument passing, JSON contracts, exit codes, stdout/stderr discipline, quoting, cross-platform CI, Make facade, dan strategi menghindari drift antara scripts.

---

## 0. Posisi Part Ini dalam Seri

Kita sudah membahas:

- Bash dan POSIX shell sebagai process/text automation;
- PowerShell sebagai object/structured automation;
- Make sebagai workflow facade;
- CI/CD, release, deployment, dan operational scripts.

Part 027 menjawab pertanyaan realistis di banyak tim:

> Kalau repo punya Bash dan PowerShell, bagaimana agar keduanya bekerja bersama tanpa kacau?

Contoh situasi:

- Linux CI sudah punya Bash scripts.
- Windows developers butuh PowerShell.
- Structured JSON lebih nyaman di PowerShell.
- Container entrypoint tetap POSIX sh.
- Makefile menjadi facade di Linux/devcontainer.
- CI matrix menjalankan Bash di Linux dan PowerShell di Windows.
- Beberapa workflow perlu reusable logic tanpa rewrite penuh.

Interop yang buruk menghasilkan:

- quoting bugs;
- broken paths;
- swallowed exit codes;
- inconsistent behavior;
- duplicated logic;
- impossible debugging;
- works-on-one-shell-only scripts.

Interop yang bagus punya boundary jelas.

---

## 1. Core Principle: Interop Is Process Boundary Design

Bash and PowerShell interop is not magic.

When Bash calls PowerShell:

```bash
pwsh -NoProfile -File ./scripts/Build-Metadata.ps1 -Output Json
```

that is process boundary.

When PowerShell calls Bash:

```powershell
& bash ./scripts/deploy-release.sh --env staging
```

that is also process boundary.

At process boundary, define:

```text
arguments
environment variables
working directory
stdin
stdout
stderr
exit code
files/artifacts
encoding
```

Treat shell interop like API design.

---

## 2. Preferred Data Contract: JSON

Bash outputs text well. PowerShell outputs objects well. The bridge should often be JSON.

PowerShell emits JSON:

```powershell
[PSCustomObject]@{
  service = 'payment'
  version = '1.2.3'
  commit = 'abc123'
} | ConvertTo-Json -Depth 5
```

Bash consumes with `jq`:

```bash
metadata="$(pwsh -NoProfile -File ./Build-Metadata.ps1 -Output Json)"
version="$(jq -r '.version' <<<"$metadata")"
```

Bash emits JSON using `jq`:

```bash
jq -n \
  --arg service "$service" \
  --arg version "$version" \
  '{service: $service, version: $version}'
```

PowerShell consumes:

```powershell
$data = $json | ConvertFrom-Json
$data.version
```

JSON is better than fragile human text parsing.

---

## 3. Stdout vs Stderr Discipline

Interop depends on clean streams.

Rule:

```text
stdout = machine-readable output
stderr = logs/diagnostics
exit code = success/failure
```

Bash:

```bash
printf '%s\n' "$json"
printf '==> Running step\n' >&2
```

PowerShell:

```powershell
$result | ConvertTo-Json -Depth 5
Write-Information "Running step" -InformationAction Continue
```

But be careful: PowerShell information stream may be rendered in host output depending settings. For scripts producing machine JSON, keep logs out of stdout.

PowerShell simple pattern:

```powershell
[Console]::Error.WriteLine("==> Running step")
$result | ConvertTo-Json -Depth 5
```

For strict machine contracts, explicit stderr writes are okay.

---

## 4. Exit Code Contract

Bash calling PowerShell:

```bash
json="$(pwsh -NoProfile -File ./script.ps1)" || {
  echo "PowerShell script failed" >&2
  exit 1
}
```

PowerShell calling Bash:

```powershell
& bash ./script.sh
if ($LASTEXITCODE -ne 0) {
  throw "Bash script failed with exit code $LASTEXITCODE"
}
```

Do not ignore exit codes.

PowerShell exceptions only become process exit non-zero if script exits/fails properly. In CI, `pwsh -File script.ps1` generally returns non-zero for unhandled terminating error. Still, structure script intentionally:

```powershell
try {
  # work
}
catch {
  Write-Error $_
  exit 1
}
```

For library-like functions, throw. For script entrypoint, allow non-zero process exit.

---

## 5. Argument Passing: Avoid One Big String

Bad Bash:

```bash
pwsh -Command "./Deploy.ps1 -Environment $ENV -Version $VERSION"
```

This mixes shell parsing with PowerShell parsing.

Better:

```bash
pwsh -NoProfile -File ./Deploy.ps1 -Environment "$ENV" -Version "$VERSION"
```

Bad PowerShell:

```powershell
& bash -c "./deploy.sh --env $Environment --version $Version"
```

Better:

```powershell
& bash ./deploy.sh --env $Environment --version $Version
```

Use native process argument boundaries, not eval-like strings.

---

## 6. Quoting Boundary

Bash quoting protects Bash parsing.

PowerShell quoting protects PowerShell parsing.

When crossing boundary, avoid nested shell code.

Good:

```bash
pwsh -NoProfile -File ./Build.ps1 -Path "$path_with_spaces"
```

Good:

```powershell
& bash ./script.sh --path $PathWithSpaces
```

Bad:

```powershell
& bash -c "script.sh --path '$PathWithSpaces'"
```

Nested quotes become a trap.

If you must use `-c`, pass args separately:

```bash
bash -c 'echo "$1"' _ "$value"
```

But avoid when possible.

---

## 7. Working Directory Boundary

Decide who controls cwd.

Option A: caller sets cwd.

```bash
cd "$repo_root"
pwsh -NoProfile -File ./scripts/Build-Metadata.ps1
```

Option B: callee resolves repo root.

PowerShell:

```powershell
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $RepoRoot
```

Bash:

```bash
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
cd "$repo_root"
```

For reusable scripts, callee should be robust.

Document expected cwd anyway.

---

## 8. Environment Variables Boundary

Pass simple config via env vars when appropriate:

Bash to PowerShell:

```bash
APP_ENV=staging pwsh -NoProfile -File ./Script.ps1
```

PowerShell reads:

```powershell
$env:APP_ENV
```

PowerShell to Bash:

```powershell
$env:APP_ENV = 'staging'
& bash ./script.sh
```

Bash reads:

```bash
"$APP_ENV"
```

For complex data, prefer JSON file/stdin, not huge env vars.

---

## 9. Stdin Boundary

PowerShell can read stdin:

```powershell
$json = [Console]::In.ReadToEnd()
$data = $json | ConvertFrom-Json
```

Bash to PowerShell:

```bash
jq -n --arg env "$ENV" '{env: $env}' |
  pwsh -NoProfile -File ./Process-Payload.ps1
```

PowerShell to Bash:

```powershell
$payload | ConvertTo-Json | & bash ./process-json.sh
```

Bash:

```bash
json="$(cat)"
```

Stdin is good for payloads, but harder to debug than file args. For large/important payloads, use explicit files.

---

## 10. File Boundary

Robust pattern:

```text
caller writes input.json
callee reads input.json and writes output.json
caller reads output.json
```

Advantages:

- inspectable artifacts;
- easier debugging;
- avoids quoting/stdin issues;
- useful in CI.

Example Make:

```make
build/metadata.json:
	pwsh -NoProfile -File ./scripts/Build-Metadata.ps1 -OutputPath $@
```

PowerShell:

```powershell
param([string] $OutputPath)
$result | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8
```

Bash consumes:

```bash
jq -r '.version' build/metadata.json
```

---

## 11. Encoding Boundary

Use UTF-8.

PowerShell:

```powershell
Set-Content -Path output.json -Encoding UTF8
Get-Content -Raw -Encoding UTF8 output.json
```

Bash generally treats bytes; tools expect locale.

Set CI locale if needed:

```bash
export LC_ALL=C.UTF-8
export LANG=C.UTF-8
```

Avoid UTF-16 output from Windows PowerShell 5.1. Prefer PowerShell 7+.

---

## 12. Newline Boundary

JSON output with trailing newline is okay.

But command substitution in Bash strips trailing newlines:

```bash
json="$(pwsh ...)"
```

Usually fine for JSON.

For binary or exact text, use files.

PowerShell arrays written to stdout can become multiple lines. For JSON, force one serialized object:

```powershell
$result | ConvertTo-Json -Depth 10
```

If output must be compact:

```powershell
$result | ConvertTo-Json -Depth 10 -Compress
```

---

## 13. Bash Calling PowerShell: Structured Metadata Example

`Build-Metadata.ps1`:

```powershell
#requires -Version 7.0

[CmdletBinding()]
param(
  [ValidateSet('Json')]
  [string] $Output = 'Json'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$commit = (& git rev-parse --short HEAD)
if ($LASTEXITCODE -ne 0) {
  throw 'git rev-parse failed'
}

$result = [PSCustomObject]@{
  service = 'payment-service'
  commit = ($commit -join '').Trim()
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
}

$result | ConvertTo-Json -Depth 5
```

Bash:

```bash
metadata="$(pwsh -NoProfile -File ./scripts/Build-Metadata.ps1 -Output Json)"
commit="$(jq -r '.commit' <<<"$metadata")"
printf 'commit=%s\n' "$commit"
```

---

## 14. PowerShell Calling Bash: Native Workflow Example

`deploy-release.sh` owns Linux/Kubernetes deployment.

PowerShell wrapper:

```powershell
#requires -Version 7.0

[CmdletBinding()]
param(
  [ValidateSet('staging', 'prod')]
  [string] $Environment,

  [Parameter(Mandatory)]
  [string] $Image,

  [switch] $Plan,
  [switch] $Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$argsList = @('--env', $Environment, '--image', $Image)

if ($Plan) { $argsList += '--plan' }
elseif ($Apply) { $argsList += '--apply' }
else { throw 'Specify -Plan or -Apply' }

& bash "$PSScriptRoot/deploy-release.sh" @argsList
if ($LASTEXITCODE -ne 0) {
  throw "deploy-release.sh failed with exit code $LASTEXITCODE"
}
```

PowerShell provides Windows-friendly parameter UX; Bash owns Unix deployment.

---

## 15. Make as Neutral Facade

Make can call either:

```make
metadata:
	pwsh -NoProfile -File ./scripts/Build-Metadata.ps1 -Output Json

deploy/plan:
	./scripts/deploy-release.sh --env "$(ENV)" --image "$(IMAGE)" --plan
```

Or route based on availability:

```make
ifeq ($(OS),Windows_NT)
VERIFY := pwsh -NoProfile -File ./scripts/Verify.ps1
else
VERIFY := ./scripts/verify.sh
endif

verify:
	$(VERIFY)
```

But OS detection in Make can get messy.

Better: document supported entrypoints or use a single cross-platform script.

---

## 16. Avoid Dual Implementation Drift

Bad:

```text
verify.sh
Verify.ps1
```

both implement same logic independently and drift.

Strategies:

### Strategy A — One source of truth script

Make and CI call same script.

```text
Verify.ps1 as primary cross-platform
```

### Strategy B — Thin wrappers over shared CLI

```text
verify.sh -> platform-cli verify
Verify.ps1 -> platform-cli verify
```

### Strategy C — Split by responsibility

```text
verify.sh handles Linux process workflow
Build-Metadata.ps1 handles JSON metadata
```

No duplicate behavior.

### Strategy D — Contract tests

Both scripts must produce same JSON output for same fixtures.

Avoid maintaining parallel logic unless necessary.

---

## 17. Interop Contract Tests

If Bash and PowerShell wrappers should behave the same, test contract.

Example expected JSON shape:

```json
{
  "service": "payment",
  "version": "1.2.3"
}
```

Test both:

```bash
./scripts/metadata.sh > bash.json
pwsh ./scripts/Metadata.ps1 > pwsh.json
jq -S . bash.json > bash.sorted.json
jq -S . pwsh.json > pwsh.sorted.json
diff -u bash.sorted.json pwsh.sorted.json
```

Or decide one is canonical and the other calls it.

---

## 18. Path Translation Issues

Windows paths:

```text
C:\Users\alice\repo
```

WSL paths:

```text
/mnt/c/Users/alice/repo
```

Git Bash paths:

```text
/c/Users/alice/repo
```

PowerShell paths:

```text
C:\Users\alice\repo
```

Passing Windows path to Bash can fail depending Bash environment.

Avoid cross-environment path translation when possible.

If using WSL, call `wslpath` explicitly:

```bash
wslpath -u 'C:\Users\alice\repo'
```

But this is environment-specific.

Best: run both tools in same environment boundary, e.g., devcontainer/Linux CI, or PowerShell-native on Windows.

---

## 19. Executable Resolution

Bash:

```bash
command -v pwsh
```

PowerShell:

```powershell
Get-Command bash
```

Interop scripts should preflight required tools:

Bash:

```bash
command -v pwsh >/dev/null || die "pwsh is required"
```

PowerShell:

```powershell
if ($null -eq (Get-Command bash -ErrorAction SilentlyContinue)) {
  throw 'bash is required'
}
```

Do not fail halfway with obscure “command not found”.

---

## 20. Shell Profiles

Automation should avoid profiles.

Bash interop:

```bash
bash --noprofile --norc ./script.sh
```

Usually direct script invocation with shebang is enough.

PowerShell:

```bash
pwsh -NoProfile -File ./script.ps1
```

Always use `-NoProfile` for PowerShell automation.

Profiles create hidden dependencies.

---

## 21. Security: Avoid Eval Across Boundaries

Bad Bash:

```bash
pwsh -Command "$USER_SUPPLIED"
```

Bad PowerShell:

```powershell
Invoke-Expression $UserSupplied
```

Bad:

```powershell
& bash -c $UserSupplied
```

Do not pass untrusted command strings across shells.

Pass data as arguments/files/JSON.

---

## 22. Secret Handling Across Boundaries

Avoid logging full command with secrets.

Bad:

```bash
pwsh -File Deploy.ps1 -Token "$TOKEN"
```

CLI args can leak.

Prefer env:

```bash
DEPLOY_TOKEN="$TOKEN" pwsh -NoProfile -File Deploy.ps1
```

PowerShell:

```powershell
$token = $env:DEPLOY_TOKEN
```

Still avoid printing env.

When Bash calls PowerShell, both processes inherit env secrets. Scope narrowly.

---

## 23. Signal and Cancellation

CI cancellation sends signals differently depending shell/process tree.

If Bash starts PowerShell starts child, ensure cancellation propagates enough.

Bash:

```bash
trap 'echo "cancelled" >&2; kill 0' INT TERM
pwsh -NoProfile -File ./Long.ps1 &
wait $!
```

PowerShell process cancellation behavior differs.

For long-running deploys, prefer CI job cancellation plus platform-safe operations. Avoid complex nested background interop unless necessary.

---

## 24. Error Message Preservation

When wrapping one shell with another, do not obscure original error.

Bad:

```text
Deployment failed.
```

Good:

```text
deploy-release.sh failed with exit code 42.
See stderr above.
```

PowerShell wrapper:

```powershell
& bash ./deploy.sh @argsList
$exit = $LASTEXITCODE
if ($exit -ne 0) {
  throw "deploy.sh failed exitCode=$exit env=$Environment"
}
```

Bash wrapper:

```bash
if ! output="$(pwsh ... 2>err.log)"; then
  cat err.log >&2
  die "PowerShell metadata failed"
fi
```

---

## 25. Capturing Stdout and Stderr

Bash:

```bash
stdout_file="$(mktemp)"
stderr_file="$(mktemp)"

if pwsh -NoProfile -File ./script.ps1 >"$stdout_file" 2>"$stderr_file"; then
  cat "$stdout_file"
else
  cat "$stderr_file" >&2
  exit 1
fi
```

PowerShell:

```powershell
$output = & bash ./script.sh 2>&1
$exit = $LASTEXITCODE
if ($exit -ne 0) {
  throw "script failed: $output"
}
```

Be cautious: merging stderr/stdout destroys machine-output separation.

For machine JSON, keep stdout clean.

---

## 26. JSON Lines for Streaming

For multiple records, use JSON Lines:

```json
{"service":"api","status":"ok"}
{"service":"worker","status":"fail"}
```

Bash can process line-by-line:

```bash
while IFS= read -r line; do
  jq -r '.service' <<<"$line"
done
```

PowerShell:

```powershell
Get-Content results.jsonl | ForEach-Object {
  $_ | ConvertFrom-Json
}
```

Use JSON array for small finite data; JSONL for streaming many records.

---

## 27. Choosing Canonical Shell

For each workflow, choose canonical owner.

Examples:

```text
Container entrypoint: POSIX sh canonical
Linux deploy: Bash canonical
Metadata JSON: PowerShell canonical
Java build: Maven canonical
Workflow names: Make canonical
```

Do not let two shells both own same business rule.

Document canonical owner.

---

## 28. Cross-Platform Primary Entry Point

If team wants one command across OS:

Option A:

```text
pwsh ./scripts/Verify.ps1
```

PowerShell 7 required.

Option B:

```text
./mvnw verify
```

No script.

Option C:

```text
devcontainer + make verify
```

Everyone uses same Linux environment.

Option D:

```text
platform-cli verify
```

Real CLI.

Choose based on team constraints.

Make is not always best on Windows.

---

## 29. Interop with Maven/Gradle

Bash:

```bash
./mvnw --batch-mode verify
```

PowerShell:

```powershell
& ./mvnw --batch-mode verify
if ($LASTEXITCODE -ne 0) { throw 'mvn failed' }
```

On Windows, wrapper is `.cmd`:

```powershell
& ./mvnw.cmd verify
```

Cross-platform PowerShell helper:

```powershell
$Mvn = if ($IsWindows) { './mvnw.cmd' } else { './mvnw' }
& $Mvn '--batch-mode' 'verify'
```

This is a real portability issue.

---

## 30. Interop with Make

PowerShell can call Make:

```powershell
& make ci/verify
if ($LASTEXITCODE -ne 0) {
  throw "make failed"
}
```

But Windows may not have Make.

Bash can call PowerShell through Make target:

```make
metadata:
	pwsh -NoProfile -File ./scripts/Build-Metadata.ps1
```

If Make requires GNU Make, document.

---

## 31. Windows Native vs WSL vs Git Bash

Do not conflate:

- PowerShell on Windows;
- Git Bash on Windows;
- WSL Bash;
- MSYS2 Bash;
- Cygwin;
- Linux container Bash.

They have different paths, process behavior, tool availability.

Interop strategy should state supported environment.

Example:

```text
Supported:
  - Linux devcontainer
  - Ubuntu CI
  - Windows PowerShell 7 for Verify.ps1

Not supported:
  - Git Bash invoking deploy.sh on Windows
```

Honesty prevents wasted debugging.

---

## 32. Interop Anti-Patterns

### 32.1 `pwsh -Command` with interpolated string

Unsafe and fragile.

### 32.2 `bash -c` with interpolated string

Unsafe and fragile.

### 32.3 Parsing human table output

Use JSON.

### 32.4 Logs on stdout with JSON

Breaks consumers.

### 32.5 Duplicate Bash/PowerShell implementations

Drift.

### 32.6 Ignoring `$LASTEXITCODE`

PowerShell wrapper falsely succeeds.

### 32.7 Assuming Make on Windows

Often false.

### 32.8 Passing paths between Windows and WSL blindly

Breaks.

---

## 33. Interop Checklist

### Boundary

- What is canonical owner?
- What are inputs?
- What is stdout contract?
- What is stderr contract?
- What exit codes mean?
- Is cwd defined?
- Are env vars documented?

### Data

- Is JSON used for structured output?
- Are logs separated?
- Is encoding UTF-8?
- Are large payloads passed by file?

### Safety

- Any eval/string command?
- Any secrets in args/logs?
- Are tools preflighted?
- Are paths translated safely?

### Portability

- Which OS/shell environments are supported?
- Is `pwsh` available?
- Is Bash available?
- Is Make available?
- Are wrapper scripts tested in CI matrix?

### Maintainability

- Is logic duplicated?
- Are contract tests present?
- Is help documented?
- Can failures be debugged?

---

## 34. Mini Lab

### Lab 1 — Bash Calls PowerShell JSON

Write PowerShell script outputting JSON metadata. Call from Bash and parse with `jq`.

### Lab 2 — PowerShell Calls Bash

Write Bash script accepting `--env` and outputting JSON. Call from PowerShell and parse with `ConvertFrom-Json`.

### Lab 3 — Stdout/Stderr Discipline

Make script that logs to stderr and outputs only JSON to stdout.

### Lab 4 — Exit Code Propagation

Create failing PowerShell script and ensure Bash wrapper fails. Create failing Bash script and ensure PowerShell wrapper fails.

### Lab 5 — File Boundary

Use input.json/output.json instead of stdout and compare debuggability.

---

## 35. Design Exercise: Cross-Platform Metadata Workflow

Goal:

```text
make metadata
pwsh ./scripts/Build-Metadata.ps1
./scripts/build-metadata.sh
```

All produce same JSON contract:

```json
{
  "service": "...",
  "version": "...",
  "commit": "...",
  "generatedAt": "..."
}
```

Decide:

- canonical implementation;
- wrappers;
- test strategy;
- CI matrix;
- stdout/stderr behavior;
- JSON schema;
- failure modes.

Preferred solution: one canonical script or real CLI, wrappers only delegate.

---

## 36. Part 027 Summary

Bash and PowerShell can interoperate well if treated as process-boundary APIs.

Key takeaways:

1. Interop is boundary design: args, env, cwd, stdin/stdout/stderr, files, exit codes.
2. JSON is the best common structured data contract.
3. Keep stdout machine-readable and logs on stderr.
4. Preserve exit codes across shell boundaries.
5. Avoid `-Command`/`bash -c` with interpolated strings.
6. Pass arguments as arguments, not as one command string.
7. Use files for large/important payloads.
8. Use UTF-8 and PowerShell 7+.
9. Preflight required tools.
10. Avoid secrets in CLI args/logs.
11. Avoid duplicate Bash/PowerShell implementations unless contract-tested.
12. Be honest about Windows, WSL, Git Bash, Linux, and devcontainer differences.
13. Make can be facade, but should not hide unsupported runtime assumptions.
14. Choose canonical owner per workflow.
15. The safest interop is often thin wrappers over one canonical script or real CLI.

Part 028 will cover refactoring legacy scripts.

---

## 37. Referensi Resmi dan Bacaan Lanjutan

- Bash Reference Manual: quoting, exit status, command substitution.
- PowerShell documentation: native commands, streams, `$LASTEXITCODE`, `ConvertTo-Json`.
- JSON Lines format.
- GNU Make documentation for recipes and shell execution.
- CI documentation for shell selection and cross-platform runners.
- Microsoft documentation on PowerShell cross-platform behavior.
- ShellCheck and PSScriptAnalyzer for linting.
- Secure scripting practices around secrets and command injection.

---

## 38. Status Seri

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
- [ ] Part 028 — Refactoring Legacy Scripts
- [ ] Part 029 — Capstone: Production-Grade Automation Toolkit for a Java Service


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-026.md">⬅️ Part 026 — Operational Scripts: Diagnostics, Runbooks, Incident Tools</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-028.md">Part 028 — Refactoring Legacy Scripts ➡️</a>
</div>
