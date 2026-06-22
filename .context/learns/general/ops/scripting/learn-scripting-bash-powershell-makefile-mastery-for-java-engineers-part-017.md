# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-017.md

# Part 017 — PowerShell Modules and Reusable Automation Architecture

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: mengubah PowerShell scripts dari file ad-hoc menjadi automation library yang reusable, testable, versioned, documented, dan aman dipakai lintas repo/tim.

---

## 0. Posisi Part Ini dalam Seri

Part PowerShell sejauh ini:

- Part 012: mental model object pipeline, providers.
- Part 013: language fundamentals.
- Part 014: error handling, strictness, observability.
- Part 015: data automation.
- Part 016: cross-platform PowerShell.

Part 017 membahas pertanyaan arsitektural:

> Kapan sekumpulan `.ps1` harus tetap script biasa, dan kapan harus menjadi PowerShell module?

Dalam Bash, reuse sering berupa:

```bash
source scripts/lib/common.sh
```

Dalam PowerShell, reuse yang lebih idiomatis adalah module:

```powershell
Import-Module ./MyCompany.Automation
Invoke-ServiceVerification -Profile unit
```

Module memungkinkan:

- function discovery;
- exported/private functions;
- versioning;
- manifest;
- help;
- testing;
- packaging;
- dependency declaration;
- CI validation;
- internal distribution;
- clearer public API.

Tetapi module juga bisa overkill jika script masih kecil.

Part ini akan membangun mental model reusable automation architecture.

---

## 1. Dari Script ke Library

Script tunggal cocok saat:

- workflow satu tujuan;
- tidak banyak reuse;
- dipanggil langsung oleh manusia/CI;
- logic kecil;
- dependency minimal.

Module cocok saat:

- function dipakai banyak script;
- ada public API internal;
- ada private helper cukup banyak;
- butuh versioning;
- butuh tests;
- butuh packaging/distribution;
- banyak repo memakai automation sama;
- ingin PowerShell-native help/discovery;
- ingin menghindari copy-paste antar repo.

Contoh evolusi:

```text
scripts/Deploy.ps1
scripts/Verify.ps1
scripts/Clean.ps1
```

mulai duplicate:

```powershell
Require-Command
Invoke-NativeChecked
Get-ProjectRoot
New-DeploymentPayload
Test-Version
```

Maka extract:

```text
modules/Company.BuildAutomation/
  Company.BuildAutomation.psd1
  Company.BuildAutomation.psm1
  Public/
  Private/
  Tests/
```

Scripts tetap menjadi CLI tipis:

```powershell
Import-Module "$PSScriptRoot/../modules/Company.BuildAutomation"
Invoke-ServiceVerification -Profile unit
```

---

## 2. PowerShell Module Types

Common module types:

### 2.1 Script module

File `.psm1`.

```text
MyModule.psm1
```

Contains functions written in PowerShell.

This is the main focus.

### 2.2 Module manifest

File `.psd1`.

```text
MyModule.psd1
```

Describes module metadata:

- RootModule;
- ModuleVersion;
- GUID;
- Author;
- Description;
- FunctionsToExport;
- RequiredModules;
- CompatiblePSEditions;
- PowerShellVersion.

### 2.3 Binary module

Compiled .NET assembly.

Useful for high-performance or strongly typed cmdlets. Usually unnecessary for internal scripting.

### 2.4 Dynamic module

Created at runtime. Advanced, rarely needed.

For Java engineers: think of script module as a package/library, manifest as metadata/build descriptor.

---

## 3. Basic `.psm1`

`Company.Automation.psm1`:

```powershell
Set-StrictMode -Version Latest

function Get-Greeting {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]
    [string] $Name
  )

  "Hello, $Name"
}

Export-ModuleMember -Function Get-Greeting
```

Use:

```powershell
Import-Module ./Company.Automation.psm1
Get-Greeting -Name Alice
```

Without `Export-ModuleMember`, functions may be exported by default depending module loading behavior. Be explicit.

---

## 4. Basic `.psd1` Manifest

Create manifest:

```powershell
New-ModuleManifest `
  -Path ./Company.Automation.psd1 `
  -RootModule Company.Automation.psm1 `
  -ModuleVersion 0.1.0 `
  -Author 'Platform Team' `
  -Description 'Internal automation helpers'
```

Simplified manifest content:

```powershell
@{
  RootModule = 'Company.Automation.psm1'
  ModuleVersion = '0.1.0'
  GUID = '00000000-0000-0000-0000-000000000000'
  Author = 'Platform Team'
  Description = 'Internal automation helpers'
  PowerShellVersion = '7.0'
  FunctionsToExport = @(
    'Get-Greeting'
  )
}
```

Import manifest path:

```powershell
Import-Module ./Company.Automation.psd1
```

Prefer importing manifest, not `.psm1`, once module matures.

---

## 5. Recommended Module Layout

Common layout:

```text
modules/
  Company.BuildAutomation/
    Company.BuildAutomation.psd1
    Company.BuildAutomation.psm1
    Public/
      Invoke-ServiceVerification.ps1
      New-DeploymentPayload.ps1
      Test-ServiceHealth.ps1
    Private/
      Invoke-NativeChecked.ps1
      Require-Command.ps1
      Resolve-ProjectRoot.ps1
    Tests/
      Invoke-ServiceVerification.Tests.ps1
      New-DeploymentPayload.Tests.ps1
```

`Company.BuildAutomation.psm1` loads files:

```powershell
$public = Get-ChildItem -Path (Join-Path $PSScriptRoot 'Public') -Filter *.ps1
$private = Get-ChildItem -Path (Join-Path $PSScriptRoot 'Private') -Filter *.ps1

foreach ($file in @($private + $public)) {
  . $file.FullName
}

Export-ModuleMember -Function $public.BaseName
```

This pattern keeps one function per file.

Caveat:

- dot-sourcing executes files;
- files should only define functions, not run workflow;
- loading order matters if functions depend on script-level variables;
- use tests to catch load errors.

---

## 6. Public vs Private Functions

Public functions are module API:

```powershell
Invoke-ServiceVerification
New-DeploymentPayload
Test-ServiceHealth
```

Private functions are implementation details:

```powershell
Invoke-NativeChecked
Require-Command
Resolve-ProjectRoot
Write-Step
```

Public functions should be:

- stable;
- documented;
- tested;
- named with approved verbs;
- parameter validated;
- output contract clear.

Private functions can change more freely.

Like Java:

```text
public class API vs private helper methods
```

Do not export everything.

---

## 7. Function Naming in Modules

Use approved verbs:

```powershell
Get-Verb
```

Good:

```powershell
Get-BuildMetadata
Invoke-ServiceVerification
New-DeploymentPayload
Test-ServiceHealth
Remove-BuildArtifacts
ConvertTo-DeploymentMatrix
```

Bad:

```powershell
Do-Build
Run-Stuff
MakePayload
Magic
```

PowerShell users expect `Verb-Noun`.

For internal modules, noun prefix can avoid collisions:

```powershell
Get-CompanyBuildMetadata
Invoke-CompanyServiceVerification
```

But overly long names reduce usability. Balance.

If module is imported in controlled scripts, shorter domain-specific names are okay.

---

## 8. Cmdlet-Like Function Design

A serious function:

```powershell
function Invoke-ServiceVerification {
  [CmdletBinding()]
  param(
    [ValidateSet('unit', 'integration')]
    [string] $Profile = 'unit',

    [string[]] $MavenArgs = @()
  )

  Set-StrictMode -Version Latest

  Require-Command -Name 'mvn'

  $argsList = @('-P', $Profile, 'test')
  $argsList += $MavenArgs

  Invoke-NativeChecked -FilePath 'mvn' -ArgumentList $argsList
}
```

Characteristics:

- `[CmdletBinding()]`;
- typed parameters;
- validation attributes;
- no hardcoded user environment;
- uses private helper;
- throws on failure;
- output contract clear.

---

## 9. Output Contract for Functions

PowerShell functions should output objects intentionally.

Example:

```powershell
function Get-BuildMetadata {
  [CmdletBinding()]
  param()

  [PSCustomObject]@{
    Service = 'my-service'
    Version = '1.2.3'
    Commit = 'abc123'
  }
}
```

Document:

```powershell
<#
.SYNOPSIS
Gets build metadata for current repository.

