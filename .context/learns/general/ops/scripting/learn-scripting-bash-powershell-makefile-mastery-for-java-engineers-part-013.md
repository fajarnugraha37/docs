# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-013.md

# Part 013 — PowerShell Language Fundamentals for Java Engineers

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: memahami bahasa PowerShell secara praktis: variables, types, collections, functions, `param`, validation attributes, scope, script blocks, loops, splatting, modules-ready function style, dan native command invocation.

---

## 0. Posisi Part Ini dalam Seri

Part 012 membangun mental model PowerShell:

- object pipeline;
- cmdlet `Verb-Noun`;
- providers;
- formatting system;
- native command boundary;
- PowerShell 7+;
- kapan PowerShell lebih tepat daripada Bash.

Part 013 masuk ke bahasa PowerShell itu sendiri.

Tujuannya bukan menghafal seluruh syntax, tetapi membangun kemampuan untuk menulis script PowerShell yang:

- jelas;
- typed enough;
- parameterized;
- validated;
- composable;
- cross-platform-aware;
- tidak mencampur data dan display;
- bisa dipakai di CI/local;
- mudah direview oleh engineer lain.

Untuk Java engineer, PowerShell terasa lebih dekat ke scripting language yang punya akses object/.NET daripada shell text tradisional. Tetapi ia tetap shell, jadi tetap ada boundary dengan native process, filesystem, environment, dan exit code.

---

## 1. PowerShell Script Anatomy

File PowerShell biasanya `.ps1`.

Minimal:

```powershell
#requires -Version 7.0

param(
  [Parameter(Mandatory)]
  [ValidateSet('dev', 'staging', 'prod')]
  [string] $Environment
)

Write-Output "Environment: $Environment"
```

Run:

```powershell
pwsh ./script.ps1 -Environment dev
```

Anatomy:

- `#requires`: runtime requirement;
- `param(...)`: input contract;
- typed parameters;
- validation attributes;
- script body;
- output stream.

A more production-style script:

```powershell
#requires -Version 7.0

[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateSet('dev', 'staging', 'prod')]
  [string] $Environment,

  [switch] $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step {
  param([Parameter(Mandatory)][string] $Message)
  Write-Information "==> $Message" -InformationAction Continue
}

Write-Step "Running for environment $Environment"

if ($DryRun) {
  Write-Step "Dry run mode"
}
```

We will unpack this gradually.

---

## 2. Comments and Documentation

Line comment:

```powershell
# This is a comment
```

Block comment:

```powershell
<#
This is a block comment.
#>
```

Comment-based help:

```powershell
<#
.SYNOPSIS
Runs service verification.

.DESCRIPTION
Runs local verification similar to CI.

.PARAMETER Environment
Target environment.

.EXAMPLE
./Verify.ps1 -Environment dev
#>
param(
  [Parameter(Mandatory)]
  [string] $Environment
)
```

PowerShell can surface help from these comments:

```powershell
Get-Help ./Verify.ps1 -Full
```

This is much better than ad-hoc `--help` in Bash when you are writing PowerShell-native tools.

---

## 3. Variables

Assignment:

```powershell
$name = 'Alice'
$count = 3
$isEnabled = $true
```

Use:

```powershell
$name
```

String interpolation:

```powershell
"Hello $name"
```

Property interpolation needs `$()`:

```powershell
"Process id is $($process.Id)"
```

Single quotes are literal:

```powershell
'Hello $name'
```

Double quotes interpolate:

```powershell
"Hello $name"
```

Similar to Bash in concept, but PowerShell variables are objects.

---

## 4. Types

PowerShell is dynamically typed but can use type annotations.

```powershell
[string] $Name = 'Alice'
[int] $Port = 8080
[bool] $Enabled = $true
[datetime] $Now = [datetime]::UtcNow
```

Parameter typing:

```powershell
param(
  [int] $Port = 8080
)
```

If caller passes:

```powershell
./Run.ps1 -Port abc
```

PowerShell fails parameter binding before script logic.

This is a big advantage over Bash manual validation.

However, type conversion can surprise:

```powershell
[int] "42"
```

works.

Be explicit with validation for domain constraints:

```powershell
[ValidateRange(1, 65535)]
[int] $Port
```

---

## 5. Strings

Single quote:

```powershell
'Literal $HOME'
```

Double quote:

```powershell
"Home is $HOME"
```

Here-string:

