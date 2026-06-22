# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-012.md

# Part 012 — PowerShell Mental Model: Objects, Pipeline, Providers

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: memahami PowerShell sebagai automation shell berbasis object, bukan sekadar shell Windows atau pengganti Bash.

---

## 0. Posisi Part Ini dalam Seri

Part 000–011 membangun fondasi Bash dan shell scripting:

- shell as process orchestration;
- parsing/quoting;
- POSIX vs Bash;
- Bash fundamentals;
- error handling;
- data handling;
- filesystem;
- process control;
- CLI design;
- testing;
- security.

Part 012 memulai blok PowerShell.

Kita tidak akan melihat PowerShell sebagai:

```text
cmd.exe yang lebih baru
```

atau:

```text
Bash versi Windows
```

Itu mental model yang salah.

PowerShell adalah automation platform dengan ciri utama:

- pipeline berbasis object, bukan hanya text;
- cmdlet dengan pola `Verb-Noun`;
- akses kuat ke .NET object;
- provider model untuk filesystem, registry, certificate store, env vars, dan lainnya;
- structured error records;
- parameter binding yang kaya;
- module system;
- cross-platform melalui PowerShell 7+;
- first-class automation untuk Windows, cloud, admin tooling, dan API.

Jika Bash mental model-nya:

```text
process + text stream + exit code
```

PowerShell mental model-nya:

```text
command + object stream + structured metadata + .NET runtime
```

Ini perubahan besar.

---

## 1. Why PowerShell Matters for Java Engineers

Sebagai Java engineer, kamu mungkin tidak banyak memakai PowerShell jika sehari-hari di Linux/macOS. Tetapi PowerShell penting karena:

1. Banyak enterprise environment masih Windows-heavy.
2. Build/release tooling kadang harus berjalan cross-platform.
3. PowerShell 7+ berjalan di Windows, Linux, macOS.
4. Azure, Microsoft 365, Windows Server, Active Directory, IIS, certificate store, registry, dan admin tooling banyak expose PowerShell-first interface.
5. Object pipeline membuat automation structured data lebih aman daripada parsing text.
6. PowerShell sangat baik untuk JSON/XML/CSV/REST automation.
7. CI runners Windows sering memakai PowerShell default.
8. Developer tooling internal bisa lebih portable jika tim hybrid Windows/Linux.
9. PowerShell bisa memanggil .NET APIs langsung.
10. Banyak security/ops scripts di enterprise ditulis dengan PowerShell.

PowerShell bukan pengganti Bash untuk semua hal. Tetapi untuk beberapa domain, PowerShell jauh lebih natural.

---

## 2. Bash vs PowerShell: Perbedaan Fundamental

Bash pipeline:

```bash
ps aux | grep java | awk '{print $2}'
```

Data antar command adalah text.

PowerShell pipeline:

```powershell
Get-Process java | Select-Object Id, ProcessName
```

Data antar command adalah object.

Dalam Bash:

```text
stdout bytes -> parsed by next command
```

Dalam PowerShell:

```text
.NET object -> pipeline -> next command receives object
```

Contoh:

```powershell
Get-Process | Where-Object { $_.CPU -gt 100 } | Select-Object Name, Id, CPU
```

`Where-Object` tidak parsing kolom text. Ia menerima object process dengan property `CPU`.

Analogy Java:

Bash:

```java
String output = run("ps aux");
List<String> lines = output.split("\n");
```

PowerShell:

```java
List<ProcessInfo> processes = getProcesses();
processes.stream()
  .filter(p -> p.cpu() > 100)
  .map(p -> ...)
```

PowerShell lebih dekat ke object pipeline.

---

## 3. Object Pipeline

PowerShell command mengirim object ke pipeline.

Example:

```powershell
Get-Process pwsh
```

Output terlihat seperti table:

```text
NPM(K)    PM(M)      WS(M)     CPU(s)      Id  SI ProcessName
------    -----      -----     ------      --  -- -----------
...
```

Tetapi table itu hanya formatting. Object aslinya punya banyak property.

Inspect:

```powershell
Get-Process pwsh | Get-Member
```

`Get-Member` menunjukkan type, properties, methods.

Select properties:

