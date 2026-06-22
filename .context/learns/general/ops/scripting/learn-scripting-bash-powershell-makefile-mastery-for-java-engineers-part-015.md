# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-015.md

# Part 015 — PowerShell Data Automation: JSON, XML, CSV, REST, Objects

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: menggunakan PowerShell untuk structured data automation: JSON, REST API, CSV, XML, object transformation, output contract, validation, dan batas kapan harus pindah ke tool/language lain.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya:

- Part 012: PowerShell object pipeline, providers, cmdlets.
- Part 013: PowerShell language fundamentals.
- Part 014: PowerShell error handling, strictness, observability.

Part 015 membahas salah satu kekuatan terbesar PowerShell:

> data automation berbasis object.

Bash sangat kuat untuk text stream. Tetapi begitu data menjadi JSON, CSV, XML, atau REST API response, Bash sering membutuhkan external parser seperti `jq`, `python`, `awk`, atau tool lain.

PowerShell punya dukungan bawaan untuk:

- JSON: `ConvertFrom-Json`, `ConvertTo-Json`, `Invoke-RestMethod`;
- CSV: `Import-Csv`, `Export-Csv`, `ConvertFrom-Csv`, `ConvertTo-Csv`;
- XML: `[xml]`, XPath/.NET XML APIs;
- REST: `Invoke-RestMethod`, `Invoke-WebRequest`;
- object transformation: `Select-Object`, `Where-Object`, `ForEach-Object`, calculated properties;
- structured output: `PSCustomObject`, JSON export.

Sebagai Java engineer, ini mirip bekerja dengan DTO/map/list, bukan parsing string.

---

## 1. Data Automation Mental Model

PowerShell pipeline ideal:

```text
Read structured data -> object pipeline -> filter/project/group/transform -> export structured data
```

Example:

```powershell
Import-Csv ./environments.csv |
  Where-Object { $_.Enabled -eq 'true' } |
  Select-Object Environment, Url |
  ConvertTo-Json
```

Tidak ada manual split comma.

REST example:

```powershell
$response = Invoke-RestMethod -Uri 'https://api.example.com/status'
$response.version
```

Tidak perlu `curl | jq` untuk banyak kasus sederhana.

Core principle:

> Keep data as objects as long as possible. Convert to text only at external boundaries.

Ini sama seperti Java: jangan convert DTO ke string lalu parse lagi.

---

## 2. PowerShell Object Shape

PowerShell object bisa berasal dari:

- cmdlets: `Get-Process`, `Get-ChildItem`;
- JSON: `ConvertFrom-Json`;
- CSV: `Import-Csv`;
- XML: `[xml]`;
- custom object: `[PSCustomObject]@{}`;
- .NET classes;
- REST API: `Invoke-RestMethod`.

Inspect object:

```powershell
$object | Get-Member
```

Print all properties:

```powershell
$object | Format-List * -Force
```

Select:

```powershell
$object | Select-Object Name, Id
```

Expand single property:

```powershell
$object | Select-Object -ExpandProperty Name
```

Do not guess object structure. Inspect.

---

## 3. JSON: Reading Files

Given `config.json`:

```json
{
  "environment": "dev",
  "port": 8080,
  "modules": ["api", "worker"]
}
```

Read:

```powershell
$config = Get-Content -Raw -Path ./config.json | ConvertFrom-Json
```

Why `-Raw`?

Without `-Raw`, `Get-Content` returns array of lines. `ConvertFrom-Json` can handle some cases, but `-Raw` is clearer and avoids line-array surprises.

Access:

```powershell
$config.environment
$config.port
$config.modules
```

Loop:

```powershell
foreach ($module in $config.modules) {
  Write-Output $module
}
```

Validate lightly:

```powershell
if ([string]::IsNullOrWhiteSpace($config.environment)) {
  throw 'config.environment is required'
}

if ($config.port -isnot [int] -and $config.port -isnot [long]) {
  throw 'config.port must be number'
}
```

