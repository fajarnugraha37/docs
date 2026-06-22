# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-014.md

# Part 014 — PowerShell Error Handling, Strictness, and Observability

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: memahami error model PowerShell secara serius: terminating vs non-terminating errors, `$ErrorActionPreference`, `try/catch/finally`, `throw`, `Write-Error`, native command exit codes, streams, transcript, logging, dan CI observability.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya:

- Part 012: mental model PowerShell sebagai object pipeline.
- Part 013: fundamentals bahasa PowerShell: parameter, function, type, validation, splatting, native invocation.

Part 014 membahas bagian yang sering membuat PowerShell script terlihat “berhasil” padahal sebenarnya gagal:

> Error handling.

Di Bash, kita banyak bergumul dengan:

```bash
set -euo pipefail
$?
PIPESTATUS
trap
```

Di PowerShell, masalahnya berbeda:

- ada terminating error;
- ada non-terminating error;
- ada error stream;
- ada `$ErrorActionPreference`;
- ada `-ErrorAction`;
- ada `$?`;
- ada `$LASTEXITCODE`;
- native command failure tidak selalu sama dengan cmdlet failure;
- `Write-Error` tidak sama dengan `throw`;
- pipeline bisa lanjut walau ada error;
- CI bisa hijau jika native exit code tidak dipropagasi dengan benar;
- diagnostic stream bisa tercampur dengan data output jika tidak disiplin.

PowerShell punya error model lebih kaya daripada Bash, tetapi kekayaan ini membuatnya perlu dipahami dengan benar.

---

## 1. Mental Model: PowerShell Error Bukan Sekadar Exit Code

Bash command biasanya berkomunikasi dengan:

```text
stdout, stderr, exit code
```

PowerShell command/cmdlet berkomunikasi dengan:

```text
success output stream
error stream
warning stream
verbose stream
debug stream
information stream
progress stream
error records
exceptions
preference variables
native exit codes
```

PowerShell cmdlet dapat menghasilkan error record tanpa menghentikan script.

Contoh:

```powershell
Get-Item -Path ./missing.txt
Write-Output "still running"
```

Secara default, `Get-Item` untuk file missing bisa menulis non-terminating error lalu script lanjut.

Jika kamu berasal dari Java, bayangkan ada operasi yang “mencatat exception ke error stream” tetapi tidak melempar exception yang menghentikan control flow. Ini bisa mengejutkan.

---

## 2. Terminating vs Non-Terminating Errors

### 2.1 Terminating error

Terminating error menghentikan statement/current pipeline dan bisa ditangkap `try/catch`.

Contoh:

```powershell
throw "boom"
```

```powershell
try {
  throw "boom"
}
catch {
  "caught"
}
```

### 2.2 Non-terminating error

Non-terminating error ditulis ke error stream, tetapi execution bisa lanjut.

Contoh:

```powershell
Get-ChildItem -Path ./missing
"still running"
```

Banyak cmdlet menggunakan non-terminating error agar bisa memproses item lain dalam pipeline.

Example:

```powershell
Get-Item missing1.txt, existing.txt, missing2.txt
```

Jika satu item gagal, cmdlet masih bisa memproses item lain.

Ini masuk akal untuk batch operation, tetapi berbahaya untuk automation yang ingin fail-fast.

---

## 3. `$ErrorActionPreference`

Preference variable:

```powershell
$ErrorActionPreference = 'Continue'
```

Default biasanya `Continue`.

Meaning:

- `Continue`: show error, continue.
- `Stop`: convert many non-terminating errors into terminating errors.
- `SilentlyContinue`: suppress error display, continue.
- `Ignore`: ignore and do not add to `$Error` in some contexts.
- `Inquire`: ask user.
- `Suspend`: workflow legacy context.

For scripts, common strict baseline:

```powershell
$ErrorActionPreference = 'Stop'
```

This makes many cmdlet errors behave more like exceptions.

Template:

```powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
```

But note:

> `$ErrorActionPreference = 'Stop'` applies to PowerShell errors, not necessarily native command non-zero exit codes.

Native command handling requires separate attention.

---

## 4. `-ErrorAction Stop`

Instead of global preference:

```powershell
Get-Item -Path $Path -ErrorAction Stop
```

This is explicit for one command.

Use when:

- you want one operation to fail-fast;
- global preference would be too broad;
- function should control local semantics;
- some commands are allowed to fail.

Example:

```powershell
try {
  $config = Get-Item -Path $ConfigPath -ErrorAction Stop
}
catch {
  throw "Config file not found or inaccessible: $ConfigPath"
}
```

This produces domain-specific error.

---

## 5. `try/catch/finally`

Basic:

```powershell
try {
  Invoke-Thing
}
catch {
  Write-Error "Failed: $_"
  exit 1
}
finally {
  Write-Verbose "cleanup"
}
```

`catch` receives current error in `$_`, an ErrorRecord.

More explicit:

```powershell
catch {
  $errorRecord = $_
  Write-Error "Failed: $($errorRecord.Exception.Message)"
}
```

`finally` runs whether success or failure.

Use `finally` for cleanup:

```powershell
$tempFile = New-TemporaryFile

try {
  # use temp file
}
finally {
  Remove-Item -Path $tempFile -ErrorAction SilentlyContinue
}
```

---

## 6. ErrorRecord Anatomy

In `catch`, `$_` is not just string.

Inspect:

```powershell
catch {
  $_ | Format-List * -Force
}
```

Useful properties:

```powershell
$_.Exception.Message
$_.CategoryInfo
$_.FullyQualifiedErrorId
$_.ScriptStackTrace
$_.InvocationInfo
```

Example:

```powershell
catch {
  Write-Error @"
Operation failed.
Message: $($_.Exception.Message)
Category: $($_.CategoryInfo)
Line: $($_.InvocationInfo.ScriptLineNumber)
Command: $($_.InvocationInfo.Line)
"@
  exit 1
}
```

Be careful not to leak secrets in command line/InvocationInfo.

---

## 7. `throw` vs `Write-Error`

### `throw`

Creates terminating error.

```powershell
throw "Invalid environment: $Environment"
```

This stops execution unless caught.

### `Write-Error`

Writes error record to error stream. By default it may be non-terminating.

```powershell
Write-Error "Invalid environment"
```

If `$ErrorActionPreference = 'Stop'`, it can become terminating.

For validation/precondition failure in scripts, prefer:

```powershell
throw "Invalid environment: $Environment"
```

For functions that should report item-level error and continue, `Write-Error` may be appropriate.

Example batch processing:

```powershell
foreach ($file in $Files) {
  if (-not (Test-Path $file)) {
    Write-Error "File missing: $file"
    continue
  }
}
```

But for fail-fast automation, prefer `throw`.

---

## 8. `Write-Error -ErrorAction Stop` Is Not `throw`, But Similar Enough for Many Cases

```powershell
Write-Error "boom" -ErrorAction Stop
```

This creates a terminating error.

However:

- `throw` is simpler for script logic;
- `Write-Error` creates richer ErrorRecord options;
- advanced functions may use `Write-Error` to behave like cmdlets;
- `throw` is closer to exception flow.

Rule for practical scripts:

- use `throw` for fatal validation and unrecoverable workflow errors;
- use `Write-Error` when implementing cmdlet-like functions that process multiple inputs.

---

## 9. Strict Mode

Use:

```powershell
Set-StrictMode -Version Latest
```

Catches things like:

- references to non-existent properties in some contexts;
- uninitialized variables;
- incorrect function syntax patterns;
- some unsafe assumptions.

Example:

```powershell
Set-StrictMode -Version Latest
Write-Output $TypoVariable
```

Without strict mode, this may output `$null`. With strict mode, it errors.

For new scripts, strict mode is recommended.

But strict mode can break legacy scripts that rely on loose behavior.

---

## 10. Recommended Script Baseline

```powershell
#requires -Version 7.0

[CmdletBinding()]
param(
  # parameters
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Main {
  # workflow
}

try {
  Main
}
catch {
  Write-Error "FAILED: $($_.Exception.Message)"
  exit 1
}
```

However, wrapping the whole `Main` in `try/catch` is optional.

If you do not catch, PowerShell will print error and exit non-zero for terminating errors in many script contexts. But explicit catch lets you:

- customize message;
- add context;
- cleanup;
- avoid stack noise;
- set specific exit code.

Do not catch only to hide useful detail.

---

## 11. Exit Codes from PowerShell Script

Exit explicitly:

```powershell
exit 0
exit 1
exit 2
```