```powershell
Get-Process pwsh | Select-Object Id, ProcessName, CPU
```

Filter:

```powershell
Get-Process | Where-Object { $_.ProcessName -like '*java*' }
```

Sort:

```powershell
Get-Process | Sort-Object CPU -Descending
```

This is not text parsing.

---

## 4. Formatting Happens at the End

PowerShell output shown in terminal is formatted by formatting system.

This matters.

Bad mental model:

```powershell
$output = Get-Process
# output is table text
```

Actually `$output` is collection of process objects.

Formatting cmdlets:

```powershell
Format-Table
Format-List
```

should usually be used only at the final display boundary.

Bad for further processing:

```powershell
Get-Process | Format-Table Name, Id | Where-Object { $_.Id -gt 100 }
```

After `Format-Table`, pipeline no longer contains process objects in useful way. It contains formatting objects.

Good:

```powershell
Get-Process |
  Where-Object { $_.Id -gt 100 } |
  Select-Object Name, Id |
  Format-Table
```

Rule:

> Filter, sort, transform, export first. Format last.

This is analogous to not converting Java objects to string too early.

---

## 5. Cmdlet Naming: Verb-Noun

PowerShell cmdlets commonly follow:

```text
Verb-Noun
```

Examples:

```powershell
Get-Process
Stop-Process
Get-ChildItem
Set-Location
New-Item
Remove-Item
Invoke-RestMethod
ConvertTo-Json
ConvertFrom-Json
Import-Csv
Export-Csv
Select-Object
Where-Object
Sort-Object
ForEach-Object
```

Verbs are standardized:

```powershell
Get-Verb
```

This helps discoverability.

Instead of memorizing arbitrary command names, PowerShell encourages pattern:

- `Get-*` reads;
- `Set-*` modifies;
- `New-*` creates;
- `Remove-*` deletes;
- `Start-*` starts;
- `Stop-*` stops;
- `Invoke-*` executes action;
- `ConvertTo-*` serializes;
- `ConvertFrom-*` parses;
- `Import-*` reads external data into objects;
- `Export-*` writes objects out.

Compare Bash:

```bash
ls
cat
grep
awk
sed
rm
mv
cp
curl
```

PowerShell is more uniform.

---

## 6. Aliases: Convenient but Avoid in Scripts

PowerShell has aliases:

```powershell
ls
dir
cat
cd
rm
cp
mv
?
%
```

Examples:

```powershell
ls
cat file.txt
? { $_.Name -like '*.log' }
% { $_.Name }
```

These are convenient interactively.

In scripts, prefer full cmdlet names:

```powershell
Get-ChildItem
Get-Content
Where-Object
ForEach-Object
Remove-Item
Copy-Item
Move-Item
```

Why?

- clearer;
- cross-platform less ambiguous;
- easier for reviewers;
- avoids confusion with native commands;
- aligns with PowerShell style.

Rule:

> Aliases are for interactive use. Scripts should use full names.

---

## 7. Parameters Are Named and Typed

PowerShell commands have rich parameters.

Example:

```powershell
Get-ChildItem -Path ./logs -Filter *.log -Recurse
```

Get help:

```powershell
Get-Help Get-ChildItem -Full
```

Parameter discovery:

```powershell
Get-Command Get-ChildItem -Syntax
```

PowerShell supports:

- named parameters;
- positional parameters;
- switch parameters;
- parameter sets;
- validation attributes;
- pipeline binding.

In scripts/functions:

```powershell
param(
  [Parameter(Mandatory)]
  [ValidateSet('dev', 'staging', 'prod')]
  [string] $Environment,

  [switch] $DryRun
)
```

This is much richer than manual Bash parsing.

---

## 8. Switch Parameters

PowerShell boolean flags are often switches:

```powershell
.\Deploy.ps1 -Environment staging -DryRun
```

In function:

```powershell
param(
  [switch] $DryRun
)

if ($DryRun) {
  Write-Host "dry run"
}
```

A switch is not exactly string `"true"`/`"false"`. It is a `SwitchParameter`.

You can pass:

```powershell
-DryRun
-DryRun:$true
-DryRun:$false
```

This is cleaner than Bash boolean string flags.

---

## 9. Variables and Objects

Variable:

```powershell
$name = 'Alice'
```

Access:

```powershell
$name
```

Object property:

```powershell
$process = Get-Process -Id $PID
$process.ProcessName
$process.Id
```

Method call:

```powershell
$name.ToUpper()
```

PowerShell sits on .NET, so objects have .NET methods.

Example:

```powershell
[DateTime]::UtcNow
[Guid]::NewGuid()
[System.IO.Path]::Combine('a', 'b')
```

This is powerful and dangerous if overused. Use cmdlets where natural, .NET APIs where they provide precision.

---

## 10. Pipeline Variable `$_`

In script blocks:

```powershell
Get-Process | Where-Object { $_.CPU -gt 100 }
```

`$_` is current pipeline object.

Equivalent alias:

```powershell
$PSItem
```

Example:

```powershell
Get-ChildItem -Path ./logs -Filter *.log |
  Where-Object { $_.Length -gt 1MB } |
  Select-Object Name, Length
```

This is like Java stream lambda:

```java
files.stream()
  .filter(file -> file.length() > oneMb)
```

---

## 11. Collections

PowerShell arrays:

```powershell
$items = @('api', 'worker', 'scheduler')
```

Loop:

```powershell
foreach ($item in $items) {
  Write-Output $item
}
```

Pipeline:

```powershell
$items | ForEach-Object { $_.ToUpper() }
```

Important distinction:

- `foreach` statement is language construct;
- `ForEach-Object` is pipeline cmdlet.

For simple loops, `foreach` statement is often clearer and faster.

---

## 12. Hashtables

Hashtable:

```powershell
$config = @{
  Environment = 'dev'
  Port = 8080
}
```

Access:

```powershell
$config.Environment
$config['Environment']
```

Useful for splatting parameters.

```powershell
$params = @{
  Uri = 'https://example.com'
  Method = 'Get'
  TimeoutSec = 30
}

Invoke-RestMethod @params
```

Splatting improves readability for many parameters.

---

## 13. PSCustomObject

Create structured object:

```powershell
[PSCustomObject]@{
  Service = 'api'
  Environment = 'dev'
  Port = 8080
}
```

Output objects:

```powershell
[PSCustomObject]@{
  Version = '1.2.3'
  Commit = 'abc123'
}
```

This is good for script-to-script structured output.

Convert to JSON:

```powershell
[PSCustomObject]@{
  Version = '1.2.3'
  Commit = 'abc123'
} | ConvertTo-Json
```

Compare Bash requiring `jq`.

---

## 14. Providers: Filesystem Is Just One Namespace

PowerShell has providers that expose data stores like drives.

See providers:

```powershell
Get-PSProvider
```

Drives:

```powershell
Get-PSDrive
```

Common providers:

- FileSystem
- Registry
- Environment
- Certificate
- Variable
- Function
- Alias

Examples:

```powershell
Get-ChildItem Env:
Get-ChildItem Cert:
Get-ChildItem Function:
Get-ChildItem Alias:
```

On Windows:

```powershell
Get-ChildItem HKLM:
```

The same navigation commands work across providers:

```powershell
Set-Location Env:
Get-ChildItem
```

Mental model:

> PowerShell generalizes shell navigation beyond files.

---

## 15. Filesystem in PowerShell

Equivalent commands:

| Bash | PowerShell |
|---|---|
| `pwd` | `Get-Location` |
| `cd` | `Set-Location` |
| `ls` | `Get-ChildItem` |
| `cat` | `Get-Content` |
| `cp` | `Copy-Item` |
| `mv` | `Move-Item` |
| `rm` | `Remove-Item` |
| `mkdir` | `New-Item -ItemType Directory` |
| `test -f` | `Test-Path -PathType Leaf` |
| `test -d` | `Test-Path -PathType Container` |

Example:

```powershell
Get-ChildItem -Path ./logs -Filter *.log -Recurse |
  Where-Object { $_.Length -gt 1MB } |
  Select-Object FullName, Length
```

This processes file objects, not text output.

---

## 16. Environment Variables

In Bash:

```bash
echo "$APP_ENV"
export APP_ENV=dev
```

In PowerShell:

```powershell
$env:APP_ENV
$env:APP_ENV = 'dev'
```