.OUTPUTS
PSCustomObject with Service, Version, Commit, Dirty.
#>
```

Avoid writing display text in public API function.

Use:

```powershell
Write-Verbose
Write-Warning
Write-Information
```

for diagnostics.

---

## 10. Script as Thin CLI over Module

`Verify.ps1`:

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

Import-Module (Join-Path $PSScriptRoot '../modules/Company.BuildAutomation/Company.BuildAutomation.psd1') -Force

try {
  Invoke-ServiceVerification -Profile $Profile -MavenArgs $MavenArgs
  exit 0
}
catch {
  Write-Error "Verification failed: $($_.Exception.Message)"
  exit 1
}
```

This keeps CLI concern separate from reusable logic.

Benefits:

- module functions testable directly;
- script is small;
- public API reused by other scripts;
- CI can call script;
- advanced users can import module.

---

## 11. Manifest Metadata

Important manifest fields:

```powershell
@{
  RootModule = 'Company.BuildAutomation.psm1'
  ModuleVersion = '0.1.0'
  GUID = '...'
  Author = 'Platform Team'
  Description = 'Build automation helpers for Java services'
  PowerShellVersion = '7.0'
  CompatiblePSEditions = @('Core')
  FunctionsToExport = @(
    'Get-BuildMetadata',
    'Invoke-ServiceVerification',
    'New-DeploymentPayload',
    'Test-ServiceHealth'
  )
  PrivateData = @{
    PSData = @{
      Tags = @('build', 'java', 'automation')
      ProjectUri = 'https://example.internal/platform/build-automation'
    }
  }
}
```

Use `FunctionsToExport` explicitly. Avoid `'*'` for mature modules.

---

## 12. Module Versioning

Use semantic-ish versioning:

```text
0.1.0 initial internal
0.2.0 additive function
0.2.1 bugfix
1.0.0 stable API
2.0.0 breaking change
```

Breaking changes:

- rename function;
- remove parameter;
- change parameter meaning;
- change output object property;
- change default side effect;
- change error behavior relied on by callers.

Additive changes:

- new optional parameter;
- new output property;
- new function;
- improved validation that only rejects invalid input.

Versioning matters if multiple repos depend on module.

---

## 13. Public API Stability

Once a module is shared, treat exported functions like public Java APIs.

Avoid:

```powershell
function Invoke-Deploy($env, $version)
```

Then later changing parameter meaning.

Prefer named, validated parameters:

```powershell
function Invoke-DeployRelease {
  [CmdletBinding(SupportsShouldProcess)]
  param(
    [ValidateSet('staging', 'prod')]
    [string] $Environment,

    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string] $Version
  )
}
```

Document output and side effects.

---

## 14. Comment-Based Help for Functions

```powershell
function New-DeploymentPayload {
<#
.SYNOPSIS
Creates deployment API payload.

.PARAMETER Environment
Target environment: staging or prod.

.PARAMETER Version
Semantic version to deploy.

.OUTPUTS
PSCustomObject containing env and version.

.EXAMPLE
New-DeploymentPayload -Environment staging -Version 1.2.3
#>
  [CmdletBinding()]
  param(
    [ValidateSet('staging', 'prod')]
    [string] $Environment,

    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string] $Version
  )

  [PSCustomObject]@{
    env = $Environment
    version = $Version
  }
}
```

Help:

```powershell
Get-Help New-DeploymentPayload -Full
```

This is PowerShell-native documentation.

---

## 15. Private Helpers

Example `Private/Invoke-NativeChecked.ps1`:

```powershell
function Invoke-NativeChecked {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]
    [string] $FilePath,

    [string[]] $ArgumentList = @(),

    [int[]] $AllowedExitCodes = @(0)
  )

  & $FilePath @ArgumentList
  $exitCode = $LASTEXITCODE

  if ($exitCode -notin $AllowedExitCodes) {
    throw "Native command failed: $FilePath exitCode=$exitCode"
  }
}
```

Private helper can still be tested, but not exported.

If private helper becomes widely useful, consider promoting to public API carefully.

