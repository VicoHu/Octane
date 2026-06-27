---
name: octane-release
description: Use when publishing a new Octane browser-extension version to GitHub Releases, bumping nothing but packaging the chrome MV3 build and creating a release with the version's changelog notes. Triggers on "发版 / release octane / 发 GitHub Release / ship a version".
---

# Octane Release

## Overview

把 Octane 当前 `package.json` 版本发到 GitHub Release，最终 Release 页面**必有 3 个文件**：

1. `Source code (zip)` —— GitHub 自动生成（源码快照，不可加载）
2. `Source code (tar.gz)` —— GitHub 自动生成（源码快照，不可加载）
3. `octane-<version>-chrome.zip` —— **本流程上传**的、可加载的 chrome MV3 扩展包

核心坑：WXT 的 zip 产物在 **`.output/`**，不是 `dist/`。`dist/*.zip` 永远匹配为空。

## Prerequisites（执行前先校验）

```bash
# 1. gh 已登录
gh auth status | grep -q "Logged in" || { echo "gh 未登录"; exit 1; }

# 2. 工作区干净（避免把未提交改动打进源码包）
git diff --quiet || { echo "工作区有未提交改动，先 commit"; exit 1; }

# 3. 已在对应版本的分支/commit 上打 tag（release 依附 tag）
VERSION=$(node -p "require('./package.json').version")
git tag --list "v$VERSION" | grep -q "v$VERSION" || { echo "缺少 tag v$VERSION，先 git tag v$VERSION && git push origin v$VERSION"; exit 1; }
```

## Steps（按序执行，每步验证）

```text
1. 构建 chrome 包  → 验证：.output/chrome-mv3/manifest.json 存在
2. 打包 zip        → 验证：.output/octane-<ver>-chrome.zip 存在且非空
3. 提取 release notes → 验证：输出非空、只含当前版本段
4. 创建 release    → 验证：release 页面有 3 个文件
```

### 1. 构建 + 打包

```bash
npm run build          # → .output/chrome-mv3/
npm run zip            # → .output/octane-<version>-chrome.zip
```

### 2. 校验产物

```bash
ZIP=".output/octane-${VERSION}-chrome.zip"
test -s "$ZIP" || { echo "zip 未生成或为空：$ZIP"; exit 1; }
ls -lh "$ZIP"
```

### 3. 提取当前版本的 CHANGELOG 段（只发本版本，非整个文件）

```bash
NOTES="$(awk -v v="$VERSION" '
  /^## \[/ { if ($0 ~ "\\["v"\\]") p=1; else if (p) exit }
  p { print }
' CHANGELOG.md)"
test -n "$NOTES" || { echo "CHANGELOG 找不到版本 $VERSION 段"; exit 1; }
```

### 4. 创建 Release（上传 zip）

```bash
gh release create "v$VERSION" "$ZIP" \
  --title "v$VERSION" \
  --notes "$NOTES"
```

### 5. 验证最终 3 个文件

```bash
gh release view "v$VERSION" --json assets --jq '.assets[].name'
# 期望输出（前两个 GitHub 自动生成，第三个是上传的）：
#   octane-<version>-chrome.zip
# 叫不出 Source code，但 GitHub 页面上会另有 Source code (zip/tar.gz)
```

> `gh release view --json assets` 只列出**上传的** assets（即 zip），`Source code (zip/tar.gz)` 是 GitHub 页面单独渲染、不在 assets 列表里。打开浏览器 Release 页面才能看到完整 3 项。

## Common Mistakes

| 错误 | 结果 | 正解 |
|---|---|---|
| 用 `dist/*.zip` | 匹配为空，Release 没有扩展包 | 用 `.output/*.zip` |
| `--notes-file CHANGELOG.md` | 整个 changelog 当 notes，历史全堆上去 | 用 awk 截取当前版本段 |
| 忘了 `npm run build` 直接 zip | zip 为空或旧产物 | 先 build 再 zip |
| 没打 tag 就 create | `gh` 自动建 tag 但指向当前 HEAD，可能错位 | 先在目标 commit 打 tag 并 push |
| 想发 Firefox 包 | 只有 chrome | 另跑 `npm run zip:firefox`，asset 多传一个 `.output/*-firefox.zip` |
| 把 Source code 当扩展发 | 用户装不上（无编译后 assets） | 必须上传 `.output/*.zip` |

## Fire and forget（一条命令版，已通过所有校验后用）

```bash
VERSION=$(node -p "require('./package.json').version") && \
npm run build && npm run zip && \
ZIP=".output/octane-${VERSION}-chrome.zip" && test -s "$ZIP" && \
NOTES="$(awk -v v="$VERSION" '/^## \[/ { if ($0 ~ "\\["v"\\]") p=1; else if (p) exit } p{print}' CHANGELOG.md)" && \
gh release create "v$VERSION" "$ZIP" --title "v$VERSION" --notes "$NOTES"
```