Environment variables are exposed through `Env:` provider:

```powershell
Get-ChildItem Env:
```

Important:

- `$env:NAME` is string.
- Setting `$env:NAME` affects current process and child processes.
- It does not permanently modify user/system environment unless using other APIs.
- Environment variable names are case-insensitive on Windows, usually case-sensitive on Unix-like systems at OS level, but PowerShell behavior can have abstractions.

Validate:

```powershell
if ([string]::IsNullOrWhiteSpace($env:APP_ENV)) {
  throw 'APP_ENV is required'
}
```

---

## 17. Native Commands vs Cmdlets

PowerShell can call native commands:

```powershell
git status
mvn test
docker build -t myapp .
```

But native command output is usually text, not rich PowerShell objects.

Cmdlets return objects:

```powershell
Get-Process
Get-ChildItem
Invoke-RestMethod
```

This means PowerShell scripts often mix:

- object-native PowerShell commands;
- text/native external tools.

Be conscious at boundary.

Example:

```powershell
$mvnOutput = mvn test
```

`mvn` output is text lines.

Exit status of native command:

```powershell
$LASTEXITCODE
$?
```

PowerShell error handling for native commands has nuances and will be covered in Part 014.

---

## 18. `Write-Output`, `Write-Host`, and Streams

PowerShell has multiple streams:

- Success output stream;
- Error stream;
- Warning stream;
- Verbose stream;
- Debug stream;
- Information stream;
- Progress stream.

`Write-Output` writes to success pipeline.

```powershell
Write-Output "data"
```

`Write-Host` writes to information/host display, intended for human display.

For scripts producing data, use output objects or `Write-Output`.

For diagnostics:

```powershell
Write-Verbose "message"
Write-Warning "message"
Write-Error "message"
```

A common beginner mistake is using `Write-Host` everywhere. It makes automation less composable.

Rule:

> Output data to pipeline. Diagnostics to appropriate diagnostic streams.

Equivalent to Bash stdout/stderr discipline, but richer.

---

## 19. `Get-Help` and Discoverability

PowerShell has built-in help:

```powershell
Get-Help Get-Process
Get-Help Get-Process -Examples
Get-Help about_Automatic_Variables
Get-Help about_Pipelines
```

Discover commands:

```powershell
Get-Command *Process*
Get-Command -Verb Get
Get-Command -Noun Process
```

Discover members:

```powershell
Get-Process | Get-Member
```

This is one of PowerShell's strengths.

As a Java engineer, use:

```powershell
Get-Member
```

like reflection/introspection.

---

## 20. Objects Make Many Text Tools Unnecessary

Bash:

```bash
ls -l | awk '$5 > 1000000 {print $9}'
```

PowerShell:

```powershell
Get-ChildItem |
  Where-Object { $_.Length -gt 1000000 } |
  Select-Object Name
```

Bash:

```bash
ps aux | grep java | awk '{print $2}'
```

PowerShell:

```powershell
Get-Process java | Select-Object Id
```

Bash:

```bash
curl -s "$url" | jq -r '.version'
```

PowerShell:

```powershell
(Invoke-RestMethod -Uri $url).version
```

PowerShell can still use `jq`, but often `ConvertFrom-Json` or `Invoke-RestMethod` is enough.

---

## 21. JSON in PowerShell

Parse JSON:

```powershell
$json = Get-Content -Raw -Path config.json | ConvertFrom-Json
$json.version
```

Call REST API:

```powershell
$response = Invoke-RestMethod -Uri 'https://api.example.com/status'
$response.status
```

Build object and convert:

```powershell
$payload = [PSCustomObject]@{
  env = 'dev'
  version = '1.2.3'
} | ConvertTo-Json

Invoke-RestMethod -Uri $url -Method Post -Body $payload -ContentType 'application/json'
```

PowerShell is very natural for JSON APIs, though `ConvertTo-Json` depth defaults require attention for nested objects. That will be covered in Part 015.

---

## 22. CSV in PowerShell

Import:

```powershell
$rows = Import-Csv -Path data.csv
```

Use:

```powershell
$rows | Where-Object { $_.Environment -eq 'prod' }
```

Export:

```powershell
$rows | Export-Csv -Path output.csv -NoTypeInformation
```

