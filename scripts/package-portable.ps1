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

function Remove-SafePath {
  param(
    [Parameter(Mandatory = $true)][string]$TargetPath,
    [Parameter(Mandatory = $true)][string]$AllowedParent,
    [switch]$Recurse
  )
  if (-not (Test-Path -LiteralPath $TargetPath)) { return }
  $resolvedParent = (Resolve-Path -LiteralPath $AllowedParent).Path
  $resolvedTarget = (Resolve-Path -LiteralPath $TargetPath).Path
  $driveRoot = (Split-Path -Qualifier $resolvedTarget) + "\"
  if (
    [string]::IsNullOrWhiteSpace($resolvedTarget) -or
    $resolvedTarget -eq $driveRoot -or
    $resolvedTarget -eq $resolvedParent -or
    -not $resolvedTarget.StartsWith($resolvedParent + [System.IO.Path]::DirectorySeparatorChar)
  ) {
    throw "Refusing unsafe Remove-Item target: $resolvedTarget (must be inside $resolvedParent)"
  }
  Write-Host "Removing: $resolvedTarget"
  if ($Recurse) {
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
  } else {
    Remove-Item -LiteralPath $resolvedTarget -Force
  }
}

Push-Location $root
try {
  if (-not (Test-Path -LiteralPath $Exe)) { throw "$Exe not found; run the release build first." }
  New-Item -ItemType Directory -Force $OutDir | Out-Null
  $stageRoot = Join-Path $OutDir ".staging-$PID"
  $stage = Join-Path $stageRoot "Bibalak"
  Remove-SafePath -TargetPath $stageRoot -AllowedParent $OutDir -Recurse
  New-Item -ItemType Directory -Force $stage | Out-Null
  try {
    Copy-Item $Exe (Join-Path $stage "Bibalak.exe")
    Copy-Item "apps\desktop\portable\portable.txt", "LICENSE", "THIRD_PARTY_NOTICES.md" $stage
    $zip = Join-Path $OutDir "Bibalak_${Version}_x64_portable.zip"
    Remove-SafePath -TargetPath $zip -AllowedParent $OutDir
    # The ZIP holds a "Bibalak" folder so extracting never scatters files.
    Compress-Archive -Path $stage -DestinationPath $zip
    (Resolve-Path -LiteralPath $zip).Path
  } finally {
    Remove-SafePath -TargetPath $stageRoot -AllowedParent $OutDir -Recurse
  }
} finally {
  Pop-Location
}