---

## 16. Avoid Module Import Side Effects

Bad module:

```powershell
# psm1
Write-Host "Loading module"
Set-Location ..
mvn test
```

Importing module should not run workflows.

Allowed import-time actions:

- define functions;
- define aliases if intentional;
- set module-local variables;
- maybe load private/public function files.

Avoid:

- network calls;
- filesystem mutation;
- changing current directory;
- printing host output;
- reading secrets;
- running builds;
- modifying global state.

Import should be boring.

---

## 17. Module Scope

Variables in module live in module scope.

```powershell
$script:DefaultTimeoutSeconds = 60
```

Use sparingly.

Public functions can access module script-scope variables.

Guideline:

- constants okay;
- mutable global state risky;
- prefer parameters;
- avoid hidden configuration.

If module needs config, expose explicit parameter or configuration function.

Bad:

```powershell
$script:Environment = 'prod'
```

Better:

```powershell
Invoke-DeployRelease -Environment prod
```

---

## 18. Dependency Management

Manifest can declare required modules:

```powershell
RequiredModules = @(
  @{ ModuleName = 'Pester'; ModuleVersion = '5.0.0' }
)
```

But module installation is separate.

For internal modules:

- document dependencies;
- install in CI explicitly;
- pin versions if behavior matters;
- avoid unnecessary dependencies.

For a module that only wraps Maven/Git, external native tools are not PowerShell modules. Check with `Get-Command`.

```powershell
Require-Command -Name 'git'
Require-Command -Name 'mvn'
```

---

## 19. Distribution Options

### 19.1 Repo-local module

```text
modules/Company.BuildAutomation/
scripts/Verify.ps1
```

Best for single repo.

### 19.2 Git submodule/subtree

Shared across repos, but operationally annoying.

### 19.3 Internal PowerShell repository

Publish module to internal feed.

```powershell
Publish-Module
Install-Module
```

Requires infrastructure and governance.

### 19.4 Artifact package

Zip module and distribute via artifact registry.

### 19.5 Dev container baked module

Preinstall in standard developer/CI image.

Choose based on reuse scale.

---

## 20. Repo-Local Module Pattern

For many teams, simplest:

```text
repo/
  modules/
    Company.ProjectAutomation/
      Company.ProjectAutomation.psd1
      Company.ProjectAutomation.psm1
      Public/
      Private/
  scripts/
    Verify.ps1
    Deploy.ps1
```

Scripts import by relative path:

```powershell
$ModulePath = Join-Path $PSScriptRoot '../modules/Company.ProjectAutomation/Company.ProjectAutomation.psd1'
Import-Module $ModulePath -Force
```

This avoids external install.

Downside: reuse across repos still copy-paste unless separately managed.

---

## 21. Internal Module Feed

PowerShell can use repositories:

```powershell
Register-PSRepository
Install-Module
Publish-Module
```

For enterprise/internal:

- private NuGet feed;
- GitHub Packages;
- Azure Artifacts;
- Artifactory/Nexus.

Benefits:

- versioned install;
- dependency management;
- central updates.

Costs:

- feed management;
- auth;
- publishing pipeline;
- version governance;
- deprecation policy.

Use when module has many consumers.

---

## 22. Testing Modules with Pester

Pester is PowerShell's test framework.

Example:

```powershell
Describe 'New-DeploymentPayload' {
  BeforeAll {
    Import-Module "$PSScriptRoot/../Company.BuildAutomation.psd1" -Force
  }

  It 'creates payload object' {
    $payload = New-DeploymentPayload -Environment staging -Version 1.2.3

    $payload.env | Should -Be 'staging'
    $payload.version | Should -Be '1.2.3'
  }

  It 'rejects invalid environment' {
    { New-DeploymentPayload -Environment dev -Version 1.2.3 } | Should -Throw
  }
}
```

Run:

```powershell
Invoke-Pester
```

Pester lets you mock functions, test modules, and assert behavior.

---

## 23. Mocking Native Commands

Better design: wrap native command in helper function.

Public function:

```powershell
function Get-GitCommit {
  [CmdletBinding()]
  param()

  Invoke-NativeText -FilePath 'git' -ArgumentList @('rev-parse', '--short', 'HEAD')
}
```