Unlike Bash `IFS=,`, PowerShell uses CSV parser.

This is a major advantage for admin/data automation.

---

## 23. XML in PowerShell

PowerShell can parse XML as .NET XML document:

```powershell
[xml]$xml = Get-Content -Raw -Path pom.xml
$xml.project.version
```

Caveat: Maven POM namespaces can complicate XML access. But compared to Bash grepping XML, PowerShell is far better.

For Java projects on Windows, PowerShell can be useful for extracting structured config.

---

## 24. Comparison Operators

PowerShell operators differ from Bash/Java.

Examples:

```powershell
$a -eq $b
$a -ne $b
$a -gt $b
$a -lt $b
$name -like '*.log'
$name -match '^app-\d+$'
```

Case-insensitive by default for strings:

```powershell
'ABC' -eq 'abc'   # True
```

Case-sensitive variants:

```powershell
'ABC' -ceq 'abc'  # False
'ABC' -clike 'abc'
'ABC' -cmatch 'abc'
```

This is important for cross-platform scripts.

---

## 25. Null and Empty

PowerShell null:

```powershell
$null
```

Check:

```powershell
if ($null -eq $value) {
  ...
}
```

Preferred style puts `$null` on left:

```powershell
$null -eq $value
```

Why? If `$value` is collection, comparison semantics differ.

Empty string:

```powershell
[string]::IsNullOrWhiteSpace($value)
```

This is closer to .NET.

---

## 26. Truthiness

PowerShell truthiness can surprise:

- `$false` false;
- `$null` false;
- empty string false;
- zero false;
- empty array false;
- non-empty array may be true depending context.

Be explicit for validation:

```powershell
if ([string]::IsNullOrWhiteSpace($Environment)) {
  throw 'Environment is required'
}
```

Do not rely on truthiness for complex data.

---

## 27. Script Files and Execution Policy

PowerShell scripts use `.ps1`.

Run:

```powershell
.\script.ps1
```

On Windows, execution policy may restrict script execution. Execution policy is not a security boundary, but an administrative safety feature.

Common developer issue:

```text
running scripts is disabled on this system
```

Solutions depend on policy and organization. Do not tell users to blindly bypass policy for production environments. In team automation, prefer signed scripts or documented policy.

Cross-platform PowerShell uses:

```bash
pwsh ./script.ps1
```

PowerShell 7 executable is usually `pwsh`.

Windows PowerShell legacy executable is `powershell.exe`.

---

## 28. Windows PowerShell vs PowerShell 7+

Important distinction:

- Windows PowerShell 5.1: built into Windows, .NET Framework, Windows-only.
- PowerShell 7+: modern, cross-platform, .NET, executable `pwsh`.

For new cross-platform scripts, target PowerShell 7+.

Check version:

```powershell
$PSVersionTable
```

In script:

```powershell
#requires -Version 7.0
```

This declares minimum version.

For Windows-only admin scripts, Windows PowerShell may still matter.

---

## 29. Cross-Platform Considerations

PowerShell 7+ runs on Linux/macOS/Windows, but cross-platform does not mean identical environment.

Consider:

- path separators;
- case sensitivity;
- available native commands;
- line endings;
- file permissions;
- execution policy;
- remoting differences;
- filesystem providers;
- registry only on Windows;
- certificate stores differ;
- default encoding historically differed, though modern PowerShell improved UTF-8 behavior.

Use PowerShell APIs where possible:

```powershell
Join-Path $root 'target'
```

instead of manual:

```powershell
"$root/target"
```

Though `/` often works, explicit APIs are clearer for portability.

---

## 30. When PowerShell Is Better Than Bash

PowerShell is better when:

- data is structured object/JSON/CSV/XML;
- Windows administration matters;
- .NET APIs are useful;
- Azure/Microsoft ecosystem automation;
- cross-platform including Windows without WSL;
- object pipeline reduces parsing;
- script has many parameters;
- functions/modules with help are needed;
- output should be objects;
- rich error records are useful.

Bash is better when:

- Unix process/text tooling is primary;
- environment is Linux minimal;
- startup simplicity and POSIX shell matter;
- commands are mostly native Unix tools;
- container entrypoint minimal;
- team uses Bash heavily;
- script is simple orchestration.