In CI, final process exit code matters.

Common:

```powershell
try {
  Main
  exit 0
}
catch {
  Write-Error $_
  exit 1
}
```

For usage errors:

```powershell
exit 2
```

Important: a PowerShell script that writes non-terminating errors may still exit 0 if you do not make them terminating or set exit code.

This is why `$ErrorActionPreference = 'Stop'` matters for automation.

---

## 12. `$?` and `$LASTEXITCODE`

PowerShell has two important status concepts.

### `$?`

Indicates success of last PowerShell command/expression.

```powershell
Get-Item missing
$?
```

But behavior with non-terminating errors and native commands needs care.

### `$LASTEXITCODE`

Exit code of last native program or script that set native exit code.

```powershell
mvn test
$LASTEXITCODE
```

For native commands, check `$LASTEXITCODE`.

Example:

```powershell
& mvn test
if ($LASTEXITCODE -ne 0) {
  throw "mvn test failed with exit code $LASTEXITCODE"
}
```

Do not assume `$ErrorActionPreference = 'Stop'` will make `mvn test` failure throw.

---

## 13. Native Command Wrapper

Create helper:

```powershell
function Invoke-NativeCommand {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]
    [string] $FilePath,

    [string[]] $ArgumentList = @(),

    [int[]] $AllowedExitCodes = @(0)
  )

  Write-Verbose "Running native command: $FilePath $($ArgumentList -join ' ')"

  & $FilePath @ArgumentList
  $exitCode = $LASTEXITCODE

  if ($exitCode -notin $AllowedExitCodes) {
    throw "Native command failed: $FilePath exitCode=$exitCode"
  }
}
```

Use:

```powershell
Invoke-NativeCommand -FilePath 'mvn' -ArgumentList @('test')
```

Allowed non-zero:

```powershell
Invoke-NativeCommand -FilePath 'robocopy' -ArgumentList @($src, $dst) -AllowedExitCodes @(0,1,2,3)
```

Some native tools have non-zero “success with differences” semantics. Treat exit code as API.

---

## 14. Native stderr Does Not Always Mean Failure

Many native tools write warnings/progress to stderr but exit 0.

Example patterns:

```powershell
git ...
mvn ...
docker ...
```

Do not treat any stderr output as failure unless tool contract says so.

Use exit code.

Similarly, PowerShell error stream is structured, but native stderr is just stream text.

---

## 15. `$PSNativeCommandUseErrorActionPreference`

PowerShell 7.3 introduced behavior where native command non-zero exit codes can interact more with `$ErrorActionPreference` when `$PSNativeCommandUseErrorActionPreference` is enabled.

Because environments vary, robust scripts often still explicitly check `$LASTEXITCODE`.

Pattern:

```powershell
& git diff --exit-code
$exitCode = $LASTEXITCODE

switch ($exitCode) {
  0 { 'clean' }
  1 { 'diff exists' }
  default { throw "git diff failed exitCode=$exitCode" }
}
```

This remains explicit and portable across PowerShell versions/settings.

---

## 16. Expected Non-Zero Exit Codes

Like Bash `grep`, native tools can use non-zero as meaningful state.

Example:

```powershell
git diff --exit-code
```

Exit codes:

- 0: no diff
- 1: diff
- >1: error

Handle:

```powershell
& git diff --exit-code
$exitCode = $LASTEXITCODE

if ($exitCode -eq 0) {
  $HasDiff = $false
}
elseif ($exitCode -eq 1) {
  $HasDiff = $true
}
else {
  throw "git diff failed with exit code $exitCode"
}
```

Do not blindly throw on all non-zero if tool defines semantics.

---

## 17. ErrorActionPreference and Scope

You can locally override:

```powershell
$previous = $ErrorActionPreference
try {
  $ErrorActionPreference = 'Stop'
  # strict block
}
finally {
  $ErrorActionPreference = $previous
}
```

But usually set once at script start.

Per-command is clearer:

```powershell
Remove-Item -Path $Path -ErrorAction SilentlyContinue
```

Use `SilentlyContinue` intentionally for cleanup:

```powershell
Remove-Item -Path $TempFile -Force -ErrorAction SilentlyContinue
```

Do not suppress errors broadly without reason.

---

## 18. `$Error` Automatic Variable

