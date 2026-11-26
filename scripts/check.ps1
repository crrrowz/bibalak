param(
    [switch]$NoRust
)

$ErrorActionPreference = "Stop"
$env:CARGO_BUILD_JOBS = "4"

function Invoke-Step {
    param(
        [string]$Label,
        [scriptblock]$Command
    )
    Write-Host "[check] $Label..."
    & $Command
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FAIL] $Label (exit $LASTEXITCODE)"
        exit $LASTEXITCODE
    }
    Write-Host "[PASS] $Label"
}

$useNpxPnpm = -not (Get-Command pnpm -ErrorAction SilentlyContinue)
function Invoke-Pnpm {
    param([string[]]$PnpmArgs)
    if ($useNpxPnpm) {
        & npx pnpm@11.5.0 @PnpmArgs
    } else {
        & pnpm @PnpmArgs
    }
}

if (-not $NoRust) {
    Invoke-Step "cargo fmt --check" { cargo fmt --check }
    Invoke-Step "cargo clippy --workspace --all-targets -- -D warnings" { cargo clippy --workspace --all-targets -- -D warnings }
    Invoke-Step "cargo test --workspace" { cargo test --workspace }
    Invoke-Step "git diff --exit-code packages/ipc-types" { git diff --exit-code packages/ipc-types }
}

Invoke-Step "pnpm lint:ts" { Invoke-Pnpm @("lint:ts") }
Invoke-Step "pnpm fmt:check" { Invoke-Pnpm @("fmt:check") }
Invoke-Step "pnpm test:ts" { Invoke-Pnpm @("test:ts") }
Invoke-Step "pnpm --filter @bibalak/desktop build" { Invoke-Pnpm @("--filter", "@bibalak/desktop", "build") }
