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

Release notes 采用**模板化结构**（非原样粘贴 CHANGELOG），见下方「Release Notes 生成」。

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
3. 提取 CHANGELOG 段 → 验证：输出非空、只含当前版本段（作为模板素材，非最终 notes）
4. 按模板重组 notes → 验证：对照模板自检清单逐条核对（占位符已替换、空章节已删）
5. 创建 release    → 验证：release 页面有 3 个文件
```

### 1. 构建 + 打包

```bash
pnpm run build          # → .output/chrome-mv3/
pnpm run zip            # → .output/octane-<version>-chrome.zip
```

> Firefox：另跑 `pnpm run zip:firefox`，可多传一个 `.output/*-firefox.zip` asset（Octane 无 Firefox 稳定分发，仅当本次明确要发 Firefox 时才打）。

### 2. 校验产物

```bash
ZIP=".output/octane-${VERSION}-chrome.zip"
test -s "$ZIP" || { echo "zip 未生成或为空：$ZIP"; exit 1; }
ls -lh "$ZIP"
```

### 3. 提取当前版本的 CHANGELOG 段（作为模板素材）

```bash
NOTES=$(node -e '
  const v = process.argv[1];
  const md = require("fs").readFileSync("CHANGELOG.md", "utf8");
  const re = new RegExp("## \\[" + v + "\\][\\s\\S]*?(?=\\n## \\[|$)");
  const m = md.match(re);
  process.stdout.write(m ? m[0].trimEnd() : "");
' "$VERSION")
test -n "$NOTES" || { echo "CHANGELOG 找不到版本 $VERSION 段"; exit 1; }
```

### 4. 按模板重组 Release Notes（模板式，非原样贴 CHANGELOG）

**选模板：**

| 场景                                              | 模板                | 判断标准           |
| ------------------------------------------------- | ------------------- | ------------------ |
| 含新功能（CHANGELOG 该版本有 `### Added`）        | `templates/full.md` | 用户可感知的新能力 |
| 纯修复/小改动（无 `### Added`，仅 Fixed/Changed） | `templates/lite.md` | 无新功能           |

**填充流程：**

1. 读取选定模板（`full.md` / `lite.md`，位于本 skill 的 `templates/` 目录）。
2. **把 `{{占位符}}` 替换为真实值：**
   - `{{VERSION}}` ← `$VERSION`
   - `{{DATE}}` ← 今天日期 `YYYY-MM-DD`
   - `{{REPO}}` ← `origin` 仓库全名（`gh repo view --json nameWithOwner -q .nameWithOwner`）
   - `{{PREV_VERSION}}` ← 上一 release tag（`gh release list --limit 1` 取上一条，或 CHANGELOG 中上一个 `## [...]`）
   - `{{TITLE_SUFFIX}}` ← 本版本一句话主题（从 CHANGELOG 该版本提炼，如「标签系统」「工作区隔离」；纯 patch 可留空）
3. **把 `【填写要求：…】` 段落替换为真实内容**，内容素材取自上一步提取的 CHANGELOG `$NOTES`：
   - `New Features` ← CHANGELOG `### Added` 段
   - `Improvements` ← CHANGELOG `### Changed` 段
   - `Bug Fixes` ← CHANGELOG `### Fixed` 段
   - 不直接整段复制，而是**提炼成面向用户的语句**（去掉 Internal 实现细节、补 issue 编号）。
4. **删除不适用的章节**（模板文末自检清单逐条核对）：
   - 无 `### Fixed` → 删 Bug Fixes 节
   - 无安全相关改动 → 删 Security 节
   - manifest 权限未变 → 删权限/依赖变更节
   - 无已知问题 → 删 Known Issues 节
5. 将最终重组后的 Markdown 写入临时文件 `/tmp/octane-notes-v$VERSION.md`。

> 为何不原样贴 CHANGELOG 段？Octane 的 GitHub Releases 是**手动安装渠道**，用户需要 CHANGELOG 里没有的三样东西：**版本速览（TL;DR）、安装/升级步骤、Assets 说明**。模板把这些固定支架补齐，CHANGELOG 只作为素材。CHANGELOG 仍是变更的单一真源，Release notes 面向终端用户重组呈现。

**对照模板自检（发布前必过）：**

- [ ] 所有 `{{占位符}}` 已替换
- [ ] 所有 `【填写要求：…】` 已替换为真实内容或随章节删除
- [ ] TL;DR 提炼自 CHANGELOG，没有新造 CHANGELOG 未提及的功能
- [ ] 安装步骤与 README「安装到浏览器」一致
- [ ] 保留的章节都有真实内容（无空标题）

### 5. 创建 Release（上传 zip + notes）

```bash
NOTES_FILE="/tmp/octane-notes-v$VERSION.md"
gh release create "v$VERSION" "$ZIP" \
  --title "v$VERSION" \
  --notes-file "$NOTES_FILE"
```

### 6. 验证最终 3 个文件

```bash
gh release view "v$VERSION" --json assets --jq '.assets[].name'
# 期望输出（第三个是上传的，前两个 GitHub 自动生成）：
#   octane-<version>-chrome.zip
# 叫不出 Source code，但 GitHub 页面上会另有 Source code (zip/tar.gz)
```

> `gh release view --json assets` 只列出**上传的** assets（即 zip），`Source code (zip/tar.gz)` 是 GitHub 页面单独渲染、不在 assets 列表里。打开浏览器 Release 页面才能看到完整 3 项。

## Common Mistakes

| 错误                           | 结果                                       | 正解                                                                |
| ------------------------------ | ------------------------------------------ | ------------------------------------------------------------------- |
| 用 `dist/*.zip`                | 匹配为空，Release 没有扩展包               | 用 `.output/*.zip`                                                  |
| 原样整段贴 CHANGELOG 当 notes  | 缺安装说明/Assets 说明，手动安装用户无指引 | 用 `templates/` 模板重组，补 TL;DR + 安装步骤                       |
| `--notes-file CHANGELOG.md`    | 整个 changelog 当 notes，历史全堆上去      | 用 node 截取当前版本段作素材，再按模板重组                          |
| 模板占位符没替换干净           | notes 里出现 `{{VERSION}}` 字样            | 发布前逐条核对模板自检清单                                          |
| 忘了 `pnpm run build` 直接 zip | zip 为空或旧产物                           | 先 build 再 zip                                                     |
| 没打 tag 就 create             | `gh` 自动建 tag 但指向当前 HEAD，可能错位  | 先在目标 commit 打 tag 并 push                                      |
| 想发 Firefox 包                | 只有 chrome                                | 另跑 `pnpm run zip:firefox`，asset 多传一个 `.output/*-firefox.zip` |
| 把 Source code 当扩展发        | 用户装不上（无编译后 assets）              | 必须上传 `.output/*.zip`                                            |

## Fire and forget（一条命令版，已通过所有校验、且 notes 已按模板重组好之后用）

```bash
VERSION=$(node -p "require('./package.json').version") && \
pnpm run build && pnpm run zip && \
ZIP=".output/octane-${VERSION}-chrome.zip" && test -s "$ZIP" && \
gh release create "v$VERSION" "$ZIP" --title "v$VERSION" --notes-file "/tmp/octane-notes-v$VERSION.md"
```