`$Error` contains recent errors, most recent first.

```powershell
$Error[0]
```

Useful interactively, less so for robust scripts.

Do not build control flow by inspecting `$Error` after the fact. Use `try/catch`, `-ErrorAction Stop`, and explicit status checks.

---

## 19. Clearing Errors

Sometimes tests/scripts clear `$Error`:

```powershell
$Error.Clear()
```

Useful in test harness, rarely needed in production script.

Avoid relying on `$Error.Count` as success indicator.

---

## 20. Streams Overview

PowerShell streams:

| Stream | Purpose |
|---|---|
| Success output | data objects |
| Error | errors |
| Warning | warnings |
| Verbose | detailed logs, opt-in |
| Debug | debug info, opt-in |
| Information | informational messages |
| Progress | progress UI |

Use proper stream.

Data:

```powershell
[PSCustomObject]@{ Status = 'OK' }
```

Warning:

```powershell
Write-Warning "Cache not found; continuing"
```

Verbose:

```powershell
Write-Verbose "Resolved project root: $ProjectRoot"
```

Information:

```powershell
Write-Information "Starting verification" -InformationAction Continue
```

Error:

```powershell
Write-Error "Failed to read config"
```

---

## 21. Verbose and Debug

With `[CmdletBinding()]`, scripts/functions support:

```powershell
-Verbose
-Debug
```

Example:

```powershell
[CmdletBinding()]
param()

Write-Verbose "Detailed diagnostic"
Write-Debug "Debug diagnostic"
```

Run:

```powershell
./Verify.ps1 -Verbose
./Verify.ps1 -Debug
```

This is better than custom `--verbose` if writing PowerShell-native script.

In cross-shell team, you may still prefer `-Verbose` PowerShell convention.

---

## 22. Information Stream

PowerShell 5+ has information stream:

```powershell
Write-Information "Starting deployment" -InformationAction Continue
```

Without `-InformationAction Continue`, information may not show depending preference.

For human progress, some people use `Write-Host`. But `Write-Information` is more stream-aware.

Practical options:

- Use `Write-Verbose` for opt-in details.
- Use `Write-Information ... -InformationAction Continue` for high-level progress.
- Use `Write-Warning` for warnings.
- Output data objects only on success output.

---

## 23. `Write-Host`: Use Sparingly

`Write-Host` writes to host UI/information stream in modern PowerShell.

It is okay for:

- purely interactive UI;
- colored local messages;
- prompts.

Avoid for:

- data output;
- library functions;
- machine-readable scripts.

If your script outputs JSON, `Write-Host` may not pollute stdout in same way as `Write-Output`, but it still creates host output that may appear in logs. Be deliberate.

---

## 24. Progress Stream

PowerShell supports progress:

```powershell
Write-Progress -Activity "Processing" -Status "Item $i" -PercentComplete $percent
```

Useful interactively, annoying in CI.

For CI, often disable progress:

```powershell
$ProgressPreference = 'SilentlyContinue'
```

Especially for commands like `Invoke-WebRequest`, progress can slow logs.

Common script baseline in CI:

```powershell
$ProgressPreference = 'SilentlyContinue'
```

But if interactive progress matters, make it conditional.

---

## 25. Transcript

PowerShell can record session:

```powershell
Start-Transcript -Path ./logs/session.log
# commands
Stop-Transcript
```

Useful for:

- diagnostics;
- audit trail;
- incident scripts;
- local admin tasks.

Risks:

- can capture secrets;
- logs may include sensitive data;
- must protect transcript file.

Use carefully.

Example:

```powershell
$TranscriptPath = Join-Path $LogDir "transcript.log"
Start-Transcript -Path $TranscriptPath | Out-Null
try {
  # work
}
finally {
  Stop-Transcript | Out-Null
}
```

For CI, pipeline logs may already serve as transcript.

---

## 26. Logging Function Pattern

PowerShell-native:

```powershell
function Write-Step {
  param([Parameter(Mandatory)][string] $Message)
  Write-Information "==> $Message" -InformationAction Continue
}

function Write-Detail {
  param([Parameter(Mandatory)][string] $Message)
  Write-Verbose $Message
}
```

Use:

```powershell
Write-Step "Preflight"
Write-Detail "ProjectRoot=$ProjectRoot"
```