Test can mock `Invoke-NativeText`:

```powershell
Mock Invoke-NativeText { 'abc123' }

Get-GitCommit | Should -Be 'abc123'
```

If your function directly calls `git` everywhere, testing is harder.

Architectural rule:

> Put native process boundaries behind small wrappers.

---

## 24. Module Linting and Static Analysis

PowerShell has PSScriptAnalyzer.

Install/use:

```powershell
Invoke-ScriptAnalyzer -Path ./modules/Company.BuildAutomation -Recurse
```

It checks:

- style;
- unapproved verbs;
- unused variables;
- compatibility issues;
- risky patterns;
- best practices.

CI:

```powershell
Invoke-ScriptAnalyzer -Path ./scripts, ./modules -Recurse -Severity Warning
```

Treat warnings according to team policy.

---

## 25. Formatting PowerShell

PowerShell formatting can be handled by:

- VS Code PowerShell extension;
- PSScriptAnalyzer formatting rules;
- editorconfig;
- `Invoke-Formatter` in some tooling contexts.

Unlike `shfmt`, PowerShell formatting ecosystem is less universally standardized, but consistency still matters.

Use `.editorconfig`:

```ini
[*.ps1]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
```

Team should agree.

---

## 26. Build/Check Script for Module

`Check-PowerShell.ps1`:

```powershell
#requires -Version 7.0

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($null -eq (Get-Command Invoke-ScriptAnalyzer -ErrorAction SilentlyContinue)) {
  throw 'PSScriptAnalyzer is required'
}

Invoke-ScriptAnalyzer -Path ./scripts, ./modules -Recurse -Severity Warning

if ($null -eq (Get-Command Invoke-Pester -ErrorAction SilentlyContinue)) {
  throw 'Pester is required'
}

Invoke-Pester -Path ./modules
```

CI calls:

```powershell
pwsh -NoProfile -File ./scripts/Check-PowerShell.ps1
```

---

## 27. Module Import Performance

Loading many files can add startup overhead.

For internal automation, usually okay.

If module grows large:

- export only needed functions;
- avoid import-time work;
- avoid heavy dependencies;
- consider build step that bundles module;
- measure before optimizing.

Do not prematurely create complex module loader.

---

## 28. Avoid Over-Abstraction

Bad module architecture:

```text
GenericTaskRunner
CommandFactory
ProviderResolver
DynamicInvoker
```

for five scripts.

PowerShell module should reduce duplication and clarify API, not become a framework.

Good module functions are close to domain:

```powershell
Get-BuildMetadata
Invoke-ServiceVerification
New-DeploymentPayload
Test-ServiceHealth
Publish-ReleaseArtifact
```

Prefer domain language over generic abstraction.

---

## 29. Security in Modules

Modules can execute code at import.

Therefore:

- import trusted modules only;
- pin versions;
- avoid importing from writable untrusted path;
- review module changes like production code;
- do not import repo-controlled module with production secrets in untrusted PR context;
- avoid module auto-loading surprises for critical scripts.

Import by explicit path for repo-local trusted module:

```powershell
Import-Module $ModulePath -Force
```

For installed modules, use version constraints where possible.

---

## 30. Autoloading and Command Discovery

PowerShell can autoload modules when command is invoked if module is in `$env:PSModulePath`.

This is convenient interactively.

For automation, explicit import is clearer:

```powershell
Import-Module Company.BuildAutomation -RequiredVersion 1.2.3
```

or path import:

```powershell
Import-Module ./modules/Company.BuildAutomation/Company.BuildAutomation.psd1
```

Avoid relying on whichever module version happens to be installed.

---

## 31. `$env:PSModulePath`

Module search path:

```powershell
$env:PSModulePath -split [System.IO.Path]::PathSeparator
```

Module install locations differ by OS/user.

In CI, avoid relying on developer machine module path.

Install or import explicitly.

---

## 32. Function Export Strategy

In manifest:

```powershell
FunctionsToExport = @(
  'Get-BuildMetadata',
  'Invoke-ServiceVerification'
)
```

In `.psm1`:

```powershell
Export-ModuleMember -Function $public.BaseName
```

Keep manifest and export list aligned.

For mature modules, avoid wildcard:

```powershell
FunctionsToExport = '*'
```

Wildcards can accidentally expose private helpers.

---

## 33. Semantic Output Compatibility

If function outputs:

```powershell
[PSCustomObject]@{
  Version = '1.2.3'
  Commit = 'abc123'
}
```

Changing `Version` to `ProjectVersion` is breaking.

Adding:

```powershell
Branch = 'main'
```

is usually additive.

Document output type and properties.

Tests should catch unintended output changes.

---

## 34. Error Compatibility

Changing error behavior can break callers.

Example:

Old:

```powershell
Test-ServiceHealth
# returns $false
```

New:

```powershell
Test-ServiceHealth
# throws
```

This is breaking if callers expect boolean.

Design intentionally:

- `Test-*` functions often return boolean;
- `Assert-*` or `Require-*` functions throw;
- `Invoke-*` functions usually throw on failure.

Naming helps signal behavior.

Example:

```powershell
Test-VersionFormat    # returns bool
Assert-VersionFormat  # throws if invalid
```

PowerShell approved verbs include `Test`, but not necessarily `Assert`. For internal helper, okay; for public module, consider `Test-*` plus clear docs.

---

## 35. ShouldProcess in Public Functions

Destructive public functions should support `ShouldProcess`.

```powershell
function Remove-BuildArtifacts {
  [CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
  param(
    [Parameter(Mandatory)]
    [string] $Path
  )

  if ($PSCmdlet.ShouldProcess($Path, 'Remove build artifacts')) {
    Remove-Item -Path $Path -Recurse -Force -ErrorAction Stop
  }
}
```

This enables:

```powershell
Remove-BuildArtifacts -Path ./target -WhatIf
Remove-BuildArtifacts -Path ./target -Confirm
```

This is part of safe reusable API.

---

## 36. Pipeline Input Support

Advanced functions can accept pipeline input.

Example:

```powershell
function Test-ServiceHealth {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory, ValueFromPipeline)]
    [string] $Uri
  )

  process {
    try {
      $response = Invoke-RestMethod -Uri $Uri -TimeoutSec 10
      [PSCustomObject]@{
        Uri = $Uri
        Healthy = $response.status -in @('UP', 'OK')
      }
    }
    catch {
      [PSCustomObject]@{
        Uri = $Uri
        Healthy = $false
        Error = $_.Exception.Message
      }
    }
  }
}
```

Use:

```powershell
@('http://a/health', 'http://b/health') | Test-ServiceHealth
```

Pipeline support is powerful, but only add when it improves usability.

---

## 37. Begin/Process/End Blocks

Advanced function can define:

```powershell
function Invoke-Thing {
  [CmdletBinding()]
  param(
    [Parameter(ValueFromPipeline)]
    [string] $InputObject
  )

  begin {
    # setup once
  }

  process {
    # process each pipeline item
  }

  end {
    # finalize once
  }
}
```

This is analogous to stream processing lifecycle.

Use for pipeline-friendly functions.

For normal command functions, simple body is enough.

---

## 38. Classes in PowerShell

PowerShell supports classes:

```powershell
class DeploymentMetadata {
  [string] $Service
  [string] $Version
}
```

But for most scripting modules, `PSCustomObject` is simpler.

Use classes when:

- strong type needed;
- methods useful;
- module API benefits;
- validation/data model complex.

Avoid classes for simple DTOs. PowerShell class loading/reloading can be awkward during development.

---

## 39. Module Architecture for Java Project Automation

A realistic module:

```text
Company.JavaServiceAutomation/
  Public/
    Get-JavaProjectMetadata.ps1
    Invoke-JavaServiceVerification.ps1
    New-DockerImageTag.ps1
    New-DeploymentPayload.ps1
    Test-ServiceHealth.ps1
    Publish-ReleaseArtifact.ps1
  Private/
    Invoke-NativeChecked.ps1
    Invoke-NativeText.ps1
    Require-Command.ps1
    Resolve-RepositoryRoot.ps1
    Test-SemVer.ps1
    Write-Step.ps1
  Tests/
    Get-JavaProjectMetadata.Tests.ps1
    New-DeploymentPayload.Tests.ps1
    Test-ServiceHealth.Tests.ps1
```