Makefile is better when:

- workflow entrypoints and dependency graph matter;
- you want `make test`, `make build`, `make run`;
- not much logic.

Java/Go/Python is better when:

- domain logic grows;
- complex parsing;
- robust API client;
- deep tests;
- long-running tool.

---

## 31. Mental Model Mapping for Java Engineers

| PowerShell Concept | Java Analogy |
|---|---|
| Cmdlet | method/function with named parameters |
| Pipeline object | stream element |
| `Where-Object` | `filter` |
| `ForEach-Object` | `map/forEach` |
| `Select-Object` | projection/DTO |
| `Get-Member` | reflection/introspection |
| Hashtable | `Map<String,Object>` |
| PSCustomObject | dynamic DTO |
| Module | package/library |
| Provider | virtual filesystem abstraction |
| ErrorRecord | structured exception/error metadata |
| Parameter validation | method parameter validation annotations |
| Splatting | passing parameter map |
| `#requires` | runtime requirement declaration |

This mapping is not perfect, but helps.

---

## 32. Example: PowerShell Service Metadata

```powershell
#requires -Version 7.0

param(
  [ValidateSet('text', 'json')]
  [string] $Output = 'text'
)

$metadata = [PSCustomObject]@{
  Service = 'my-service'
  Version = '1.2.3'
  Commit  = 'abc123'
}

switch ($Output) {
  'text' {
    $metadata
  }
  'json' {
    $metadata | ConvertTo-Json
  }
}
```

Run:

```powershell
pwsh ./metadata.ps1 -Output json
```

No `jq` needed for simple JSON output.

---

## 33. Example: Find Large Logs

Bash:

```bash
find logs -type f -name '*.log' -size +10M -print
```

PowerShell:

```powershell
Get-ChildItem -Path ./logs -Filter *.log -Recurse |
  Where-Object { $_.Length -gt 10MB } |
  Select-Object FullName, Length
```

Output can be formatted, exported, converted to JSON:

```powershell
Get-ChildItem -Path ./logs -Filter *.log -Recurse |
  Where-Object { $_.Length -gt 10MB } |
  Select-Object FullName, Length |
  ConvertTo-Json
```

---

## 34. Example: REST Health Check

```powershell
param(
  [Parameter(Mandatory)]
  [string] $Uri
)

$response = Invoke-RestMethod -Uri $Uri -Method Get -TimeoutSec 10

if ($response.status -ne 'UP') {
  throw "Service is not healthy. Status: $($response.status)"
}

[PSCustomObject]@{
  Uri = $Uri
  Status = $response.status
}
```

PowerShell naturally turns JSON response into object.

---

## 35. Example: CSV Environment Matrix

CSV:

```csv
Environment,Url,Enabled
dev,http://localhost:8080,true
staging,https://staging.example.com,true
prod,https://prod.example.com,false
```

PowerShell:

```powershell
$rows = Import-Csv -Path environments.csv

$rows |
  Where-Object { $_.Enabled -eq 'true' } |
  ForEach-Object {
    [PSCustomObject]@{
      Environment = $_.Environment
      Url = $_.Url
    }
  }
```

No manual CSV parsing.

---

## 36. Common Beginner Mistakes

### 36.1 Treating output as text too early

Bad:

```powershell
Get-Process | Format-Table | Where-Object { $_.Name -like '*java*' }
```

Good:

```powershell
Get-Process | Where-Object { $_.ProcessName -like '*java*' } | Format-Table
```

### 36.2 Using aliases in scripts

Bad:

```powershell
ls | ? { $_.Length -gt 1MB } | % Name
```

Good:

```powershell
Get-ChildItem | Where-Object { $_.Length -gt 1MB } | Select-Object -ExpandProperty Name
```

### 36.3 Using `Write-Host` for data

Bad:

```powershell
Write-Host $version
```

Good:

```powershell
Write-Output $version
```

or just:

```powershell
$version
```

### 36.4 Parsing formatted table text

Bad:

```powershell
Get-Process | Out-String | Select-String java
```

Good:

```powershell
Get-Process java
```

### 36.5 Assuming native commands return objects

```powershell
git status
```