With `[CmdletBinding()]`, `-Verbose` controls details.

---

## 27. Structured Observability Output

For scripts used by automation, return object summary:

```powershell
[PSCustomObject]@{
  Status = 'Success'
  Environment = $Environment
  Version = $Version
  DurationSeconds = $Duration.TotalSeconds
}
```

Convert to JSON when needed:

```powershell
$result | ConvertTo-Json
```

Do not force all scripts to output plain strings. Objects are PowerShell's strength.

For CI step summary, text might be enough. For script-to-script interface, JSON/object is better.

---

## 28. Timing Operations

```powershell
$start = Get-Date

# work

$duration = (Get-Date) - $start
$duration.TotalSeconds
```

Or:

```powershell
$sw = [System.Diagnostics.Stopwatch]::StartNew()
# work
$sw.Stop()
$sw.Elapsed.TotalSeconds
```

Use for observability:

```powershell
Write-Information "Completed in $([math]::Round($sw.Elapsed.TotalSeconds, 2))s" -InformationAction Continue
```

---

## 29. Preflight Pattern

```powershell
function Require-Command {
  param([Parameter(Mandatory)][string] $Name)

  if ($null -eq (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Require-EnvironmentVariable {
  param([Parameter(Mandatory)][string] $Name)

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Required environment variable is not set: $Name"
  }
}
```

Use:

```powershell
Require-Command -Name 'mvn'
Require-EnvironmentVariable -Name 'DEPLOY_TOKEN'
```

Do not print secret value.

---

## 30. Contextual Errors

Bad:

```powershell
Invoke-RestMethod @params
```

If it fails, error may be low-level.

Better:

```powershell
try {
  Invoke-RestMethod @params
}
catch {
  throw "Deploy API call failed for environment '$Environment' version '$Version'. $($_.Exception.Message)"
}
```

But avoid losing original error details. You can use `throw` with new message or `Write-Error` and rethrow:

```powershell
catch {
  Write-Error "Deploy API call failed for environment '$Environment' version '$Version'"
  throw
}
```

This preserves original error.

---

## 31. Rethrow

Inside catch:

```powershell
catch {
  Write-Error "Context message"
  throw
}
```

`throw` with no argument rethrows current error.

Use when you want to add context but keep original error.

Be careful: `Write-Error` may create additional error record. Sometimes `Write-Warning` or `Write-Information` is better for context before rethrow.

---

## 32. Cleanup with `finally`

```powershell
$tempDir = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid()))

try {
  # work
}
finally {
  if (Test-Path $tempDir) {
    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
```

If cleanup failure matters, do not silently continue. But in many temp cleanup cases, cleanup failure should warn not hide original error.

Pattern:

```powershell
finally {
  try {
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction Stop
  }
  catch {
    Write-Warning "Failed to cleanup temp dir: $TempDir. $($_.Exception.Message)"
  }
}
```

---

## 33. `trap` in PowerShell

PowerShell has `trap`, but modern scripts usually prefer `try/catch/finally`.

Avoid `trap` unless maintaining legacy scripts or special cases.

`try/catch/finally` is more familiar to Java engineers and clearer.

---

## 34. ShouldProcess, WhatIf, Confirm

Advanced functions can support `-WhatIf` and `-Confirm`.

```powershell
function Remove-BuildArtifacts {
  [CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
  param(
    [Parameter(Mandatory)]
    [string] $Path
  )

  if ($PSCmdlet.ShouldProcess($Path, 'Remove build artifacts')) {
    Remove-Item -Path $Path -Recurse -Force
  }
}
```

Call:

```powershell
Remove-BuildArtifacts -Path ./target -WhatIf
Remove-BuildArtifacts -Path ./target -Confirm
```

This is PowerShell-native dry-run/confirmation model.

For destructive scripts, prefer `SupportsShouldProcess` over custom `-DryRun` when writing PowerShell-native tools.

You can still expose `-DryRun` if team convention requires, but `-WhatIf` is idiomatic.

---

## 35. Error Handling with ShouldProcess

Even with `ShouldProcess`, operations can fail.

```powershell
if ($PSCmdlet.ShouldProcess($Path, 'Remove')) {
  Remove-Item -Path $Path -Recurse -Force -ErrorAction Stop
}
```

Use `-ErrorAction Stop` to make failure catchable under strict behavior.