---

## 4. JSON: Writing Files

Create object:

```powershell
$metadata = [PSCustomObject]@{
  service = 'my-service'
  version = '1.2.3'
  commit = 'abc123'
}
```

Convert:

```powershell
$metadata | ConvertTo-Json
```

Write:

```powershell
$metadata |
  ConvertTo-Json |
  Set-Content -Path ./metadata.json -Encoding UTF8
```

For nested objects, use `-Depth`.

```powershell
$payload | ConvertTo-Json -Depth 10
```

Important: default depth can truncate nested objects with warning. For serious scripts, always think about depth.

Example:

```powershell
$payload | ConvertTo-Json -Depth 20
```

Do not set absurd depth by habit; set enough for your schema.

---

## 5. JSON Depth Pitfall

Example:

```powershell
$obj = [PSCustomObject]@{
  service = [PSCustomObject]@{
    name = 'api'
    deployment = [PSCustomObject]@{
      strategy = [PSCustomObject]@{
        type = 'rolling'
      }
    }
  }
}

$obj | ConvertTo-Json
```

May warn/truncate if depth exceeded.

Use:

```powershell
$obj | ConvertTo-Json -Depth 5
```

PowerShell JSON depth is one of the most common pitfalls.

Review checklist:

- Is payload nested?
- Is `-Depth` sufficient?
- Are warnings treated seriously?
- Is output validated?

---

## 6. JSON Arrays

Create array:

```powershell
$modules = @(
  [PSCustomObject]@{ name = 'api'; enabled = $true }
  [PSCustomObject]@{ name = 'worker'; enabled = $true }
)

$modules | ConvertTo-Json
```

Caveat: single object vs array shape.

If output must always be array:

```powershell
@($modules) | ConvertTo-Json
```

When consuming:

```powershell
$config = Get-Content -Raw config.json | ConvertFrom-Json
$modules = @($config.modules)
```

`@(...)` ensures array behavior even if one item.

This is similar to Bash needing explicit arrays, but safer.

---

## 7. JSON Validation: Lightweight

PowerShell is not a full schema validator by default, but you can do lightweight validation.

```powershell
function Test-Config {
  param(
    [Parameter(Mandatory)]
    [pscustomobject] $Config
  )

  if ([string]::IsNullOrWhiteSpace($Config.environment)) {
    throw 'environment is required'
  }

  if ($Config.environment -notin @('dev', 'staging', 'prod')) {
    throw "invalid environment: $($Config.environment)"
  }

  if ($null -eq $Config.modules) {
    throw 'modules is required'
  }

  foreach ($module in @($Config.modules)) {
    if ([string]::IsNullOrWhiteSpace($module.name)) {
      throw 'module.name is required'
    }
  }
}
```

For strong schema validation, use:

- JSON Schema validator;
- application code;
- CI validation tool;
- Pester tests;
- Java/Kotlin DTO validation if part of application.

---

## 8. JSON: Avoid String Concatenation

Bad:

```powershell
$json = "{ `"env`": `"$Environment`", `"version`": `"$Version`" }"
```

This breaks with quotes, backslashes, newlines, encoding.

Good:

```powershell
$payload = [PSCustomObject]@{
  env = $Environment
  version = $Version
}

$json = $payload | ConvertTo-Json
```

Even better: keep object until call boundary:

```powershell
Invoke-RestMethod -Uri $Uri -Method Post -Body ($payload | ConvertTo-Json) -ContentType 'application/json'
```

---

## 9. REST API: `Invoke-RestMethod`

GET:

```powershell
$response = Invoke-RestMethod -Uri 'https://api.example.com/status' -Method Get -TimeoutSec 30
$response.status
```

POST JSON:

```powershell
$payload = [PSCustomObject]@{
  env = 'staging'
  version = '1.2.3'
}

