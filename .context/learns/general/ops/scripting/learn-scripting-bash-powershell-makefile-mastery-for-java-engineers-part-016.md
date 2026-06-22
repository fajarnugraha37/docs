# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-016.md

# Part 016 — Cross-Platform PowerShell: Windows, Linux, macOS, Containers

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: menulis PowerShell yang jelas compatibility contract-nya di Windows, Linux, macOS, dan container/CI: path, encoding, filesystem semantics, native command differences, shebang, execution policy, environment, line endings, dan portability testing.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya:

- Part 012: PowerShell object pipeline, providers.
- Part 013: PowerShell language fundamentals.
- Part 014: PowerShell error handling, strictness, observability.
- Part 015: PowerShell data automation.

Part 016 menjawab pertanyaan:

> Jika PowerShell 7+ cross-platform, apakah satu `.ps1` otomatis aman berjalan sama di Windows, Linux, macOS, dan container?

Jawabannya: tidak otomatis.

PowerShell 7+ memang cross-platform. Tetapi script tetap berinteraksi dengan OS:

- filesystem;
- path;
- newline;
- encoding;
- executable resolution;
- native commands;
- environment variables;
- permissions;
- symlinks;
- shell invocation;
- process model;
- CI runner;
- container image;
- package manager;
- installed tools;
- credential store;
- certificate store.

Cross-platform automation bukan hanya syntax PowerShell. Ia adalah kontrak runtime.

Tujuan part ini:

> Membuat kamu mampu mendesain PowerShell script dengan target platform yang eksplisit, portable bila perlu, dan tidak pura-pura portable saat bergantung pada OS-specific behavior.

---

## 1. PowerShell Versions: Windows PowerShell vs PowerShell 7+

Ada dua keluarga besar yang sering membingungkan:

### Windows PowerShell 5.1

- built-in di Windows;
- executable: `powershell.exe`;
- berbasis .NET Framework;
- Windows-only;
- banyak Windows admin module lama bergantung padanya;
- encoding default historis berbeda;
- tidak ideal untuk cross-platform modern scripts.

### PowerShell 7+

- executable: `pwsh`;
- berbasis modern .NET;
- cross-platform: Windows, Linux, macOS;
- lebih baik untuk CI, containers, modern automation;
- default encoding lebih konsisten UTF-8;
- mendukung fitur modern.

Untuk seri ini, default target adalah:

```text
PowerShell 7+
```

Deklarasikan:

```powershell
#requires -Version 7.0
```

Di CI:

```bash
pwsh ./scripts/Verify.ps1
```

Bukan:

```cmd
powershell.exe .\scripts\Verify.ps1
```

kecuali memang menargetkan Windows PowerShell.

---

## 2. Compatibility Contract

Setiap script non-trivial harus punya compatibility contract.

Contoh:

```text
Requires:
  PowerShell 7.2+
  OS: Linux or macOS or Windows
  Native tools:
    git
    mvn
    docker
  Encoding:
    UTF-8
  Path:
    must run from repository checkout or any subdirectory
  CI:
    non-interactive supported
```

Atau:

```text
Requires:
  Windows PowerShell 5.1
  OS: Windows Server 2019+
  Modules:
    ActiveDirectory
  Run as domain admin
```

Ini dua dunia berbeda.

Jangan tulis script yang sebenarnya Windows-specific tetapi diberi label cross-platform.

---

## 3. Detecting Platform

PowerShell 6+ menyediakan automatic variables:

```powershell
$IsWindows
$IsLinux
$IsMacOS
```

Example:

```powershell
if ($IsWindows) {
  'Windows'
}
elseif ($IsLinux) {
  'Linux'
}
elseif ($IsMacOS) {
  'macOS'
}
else {
  'Unknown'
}
```

Version:

```powershell
$PSVersionTable
$PSVersionTable.PSVersion
$PSVersionTable.Platform
```

Use platform detection only when needed.

Better: write platform-neutral code using PowerShell APIs.

Bad:

```powershell
if ($IsWindows) {
  $path = "$Root\target"
}
else {
  $path = "$Root/target"
}
```

Better:

```powershell
$path = Join-Path $Root 'target'
```

---

## 4. Paths: Use PowerShell Path APIs

Use:

```powershell
Join-Path $Root 'target'
Join-Path $Root 'build' 'reports'
```

Resolve:

```powershell
Resolve-Path $Path
```

Check:

```powershell
Test-Path -Path $Path -PathType Leaf
Test-Path -Path $Path -PathType Container
```

Split:

```powershell
Split-Path -Path $Path -Parent
Split-Path -Path $Path -Leaf
```

.NET path:

```powershell
[System.IO.Path]::Combine($Root, 'target', 'app.jar')
```

PowerShell cmdlets are often clearer:

```powershell
Join-Path $Root 'target'
```

Avoid manual path string building unless simple and known.

---

## 5. Path Separators

Windows uses `\`, Unix uses `/`.

PowerShell often accepts `/` on Windows for filesystem paths, but not always in native command contexts because `/` may be parsed as option by Windows tools.

PowerShell path:

```powershell
Join-Path $Root 'target'
```

Native command path:

```powershell
$mvnProject = Join-Path $ProjectRoot 'pom.xml'
& mvn -f $mvnProject test
```

Usually okay. But if calling Windows-native tools, test.

Be careful with escaping backslash in strings:

```powershell
"C:\temp\file.txt"
```

Backslash is not escape char in PowerShell strings like in many languages, so this is okay. The escape character is backtick. But prefer path APIs.

---

## 6. Case Sensitivity

Windows filesystem is typically case-insensitive. Linux filesystem is case-sensitive.

Script that works on Windows:

```powershell
Get-Content ./Config.json
```

may fail on Linux if file is `config.json`.

Guidelines:

- use exact casing in file references;
- enforce repository file name casing;
- test on Linux CI if Linux supported;
- avoid relying on case-insensitive path behavior.

PowerShell string comparisons are case-insensitive by default:

```powershell
'Prod' -eq 'prod' # True
```

Use case-sensitive if needed:

```powershell
'Prod' -ceq 'prod' # False
```

This is independent from filesystem case sensitivity.

---

## 7. Line Endings

Windows uses CRLF, Unix uses LF.

PowerShell can generally handle both, but issues appear with:

- scripts invoked by Unix shebang;
- files consumed by strict Unix tools;
- generated shell scripts;
- Docker entrypoint scripts;
- Git checkout settings.

For `.ps1`, cross-platform `pwsh script.ps1` usually works if encoding is okay.

For generated Bash scripts, ensure LF:

```powershell
Set-Content -Path ./entrypoint.sh -Value $content -NoNewline -Encoding UTF8
```

But `Set-Content` may normalize newline depending content. For precise control:

```powershell
[System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
```

Use `.gitattributes`:

```text
*.ps1 text eol=lf
*.sh text eol=lf
*.cmd text eol=crlf
```

For cross-platform repos, `.gitattributes` prevents many issues.

---

## 8. Encoding

PowerShell 7 generally uses UTF-8 without BOM for text output by default in many contexts, but be explicit when interoperability matters.

Write JSON:

```powershell
$json | Set-Content -Path $Path -Encoding UTF8
```

Read raw:

```powershell
Get-Content -Raw -Path $Path -Encoding UTF8
```

Windows PowerShell 5.1 historically used UTF-16LE for some output and different defaults. If you need support Windows PowerShell, test encoding carefully.

For cross-platform PowerShell 7 scripts, declare:

```powershell
#requires -Version 7.0
```

and use explicit encoding for generated artifacts.

---

## 9. Executable Scripts and Shebang

On Unix-like systems, you can use shebang:

```powershell
#!/usr/bin/env pwsh
#requires -Version 7.0
```

Then:

```bash
chmod +x ./script.ps1
./script.ps1
```

On Windows, shebang is just a comment. Run:

```powershell
.\script.ps1
```

or:

```powershell
pwsh .\script.ps1
```

For cross-platform CI, explicit invocation is often clearer:

```bash
pwsh ./scripts/Verify.ps1
```

rather than relying on executable bit and shebang.

---

## 10. Execution Policy on Windows

Windows may block script execution depending execution policy.

Execution policy is not a security boundary, but can prevent accidental script execution.

Common issue:

```text
running scripts is disabled on this system
```

For controlled CI, use:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\Verify.ps1
```

For developer machines, follow organization policy. Do not tell people to globally disable execution policy without context.

For internal enterprise scripts:

- consider signing scripts;
- document policy;
- use PowerShell 7;
- avoid requiring admin policy changes when possible.

---

## 11. Profiles: Use `-NoProfile` in Automation

PowerShell profile scripts can modify session:

- aliases;
- functions;
- modules;
- variables;
- preferences;
- prompt;
- PATH.

Automation should not depend on user profile.

CI/local deterministic invocation:

```bash
pwsh -NoProfile -File ./scripts/Verify.ps1
```

In docs:

```text
Use -NoProfile for CI and reproducible automation.
```

Inside script, avoid relying on interactive profile state.

---

## 12. Environment Variables Cross-Platform

PowerShell access:

```powershell
$env:APP_ENV
```

Differences:

- Windows environment variable names are case-insensitive.
- Linux/macOS environment variable names are case-sensitive.
- Path separator for PATH differs:
  - Windows: `;`
  - Unix: `:`

PowerShell exposes path separator:

```powershell
[System.IO.Path]::PathSeparator
```

Example:

```powershell
$paths = $env:PATH -split [System.IO.Path]::PathSeparator
```

Do not hardcode `:` for PATH splitting if cross-platform.

---

## 13. HOME and User Directories

Use .NET:

```powershell
[Environment]::GetFolderPath('UserProfile')
```

Or:

```powershell
$HOME
```

PowerShell sets `$HOME` cross-platform.

But be cautious in CI/container:

- `$HOME` may be `/github/home`;
- user may be root;
- workspace is elsewhere;
- home may be read-only;
- caches should use CI-provided directories if available.

For caches, consider:

```powershell
$cacheRoot = if ($env:XDG_CACHE_HOME) {
  $env:XDG_CACHE_HOME
}
else {
  Join-Path $HOME '.cache'
}
```

On Windows, XDG may not be natural. For robust cross-platform application data, .NET APIs may help, but CI scripts often use workspace-local cache.

---

## 14. Temporary Files

PowerShell:

```powershell
$tempFile = New-TemporaryFile
```

Temp directory:

```powershell
$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tempDir | Out-Null
```

Cleanup:

```powershell
try {
  # work
}
finally {
  Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
```

For atomic write, temp should be in same directory as target:

```powershell
$dir = Split-Path -Parent $target
$tmp = Join-Path $dir ".tmp.$([System.Guid]::NewGuid())"
```

Then:

```powershell
Move-Item -Path $tmp -Destination $target -Force
```

Atomic rename semantics differ across filesystems/OS. For critical operations, test target platform.

---

## 15. File Permissions

Windows ACLs and Unix permissions differ.

PowerShell `Get-Acl`/`Set-Acl` are more Windows-oriented, though ACL concepts exist cross-platform with differences.

Unix executable bit matters:

```bash
chmod +x script.sh
```

PowerShell has no built-in portable chmod equivalent as primary idiom, though on Unix you can call `chmod`.

For cross-platform scripts, avoid assuming permission model unless required.

If generating a shell script on Linux/macOS:

```powershell
if (-not $IsWindows) {
  & chmod +x $Path
  if ($LASTEXITCODE -ne 0) {
    throw "chmod failed for $Path"
  }
}
```

On Windows, executable bit irrelevant.

---

## 16. Symlinks

PowerShell supports symlinks, but behavior/permissions differ by OS and Windows developer mode/admin privileges.

Create:

```powershell
New-Item -ItemType SymbolicLink -Path $Link -Target $Target
```

Check:

```powershell
$item = Get-Item $Path
$item.LinkType
$item.Target
```

Caveats:

- symlink creation on Windows may require permissions/settings;
- directory junctions are Windows-specific;
- symlink resolution behavior differs;
- removing symlink vs target needs care.

For cross-platform scripts, avoid relying on symlink creation unless tested.

For safety, validate:

```powershell
$item = Get-Item $Path -ErrorAction Stop
if ($item.LinkType -eq 'SymbolicLink') {
  throw "Refusing symlink: $Path"
}
```

Property availability may vary; test.

---

## 17. Native Commands Differ by OS

Do not assume Unix tools exist on Windows:

```powershell
grep
sed
awk
find
xargs
sha256sum
realpath
timeout
```

On Git Bash/WSL they may exist, but not in pure PowerShell environment.

Prefer PowerShell cmdlets:

| Unix Tool | PowerShell Alternative |
|---|---|
| `grep` | `Select-String` |
| `find` | `Get-ChildItem -Recurse` |
| `cat` | `Get-Content` |
| `sha256sum` | `Get-FileHash` |
| `curl` for REST | `Invoke-RestMethod` |
| `curl` download | `Invoke-WebRequest` |
| `rm` | `Remove-Item` |
| `cp` | `Copy-Item` |
| `mv` | `Move-Item` |

But for Java tooling:

```powershell
git
mvn
gradle
docker
kubectl
```

are still native commands; ensure installed on each platform.

---

## 18. Alias Collision: `curl` and `wget`

In Windows PowerShell, `curl` and `wget` were aliases for `Invoke-WebRequest`. In PowerShell 7+, behavior changed and native command resolution is improved, but confusion remains across versions.

In scripts, avoid aliases.

Use:

```powershell
Invoke-RestMethod
Invoke-WebRequest
```

or call native explicitly if needed:

```powershell
curl.exe
```

On Windows, `curl.exe` distinguishes native curl from alias/function.

For cross-platform, prefer PowerShell cmdlets for HTTP unless you need native curl-specific behavior.

---

## 19. Native Argument Passing

PowerShell 7 improved native argument passing, but cross-platform native invocation should still be tested.

Use arrays:

```powershell
$argsList = @('build', '-t', $ImageTag, $Context)
& docker @argsList
```

Avoid string command:

```powershell
Invoke-Expression "docker build -t $ImageTag $Context"
```

Paths with spaces:

```powershell
$context = 'C:\work dir\app'
& docker build -t $ImageTag $context
```

PowerShell should pass as one argument. But native tools may parse internally differently, especially Windows programs.

Test with your target tools.

---

## 20. Newline and External Tools

PowerShell strings and arrays behave differently than Unix text.

If passing multiline content to native tools, consider writing temp file.

Bad:

```powershell
& some-tool --data $multilineJson
```

Maybe okay, maybe not depending tool.

Better:

```powershell
$temp = New-TemporaryFile
$json | Set-Content -Path $temp -Encoding UTF8
& some-tool --data-file $temp
```

For REST, use `Invoke-RestMethod -Body $json`.

---

## 21. Containers with PowerShell

Official images exist for PowerShell. In Dockerfile:

```dockerfile
FROM mcr.microsoft.com/powershell:7.4-alpine-3.20
WORKDIR /work
COPY scripts ./scripts
RUN pwsh -NoProfile -File ./scripts/Verify.ps1 -Help
```

For Java app tooling, you may need custom image:

```dockerfile
FROM eclipse-temurin:21-jdk
# install pwsh or use base image with both Java and pwsh
```

Trade-off:

- Java image + install PowerShell;
- PowerShell image + install Java;
- devcontainer image with both;
- CI setup action.

For reproducibility, a dev container with pinned tools is often best.

---

## 22. Alpine Caveats

Alpine uses musl, BusyBox, different packages.

PowerShell on Alpine is possible via official images, but native tools differ.

Caveats:

- package names;
- shell utilities;
- libc compatibility;
- timezone/cert packages;
- CA certificates;
- missing `bash` unless installed;
- BusyBox command options differ.

If target is Alpine container, test in Alpine. Do not assume Ubuntu behavior.

---

## 23. Windows Containers

PowerShell in Windows containers differs from Linux containers:

- base images larger;
- Windows filesystem semantics;
- PowerShell availability depends image;
- Windows Server Core vs Nano Server;
- .NET Framework vs .NET;
- path and shell differences;
- process isolation/hyper-v isolation issues.

Use Windows containers only when needed for Windows-specific workloads.

For Java cross-platform CI, Linux containers are usually simpler.

---

## 24. CI Runners

Common CI shells:

- Linux: Bash default, PowerShell optional.
- Windows: PowerShell often default.
- macOS: zsh/Bash default, PowerShell optional.

Be explicit:

GitHub Actions example:

```yaml
- name: Verify with PowerShell
  shell: pwsh
  run: ./scripts/Verify.ps1 -Profile unit
```

Or:

```yaml
- name: Verify
  run: pwsh -NoProfile -File ./scripts/Verify.ps1 -Profile unit
```

For matrix:

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest, macos-latest]
```

Then run same script.

---

## 25. Cross-Platform Testing Strategy

If script claims cross-platform, test it on all target OS.

Minimum CI matrix:

```text
ubuntu-latest
windows-latest
macos-latest
```

Test:

- `-Help`/parameter binding;
- dry-run/WhatIf;
- path resolution;
- JSON/CSV output;
- native tool presence or mocked commands;
- line endings;
- file operations;
- cleanup.

For scripts requiring Docker, Windows/macOS runner behavior may differ.

For scripts requiring Linux containers, do not claim Windows support unless tested.

---

## 26. Dev Containers

For teams with mixed OS, dev containers provide consistent tools.

Benefits:

- same PowerShell version;
- same Java/Maven/Docker CLI;
- same OS semantics;
- easier onboarding;
- repeatable CI/local.

Example contract:

```text
Scripts support:
  - Linux devcontainer
  - Linux CI runner
  - Windows only for ./scripts/Bootstrap-Windows.ps1