```powershell
@"
line one
line two $name
"@
```

Literal here-string:

```powershell
@'
line one
line two $name
'@
```

Use here-string for multi-line templates, but be careful with escaping when generating structured data. For JSON, prefer objects + `ConvertTo-Json`.

Bad:

```powershell
$json = "{ `"env`": `"$Environment`" }"
```

Better:

```powershell
$json = [PSCustomObject]@{
  env = $Environment
} | ConvertTo-Json
```

---

## 6. Arrays

Create:

```powershell
$items = @('api', 'worker', 'scheduler')
```

Append:

```powershell
$items += 'admin'
```

For small arrays, okay. For large arrays, `+=` repeatedly can be inefficient because arrays are fixed-size .NET arrays and copied. For large collection building, use `List[T]`.

```powershell
$list = [System.Collections.Generic.List[string]]::new()
$list.Add('api')
$list.Add('worker')
```

Loop:

```powershell
foreach ($item in $items) {
  Write-Output $item
}
```

Index:

```powershell
$items[0]
```

Count:

```powershell
$items.Count
```

Ensure array when command may return one item:

```powershell
$items = @(Get-ChildItem -Path ./scripts -Filter *.ps1)
```

Without `@(...)`, single item may not behave like collection in all contexts.

---

## 7. Hashtables

Create:

```powershell
$config = @{
  Environment = 'dev'
  Port = 8080
  Debug = $false
}
```

Access:

```powershell
$config['Environment']
$config.Environment
```

Modify:

```powershell
$config.Port = 9090
```

Ordered hashtable:

```powershell
[ordered]@{
  Service = 'api'
  Version = '1.2.3'
}
```

Useful when output order matters for display or JSON readability.

---

## 8. PSCustomObject

Use object for structured output:

```powershell
$result = [PSCustomObject]@{
  Service = 'api'
  Environment = 'dev'
  Status = 'OK'
}

$result
```

Select:

```powershell
$result | Select-Object Service, Status
```

JSON:

```powershell
$result | ConvertTo-Json
```

In internal tooling, outputting objects makes functions composable.

Bad:

```powershell
Write-Output "service=api status=OK"
```

Good:

```powershell
[PSCustomObject]@{
  Service = 'api'
  Status = 'OK'
}
```

Then caller can choose formatting.

---

## 9. Null

PowerShell null is:

```powershell
$null
```

Recommended comparison:

```powershell
if ($null -eq $value) {
  ...
}
```

Why `$null` on left?

If `$value` is array, comparison behavior can filter arrays. `$null -eq $value` is less surprising.

Empty string check:

```powershell
[string]::IsNullOrWhiteSpace($Name)
```

Example:

```powershell
if ([string]::IsNullOrWhiteSpace($Environment)) {
  throw 'Environment is required'
}
```

---

## 10. Booleans

```powershell
$true
$false
```

Switch parameter:

```powershell
param(
  [switch] $DryRun
)