$response = Invoke-RestMethod `
  -Uri $Uri `
  -Method Post `
  -Body ($payload | ConvertTo-Json -Depth 5) `
  -ContentType 'application/json' `
  -TimeoutSec 60
```

Headers:

```powershell
$headers = @{
  Authorization = "Bearer $env:DEPLOY_TOKEN"
}

Invoke-RestMethod -Uri $Uri -Headers $headers
```

Do not log headers if they contain secrets.

---

## 10. REST Error Handling

Use strict mode and catch:

```powershell
try {
  $response = Invoke-RestMethod -Uri $Uri -TimeoutSec 30
}
catch {
  throw "API call failed for Uri=$Uri. $($_.Exception.Message)"
}
```

For status code details, PowerShell versions differ in exception types/properties. Often:

```powershell
catch {
  $statusCode = $_.Exception.Response.StatusCode.value__
  throw "API call failed status=$statusCode message=$($_.Exception.Message)"
}
```

But this property may not exist for all failure modes.

Safer:

```powershell
catch {
  if ($_.Exception.Response) {
    Write-Verbose "HTTP response available"
  }
  throw
}
```

For production API wrappers, centralize error handling.

---

## 11. REST: Transport vs Application Failure

HTTP 200 does not always mean business success.

Response:

```json
{
  "status": "FAILED",
  "message": "version not found"
}
```

PowerShell request succeeds, but application failed.

Validate response:

```powershell
$response = Invoke-RestMethod @params

if ($response.status -ne 'OK') {
  throw "Deployment request rejected: $($response.message)"
}
```

For robust scripts:

- transport error: connection/status issue;
- protocol error: invalid JSON/schema;
- application error: response says failed;
- domain error: env/version invalid;
- authorization error: 401/403.

Treat them differently where useful.

---

## 12. REST: Idempotency and Retry

Retry only safe operations.

PowerShell retry helper:

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

Use with idempotency key:

```powershell
$headers = @{
  Authorization = "Bearer $env:DEPLOY_TOKEN"
  'Idempotency-Key' = "deploy-$Environment-$Version"
}
```

Do not retry non-idempotent POST unless API supports idempotency.

---

## 13. `Invoke-WebRequest` vs `Invoke-RestMethod`

`Invoke-RestMethod`:

- parses JSON/XML response into objects when possible;
- best for APIs.

`Invoke-WebRequest`:

- returns web response object;
- useful for raw content, status, headers, download, HTML-ish workflows;
- not primarily for structured API object.

Download file:

```powershell
Invoke-WebRequest -Uri $Uri -OutFile $Path
```

REST API:

```powershell
Invoke-RestMethod -Uri $Uri
```

---

## 14. CSV: Import

Given:

```csv
Environment,Url,Enabled
dev,http://localhost:8080,true
staging,https://staging.example.com,true
prod,https://prod.example.com,false
```

Read:

```powershell
$rows = Import-Csv -Path ./environments.csv
```

Filter:

```powershell
$enabled = $rows | Where-Object { $_.Enabled -eq 'true' }
```

Use:

```powershell
foreach ($row in $enabled) {
  [PSCustomObject]@{
    Environment = $row.Environment
    Url = $row.Url
  }
}
```

Note: CSV fields are strings by default. `"true"` is string, not boolean.

Convert explicitly:

```powershell
$enabled = [bool]::Parse($row.Enabled)
```

But `bool.Parse` expects `True`/`False` variants, not arbitrary yes/no. Validate.

---

## 15. CSV: Export

Objects:

```powershell
$rows = @(
  [PSCustomObject]@{ Environment = 'dev'; Url = 'http://localhost:8080'; Enabled = $true }
  [PSCustomObject]@{ Environment = 'prod'; Url = 'https://prod.example.com'; Enabled = $false }
)

$rows | Export-Csv -Path ./environments.csv -NoTypeInformation
```