---

## 36. Retrying Operations

Simple retry:

```powershell
function Invoke-WithRetry {
  param(
    [Parameter(Mandatory)]
    [scriptblock] $ScriptBlock,

    [int] $Attempts = 3,

    [int] $DelaySeconds = 2
  )

  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      return & $ScriptBlock
    }
    catch {
      if ($attempt -eq $Attempts) {
        throw
      }

      Write-Warning "Attempt $attempt/$Attempts failed: $($_.Exception.Message). Retrying in $DelaySeconds seconds."
      Start-Sleep -Seconds $DelaySeconds
    }
  }
}
```

Use:

```powershell
Invoke-WithRetry -Attempts 3 -DelaySeconds 5 -ScriptBlock {
  Invoke-RestMethod -Uri $Uri -TimeoutSec 30
}
```

Retry only idempotent/retryable operations. Same principle as Bash.

---

## 37. Timeout Patterns

PowerShell cmdlets often have timeout parameters:

```powershell
Invoke-RestMethod -Uri $Uri -TimeoutSec 30
```

For native command timeout, you can use `Start-Process` or .NET process APIs, but complexity rises.

Simpler for many cases: use native tool timeout if available, or build timeout logic for specific operation.

Example waiting loop:

```powershell
$deadline = (Get-Date).AddSeconds(60)

while ((Get-Date) -lt $deadline) {
  try {
    $response = Invoke-RestMethod -Uri $HealthUri -TimeoutSec 5
    if ($response.status -eq 'UP') {
      return
    }
  }
  catch {
    Write-Verbose "Health check failed: $($_.Exception.Message)"
  }

  Start-Sleep -Seconds 1
}

throw "Service did not become healthy within 60 seconds: $HealthUri"
```

---

## 38. Native Process Timeout with Start-Process

For advanced use:

```powershell
$process = Start-Process -FilePath 'mvn' -ArgumentList @('test') -NoNewWindow -PassThru
if (-not $process.WaitForExit(60000)) {
  $process.Kill()
  throw 'mvn test timed out'
}

if ($process.ExitCode -ne 0) {
  throw "mvn test failed with exit code $($process.ExitCode)"
}
```

Caveats:

- output capture is more complex;
- child process tree killing is non-trivial;
- cross-platform behavior needs testing.

For build tools, prefer tool-native timeout/test timeout where possible.

---

## 39. Secret-Safe Observability

Avoid:

```powershell
Write-Verbose "Token=$env:DEPLOY_TOKEN"
```

Avoid transcript around secret operations unless log protected.

Avoid:

```powershell
Write-Information ($headers | ConvertTo-Json)
```

if headers include Authorization.

Redact:

```powershell
function Protect-Secret {
  param([string] $Value)

  if ([string]::IsNullOrEmpty($Value)) {
    return '<empty>'
  }

  if ($Value.Length -le 4) {
    return '****'
  }

  return "****$($Value.Substring($Value.Length - 4))"
}
```

But best: do not log secrets at all.

---

## 40. CI Error Presentation

For CI, script should:

- fail with non-zero exit;
- show high-level step;
- show actionable context;
- preserve useful detailed error;
- avoid prompts;
- avoid progress noise;
- avoid secret leaks;
- produce artifact/log path if needed.

Example top-level:

```powershell
try {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  Main
  $sw.Stop()
  Write-Information "SUCCESS duration=$([math]::Round($sw.Elapsed.TotalSeconds, 2))s" -InformationAction Continue
  exit 0
}
catch {
  Write-Error "FAILED: $($_.Exception.Message)"
  if ($_.ScriptStackTrace) {
    Write-Verbose $_.ScriptStackTrace
  }
  exit 1
}
```

Run CI with:

```powershell
pwsh ./Verify.ps1 -Verbose
```

if you want stack trace/details.

---

## 41. Case Study: Fragile PowerShell Script

```powershell
param($Environment, $Version)

Get-Content config.json | ConvertFrom-Json
mvn test
Invoke-RestMethod "$env:DEPLOY_URL/deploy/$Environment/$Version"
Write-Host "done"
```

Problems:

1. No version requirement.
2. No strict mode.
3. Untyped/unvalidated params.
4. `Get-Content` without `-Raw` for JSON.
5. Result unused.
6. Native `mvn` exit not checked.
7. URL built by string concatenation.
8. Missing required env validation.
9. REST method/timeout not explicit.
10. `Write-Host` for completion.
11. No error context.
12. Non-terminating errors may continue.
13. No CI-friendly exit handling.

---

## 42. Improved PowerShell Script

```powershell
#requires -Version 7.0

[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateSet('staging', 'prod')]
  [string] $Environment,

  [Parameter(Mandatory)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string] $Version,

  [switch] $WhatIfDeploy
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

function Require-Env {
  param([Parameter(Mandatory)][string] $Name)

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Required environment variable is not set: $Name"
  }

  return $value
}

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory)][string] $FilePath,
    [string[]] $ArgumentList = @(),
    [int[]] $AllowedExitCodes = @(0)
  )

  & $FilePath @ArgumentList
  $exitCode = $LASTEXITCODE

  if ($exitCode -notin $AllowedExitCodes) {
    throw "Native command failed: $FilePath exitCode=$exitCode"
  }
}

function Main {
  Write-Information "Preflight" -InformationAction Continue
  Require-Command -Name 'mvn'

  $deployUrl = Require-Env -Name 'DEPLOY_URL'
  $deployToken = Require-Env -Name 'DEPLOY_TOKEN'

  Write-Information "Running tests" -InformationAction Continue
  Invoke-NativeChecked -FilePath 'mvn' -ArgumentList @('test')

  $payload = [PSCustomObject]@{
    env = $Environment
    version = $Version
  } | ConvertTo-Json

  if ($WhatIfDeploy) {
    Write-Information "WHATIF: would deploy env=$Environment version=$Version" -InformationAction Continue
    return
  }

  $headers = @{
    Authorization = "Bearer $deployToken"
  }

  $uri = "$($deployUrl.TrimEnd('/'))/deploy"

  Write-Information "Calling deploy API env=$Environment version=$Version" -InformationAction Continue

  try {
    Invoke-RestMethod `
      -Uri $uri `
      -Method Post `
      -Headers $headers `
      -Body $payload `
      -ContentType 'application/json' `
      -TimeoutSec 60
  }
  catch {
    throw "Deploy API failed for env=$Environment version=$Version. $($_.Exception.Message)"
  }
}

try {
  Main
  exit 0
}
catch {
  Write-Error "FAILED: $($_.Exception.Message)"
  exit 1
}
```

This script is still simplified, but the error model is much stronger.

---

## 43. Testing Error Paths

Test cases:

```powershell
pwsh ./Deploy.ps1
```

Should fail parameter binding.

```powershell
pwsh ./Deploy.ps1 -Environment bad -Version 1.2.3
```

Should fail validation.

```powershell
pwsh ./Deploy.ps1 -Environment staging -Version bad
```

Should fail version validation.

```powershell
pwsh ./Deploy.ps1 -Environment staging -Version 1.2.3
```

without env vars should fail preflight.

Fake native command failure should make script exit non-zero.

Mocking external commands can be done by PATH manipulation similar to Bash or by Pester mocks if functions are structured for testing.

---

## 44. Pester Preview

PowerShell's main testing framework is Pester.

Example:

```powershell
Describe 'Deploy script' {
  It 'rejects invalid version' {
    $result = pwsh ./Deploy.ps1 -Environment staging -Version bad 2>&1
    $LASTEXITCODE | Should -Not -Be 0
  }
}
```

Pester will be discussed more in module/testing context later if needed, but for this series the core is:

- structure scripts for testability;
- validate parameters;
- separate native command wrappers;
- assert exit behavior.

---

## 45. Review Checklist

### Strictness

- Is `Set-StrictMode -Version Latest` used?
- Is `$ErrorActionPreference = 'Stop'` set?
- Is `$ProgressPreference` set for CI if needed?

### Errors

- Are cmdlet errors terminating where required?
- Are non-terminating errors understood?
- Is `try/catch/finally` used where context/cleanup needed?
- Is `throw` used for fatal script errors?
- Is `Write-Error` used intentionally?

### Native commands

- Is `$LASTEXITCODE` checked?
- Are expected non-zero exit codes handled?
- Is native stderr not overinterpreted?
- Is `Invoke-Expression` avoided?

### Streams

