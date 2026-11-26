<#
.SYNOPSIS
  Packs the Windows release build into a portable ZIP (docs/guides/install.md).

.DESCRIPTION
  Takes target\release\desktop.exe (from `tauri build`), renames it to
  Bibalak.exe and adds portable.txt (the portable-mode marker), LICENSE and
  THIRD_PARTY_NOTICES.md. Prints the ZIP path.

.EXAMPLE
  .\scripts\package-portable.ps1 -Version 1.0.0 -OutDir target\portable
#>
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$OutDir = "target\portable",
  [string]$Exe = "target\release\desktop.exe"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  if (-not (Test-Path $Exe)) { throw "$Exe not found; run the release build first." }
  $stageRoot = Join-Path $OutDir ".staging-$PID"
  $stage = Join-Path $stageRoot "Bibalak"
  if (Test-Path $stageRoot) { Remove-Item -Recurse -Force $stageRoot }
  New-Item -ItemType Directory -Force $stage | Out-Null
  try {
    Copy-Item $Exe (Join-Path $stage "Bibalak.exe")
    Copy-Item "apps\desktop\portable\portable.txt", "LICENSE", "THIRD_PARTY_NOTICES.md" $stage
    $zip = Join-Path $OutDir "Bibalak_${Version}_x64_portable.zip"
    if (Test-Path $zip) { Remove-Item -Force $zip }
    # The ZIP holds a "Bibalak" folder so extracting never scatters files.
    Compress-Archive -Path $stage -DestinationPath $zip
    (Resolve-Path $zip).Path
  } finally {
    if (Test-Path $stageRoot) { Remove-Item -Recurse -Force $stageRoot -ErrorAction SilentlyContinue }
  }
} finally {
  Pop-Location
}