`-NoTypeInformation` avoids old type header.

Encoding:

```powershell
$rows | Export-Csv -Path ./environments.csv -NoTypeInformation -Encoding UTF8
```

Modern PowerShell defaults are better than legacy Windows PowerShell, but be explicit if interoperability matters.

---

## 16. CSV Schema Validation

```powershell
$requiredColumns = @('Environment', 'Url', 'Enabled')

$rows = Import-Csv -Path $Path

if ($rows.Count -eq 0) {
  throw "CSV is empty: $Path"
}

$actualColumns = $rows[0].PSObject.Properties.Name

foreach ($column in $requiredColumns) {
  if ($column -notin $actualColumns) {
    throw "CSV missing required column: $column"
  }
}
```

Validate rows:

```powershell
foreach ($row in $rows) {
  if ($row.Environment -notin @('dev', 'staging', 'prod')) {
    throw "Invalid Environment: $($row.Environment)"
  }

  if ($row.Enabled -notin @('true', 'false')) {
    throw "Enabled must be true/false for env=$($row.Environment)"
  }
}
```

PowerShell makes this much more readable than Bash.

---

## 17. CSV Is Still Not a Database

CSV is useful for small tables, but not for:

- nested data;
- large relational transformations;
- concurrent writes;
- strong schema;
- multi-user updates;
- secrets;
- complex validation;
- transactional operations.

Use database/config service/application code when needed.

PowerShell can handle CSV well, but CSV remains a limited format.

---

## 18. XML: Reading

Simple XML:

```xml
<project>
  <version>1.2.3</version>
</project>
```

PowerShell:

```powershell
[xml]$xml = Get-Content -Raw -Path ./project.xml
$xml.project.version
```

For Maven POM, namespaces complicate direct property access.

POM:

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <version>1.2.3</version>
</project>
```

Namespace-aware XPath:

```powershell
[xml]$pom = Get-Content -Raw -Path ./pom.xml

$ns = New-Object System.Xml.XmlNamespaceManager($pom.NameTable)
$ns.AddNamespace('m', 'http://maven.apache.org/POM/4.0.0')

$versionNode = $pom.SelectSingleNode('/m:project/m:version', $ns)
$version = $versionNode.InnerText
```

This is more verbose than grepping but correct.

---

## 19. XML: Writing

Create XML via .NET APIs if needed. For many automation scripts, prefer JSON unless XML is required by ecosystem.

Modify simple XML:

```powershell
[xml]$xml = Get-Content -Raw -Path ./config.xml
$xml.configuration.environment = 'dev'
$xml.Save((Resolve-Path ./config.xml))
```

Caveats:

- formatting may change;
- namespaces matter;
- comments/ordering can be affected;
- complex XML editing needs care.

For Maven POM, prefer Maven commands/plugins where possible instead of editing XML manually.

---

## 20. Object Projection with `Select-Object`

```powershell
Get-Process |
  Select-Object Name, Id, CPU
```

Calculated property:

```powershell
Get-ChildItem |
  Select-Object Name, Length, @{
    Name = 'SizeMB'
    Expression = { [math]::Round($_.Length / 1MB, 2) }
  }
```

Rename:

```powershell
Select-Object @{
  Name = 'ProcessId'
  Expression = { $_.Id }
}
```

This is like mapping DTO fields.

---

## 21. Filtering with `Where-Object`

```powershell
Get-ChildItem -Path ./logs -Filter *.log |
  Where-Object { $_.Length -gt 10MB }
```

String:

```powershell
$rows | Where-Object { $_.Environment -eq 'prod' }
```

Regex:

```powershell
$rows | Where-Object { $_.Version -match '^\d+\.\d+\.\d+$' }
```

Remember default string comparisons are case-insensitive. Use `-ceq`/`-cmatch` if case matters.

---

## 22. Grouping and Aggregation

Group:

```powershell
$rows | Group-Object Environment
```

Count by status:

```powershell
$rows |
  Group-Object Status |
  Select-Object Name, Count
