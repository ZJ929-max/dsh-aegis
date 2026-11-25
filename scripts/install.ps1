param(
  [string]$Profile = 'desktop',
  [string]$Ref = 'v0.1.0'
)
$ErrorActionPreference = 'Stop'
$dsh = (Get-Command dsh -ErrorAction SilentlyContinue).Source
if (-not $dsh) { throw 'dsh CLI not found in PATH' }
$profileDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
$pkgPath = Join-Path $profileDir 'package.json'
if (-not (Test-Path $pkgPath)) { throw "profile not found: $profileDir" }
$backup = "$pkgPath.bak-$(Get-Date -Format yyyyMMddHHmmss)"
Copy-Item $pkgPath $backup
& $dsh plugin --profile $Profile add "github:ZJ929-max/dsh-aegis#$Ref"
if ($LASTEXITCODE -ne 0) { throw "dsh plugin add failed: $LASTEXITCODE" }
$json = Get-Content $pkgPath -Raw | ConvertFrom-Json
if ($json.dsh.profile.bundles -notcontains 'dsh-aegis') {
  $json.dsh.profile.bundles += 'dsh-aegis'
  $json | ConvertTo-Json -Depth 20 | Set-Content $pkgPath -Encoding utf8
}
Write-Host "Installed dsh-aegis into $Profile. Backup: $backup"
Write-Host "Restart DSH, then run: aegis doctor"