if ($DryRun) {
  'dry run'
}
```

Avoid string booleans where possible.

Bad:

```powershell
[string] $DryRun = 'false'
if ($DryRun) { ... } # non-empty string is truthy
```

Good:

```powershell
[bool] $DryRun = $false
```

or switch:

```powershell
[switch] $DryRun
```

---

## 11. Conditionals

```powershell
if ($Environment -eq 'prod') {
  'prod'
}
elseif ($Environment -eq 'staging') {
  'staging'
}
else {
  'other'
}
```

Comparison operators:

```powershell
-eq
-ne
-gt
-ge
-lt
-le
-like
-notlike
-match
-notmatch
-in
-notin
-contains
-notcontains
```

Case-sensitive:

```powershell
-ceq
-cne
-clike
-cmatch
```

PowerShell string comparisons are case-insensitive by default.

For environment values, prefer validation:

```powershell
[ValidateSet('dev', 'staging', 'prod')]
[string] $Environment
```

---

## 12. Switch Statement

PowerShell `switch` is powerful.

```powershell
switch ($Environment) {
  'dev' {
    $Url = 'http://localhost:8080'
  }
  'staging' {
    $Url = 'https://staging.example.com'
  }
  'prod' {
    $Url = 'https://prod.example.com'
  }
  default {
    throw "Invalid environment: $Environment"
  }
}
```

Regex switch:

```powershell
switch -Regex ($Version) {
  '^\d+\.\d+\.\d+$' { 'semver-ish' }
  default { throw "Invalid version: $Version" }
}
```

Be careful: `switch` can continue matching multiple clauses unless you use `break` in some patterns. For simple literal cases, it behaves as expected, but know the semantics when advanced.

---

## 13. Loops

### 13.1 `foreach` statement

```powershell
foreach ($module in $Modules) {
  Write-Output $module
}
```

Good for collections already in memory.

### 13.2 `ForEach-Object`

```powershell
$Modules | ForEach-Object {
  Write-Output $_
}
```

Good in pipeline.

### 13.3 `while`

```powershell
while ($true) {
  Start-Sleep -Seconds 1
  break
}
```

### 13.4 `for`

```powershell
for ($i = 0; $i -lt 3; $i++) {
  $i
}
```

For scripts, prefer readability. `foreach` statement is often clearer than pipeline for imperative workflows.

---

## 14. Functions

Basic:

```powershell
function Get-NormalizedEnvironment {
  param(
    [Parameter(Mandatory)]
    [string] $Environment
  )

  switch ($Environment.ToLowerInvariant()) {
    'development' { 'dev' }
    'dev' { 'dev' }
    'stage' { 'staging' }
    'staging' { 'staging' }
    'production' { 'prod' }
    'prod' { 'prod' }
    default { throw "Invalid environment: $Environment" }
  }
}
```

Call:

```powershell
Get-NormalizedEnvironment -Environment production
```

PowerShell functions output anything written to success pipeline. No explicit `return` needed.

Important:

```powershell
return 'value'
```

also writes value then returns, but many PowerShell style guides prefer just outputting value.

Be careful: accidental output becomes function return data.

---

## 15. Accidental Output

PowerShell outputs any uncaptured expression.

Example:

```powershell
function Get-Thing {
  'debug'
  [PSCustomObject]@{ Name = 'thing' }
}
```

Caller receives two objects: string `"debug"` and object.

For diagnostics, use diagnostic streams:

```powershell
Write-Verbose "debug"
[PSCustomObject]@{ Name = 'thing' }
```

This is analogous to Bash stdout/stderr discipline.

Rule:

> In functions, only output data intentionally.

---

## 16. Advanced Functions and `[CmdletBinding()]`

Add:

```powershell
function Invoke-Verify {
  [CmdletBinding()]
  param(
    [ValidateSet('unit', 'integration')]
    [string] $Profile = 'unit'
  )

  Write-Verbose "Profile: $Profile"
}
```

Benefits:

- supports common parameters like `-Verbose`, `-Debug`, `-ErrorAction`;
- behaves more like cmdlet;
- enables parameter binding features;
- improves tooling.

Script-level:

```powershell
[CmdletBinding()]
param(...)
```

Then script supports:

```powershell
./Verify.ps1 -Verbose
```

Use `[CmdletBinding()]` for serious scripts/functions.

---

## 17. Parameters

Common attributes:

```powershell
param(
  [Parameter(Mandatory)]
  [ValidateSet('dev', 'staging', 'prod')]
  [string] $Environment,

  [ValidateRange(1, 65535)]
  [int] $Port = 8080,

  [ValidateScript({ Test-Path $_ -PathType Leaf })]
  [string] $ConfigPath,

  [switch] $DryRun
)
```

`Mandatory` prompts interactively if missing. In CI, this can be bad. If you don't want prompt behavior, omit `Mandatory` and validate manually with clear error.

Example CI-friendly:

```powershell
param(
  [ValidateSet('dev', 'staging', 'prod')]
  [string] $Environment
)

if ([string]::IsNullOrWhiteSpace($Environment)) {
  throw '-Environment is required'
}
```

Both approaches are valid. For scripts used interactively, `Mandatory` is convenient. For CI-only scripts, explicit validation can avoid prompts.

---

## 18. Parameter Validation Attributes

Useful:

```powershell
[ValidateSet('dev', 'staging', 'prod')]
[string] $Environment
```

```powershell
[ValidatePattern('^\d+\.\d+\.\d+$')]
[string] $Version
```

```powershell
[ValidateRange(1, 65535)]
[int] $Port
```

```powershell
[ValidateNotNullOrEmpty()]
[string] $Name
```

```powershell
[ValidateScript({ Test-Path $_ -PathType Container })]
[string] $Directory
```

These are analogous to parameter-level validation annotations.

However, keep error messages user-friendly. Built-in validation errors can be verbose but useful.

---

## 19. Splatting

Instead of:

```powershell
Invoke-RestMethod -Uri $Uri -Method Post -Headers $Headers -Body $Body -ContentType 'application/json' -TimeoutSec 30
```

Use hashtable:

```powershell
$params = @{
  Uri = $Uri
  Method = 'Post'
  Headers = $Headers
  Body = $Body
  ContentType = 'application/json'
  TimeoutSec = 30
}