```

This is often better than forcing every script to be fully cross-platform.

---

## 27. Profiles, Modules, and Installed State

Do not rely on interactive modules installed on developer machine.

At script start:

```powershell
#requires -Modules Pester
```

But for CI, install dependencies explicitly.

Check module:

```powershell
if (-not (Get-Module -ListAvailable -Name Pester)) {
  throw 'Required module not found: Pester'
}
```

For production scripts, pin module versions if behavior matters.

Example:

```powershell
Import-Module Pester -MinimumVersion 5.0
```

But module version management is a bigger topic for Part 017.

---

## 28. Cross-Platform Filesystem Cleanup

PowerShell cleanup example:

```powershell
[CmdletBinding(SupportsShouldProcess)]
param(
  [ValidateSet('maven', 'gradle', 'all')]
  [string] $Target = 'all'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')

$paths = switch ($Target) {
  'maven' { @(Join-Path $ProjectRoot 'target') }
  'gradle' { @(Join-Path $ProjectRoot 'build'), @(Join-Path $ProjectRoot '.gradle') }
  'all' { @(Join-Path $ProjectRoot 'target'), @(Join-Path $ProjectRoot 'build'), @(Join-Path $ProjectRoot '.gradle') }
}

foreach ($path in $paths) {
  if (Test-Path -Path $path) {
    if ($PSCmdlet.ShouldProcess($path, 'Remove')) {
      Remove-Item -Path $path -Recurse -Force -ErrorAction Stop
    }
  }
}
```

Run:

```powershell
pwsh ./Clean.ps1 -Target all -WhatIf
```

This is cross-platform if paths and permissions behave as expected.

---

## 29. Cross-Platform REST Script

REST scripts are often very portable.

```powershell
#requires -Version 7.0

[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string] $Uri
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$response = Invoke-RestMethod -Uri $Uri -TimeoutSec 30

[PSCustomObject]@{
  Uri = $Uri
  Status = $response.status
  Timestamp = (Get-Date).ToUniversalTime().ToString('o')
}
```

Potential differences:

- TLS/certificate store;
- proxy config;
- DNS;
- corporate network;
- CA certificates in container;
- OS trust store.

Even “portable REST” depends on environment.

---

## 30. Certificate Store

Windows certificate store differs from Linux/macOS.

PowerShell provider:

```powershell
Get-ChildItem Cert:
```

Works primarily in Windows/current user/local machine contexts, with cross-platform limitations/differences.

If your script installs or reads certificates, it is likely platform-specific.

Document:

```text
Windows-only: installs cert into CurrentUser\Root.
Linux/macOS: not supported.
```

Or implement separate branches with tests.

---

## 31. Registry Provider

Windows registry provider:

```powershell
Get-ChildItem HKLM:
```

Windows-only.

Any script using:

```powershell
HKLM:
HKCU:
```

is Windows-specific.

Do not call it cross-platform.

Use platform guards:

```powershell
if (-not $IsWindows) {
  throw 'This script requires Windows because it uses registry.'
}
```

---

## 32. Case Study: Cross-Platform Verify Script

```powershell
#requires -Version 7.0

[CmdletBinding()]
param(
  [ValidateSet('unit', 'integration')]
  [string] $Profile = 'unit',

  [string[]] $MavenArgs = @()
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

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory)][string] $FilePath,
    [string[]] $ArgumentList = @()
  )

  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE"
  }
}

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$Pom = Join-Path $ProjectRoot 'pom.xml'