- Is data on success output?
- Are diagnostics on Verbose/Warning/Information/Error streams?
- Is `Write-Host` avoided for data?
- Are secrets excluded from logs?

### CI

- Does script exit non-zero on failure?
- Are prompts avoided?
- Are progress logs controlled?
- Are errors actionable?

### Cleanup

- Is `finally` used for temp cleanup?
- Does cleanup avoid hiding original error?
- Are transcript/log files protected?

---

## 46. Mini Lab

### Lab 1 — Non-Terminating Error

Run:

```powershell
Get-Item ./missing-file
"still running"
```

Then:

```powershell
$ErrorActionPreference = 'Stop'
Get-Item ./missing-file
"still running"
```

Observe difference.

---

### Lab 2 — Try/Catch

```powershell
try {
  Get-Item ./missing-file -ErrorAction Stop
}
catch {
  "Caught: $($_.Exception.Message)"
}
```

---

### Lab 3 — Native Exit Code

Run:

```powershell
pwsh -NoProfile -Command "exit 7"
$LASTEXITCODE
```

Then write wrapper that throws when exit code non-zero.

---

### Lab 4 — Verbose Stream

Create:

```powershell
[CmdletBinding()]
param()

Write-Verbose "details"
Write-Output "data"
```

Run with and without `-Verbose`.

---

### Lab 5 — Cleanup Finally

Create temp file in `try`, delete in `finally`, throw error in middle, verify cleanup occurs.

---

## 47. Design Exercise: PowerShell CI Wrapper

Design `Verify.ps1`:

Requirements:

- `#requires -Version 7.0`
- `[CmdletBinding()]`
- params:
  - `-Profile unit|integration`
  - `-Quick`
  - `-MavenArgs string[]`
- strict mode;
- `$ErrorActionPreference = 'Stop'`;
- `$ProgressPreference = 'SilentlyContinue'`;
- `Require-Command mvn`;
- native wrapper checking `$LASTEXITCODE`;
- `Write-Information` for high-level steps;
- `Write-Verbose` for details;
- exit 0 success, 1 failure;
- no secrets;
- optional JSON summary output.

Think through:

- how to pass `-Dname=Alice Smith`;
- how to handle Maven failure;
- how CI sees errors;
- whether output is human text or object/JSON.

---

## 48. Part 014 Summary

PowerShell error handling is powerful but easy to misunderstand.

Key takeaways:

1. PowerShell has terminating and non-terminating errors.
2. Many cmdlet errors do not stop scripts by default.
3. `$ErrorActionPreference = 'Stop'` is a common automation baseline.
4. Use `-ErrorAction Stop` for command-level strictness.
5. Use `try/catch/finally` for context and cleanup.
6. `throw` is best for fatal script errors.
7. `Write-Error` can be non-terminating; use intentionally.
8. `Set-StrictMode -Version Latest` catches loose-script bugs.
9. `$?` and `$LASTEXITCODE` are different.
10. Always check `$LASTEXITCODE` for important native commands.
11. Treat native exit codes as API.
12. Use Verbose/Warning/Information/Error streams properly.
13. Avoid `Write-Host` for data.
14. Disable noisy progress in CI if needed.
15. Do not leak secrets in verbose/debug/transcript logs.
16. Use `ShouldProcess`/`-WhatIf` for destructive operations.
17. Observability is part of error handling: clear step, context, duration, and actionable message.

Part 015 will focus on PowerShell data automation: JSON, XML, CSV, REST, and object transformations.

---

## 49. Referensi Resmi dan Bacaan Lanjutan

- PowerShell `about_Errors`
- PowerShell `about_Try_Catch_Finally`
- PowerShell `about_Preference_Variables`
- PowerShell `about_Automatic_Variables`
- PowerShell `about_Output_Streams`
- PowerShell `about_Redirection`
- PowerShell `about_ShouldProcess`
- PowerShell `Write-Error`
- PowerShell `Write-Verbose`
- PowerShell `Write-Debug`
- PowerShell `Write-Information`
- PowerShell `Start-Transcript`
- PowerShell native command handling documentation
- Pester documentation for PowerShell testing

---

## 50. Status Seri

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
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-013.md">⬅️ Part 013 — PowerShell Language Fundamentals for Java Engineers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-015.md">Part 015 — PowerShell Data Automation: JSON, XML, CSV, REST, Objects ➡️</a>
</div>