returns text output, not Git object.

---

## 37. Review Checklist for PowerShell Mental Model

Ask:

- Is pipeline carrying objects or formatted text?
- Is `Format-*` only used at final display boundary?
- Are aliases avoided in scripts?
- Are parameters named and validated?
- Are data outputs objects/JSON rather than host text?
- Are native command boundaries handled consciously?
- Are providers used intentionally?
- Is target PowerShell version declared?
- Is script cross-platform or Windows-specific?
- Are env vars accessed via `$env:NAME`?
- Are structured formats parsed with native cmdlets?

---

## 38. Mini Lab

### Lab 1 — Object vs Text

Run:

```powershell
Get-Process | Select-Object -First 3
Get-Process | Select-Object -First 3 | Get-Member
```

Then:

```powershell
Get-Process | Select-Object -First 3 | Format-Table | Get-Member
```

Observe type difference.

---

### Lab 2 — Filter Object Property

Find processes with CPU greater than zero:

```powershell
Get-Process | Where-Object { $_.CPU -gt 0 } | Select-Object Name, Id, CPU
```

---

### Lab 3 — JSON

Create `config.json`:

```json
{"env":"dev","port":8080}
```

Run:

```powershell
$config = Get-Content -Raw config.json | ConvertFrom-Json
$config.env
$config.port
```

---

### Lab 4 — CSV

Create CSV and import:

```powershell
Import-Csv environments.csv | Where-Object { $_.Enabled -eq 'true' }
```

---

### Lab 5 — Provider

Run:

```powershell
Get-PSProvider
Get-PSDrive
Get-ChildItem Env:
```

On Windows, also explore:

```powershell
Get-ChildItem Cert:
```

---

## 39. Design Exercise: Choose Bash or PowerShell

For each task, decide Bash or PowerShell and explain:

1. Container entrypoint for Java app in Alpine.
2. Windows developer bootstrap installing certificates.
3. Cross-platform script calling REST API and producing JSON.
4. Linux CI wrapper around Maven and Docker.
5. Script reading CSV of environments and generating report.
6. Kubernetes deploy from Linux runner.
7. Azure resource inventory export.
8. Local cleanup of Maven/Gradle artifacts.
9. Transform nested JSON config into deployment payload.
10. Generate release metadata object consumed by another script.

The goal is not “PowerShell always better” or “Bash always better”. The goal is runtime/tool fit.

---

## 40. Part 012 Summary

PowerShell is not Bash with different syntax.

Key takeaways:

1. Bash pipelines move text; PowerShell pipelines move objects.
2. Formatting is display-only and should happen at the end.
3. Cmdlets follow Verb-Noun naming for discoverability.
4. Avoid aliases in scripts.
5. PowerShell has rich named/typed parameters.
6. Providers expose filesystem, env, registry, certs, variables, aliases, etc.
7. `Get-Member` is essential for understanding objects.
8. PowerShell is strong for JSON/CSV/XML/REST automation.
9. Native command output is still text; handle that boundary consciously.
10. Use appropriate streams: output objects for data, diagnostics elsewhere.
11. PowerShell 7+ is the modern cross-platform target.
12. Choose PowerShell when object/structured/admin automation matters.

Part 013 will go into PowerShell language fundamentals for Java engineers.

---

## 41. Referensi Resmi dan Bacaan Lanjutan

- Microsoft PowerShell Documentation — overview and getting started.
- PowerShell `about_Pipelines` — object pipeline model.
- PowerShell `about_Objects` — objects, properties, methods.
- PowerShell `about_Providers` — provider model.
- PowerShell `about_Command_Syntax` — cmdlet syntax and parameters.
- PowerShell `about_Aliases` — aliases and script readability.
- PowerShell `about_Automatic_Variables` — `$PSItem`, `$LASTEXITCODE`, `$?`, etc.
- PowerShell `ConvertTo-Json`, `ConvertFrom-Json`, `Invoke-RestMethod`, `Import-Csv`, `Export-Csv` docs.

---

## 42. Status Seri

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
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-011.md">⬅️ Part 011 — Security Model for Shell Scripts</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-013.md">Part 013 — PowerShell Language Fundamentals for Java Engineers ➡️</a>
</div>