if (-not (Test-Path -Path $Pom -PathType Leaf)) {
  throw "pom.xml not found: $Pom"
}

Require-Command -Name 'mvn'

$argsList = @('-f', $Pom, '-P', $Profile, 'test')
$argsList += $MavenArgs

Write-Information "Running Maven profile=$Profile on $($PSVersionTable.OS)" -InformationAction Continue
Invoke-NativeChecked -FilePath 'mvn' -ArgumentList $argsList
```

This is reasonably portable, assuming Maven is installed and works.

---

## 33. Case Study: Platform-Specific Bootstrap

Some workflows should be split.

```text
Bootstrap-Windows.ps1
Bootstrap-Linux.ps1
Bootstrap-MacOS.ps1
```

Instead of one giant script with many branches.

Or one dispatcher:

```powershell
if ($IsWindows) {
  & "$PSScriptRoot/Bootstrap-Windows.ps1"
}
elseif ($IsLinux) {
  & "$PSScriptRoot/Bootstrap-Linux.ps1"
}
elseif ($IsMacOS) {
  & "$PSScriptRoot/Bootstrap-MacOS.ps1"
}
else {
  throw 'Unsupported OS'
}
```

Use split scripts when platform logic is substantially different.

Use one script when 90% logic shared and only minor path/tool differences.

---

## 34. Cross-Platform Security Considerations

Different platforms expose secrets differently:

- Windows Credential Manager;
- macOS Keychain;
- Linux secret service/keyring;
- CI secret env vars;
- container-mounted secrets;
- Kubernetes secrets.

Avoid hardcoding one storage model unless platform-specific.

For CI scripts, prefer environment variables injected by CI and avoid logging.

For local developer scripts, integrate with organization-approved secret manager if needed.

Do not implement homemade secret storage in PowerShell.

---

## 35. Performance Differences

PowerShell can be slower than Bash/native tools for huge file operations or text processing.

Cross-platform scripts should avoid:

```powershell
Get-ChildItem -Recurse C:\huge | ForEach-Object ...
```

without understanding cost.

For large repositories, use:

- native build tool;
- `git` commands;
- targeted paths;
- filters;
- avoid unnecessary object materialization;
- measure.

PowerShell object pipeline has overhead but usually fine for admin/build automation.

---

## 36. Portability Decision Framework

Ask:

1. Does the script need to run on all OS?
2. Are the underlying tools available on all OS?
3. Are filesystem semantics important?
4. Are secrets handled differently?
5. Are native commands platform-specific?
6. Is PowerShell 7 installed everywhere?
7. Is container/devcontainer acceptable as standard runtime?
8. Would Bash be better for Linux-only?
9. Would separate scripts be clearer?
10. Can CI test every claimed platform?

If you cannot test it, do not claim it.

---

## 37. Practical Compatibility Levels

Define levels:

### Level 0 — Platform-specific

```text
Windows-only PowerShell for certificate/registry/IIS.
```

### Level 1 — PowerShell 7 cross-platform, no native tools

```text
JSON/CSV/REST/object script.
```

### Level 2 — Cross-platform with common native tools

```text
Requires pwsh, git, Java, Maven.
```

### Level 3 — Cross-platform with containers/devcontainer

```text
Runs inside standardized Linux container.
```

### Level 4 — CI matrix verified

```text
Tested on ubuntu-latest, windows-latest, macos-latest.
```

Be explicit which level each script targets.

---

## 38. Example README Compatibility Section

```markdown
## Script Compatibility