```

Sum:

```powershell
($files | Measure-Object -Property Length -Sum).Sum
```

Example:

```powershell
Get-ChildItem -Recurse -File |
  Measure-Object -Property Length -Sum
```

PowerShell has useful object aggregation, but for large datasets, dedicated tools may be faster.

---

## 23. Sorting

```powershell
$rows | Sort-Object Environment
```

Descending:

```powershell
Get-Process | Sort-Object CPU -Descending
```

Multiple keys:

```powershell
$rows | Sort-Object Environment, Name
```

Custom:

```powershell
$rows | Sort-Object { [int]$_.Priority }
```

---

## 24. Data Output Contract

If your script is consumed by another script, define output.

Example:

```powershell
# Output:
#   PSCustomObject with properties:
#     Service: string
#     Version: string
#     Commit: string
#     Dirty: bool
```

Implementation:

```powershell
[PSCustomObject]@{
  Service = $Service
  Version = $Version
  Commit = $Commit
  Dirty = $Dirty
}
```

For cross-shell consumption, support JSON:

```powershell
param(
  [ValidateSet('Object', 'Json')]
  [string] $Output = 'Object'
)

$result = [PSCustomObject]@{ ... }

switch ($Output) {
  'Object' { $result }
  'Json' { $result | ConvertTo-Json -Depth 5 }
}
```

If Bash will consume it, JSON is better than PowerShell object formatting.

---

## 25. Avoid `Format-*` Before Export

Bad:

```powershell
Get-Process |
  Format-Table Name, Id |
  ConvertTo-Json
```

This exports formatting objects, not process data.

Good:

```powershell
Get-Process |
  Select-Object Name, Id |
  ConvertTo-Json