Invoke-RestMethod @params
```

Conditional parameters:

```powershell
$params = @{
  Uri = $Uri
  Method = 'Get'
}

if ($TimeoutSec) {
  $params.TimeoutSec = $TimeoutSec
}

Invoke-RestMethod @params
```

This is like building named argument map.

Splatting is one of the best PowerShell readability tools.

---

## 20. Script Blocks

Script block:

```powershell
{ $_.Length -gt 1MB }
```

Used in:

```powershell
Where-Object { $_.Length -gt 1MB }
ForEach-Object { $_.Name }
```

Assign:

```powershell
$filter = { $_.Length -gt 1MB }
Get-ChildItem | Where-Object $filter
```

Invoke:

```powershell
& $filter
```

Script blocks are like lambdas/closures, but PowerShell scoping rules need care.

For normal scripts, use them mostly in pipeline operations and simple callbacks.

---

## 21. Scope

PowerShell scopes:

- Global
- Script
- Local
- Private
- using scope in remoting/jobs

Variables in functions are local by default, but can read parent scope variables.

Script scope:

```powershell
$script:Config = @{}
```

Global:

```powershell
$global:Name = 'bad idea generally'
```

Guidelines:

- avoid global mutable state;
- pass parameters to functions;
- use script scope sparingly for module-level constants;
- prefer function outputs over mutating outer variables.

Java analogy: avoid static mutable state.

---

## 22. Constants / ReadOnly Variables

```powershell
Set-Variable -Name ToolVersion -Value '1.0.0' -Option Constant
```

ReadOnly:

```powershell
Set-Variable -Name DefaultEnvironment -Value 'dev' -Option ReadOnly
```

For most scripts, simple variables are enough.

```powershell
$DefaultEnvironment = 'dev'
```

Do not overuse constants if tests need to override.

---

## 23. `$PSBoundParameters`

Inside function/script with parameters:

```powershell
$PSBoundParameters
```

contains parameters explicitly supplied by caller.

Example:

```powershell
if ($PSBoundParameters.ContainsKey('Port')) {
  Write-Verbose "Port was explicitly supplied"
}
```

Useful for distinguishing default value vs caller-provided value.

Example:

```powershell
param(
  [int] $TimeoutSec = 60
)