| Script | Runtime | OS | Notes |
|---|---|---|---|
| scripts/Verify.ps1 | PowerShell 7.2+ | Linux, Windows, macOS | Requires git, mvn |
| scripts/Clean.ps1 | PowerShell 7.2+ | Linux, Windows, macOS | Supports -WhatIf |
| scripts/Bootstrap-Windows.ps1 | Windows PowerShell 5.1+ | Windows only | Uses registry/cert store |
| scripts/Entrypoint.sh | POSIX sh | Linux containers | No Bash dependency |
```

This prevents ambiguity.

---

## 39. Anti-Patterns

### 39.1 Claiming cross-platform but calling Unix tools

```powershell
grep ERROR logs/*.log
```

Use `Select-String` or document Linux-only.

### 39.2 Assuming case-insensitive filesystem

```powershell
Get-Content Config.json
```

when file is `config.json`.

### 39.3 Using Windows registry in shared script

```powershell
Get-Item HKLM:\...
```

without platform guard.

### 39.4 Relying on profile

Script works only on one developer machine because profile imports functions.

### 39.5 Ignoring native exit code

Cross-platform native command fails differently and script remains green.

### 39.6 Using `Invoke-Expression`

Even worse cross-platform due to quoting differences.

### 39.7 Not testing on Windows

PowerShell syntax works, but native tool/path assumptions fail.

---

## 40. Mini Lab

### Lab 1 — Platform Detection

Run:

```powershell
$PSVersionTable
$IsWindows
$IsLinux
$IsMacOS
```

Write a script that prints supported/unsupported.

---

### Lab 2 — Path Separator

Run:

```powershell
[System.IO.Path]::DirectorySeparatorChar
[System.IO.Path]::PathSeparator
```

Split PATH portably:

```powershell
$env:PATH -split [System.IO.Path]::PathSeparator
```

---

### Lab 3 — Case Sensitivity

Create `config.json`, then try reading `Config.json` on Linux/macOS vs Windows.

---

### Lab 4 — Encoding

Write JSON with `Set-Content -Encoding UTF8`, inspect with external tool/editor.

---

### Lab 5 — Native Command Args

Create path with spaces and pass to native command. Verify argument boundary.

---

## 41. Design Exercise: Cross-Platform Script Contract

Design `Verify.ps1` for Java project.

Document:

```text
Runtime:
OS:
Native tools:
Working directory assumptions:
Environment variables:
Output:
Exit codes:
Tested CI matrix:
Unsupported:
```

Then implement only:

- parameter parsing;
- preflight;
- path resolution;
- native command wrapper;
- `-WhatIf` or dry-run if relevant;
- `-Verbose` logs.

Do not implement business logic before compatibility contract.

---

## 42. Part 016 Summary

PowerShell 7+ is cross-platform, but your script is only cross-platform if its dependencies and OS assumptions are too.

Key takeaways:

1. Prefer PowerShell 7+ (`pwsh`) for modern cross-platform scripts.
2. Declare version with `#requires -Version`.
3. Use `-NoProfile` for automation.
4. Use `$IsWindows`, `$IsLinux`, `$IsMacOS` only when platform-specific branch is needed.
5. Use `Join-Path`, `Test-Path`, `Resolve-Path`, not manual path strings.
6. Respect case sensitivity differences.
7. Control line endings with `.gitattributes`.
8. Be explicit about encoding.
9. Avoid Unix-native tools if claiming Windows support.
10. Avoid aliases like `curl`; use `Invoke-RestMethod`/`Invoke-WebRequest` or `curl.exe` intentionally.
11. Use arrays for native command arguments.
12. Test on every OS you claim to support.
13. Use containers/devcontainers to standardize runtime when full portability is not worth it.
14. Platform-specific scripts are okay if labeled honestly.
15. Compatibility is a contract, not an assumption.

Part 017 will cover PowerShell modules and reusable automation architecture.

---

## 43. Referensi Resmi dan Bacaan Lanjutan

- PowerShell `about_Pwsh`
- PowerShell `about_Requires`
- PowerShell `about_Automatic_Variables`
- PowerShell `about_Profiles`
- PowerShell `about_Execution_Policies`
- PowerShell `about_Path_Syntax`
- PowerShell `Join-Path`, `Resolve-Path`, `Test-Path`
- PowerShell `Invoke-RestMethod`, `Invoke-WebRequest`
- PowerShell `about_Native_Commands`
- PowerShell Docker/container documentation
- Git `.gitattributes` documentation
- CI provider docs for PowerShell shells and OS matrix builds

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
- [x] Part 009 — CLI Design for Internal Tools
- [x] Part 010 — Bash Testing, Linting, Formatting, and Reviewability
- [x] Part 011 — Security Model for Shell Scripts
- [x] Part 012 — PowerShell Mental Model: Objects, Pipeline, Providers
- [x] Part 013 — PowerShell Language Fundamentals for Java Engineers
- [x] Part 014 — PowerShell Error Handling, Strictness, and Observability
- [x] Part 015 — PowerShell Data Automation: JSON, XML, CSV, REST, Objects
- [x] Part 016 — Cross-Platform PowerShell: Windows, Linux, macOS, Containers
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
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-015.md">⬅️ Part 015 — PowerShell Data Automation: JSON, XML, CSV, REST, Objects</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-017.md">Part 017 — PowerShell Modules and Reusable Automation Architecture ➡️</a>
</div>
