#!/usr/bin/env bash
# 品牌色迁移守卫：迁移完成后 src/ 与 public/icons 不应残留靛蓝硬编码。
# 接入 CI 或 lint：命中即 fail，防止未来重新引入靛蓝。
# 详见 docs/brand-color-migration-guide.md Step 8。
set -euo pipefail

PATTERN='#6366f1|#4f46e5|#818cf8|#0077fa|#0066d6|rgba\(99,\s*102,\s*241'

hits=$(rg -n -E "$PATTERN" src/ public/icons/ 2>/dev/null || true)
if [ -n "$hits" ]; then
  echo "FAIL: 残留靛蓝硬编码：" >&2
  echo "$hits" >&2
  exit 1
fi

echo "PASS: 无靛蓝残留"