if ($PSBoundParameters.ContainsKey('TimeoutSec')) {
  Write-Verbose "Custom timeout: $TimeoutSec"
}
```

---

## 24. `$MyInvocation` and `$PSScriptRoot`

Script directory:

```powershell
$PSScriptRoot
```

This is analogous to Bash `${BASH_SOURCE[0]}` resolution, but easier.

Use:

```powershell
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
```

For script path details:

```powershell
$MyInvocation
```

In most scripts, `$PSScriptRoot` is enough.

Example:

```powershell
$ConfigPath = Join-Path $PSScriptRoot '..' 'config' 'app.json'
```

---

## 25. Paths

Use:

```powershell
Join-Path $Root 'target'
```

Check existence:

```powershell
Test-Path -Path $Path -PathType Leaf
Test-Path -Path $Path -PathType Container
```

Resolve:

```powershell
Resolve-Path -Path $Path
```

Create directory:

```powershell
New-Item -ItemType Directory -Path $Dir -Force
```

Remove:

```powershell
Remove-Item -Path $Path -Recurse -Force
```

Be careful: `Remove-Item` is dangerous like `rm -rf`. Validate path.

PowerShell cmdlets support `-WhatIf` and `-Confirm` if functions use ShouldProcess; more in later parts.

---

## 26. Native Command Invocation

Call native:

```powershell
mvn test
docker build -t myapp .
```

Arguments with spaces:

```powershell
$Path = 'my folder'
git -C $Path status
```

PowerShell generally handles argument passing better than Bash strings, but native command invocation has had historical quirks, especially Windows quoting. PowerShell 7 improved native argument passing, but still test cross-platform.

Avoid building native command as a single string:

Bad:

```powershell
$cmd = "mvn -P $Profile test"
Invoke-Expression $cmd
```

Good:

```powershell
& mvn -P $Profile test
```

Or build array:

```powershell
$argsList = @('-P', $Profile, 'test')
& mvn @argsList
```

Avoid `Invoke-Expression`; it is PowerShell's `eval`.

---

## 27. Call Operator `&`

Use call operator to invoke command stored in variable.

```powershell
$tool = 'mvn'
& $tool test
```

With args:

```powershell
$argsList = @('-P', $Profile, 'test')
& $tool @argsList
```

This preserves argument boundaries better than constructing a string.

---

## 28. Stop Using `Invoke-Expression`

Bad:

```powershell
Invoke-Expression "docker build -t $ImageTag $Context"
```

Risk:

- code injection;
- quoting bugs;
- argument boundary issues;
- hard to review.

Good:

```powershell
$argsList = @('build', '-t', $ImageTag, $Context)
& docker @argsList
```

PowerShell equivalent of Bash arrays.

Rule:

> If you reach for `Invoke-Expression`, stop and build argument arrays or use explicit dispatch.

---

## 29. External Process Exit Status

For native commands:

```powershell
mvn test
$LASTEXITCODE
$?
```

`$LASTEXITCODE` is native process exit code.

`$?` indicates whether last command succeeded from PowerShell perspective.

Nuance:

- cmdlet errors use error records;
- native command non-zero behavior differs by PowerShell version/settings;
- `$ErrorActionPreference` does not always apply to native command exit status the way Java engineers expect.

For critical native command, check explicitly:

```powershell
& mvn test
if ($LASTEXITCODE -ne 0) {
  throw "mvn test failed with exit code $LASTEXITCODE"
}
```

Part 014 will cover this deeply.

---

## 30. Output Streams

Data output:

```powershell
[PSCustomObject]@{ Status = 'OK' }
```

Verbose:

```powershell
Write-Verbose "Detailed message"
```

Warning:

```powershell
Write-Warning "Something suspicious"
```

Error:

```powershell
Write-Error "Something failed"
```

Information:

```powershell
Write-Information "Human info" -InformationAction Continue
```

Host display:

```powershell
Write-Host "Hello"
```

Use `Write-Host` sparingly. It is for host UI, not data contract.

For scripts with object output, avoid polluting success stream.

---

## 31. `Write-Output` vs Bare Output

These are equivalent in many simple cases:

```powershell
Write-Output $object
$object
```

In functions, bare output is idiomatic.

```powershell
function Get-Metadata {
  [PSCustomObject]@{
    Version = '1.2.3'
  }
}
```

Avoid:

```powershell
return $object
```

if it makes Java engineers think function returns only that. In PowerShell, any success output is returned.

Use `return` mainly to exit early:

```powershell
if ($DryRun) {
  Write-Information "Dry run" -InformationAction Continue
  return
}
```

---

## 32. Error Throwing Basics

Throw:

```powershell
throw "Invalid environment: $Environment"
```

Try/catch:

```powershell
try {
  Invoke-Thing
}
catch {
  Write-Error "Failed: $_"
  exit 1
}
```

PowerShell has terminating and non-terminating errors. This is critical and covered in Part 014.

For now, know:

- `throw` creates terminating error;
- many cmdlets emit non-terminating errors by default;
- use `-ErrorAction Stop` or `$ErrorActionPreference = 'Stop'` for stricter behavior.

---

## 33. Strict Mode

Use:

```powershell
Set-StrictMode -Version Latest
```

This catches some issues like using uninitialized variables.

Example:

```powershell
Set-StrictMode -Version Latest
Write-Output $TypoVariable
```

will error.

Strict mode is useful, but can affect legacy scripts.

For new scripts, prefer strict mode.

Also:

```powershell
$ErrorActionPreference = 'Stop'
```

to turn many non-terminating errors into terminating errors. Details in Part 014.

---

## 34. Script-Level Template

A practical script template:

```powershell
#requires -Version 7.0

[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateSet('dev', 'staging', 'prod')]
  [string] $Environment,

  [switch] $DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step {
  param([Parameter(Mandatory)][string] $Message)
  Write-Information "==> $Message" -InformationAction Continue
}

