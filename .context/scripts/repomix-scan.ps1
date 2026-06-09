param (
    [ValidateSet("code", "diff")]
    [string]$Type = "code",

    [Parameter(Mandatory = $true)]
    [string]$Target = "all"
)

# Base directories relative to script location
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$projectRoot = (Get-Item (Join-Path $scriptDir "..\..")).FullName
$servicesRoot = Join-Path $projectRoot "services"
$sourcesDir = Join-Path $projectRoot ".context\sources"

# Ensure output directory exists
if (-not (Test-Path $sourcesDir)) {
    New-Item -ItemType Directory -Path $sourcesDir -Force | Out-Null
}

function Get-ServiceMetadata {
    param([string]$path)
    $metadata = @{
        Branch = ""
        Commit = ""
        Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Path = $path
    }
    $currentDir = Get-Location
    try {
        Set-Location $path
        # Get branch
        $branch = git rev-parse --abbrev-ref HEAD 2>$null
        if ($LASTEXITCODE -eq 0) { $metadata.Branch = $branch.Trim() }
        
        # Get commit hash
        $commit = git rev-parse HEAD 2>$null
        if ($LASTEXITCODE -eq 0) { $metadata.Commit = $commit.Trim() }
    } catch {
    } finally {
        Set-Location $currentDir
    }
    return $metadata
}

# Identify target folders
$targets = @()
if ($Target -eq "all") {
    if (Test-Path $servicesRoot) {
        $targets = Get-ChildItem -Path $servicesRoot -Directory
    } else {
        Write-Error "Services directory not found at $servicesRoot"
        return
    }
} else {
    $targetPath = Join-Path $servicesRoot $Target
    if (Test-Path $targetPath -PathType Container) {
        $targets = @(Get-Item $targetPath)
    } else {
        Write-Error "Target service '$Target' not found in $servicesRoot"
        return
    }
}

foreach ($service in $targets) {
    $serviceName = $service.Name
    $servicePath = $service.FullName
    
    Write-Host "Processing service: $serviceName..." -ForegroundColor Cyan
    
    $meta = Get-ServiceMetadata -path $servicePath
    
    # Generate filename identifier
    $identifier = $meta.Branch
    if ([string]::IsNullOrWhiteSpace($identifier)) {
        $identifier = Get-Date -Format "yyyyMMdd-HHmmss"
    }
    $identifier = $identifier -replace '[\\/:*?"<>|]', '-'
    
    $outputFileName = "$serviceName.$identifier.source.xml"
    $outputPath = Join-Path $sourcesDir $outputFileName
    
    # Prepare Header Text
    $headerLines = @(
        "Service Path: $($meta.Path)",
        "Branch:       $($meta.Branch)",
        "Commit Hash:  $($meta.Commit)",
        "Generated At: $($meta.Timestamp)"
    )
    $headerText = $headerLines -join "`n"
    
    # Prepare repomix arguments
    $repomixArgs = @("--output", $outputPath, "--style", "xml", "--header-text", $headerText)
    
    if ($Type -eq "diff") {
        $repomixArgs += "--include-diffs"
    }
    
    # Run repomix from the service directory
    $currentDir = Get-Location
    Set-Location $servicePath
    try {
        Write-Host "Running: repomix $($repomixArgs -join ' ')" -ForegroundColor Gray
        repomix @repomixArgs
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Successfully generated: $outputPath" -ForegroundColor Green
        } else {
            Write-Warning "Repomix failed for $serviceName with exit code $LASTEXITCODE"
        }
    } catch {
        Write-Error "An error occurred while running repomix for $($serviceName): $($_.Exception.Message)"
    } finally {
        Set-Location $currentDir
    }
}
