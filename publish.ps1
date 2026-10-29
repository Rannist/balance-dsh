# balance-dsh one-click npm publish script
# Run via 发布.bat (double-click). Bumps patch version -> npm pack -> npm publish.
#
# IMPORTANT: npm.cmd is invoked through cmd.exe so that PowerShell 5.1 does not
#   throw NativeCommandError on the batch file's stderr output (which crashed the tool).
#
# 2FA: npm publish uses the browser-login flow (npm prints a auth URL, you log in
#   in the browser, then the script retries). No 6-digit code entry is needed.
#
# Steps:
#   1. Log in first (owner: rannist) in your own terminal:  npm login
#   2. Double-click 发布.bat (or run publish.ps1 directly)
#   3. If npm asks for 2FA, open the printed browser URL, log in, come back and press Enter.
#
# package.json is read/written with node to avoid GBK encoding issues.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "=== balance-dsh publish script ===" -ForegroundColor Cyan
Write-Host ("Project dir: " + $root)

$pkgPath = Join-Path $root "package.json"
if (-not (Test-Path $pkgPath)) {
    Write-Host "[ERROR] package.json not found" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# Run a native npm command through cmd.exe; expose the exit code via $script:.
function Invoke-NpmCommand {
    param([string]$argLine)
    $out = cmd /c ("npm.cmd " + $argLine + " 2>&1") 2>&1 | Out-String
    $script:lastNative = $LASTEXITCODE
    return $out
}

# 0) Pre-check: npm logged in?
Write-Host ""
Write-Host "[1/4] Checking npm login ..." -ForegroundColor Cyan
$whoOut = Invoke-NpmCommand "whoami"
$code = $script:lastNative
$whoTrim = ($whoOut | Out-String).Trim()
if ($code -ne 0 -or $whoTrim -match "401|Unauthorized|ENEEDAUTH|E401|Not found|npm error" -or $whoTrim -eq "") {
    Write-Host "[ERROR] You are NOT logged in to npm." -ForegroundColor Red
    Write-Host "  Please run this first in your own terminal:" -ForegroundColor Yellow
    Write-Host "      npm login" -ForegroundColor Yellow
    Write-Host "  then re-run this script." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host ("  Logged in as: " + $whoTrim) -ForegroundColor Green

# 1) Read current version, bump patch
Write-Host ""
Write-Host "[2/4] Bumping patch version ..." -ForegroundColor Cyan
$versionJson = node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync('package.json','utf8'));console.log(JSON.stringify({v:j.version}))"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] failed to read version" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
$ver = ($versionJson | ConvertFrom-Json).v
$parts = $ver -split '\.'
if ($parts.Count -ne 3) {
    Write-Host "[ERROR] version must be major.minor.patch, got: $ver" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
$major = [int]$parts[0]
$minor = [int]$parts[1]
$patch = [int]$parts[2]
$newVer = "$major.$minor.$($patch + 1)"

Write-Host ("  Current version: {0}  ->  New version: {1}" -f $ver, $newVer) -ForegroundColor Yellow

# 2) Write back new version
$writeCode = node -e "const fs=require('fs');const p='package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.version=process.argv[1];fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');console.log('  done')" $newVer
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] failed to write version" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host ("  package.json version set to: {0}" -f $newVer) -ForegroundColor Green

# 3) Pack, then publish
Write-Host ""
Write-Host "[3/4] Packing ..." -ForegroundColor Cyan
$packOut = Invoke-NpmCommand ("pack --cache " + ($root + "\.npm-cache"))
Write-Host $packOut
if (Test-Path ($root + "\.npm-cache")) {
    Remove-Item ($root + "\.npm-cache") -Recurse -Force
}

# 4) Publish (first attempt)
Write-Host ""
Write-Host "[4/4] Publishing to npm ..." -ForegroundColor Cyan
$out = Invoke-NpmCommand "publish"
Write-Host $out
$code = $script:lastNative

# 2FA via browser login: npm prints an auth URL. Open it, log in, press Enter to retry.
if ($code -ne 0 -and $out -match 'EOTP|One-time password|two-factor|authentication') {
    Write-Host ""
    Write-Host "[INFO] npm publish needs two-factor (2FA) authentication via browser." -ForegroundColor Yellow
    Write-Host "  In the output above, find the URL that looks like:" -ForegroundColor Cyan
    Write-Host "      https://www.npmjs.com/auth/cli/***" -ForegroundColor Cyan
    Write-Host "  Copy it, open it in your browser, and log in / confirm there." -ForegroundColor Cyan
    Write-Host "  then come back here and press Enter to retry." -ForegroundColor Cyan
    Read-Host "Press Enter after you have logged in"
    Write-Host ""
    Write-Host "Retrying publish after browser login ..." -ForegroundColor Cyan
    $out2 = Invoke-NpmCommand "publish"
    Write-Host $out2
    $code = $script:lastNative
}

# 5) Result
if ($code -eq 0) {
    Write-Host ""
    Write-Host "Publish SUCCESS! version $newVer" -ForegroundColor Green
    Write-Host ("  https://registry.npmjs.org/balance-dsh")
} else {
    Write-Host ""
    Write-Host "Publish did NOT succeed (exit $code). Check the output above." -ForegroundColor Red
}

Write-Host ""
Read-Host "Press Enter to close"