Scripts:

```text
scripts/
  Verify.ps1
  Build-Metadata.ps1
  Deploy-Release.ps1
```

Scripts are CLI entrypoints. Module holds reusable logic.

---

## 40. Example Public Function: `New-DeploymentPayload`

```powershell
function New-DeploymentPayload {
<#
.SYNOPSIS
Creates deployment API payload.

.OUTPUTS
PSCustomObject with env and version properties.
#>
  [CmdletBinding()]
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
```

Test:

```powershell
Describe 'New-DeploymentPayload' {
  It 'creates expected object' {
    $payload = New-DeploymentPayload -Environment staging -Version 1.2.3
    $payload.env | Should -Be 'staging'
    $payload.version | Should -Be '1.2.3'
  }

  It 'rejects invalid version' {
    { New-DeploymentPayload -Environment staging -Version bad } | Should -Throw
  }
}
```

---

## 41. Example Public Function with Native Boundary

```powershell
function Get-GitShortCommit {
  [CmdletBinding()]
  param()

  Invoke-NativeText -FilePath 'git' -ArgumentList @('rev-parse', '--short', 'HEAD')
}
```

Private helper:

```powershell
function Invoke-NativeText {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string] $FilePath,
    [string[]] $ArgumentList = @()
  )

  $output = & $FilePath @ArgumentList
  $exitCode = $LASTEXITCODE

  if ($exitCode -ne 0) {
    throw "$FilePath failed with exit code $exitCode"
  }

  ($output -join "`n").Trim()
}
```

Test with mock:

```powershell
Mock Invoke-NativeText { 'abc123' }
Get-GitShortCommit | Should -Be 'abc123'
```

This is why abstraction around native commands helps.

---

## 42. Module Documentation

At minimum:

```text
README.md
CHANGELOG.md
examples/
```

README should include:

- purpose;
- install/import;
- exported functions;
- examples;
- compatibility;
- dependencies;
- versioning policy;
- testing command.

Example:

```markdown
# Company.BuildAutomation

Requires PowerShell 7.2+.

## Import

Import-Module ./Company.BuildAutomation.psd1

## Examples

Invoke-ServiceVerification -Profile unit
Get-BuildMetadata | ConvertTo-Json
```

Docs matter because module becomes team API.

---

## 43. CI for Module

Quality gate:

```powershell
pwsh -NoProfile -File ./scripts/Check-PowerShell.ps1
```

Should run:

- import module;
- PSScriptAnalyzer;
- Pester tests;
- help generation maybe;
- manifest validation;
- cross-platform matrix if claimed.

Validate manifest:

```powershell
Test-ModuleManifest ./modules/Company.BuildAutomation/Company.BuildAutomation.psd1
```

Import smoke:

```powershell
Import-Module ./modules/Company.BuildAutomation/Company.BuildAutomation.psd1 -Force
Get-Command -Module Company.BuildAutomation
```

---

## 44. Versioned Publishing Pipeline

For shared module:

1. Run lint/tests.
2. Validate manifest.
3. Update version.
4. Generate changelog/release notes.
5. Publish to internal repository.
6. Tag Git commit.
7. Notify consumers if breaking.

Do not manually publish untested modules.

---

## 45. When Not to Create a Module

Do not create module if:

- there is only one small script;
- no reuse;
- team unfamiliar and module adds friction;
- Bash/Makefile already better fit;
- logic should be in Java/Go/Python application;
- deployment platform already provides abstraction;
- module would just wrap one command without value.

Module is a tool, not goal.

---

## 46. Migration Strategy from Scripts to Module

Step-by-step:

1. Identify duplicated helpers.
2. Extract pure/private helpers first.
3. Add Pester tests for helpers.
4. Create module layout.
5. Export one stable public function.
6. Convert one script to call module.
7. Add CI checks.
8. Document import/use.
9. Repeat gradually.
10. Avoid big-bang rewrite.

Migration should reduce risk, not create it.

---

## 47. Review Checklist

### Module structure

- Is public/private separation clear?
- Are exported functions explicit?
- Is import side-effect-free?
- Is manifest valid?

### API design

- Are function names Verb-Noun?
- Are parameters typed/validated?
- Is output contract documented?
- Are destructive functions `SupportsShouldProcess`?

### Reliability

- Is strict mode used?
- Are errors terminating where needed?
- Are native commands wrapped?
- Are tests covering success/failure?

### Distribution

- Is version set?
- Are dependencies documented?
- Is CI publishing controlled?
- Is compatibility contract clear?

### Security

- Is module trusted before import?
- Are secrets avoided in logs/output?
- Are untrusted PRs prevented from modifying module used with secrets?
- Are dependencies pinned where needed?

---

## 48. Mini Lab

### Lab 1 — Create Basic Module

Create:

```text
MyAutomation.psm1
```

with:

```powershell
function Get-Greeting {
  param([string] $Name)
  "Hello, $Name"
}

