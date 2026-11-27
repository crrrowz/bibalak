#!/usr/bin/env sh
set -eu

NO_RUST=0
AUDIT=0
for arg in "$@"; do
  case "$arg" in
    --no-rust) NO_RUST=1 ;;
    --audit) AUDIT=1 ;;
    *)
      echo "Unknown flag: $arg" >&2
      exit 2
      ;;
  esac
done

if command -v pnpm >/dev/null 2>&1; then
  run_pnpm() { pnpm "$@"; }
else
  run_pnpm() { npx pnpm@11.5.0 "$@"; }
fi

run_step() {
  label="$1"
  shift
  echo "[check] $label..."
  if "$@"; then
    echo "[PASS] $label"
  else
    status=$?
    echo "[FAIL] $label (exit $status)"
    exit "$status"
  fi
}

if [ "$NO_RUST" -eq 0 ]; then
  run_step "cargo fmt --check" cargo fmt --check
  run_step "cargo clippy --workspace --all-targets -- -D warnings" cargo clippy --workspace --all-targets -- -D warnings
  run_step "cargo test --workspace" cargo test --workspace
  run_step "git diff --exit-code packages/ipc-types" git diff --exit-code packages/ipc-types
fi

run_step "pnpm lint:ts" run_pnpm lint:ts
run_step "pnpm fmt:check" run_pnpm fmt:check
run_step "pnpm test:ts" run_pnpm test:ts
run_step "pnpm --filter @bibalak/desktop build" run_pnpm --filter @bibalak/desktop build
# Every *.test.mjs under scripts/ (found, not listed: the public copy has fewer).
SCRIPT_TESTS=$(find scripts -name '*.test.mjs' | sort)
# shellcheck disable=SC2086
run_step "node --test (repo scripts)" node --test $SCRIPT_TESTS
if [ "$NO_RUST" -eq 0 ]; then
  run_step "node scripts/licenses/generate-notices.mjs --check" node scripts/licenses/generate-notices.mjs --check
fi
if [ "$AUDIT" -eq 1 ]; then
  run_step "pnpm audit --audit-level=high" run_pnpm audit --audit-level=high
  if [ "$NO_RUST" -eq 0 ]; then
    run_step "cargo audit" cargo audit
  fi
fi