```

Rule repeated because it matters:

> `Format-*` is terminal display, not data transformation.

---

## 26. ConvertTo-Json and Single-Item Shape

Potential pitfall:

```powershell
$item = Get-ChildItem ./one-file.txt
$item | ConvertTo-Json
```

Outputs object.

For array contract:

```powershell
@($item) | ConvertTo-Json
```

When an API expects array even for one item:

```powershell
$payload = [PSCustomObject]@{
  items = @($items)
}
```

Validate shape by inspecting final JSON.

---

## 27. Ordered JSON

If property order matters for readability:

```powershell
[ordered]@{
  service = 'api'
  version = '1.2.3'
  commit = 'abc123'
} | ConvertTo-Json
```

JSON object order should not be semantically important, but stable order helps humans and golden tests.

---

## 28. Date/Time Data

Use ISO-like UTC:

```powershell
$timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
```

Or round-trip:

```powershell
(Get-Date).ToUniversalTime().ToString('o')
```

Be explicit about timezone.

In JSON:

```powershell
[PSCustomObject]@{
  timestamp = (Get-Date).ToUniversalTime().ToString('o')
}
```

Do not rely on locale-specific date formatting for machine data.

---

## 29. Encoding

PowerShell 7 defaults are more UTF-8 friendly than Windows PowerShell 5.1, but be explicit when writing files for cross-platform use:

```powershell
Set-Content -Path output.json -Value $json -Encoding UTF8
```

For CSV:

```powershell
Export-Csv -Path output.csv -NoTypeInformation -Encoding UTF8
```

Be aware of BOM differences if interoperating with legacy Windows tools.

For binary files, do not use text cmdlets like `Get-Content` without appropriate options.

---

## 30. Large Data Considerations

PowerShell object pipeline is convenient but can be slower/heavier than streaming Unix tools for huge text files.

For huge logs:

- `Select-String` can search efficiently enough for many cases;
- native tools like `grep` may be faster on Linux;
- avoid loading entire file if streaming works;
- avoid `ConvertFrom-Json` on enormous JSON if streaming parser needed;
- use application code for large/complex transformations.

PowerShell is excellent for admin-sized structured data. For big data, choose proper tooling.

---

## 31. `Select-String` for Text Search

PowerShell equivalent of grep-ish:

```powershell
Select-String -Path ./logs/*.log -Pattern 'ERROR'
```

Output is match objects.

Use:

```powershell
Select-String -Path ./logs/*.log -Pattern 'ERROR' |
  Select-Object Path, LineNumber, Line
```

For simple text search in PowerShell scripts, `Select-String` is better than calling `grep` cross-platform.

---

## 32. Binary Data

Avoid treating binary as strings.

Use byte APIs:

```powershell
[byte[]]$bytes = [System.IO.File]::ReadAllBytes($Path)
```

Write:

```powershell
[System.IO.File]::WriteAllBytes($Path, $bytes)
```

For hash:

```powershell
Get-FileHash -Path $Path -Algorithm SHA256
```

This is better than platform-specific `sha256sum`.

---

## 33. File Hash and Integrity

```powershell
$hash = Get-FileHash -Path ./target/app.jar -Algorithm SHA256
$hash.Hash
```

Object includes:

```powershell
Algorithm
Hash
Path
```

Use for artifact metadata:

```powershell
[PSCustomObject]@{
  artifact = $Path
  sha256 = (Get-FileHash -Path $Path -Algorithm SHA256).Hash
}
```

PowerShell's `Get-FileHash` is cross-platform in PowerShell 7.

---

## 34. Case Study: Build Metadata Script

Goal:

```powershell
pwsh ./Build-Metadata.ps1 -Output Json
```

Output:

```json
{
  "service": "my-service",
  "version": "1.2.3",
  "commit": "abc123",
  "dirty": false,
  "timestamp": "2026-06-22T10:00:00Z"
}
```

Script:

```powershell
#requires -Version 7.0

[CmdletBinding()]
param(
  [ValidateSet('Object', 'Json')]
  [string] $Output = 'Object'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-NativeText {
  param(
    [Parameter(Mandatory)][string] $FilePath,
    [string[]] $ArgumentList = @()
  )

  $result = & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE"
  }

  return ($result -join "`n").Trim()
}

$service = 'my-service'
$version = Invoke-NativeText -FilePath 'mvn' -ArgumentList @('help:evaluate', '-Dexpression=project.version', '-q', '-DforceStdout')
$commit = Invoke-NativeText -FilePath 'git' -ArgumentList @('rev-parse', '--short', 'HEAD')

& git diff --quiet
$diffExit = $LASTEXITCODE
if ($diffExit -eq 0) {
  $dirty = $false
}
elseif ($diffExit -eq 1) {
  $dirty = $true
}
else {
  throw "git diff failed with exit code $diffExit"
}

$result = [PSCustomObject]@{
  service = $service
  version = $version
  commit = $commit
  dirty = $dirty
  timestamp = (Get-Date).ToUniversalTime().ToString('o')
}

switch ($Output) {
  'Object' { $result }
  'Json' { $result | ConvertTo-Json -Depth 5 }
}
```

Note native command handling and expected non-zero handling.

---

## 35. Case Study: Environment CSV to Deployment Matrix JSON

CSV:

```csv
Environment,Url,Enabled
dev,http://localhost:8080,true
staging,https://staging.example.com,true
prod,https://prod.example.com,false
```

Script:

```powershell
#requires -Version 7.0

[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string] $Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$rows = Import-Csv -Path $Path

if ($rows.Count -eq 0) {
  throw "CSV has no rows: $Path"
}

$matrix = foreach ($row in $rows) {
  if ($row.Environment -notin @('dev', 'staging', 'prod')) {
    throw "Invalid environment: $($row.Environment)"
  }

  if ($row.Enabled -notin @('true', 'false')) {
    throw "Enabled must be true/false for $($row.Environment)"
  }

  if ($row.Enabled -eq 'true') {
    [PSCustomObject]@{
      environment = $row.Environment
      url = $row.Url
    }
  }
}

[PSCustomObject]@{
  include = @($matrix)
} | ConvertTo-Json -Depth 5
```

Useful for CI matrix generation.

---

## 36. Case Study: REST Health Report

```powershell
#requires -Version 7.0

[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string[]] $Uris,

  [ValidateSet('Text', 'Json')]
  [string] $Output = 'Text'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$results = foreach ($uri in $Uris) {
  $start = Get-Date

  try {
    $response = Invoke-RestMethod -Uri $uri -TimeoutSec 10
    $status = if ($response.status) { [string]$response.status } else { 'UNKNOWN' }
    $ok = $status -in @('UP', 'OK', 'Healthy')
    $errorMessage = $null
  }
  catch {
    $status = 'ERROR'
    $ok = $false
    $errorMessage = $_.Exception.Message
  }

  $durationMs = [int](((Get-Date) - $start).TotalMilliseconds)

  [PSCustomObject]@{
    uri = $uri
    ok = $ok
    status = $status
    durationMs = $durationMs
    error = $errorMessage
  }
}

switch ($Output) {
  'Text' {
    $results | Format-Table -AutoSize
  }
  'Json' {
    $results | ConvertTo-Json -Depth 5
  }
}
```

Notice:

- structured result per URI;
- errors captured as data for report;
- `Format-Table` only in Text output mode;
- JSON mode remains structured.

---

## 37. Data Security

Structured data automation often handles secrets.

Risks:

- dumping full object to logs;
- converting headers to JSON;
- exporting env vars;
- transcript captures request;
- error response includes sensitive details;
- CSV/JSON output accidentally includes token.

Bad:

```powershell
$headers | ConvertTo-Json | Write-Verbose
```

Bad:

```powershell
Get-ChildItem Env: | ConvertTo-Json
```

Safer:

- select only safe properties;
- redact;
- avoid logging payload if contains secrets;
- write secret files with restricted permissions;
- do not include secrets in output contract.

Example:

```powershell
[PSCustomObject]@{
  Environment = $Environment
  TokenPresent = -not [string]::IsNullOrWhiteSpace($env:DEPLOY_TOKEN)
}
```

not token value.

---

## 38. When PowerShell Is Not Enough

Move to a real application/tool when:

- schema validation becomes complex;
- API client needs pagination, retries, auth refresh, typed errors;
- data volume large;
- transformation has domain logic;
- multiple input formats;
- tests become complex;
- performance matters;
- you need streaming JSON parser;
- concurrency is non-trivial;
- you need library reuse across services.

PowerShell can orchestrate:

```powershell
java -jar data-tool.jar --input config.json --output result.json
```

Do not force everything into scripts.

---

## 39. Review Checklist: PowerShell Data Automation

### Input

- Is JSON read with `Get-Content -Raw | ConvertFrom-Json`?
- Is CSV read with `Import-Csv`, not manual split?
- Is XML namespace handled if needed?
- Is input schema validated?

### Transformation

- Are objects kept as objects?
- Is `Format-*` avoided before export?
- Are calculated properties clear?
- Are single-item array shapes handled?

### Output

- Is JSON generated via `ConvertTo-Json`?
- Is `-Depth` set appropriately?
- Is output contract documented?
- Is encoding explicit for files?
- Is machine output free of logs?

### REST

- Are timeout and method explicit?
- Are headers secret-safe?
- Are transport and application errors distinguished?
- Is retry used only when safe?

### Security

- Are secrets excluded from objects/logs/files?
- Are API responses validated before use?
- Are URLs/endpoints constrained if needed?

---

## 40. Mini Lab

### Lab 1 — JSON Read/Write

Create `config.json` and read with:

```powershell
$config = Get-Content -Raw config.json | ConvertFrom-Json
$config | Get-Member
```

Create output object and `ConvertTo-Json`.

---

### Lab 2 — JSON Depth

Create nested object 4 levels deep and run `ConvertTo-Json` with and without `-Depth`.

Observe warning/truncation.

---

### Lab 3 — CSV Validation

Create CSV with missing column and write validation that fails.

---

### Lab 4 — REST Mock Shape

Without calling network, create fake response object:

```powershell
$response = [PSCustomObject]@{
  status = 'FAILED'
  message = 'version not found'
}
```

Write application-level validation.

---

### Lab 5 — Format Pitfall

Run:

```powershell
Get-Process | Select-Object -First 1 | Format-Table | ConvertTo-Json
```

Compare with:

```powershell
Get-Process | Select-Object -First 1 Name, Id | ConvertTo-Json
```

---

## 41. Design Exercise: Deployment Metadata Converter

Build `Convert-DeploymentMetadata.ps1`.

Input JSON:

```json
{
  "service": "payment",
  "version": "1.2.3",
  "artifacts": [
    {"name": "app.jar", "path": "target/app.jar"},
    {"name": "openapi.json", "path": "target/openapi.json"}
  ]
}
```

Output JSON:

```json
{
  "service": "payment",
  "version": "1.2.3",
  "artifactCount": 2,
  "artifacts": [
    {"name": "app.jar", "sha256": "..."},
    {"name": "openapi.json", "sha256": "..."}
  ],
  "generatedAt": "..."
}
```

Requirements:

- validate service/version;
- validate artifact array;
- verify files exist;
- compute SHA256 with `Get-FileHash`;
- output JSON with sufficient depth;
- no logs on success output;
- errors are terminating;
- support `-Output Json`.

This combines JSON, filesystem, validation, and structured output.

---

## 42. Part 015 Summary

PowerShell is strong for structured data automation because objects are first-class.

Key takeaways:

1. Keep data as objects as long as possible.
2. Use `Get-Member` to inspect data shape.
3. Read JSON with `Get-Content -Raw | ConvertFrom-Json`.
4. Write JSON with objects + `ConvertTo-Json`.
5. Always consider `ConvertTo-Json -Depth`.
6. Use `Invoke-RestMethod` for REST APIs.
7. Distinguish transport failure from application failure.
8. Use `Import-Csv`/`Export-Csv`, not manual comma splitting.
9. CSV fields are strings; convert/validate explicitly.
10. XML namespaces matter; do not grep XML.
11. Use `Select-Object`, `Where-Object`, `Group-Object`, `Measure-Object` for object transformations.
12. Avoid `Format-*` before export.
13. Be explicit about output contract and encoding.
14. Keep secrets out of data dumps/logs.
15. Move to a proper application when schema/domain complexity grows.

Part 016 will cover cross-platform PowerShell: Windows, Linux, macOS, containers, paths, encoding, native commands, and team portability strategy.

---

## 43. Referensi Resmi dan Bacaan Lanjutan

- PowerShell `ConvertFrom-Json`
- PowerShell `ConvertTo-Json`
- PowerShell `Invoke-RestMethod`
- PowerShell `Invoke-WebRequest`
- PowerShell `Import-Csv`
- PowerShell `Export-Csv`
- PowerShell `ConvertFrom-Csv`
- PowerShell `ConvertTo-Csv`
- PowerShell `Select-Object`
- PowerShell `Where-Object`
- PowerShell `Group-Object`
- PowerShell `Measure-Object`
- PowerShell `Get-FileHash`
- PowerShell XML and .NET `System.Xml` documentation
- PowerShell `about_Output_Streams`
- PowerShell `about_Calculated_Properties`

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
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-014.md">⬅️ Part 014 — PowerShell Error Handling, Strictness, and Observability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-016.md">Part 016 — Cross-Platform PowerShell: Windows, Linux, macOS, Containers ➡️</a>
</div>
