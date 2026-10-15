#!/usr/bin/env pwsh
<#
  Local test runner. It only corrects three known Windows problems, then runs each suite
  listed in script/local-test.json.

  Why it exists (all three are recorded in docs/plan/environment_plan.md):

  1. TEMP lives under the user profile. Config discovery walks upward from the test
     workspace looking for .opencode, so it reaches the real home directory, which breaks
     the config cases and reads your real configuration. Fix: point TEMP/TMP/TMPDIR at
     tempRoot, outside the profile.
  2. PowerShell is the MSIX/Store build, so PATH only carries an app execution alias and
     bun gets EACCES when it stats it, failing 16 shell syntax cases. Fix: point
     SHELL_SCAN_PWSH at the real powershell.exe.
  3. On this machine the first two child_process spawns in a fresh bun process take about
     4.7s and 5.2s, then 44ms from the third on, so the framework's 5s default timeout
     kills every case that starts a subprocess. Fix: suites[].timeoutMs.

  Usage: run the script. It takes no arguments; change local-test.json to tune anything.

  ASCII only on purpose: Windows PowerShell 5.1 reads BOM-less .ps1 files as ANSI, so any
  non-ASCII character here would break parsing on the machine's default shell.
#>
# Continue, not Stop: in Windows PowerShell a native command's stderr output becomes an
# error record, so Stop would abort the run the moment bun prints its script banner.
# Real problems below are raised with an explicit throw, which terminates either way.
$ErrorActionPreference = "Continue"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$configPath = Join-Path $scriptDir "local-test.json"

if (-not (Test-Path $configPath)) { throw "missing config file: $configPath" }

$config = (Get-Content $configPath -Raw | ConvertFrom-Json)."local-test"
if (-not $config) { throw "config has no local-test section: $configPath" }

# --- Fix 1: move the temp directory out of the user profile -------------------
$tempRoot = $config.tempRoot
if ($tempRoot) {
  New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
  if ($tempRoot.StartsWith($env:USERPROFILE, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Warning "tempRoot is inside the user profile; discovery may still reach the real ~/.opencode: $tempRoot"
  }
  $env:TEMP = $tempRoot
  $env:TMP = $tempRoot
  $env:TMPDIR = $tempRoot
}

# --- Fix 2: point at the real powershell.exe, bypassing the MSIX alias --------
if ($config.shellScanPwsh) {
  if (Test-Path $config.shellScanPwsh) {
    $env:SHELL_SCAN_PWSH = $config.shellScanPwsh
  } else {
    Write-Warning "shellScanPwsh does not exist, shell syntax cases will fail: $($config.shellScanPwsh)"
  }
}

$bun = if ($config.bun) { $config.bun } else { "bun" }
$bunVersion = (& $bun --version) 2>&1
Write-Host "bun $bunVersion  |  tempRoot=$tempRoot" -ForegroundColor Cyan
Write-Host "SHELL_SCAN_PWSH=$env:SHELL_SCAN_PWSH" -ForegroundColor Cyan
Write-Host ""

# --- Run each suite ----------------------------------------------------------
$results = @()

foreach ($suite in $config.suites) {
  $cwd = Join-Path $repoRoot $suite.cwd
  Write-Host "=== $($suite.name)  ($($suite.cwd)) ===" -ForegroundColor Yellow

  $started = Get-Date
  Push-Location $cwd
  $logFile = Join-Path ([System.IO.Path]::GetTempPath()) "local-test-$($suite.name).log"
  try {
    # Splat through a variable: "@($suite.args)" is the array operator and would hand the whole
    # array over as one argument. Redirecting every stream to a file also keeps a failing native
    # command from raising an error record that ErrorActionPreference=Stop would turn fatal.
    $cmdArgs = @($suite.args)
    & $bun @cmdArgs *> $logFile
    $exit = $LASTEXITCODE
    $output = if (Test-Path $logFile) { Get-Content $logFile -Raw } else { "" }
  } finally {
    Pop-Location
  }
  $elapsed = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)

  # Parse only the summary lines so the full output never floods the terminal.
  $summary = ($output -split "`n" | Where-Object { $_ -match "^\s*\d+ (pass|fail|skip)" }) -join " "
  if (-not $summary) { $summary = "(no summary line parsed)" }

  $results += [PSCustomObject]@{
    Suite   = $suite.name
    Exit    = $exit
    Seconds = $elapsed
    Summary = $summary.Trim()
  }

  if ($suite.timeoutMs -and $elapsed * 1000 -gt $suite.timeoutMs) {
    Write-Warning "$($suite.name) exceeded the configured timeoutMs=$($suite.timeoutMs); raise it"
  }

  Write-Host "  exit=$exit  ${elapsed}s  $($summary.Trim())"
  Write-Host ""
}

# --- Summary -----------------------------------------------------------------
Write-Host "=== summary ===" -ForegroundColor Cyan
$results | Format-Table -AutoSize

$failed = @($results | Where-Object { $_.Exit -ne 0 }).Count
if ($failed -eq 0) {
  Write-Host "All suites passed." -ForegroundColor Green
} else {
  Write-Host "$failed suite(s) exited non-zero. Known-failure baseline: docs/plan/issues_backlog.md" -ForegroundColor Yellow
}