function Require-Command {
  param([Parameter(Mandatory)][string] $Name)

  if ($null -eq (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Main {
  Require-Command -Name 'mvn'

  Write-Step "Running verification for $Environment"

  if ($DryRun) {
    Write-Step "Dry run: no changes will be made"
    return
  }

  & mvn test
  if ($LASTEXITCODE -ne 0) {
    throw "mvn test failed with exit code $LASTEXITCODE"
  }
}

Main
```

This is roughly analogous to Bash `main "$@"`, but parameter binding is built into script.

---

## 35. Naming Conventions

PowerShell uses PascalCase for functions and parameters:

```powershell
function Invoke-Verification { ... }
param([string] $Environment)
```

Function names should use approved verbs:

```powershell
Get-Verb
```

Examples:

```powershell
Get-BuildMetadata
Invoke-ServiceVerification
New-DeploymentPayload
Test-ServiceHealth
Remove-BuildArtifacts
```

Avoid:

```powershell
Do-Thing
Run-Stuff
Magic
```

Use PowerShell discoverability conventions.

---

## 36. Approved Verbs

PowerShell encourages approved verbs:

```powershell
Get-Verb
```

Common:

- Get
- Set
- New
- Remove
- Invoke
- Test
- ConvertTo
- ConvertFrom
- Import
- Export
- Start
- Stop
- Write
- Read

For internal functions, still use meaningful names:

```powershell
function Test-ServiceHealth { ... }
function New-DeploymentPayload { ... }
function Invoke-DeployRelease { ... }
```

This makes scripts feel like cmdlets.

---

## 37. Example: Verify Script

```powershell
#requires -Version 7.0

[CmdletBinding()]
param(
  [ValidateSet('unit', 'integration')]
  [string] $Profile = 'unit',

  [switch] $Quick,

  [string[]] $MavenArgs = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Require-Command {
  param([Parameter(Mandatory)][string] $Name)

  if ($null -eq (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Invoke-Native {
  param(
    [Parameter(Mandatory)][string] $FilePath,
    [string[]] $ArgumentList = @()
  )

  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE"
  }
}

Require-Command -Name 'mvn'

$argsList = @('-P', $Profile)

if ($Quick) {
  $argsList += '-DskipITs=true'
}

$argsList += 'test'
$argsList += $MavenArgs

Write-Information "Running Maven profile=$Profile quick=$Quick" -InformationAction Continue
Invoke-Native -FilePath 'mvn' -ArgumentList $argsList
```

Call:

```powershell
pwsh ./Verify.ps1 -Profile integration -MavenArgs '-DskipDocker=true'
```

This shows argument array pattern.

---

## 38. Example: Build JSON Payload

```powershell
function New-DeploymentPayload {
  param(
    [Parameter(Mandatory)]
    [ValidateSet('staging', 'prod')]
    [string] $Environment,

    [Parameter(Mandatory)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string] $Version
  )

  [PSCustomObject]@{
    env = $Environment
    version = $Version
  }
}

$payload = New-DeploymentPayload -Environment staging -Version '1.2.3'
$json = $payload | ConvertTo-Json
```

No string concatenation.

---

## 39. Example: Path-Safe Cleanup

```powershell
#requires -Version 7.0

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
  if (Test-Path $path) {
    if ($PSCmdlet.ShouldProcess($path, 'Remove build artifact directory')) {
      Remove-Item -Path $path -Recurse -Force
    }
  }
}
```

Run dry-run-like:

```powershell
./Clean.ps1 -WhatIf
```

`SupportsShouldProcess` unlocks `-WhatIf`/`-Confirm`. This is a major PowerShell safety feature.

---

## 40. Mini Lab

### Lab 1 — Parameter Validation

Create:

```powershell
param(
  [ValidateSet('dev', 'staging', 'prod')]
  [string] $Environment
)

"Environment: $Environment"
```

Run with valid/invalid values.

---

### Lab 2 — PSCustomObject

Create object:

```powershell
[PSCustomObject]@{
  Service = 'api'
  Status = 'OK'
} | ConvertTo-Json
```

---

### Lab 3 — Splatting

Call `Invoke-RestMethod` or mock with hashtable params.

```powershell
$params = @{
  Uri = 'https://example.com'
  Method = 'Get'
}
```

Print params first if no network.

---

### Lab 4 — Native args

Create script that builds Maven args array and prints each arg:

```powershell
$argsList = @('-P', 'unit', 'test', '-Dname=Alice Smith')
$argsList | ForEach-Object { "<$_>" }
```

---

### Lab 5 — `SupportsShouldProcess`

Write cleanup script supporting `-WhatIf`.

Run:

```powershell
./Clean.ps1 -WhatIf
```

Observe no deletion.

---

## 41. Design Exercise: PowerShell Internal CLI

Design `Service.ps1` with parameters:

```powershell
param(
  [ValidateSet('verify', 'run', 'metadata')]
  [string] $Command,

  [ValidateSet('dev', 'staging-like')]
  [string] $Environment = 'dev',

  [switch] $DebugApp,

  [ValidateSet('text', 'json')]
  [string] $Output = 'text'
)
```

Then decide:

- Which commands output objects?
- Which commands call native tools?
- Which parameters belong globally vs command-specific?
- Should this be one script or separate scripts?
- Where should `-WhatIf` apply?
- What should be strict-mode behavior?
- How will you test `$LASTEXITCODE` for native commands?

This mirrors the Bash CLI design but uses PowerShell idioms.

---

## 42. Review Checklist

### Parameters

- Are required values declared/validated?
- Are `ValidateSet`, `ValidatePattern`, `ValidateRange` used where appropriate?
- Is `Mandatory` safe for CI use?

### Output

- Does function emit only intended data?
- Are diagnostics using `Verbose`, `Warning`, `Information`, or `Error` streams?
- Is `Write-Host` avoided for data?

### Native commands

- Is `Invoke-Expression` avoided?
- Are native args passed as arrays/splatting?
- Is `$LASTEXITCODE` checked?

### Structure

- Is `Set-StrictMode` used?
- Is `$ErrorActionPreference = 'Stop'` used intentionally?
- Is `$PSScriptRoot` used instead of current directory assumptions?
- Are functions named with approved verbs?

### Safety

- Are destructive operations behind `ShouldProcess` where appropriate?
- Are paths validated?
- Are secrets kept out of logs?

---

## 43. Part 013 Summary

PowerShell language fundamentals give you stronger structure than Bash for many automation tasks.

Key takeaways:

1. PowerShell scripts can declare typed parameters.
2. Validation attributes reduce manual parsing.
3. Use `[CmdletBinding()]` for serious scripts/functions.
4. Use `Set-StrictMode -Version Latest` for new scripts.
5. Keep data output separate from diagnostics.
6. Functions output success-stream objects, intentionally or accidentally.
7. Use PSCustomObject for structured output.
8. Use hashtables and splatting for readable parameter passing.
9. Use arrays for native command argument lists.
10. Avoid `Invoke-Expression`.
11. Use `$PSScriptRoot` for script-relative paths.
12. Use PowerShell naming conventions and approved verbs.
13. Use `SupportsShouldProcess` for safe destructive operations.
14. Check `$LASTEXITCODE` for native commands.
15. Treat PowerShell as object automation, not text shell with different syntax.

Part 014 will go deeper into PowerShell error handling, strictness, streams, observability, and native command failure semantics.

---

## 44. Referensi Resmi dan Bacaan Lanjutan

- PowerShell `about_Scripts`
- PowerShell `about_Functions`
- PowerShell `about_Functions_Advanced`
- PowerShell `about_Parameters`
- PowerShell `about_Parameter_Validation_Attributes`
- PowerShell `about_Splatting`
- PowerShell `about_Script_Blocks`
- PowerShell `about_Scopes`
- PowerShell `about_Automatic_Variables`
- PowerShell `about_Comparison_Operators`
- PowerShell `about_ShouldProcess`
- PowerShell `about_Preference_Variables`
- PowerShell `about_Native_Commands`

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
- [x] Part 006 — Data Handling in Bash: Text, Lines, Null Bytes, JSON, CSV
- [x] Part 007 — Filesystem Automation: Safe File Operations
- [x] Part 008 — Process Control: Background Jobs, Signals, Timeouts, Concurrency
- [x] Part 009 — CLI Design for Internal Tools
- [x] Part 010 — Bash Testing, Linting, Formatting, and Reviewability
- [x] Part 011 — Security Model for Shell Scripts
- [x] Part 012 — PowerShell Mental Model: Objects, Pipeline, Providers
- [x] Part 013 — PowerShell Language Fundamentals for Java Engineers
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
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-012.md">⬅️ Part 012 — PowerShell Mental Model: Objects, Pipeline, Providers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-014.md">Part 014 — PowerShell Error Handling, Strictness, and Observability ➡️</a>
</div>