Export-ModuleMember -Function Get-Greeting
```

Import and run.

---

### Lab 2 — Add Manifest

Run `New-ModuleManifest`, import `.psd1`, validate with `Test-ModuleManifest`.

---

### Lab 3 — Public/Private Layout

Create `Public/Get-Greeting.ps1` and `Private/Format-Greeting.ps1`. Dot-source in `.psm1`, export only public.

---

### Lab 4 — Pester Test

Write one Pester test for `Get-Greeting`.

---

### Lab 5 — ShouldProcess

Create `Remove-DemoFile` with `SupportsShouldProcess`, test `-WhatIf`.

---

## 49. Design Exercise: Java Service Automation Module

Design module:

```text
Company.JavaServiceAutomation
```

Public functions:

```text
Get-JavaProjectMetadata
Invoke-JavaServiceVerification
New-DeploymentPayload
Test-ServiceHealth
Publish-ReleaseArtifact
Remove-BuildArtifacts
```

Private helpers:

```text
Invoke-NativeChecked
Invoke-NativeText
Require-Command
Resolve-RepositoryRoot
Test-SemVer
Write-Step
```

For each public function define:

- parameters;
- output object;
- errors;
- side effects;
- ShouldProcess support;
- native dependencies;
- tests;
- examples.

This is the module-level equivalent of designing a Java package public API.

---

## 50. Part 017 Summary

PowerShell modules turn scripts into reusable automation libraries.

Key takeaways:

1. Keep simple workflows as scripts until reuse justifies module.
2. Use `.psm1` for script module and `.psd1` manifest for metadata.
3. Separate Public and Private functions.
4. Export only stable public functions.
5. Avoid import-time side effects.
6. Use `[CmdletBinding()]`, typed parameters, validation attributes.
7. Output objects intentionally and document output contracts.
8. Use comment-based help for discoverability.
9. Wrap native command boundaries for testability.
10. Test modules with Pester.
11. Analyze with PSScriptAnalyzer.
12. Version module APIs carefully.
13. Use `SupportsShouldProcess` for destructive public functions.
14. Import modules explicitly in automation.
15. Treat module distribution as release engineering.
16. Avoid over-abstraction; modules should clarify, not create a framework.

This closes the PowerShell block. Part 018 starts the Makefile block: **Makefile Mental Model: Dependency Graph, Targets, Recipes**.

---

## 51. Referensi Resmi dan Bacaan Lanjutan

- PowerShell `about_Modules`
- PowerShell `about_Module_Manifests`
- PowerShell `New-ModuleManifest`
- PowerShell `Test-ModuleManifest`
- PowerShell `Import-Module`
- PowerShell `Export-ModuleMember`
- PowerShell `about_Functions_Advanced`
- PowerShell `about_Comment_Based_Help`
- PowerShell `about_ShouldProcess`
- Pester documentation
- PSScriptAnalyzer documentation
- PowerShell Gallery / repository publishing documentation

---

## 52. Status Seri

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
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-016.md">⬅️ Part 016 — Cross-Platform PowerShell: Windows, Linux, macOS, Containers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-018.md">Part 018 — Makefile Mental Model: Dependency Graph, Targets, Recipes ➡️</a>
</div>
