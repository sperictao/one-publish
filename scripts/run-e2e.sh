#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
# one-publish E2E 全流程测试管道
#
# 用法:
#   ./scripts/run-e2e.sh              # 运行全部 E2E 测试
#   ./scripts/run-e2e.sh --full       # 完整流程: typecheck → vitest → cargo check → E2E
#   ./scripts/run-e2e.sh --rust       # 仅 Rust 检查 (cargo check + test)
#   ./scripts/run-e2e.sh --spec 01    # 仅运行单个 spec 文件
# ──────────────────────────────────────────────────────────

set -euo pipefail
cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass_count=0
fail_count=0

section() {
  echo ""
  echo -e "${YELLOW}━━━ $1 ━━━${NC}"
}

success() {
  echo -e "  ${GREEN}✅ $1${NC}"
  ((pass_count++)) || true
}

fail() {
  echo -e "  ${RED}❌ $1${NC}"
  ((fail_count++)) || true
}

summary() {
  echo ""
  echo -e "${YELLOW}══════════════════════════════════════${NC}"
  echo -e "  ${GREEN}通过: $pass_count${NC}  ${RED}失败: $fail_count${NC}"
  if [ "$fail_count" -eq 0 ]; then
    echo -e "  ${GREEN}全部通过 🎉${NC}"
    echo ""
    echo "报告位置:"
    echo "  HTML: test-results/report/index.html"
    echo "  JSON: test-results/results.json"
  else
    echo -e "  ${RED}存在失败，请检查上方输出${NC}"
    exit 1
  fi
}

# ─── Parse args ───
MODE="e2e"
SPEC_FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --full) MODE="full"; shift ;;
    --rust) MODE="rust"; shift ;;
    --spec) MODE="spec"; SPEC_FILE="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ─── Step 1: TypeScript 类型检查 ───
if [[ "$MODE" == "full" ]]; then
  section "TypeScript 类型检查"
  if pnpm typecheck; then
    success "类型检查通过"
  else
    fail "类型检查失败"
  fi

  # ─── Step 2: Vitest 单元测试 ───
  section "Vitest 单元测试"
  if pnpm test -- --run 2>&1 | tail -5; then
    success "单元测试通过"
  else
    fail "单元测试失败"
  fi
fi

# ─── Step 3: Rust 检查 ───
if [[ "$MODE" == "full" || "$MODE" == "rust" ]]; then
  section "Rust 编译检查"
  if (cd src-tauri && cargo check 2>&1 | tail -3); then
    success "cargo check 通过"
  else
    fail "cargo check 失败"
  fi

  section "Rust 测试"
  if (cd src-tauri && cargo test 2>&1 | grep "test result" | tail -1); then
    success "cargo test 通过"
  else
    fail "cargo test 失败"
  fi

  if [[ "$MODE" == "rust" ]]; then
    summary
    exit 0
  fi
fi

# ─── Step 4: Tauri 契约同步 ───
section "Tauri 契约同步"
if pnpm check:contracts; then
  success "契约同步"
else
  fail "契约同步失败"
fi

# ─── Step 5: Playwright E2E 测试 ───
section "Playwright E2E 测试"

E2E_ARGS="--reporter=list --timeout=90000"
if [[ -n "$SPEC_FILE" ]]; then
  E2E_ARGS="$E2E_ARGS tests/e2e/specs/0${SPEC_FILE}*.spec.ts"
else
  E2E_ARGS="$E2E_ARGS tests/e2e/specs/"
fi

echo "  命令: npx playwright test $E2E_ARGS"
if npx playwright test $E2E_ARGS 2>&1; then
  success "E2E 测试全部通过"
else
  fail "E2E 测试存在失败"
fi

# ─── Done ───
summary
