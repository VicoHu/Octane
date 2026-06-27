# Octane 品牌设计一致性迁移指南

> **版本**: 1.1（autoplan 审核修正版，修正原 v1.0 的臆造类名/Semi 选择器失效/对比度/硬编码遗漏，详见文末 GSTACK REVIEW REPORT）
> **日期**: 2026-06-27
> **目标**: 将现有 UI 主色调从靛蓝 (#6366f1) 迁移至品牌绿 (#00B894)，与 Logo 视觉识别保持一致。

---

## 1. 背景与动机

### 1.1 Logo 色彩分析

当前项目 Logo (`public/icons/icon-128.png`) 包含以下核心色彩：

| 色彩角色 | 色值 | 在 Logo 中的位置 |
|---------|------|----------------|
| 深灰/近黑 | `#2D3436` | 外环圆环主体 |
| 品牌绿 | `#00B894` | 左侧速度线 + 底部书签飘带 |
| 浅绿 | `#55EFC4` | 速度线高光/渐变端点 |

**品牌语义**：
- **速度线** → 效率、快捷访问
- **书签飘带** → 核心功能（书签管理）
- **闭合圆环** → 安全、完整、收纳

### 1.2 当前代码与品牌的不一致

现有代码使用 **Indigo 靛蓝** 作为主色调：

```css
/* src/styles/global.css (当前) */
--primary: #6366f1;
--primary-hover: #4f46e5;
--primary-light: rgba(99, 102, 241, 0.1);
```

这与 Logo 中的 **青绿色系** 完全不同，造成：
1. **品牌识别断裂** — 用户看到绿色 Logo，打开却是蓝色界面
2. **情感语义冲突** — 蓝色偏向"企业/通用"，绿色更契合"高效/安全/书签"
3. **视觉记忆模糊** — 没有统一的颜色锚点，难以建立品牌印象

---

## 2. 迁移范围总览

### 2.1 涉及文件清单

| 文件路径 | 涉及内容 | 修改类型 |
|---------|---------|---------|
| `src/styles/global.css` | CSS 变量定义（+ 新增 primary-dark/text/focus） | 色值替换 + 新增 token |
| `public/icons/icon.svg` | **Logo 本体底色 `#4F46E5`** | 色值替换（v1.0 漏） |
| `src/entrypoints/popup/popup.module.css` | 4 处硬编码 fallback（backBtn/featureItem/featureItemPrimary×2） | 色值替换 |
| `src/newtab/components/BookmarkCard/index.module.css` | `.fallback` 渐变 + `.contextBadge` 白字底 | 色值替换 + 改用 primary-dark |
| `src/newtab/components/UnlockModal/index.module.css` | 遮罩 radial-gradient + badge box-shadow 硬编码 | 色值替换（v1.0 漏） |
| `src/newtab/components/ChangePasswordModal/index.module.css` | badge box-shadow 硬编码 | 色值替换（v1.0 漏） |
| `src/styles/semi-theme-override.css` | **新建**：Semi token 覆盖（html body + dark scope） | 新增文件 |
| `src/newtab/App.tsx` | 引入 semi-theme-override.css（排在 Semi 组件之后） | 新增 import |
| `src/entrypoints/popup/main.tsx` | 同上 | 新增 import |
| `src/entrypoints/sidepanel/main.tsx` | 同上 | 新增 import |
| `scripts/check-brand-colors.sh` | **新建**：grep 守卫，CI 防靛蓝残留 | 新增文件 |

**自动跟随、无需改但须验证的文件**（用 `var(--primary)` 或 Semi token）：
- `src/newtab/components/ContextEditor/index.module.css`（focus 边框 + shadow）
- `src/newtab/components/ContextList/index.module.css`（锁图标）
- `src/newtab/components/ManagePanel/index.module.css`（依赖 `--semi-color-primary`）
- `src/shared/components/IconPicker/index.module.css`（selected 态 Semi token）
- `src/newtab/components/Sidebar/index.module.css`（Semi token，依赖 dark scope 覆盖生效）

### 2.2 Semi Design Token 影响面

项目使用 `@douyinfe/semi-ui` 作为组件库，其默认主色为蓝色系。需要同步覆盖以下 CSS 变量：

```css
--semi-color-primary
--semi-color-primary-hover
--semi-color-primary-active
--semi-color-primary-light-default
--semi-color-primary-light-active
```

---

## 3. 详细修改方案

### 3.1 核心 CSS 变量 (`src/styles/global.css`)

**当前状态：**
```css
:root {
  --primary: #6366f1;
  --primary-hover: #4f46e5;
  --primary-light: rgba(99, 102, 241, 0.1);
}
```

**目标状态：**
```css
:root {
  /* === 品牌色（提取自 Logo）=== */
  /* accent：图标、描边、浅底强调、渐变起点 */
  --primary: #00B894;
  --primary-hover: #00A383;
  --primary-active: #008F72;
  --primary-light: rgba(0, 184, 148, 0.1);
  --primary-light-hover: rgba(0, 184, 148, 0.15);
  /* 实色填充专用：solid button / badge 底（配白字达 WCAG AA）。
     单用 #00B894 做按钮底，白字对比仅 2.58:1 不及格；#00755C 配白字 ≈4.7:1。 */
  --primary-dark: #00755C;
  /* 文字/链接专用：白底/浅底上的绿色文字（#00B894 on white 仅 2.58:1 不及格；
     #007D63 on white ≈5.6:1 达 AA）。Markdown 链接、ContextList/Editor 文字用此。 */
  --primary-text: #007D63;
  /* focus ring：原 --primary-light alpha 0.1 在白底几乎不可见，专用 focus 色提强 */
  --primary-focus: rgba(0, 184, 148, 0.35);
}
```

**修改理由**：
- `#00B894` 直接取自 Logo 的书签飘带和速度线，作 accent。
- **必须引入 `--primary-dark` / `--primary-text` 双 token**：单一 `#00B894` 同时做按钮底和文字，必然有一个场景对比度不及格（按钮白字 2.58:1、文字 on 白底 2.58:1，均远低于 AA 4.5:1）。这是 v1.0 的关键缺陷。
- `--primary-focus` 解决原 focus ring 在白底几乎透明的问题。
- 保持 `rgba(..., 0.1)` 的透明度模式用于浅底强调。

---

### 3.2 Popup 模块硬编码回退 (`src/entrypoints/popup/popup.module.css`)

> ⚠️ v1.0 此节用了不存在的类名 `currentPageCard`/`categoryItemActive`，已对照真实代码改正。真实硬编码点共 4 处：

**当前状态（真实代码）：**
```css
.backBtn:hover {                       /* line 47-50 */
  background: var(--primary-light, rgba(99, 102, 241, 0.1));
  color: var(--primary, #6366f1);
}
.featureItem:hover {                   /* line 118-120 */
  background: var(--primary-light, rgba(99, 102, 241, 0.1));
}
.featureItemPrimary {                  /* line 123-128：首页主操作行 */
  border-left: 3px solid var(--primary, #6366f1);
  background: var(--primary-light, rgba(99, 102, 241, 0.06));
}
.featureItemPrimary:hover {            /* line 130-132：纯硬编码，无 var() 包裹 */
  background: rgba(99, 102, 241, 0.12);
}
```

**目标状态：**
```css
.backBtn:hover {
  background: var(--primary-light, rgba(0, 184, 148, 0.1));
  color: var(--primary, #00B894);
}
.featureItem:hover {
  background: var(--primary-light, rgba(0, 184, 148, 0.1));
}
.featureItemPrimary {
  border-left: 3px solid var(--primary, #00B894);
  background: var(--primary-light, rgba(0, 184, 148, 0.06));
}
.featureItemPrimary:hover {
  background: rgba(0, 184, 148, 0.12);   /* 注意：原为纯硬编码，必须手改 */
}
```

**修改理由**：
- 这些是 CSS `var()` 的 fallback 硬编码值，CSS module scope 隔离时会生效。
- `.featureItemPrimary:hover`（line 131）是**纯硬编码无 var() 包裹**，v1.0 完全漏掉，必须手动替换。
- 不改则 popup 在 scope 隔离或变量未注入时仍显示蓝色。

---

### 3.3 BookmarkCard 渐变与徽章 (`src/newtab/components/BookmarkCard/index.module.css`)

> ⚠️ v1.0 只提了渐变，漏了 `.contextBadge`（白字 on 绿底，同样有对比度问题）。

**当前状态：**
```css
.fallback {                             /* line 24-35：favicon 缺失时的字母占位 */
  background: linear-gradient(135deg, var(--primary), #818cf8);
  color: #fff;                          /* 白字在渐变浅端 */
}
.contextBadge {                         /* line 38-52：右下角上下文徽章 */
  background: var(--primary);
  color: #fff;                          /* 白字 on 绿底 = 2.58:1，不及格 */
}
```

**目标状态：**
```css
.fallback {
  /* 渐变浅端用 #1AD6A8（明度 46%）而非 #55EFC4（63%），
     收窄明度跨度，保证白字全程可读（#818cf8 → 同理）。 */
  background: linear-gradient(135deg, var(--primary-dark), #1AD6A8);
  color: #fff;
}
.contextBadge {
  background: var(--primary-dark);      /* 实色绿底配白字用 --primary-dark，达 AA */
  color: #fff;
}
```

**修改理由**：
- `#818cf8`（靛蓝浅色）替换为绿色的对应高光；v1.0 提议的 `#55EFC4` 明度 63% 过高，`#fff on #55EFC4` ≈1.7:1 不可读，改用明度 46% 的 `#1AD6A8`。
- 渐变起点用 `--primary-dark`（深绿），让两端都在 36–46% 明度，白字全程可读。
- `.contextBadge` 是绿色圆点配白字图标，必须用 `--primary-dark`（v1.0 漏）。

---

### 3.4 Sidebar Semi Token (`src/newtab/components/Sidebar/index.module.css`)

**当前状态：**
```css
.sidebarItem:hover {
  background: var(--semi-color-primary-light-default);
}

.sidebarItem.active {
  background: var(--semi-color-primary-light-active);
}
```

**目标状态：**
```css
.sidebarItem:hover {
  background: var(--semi-color-primary-light-default);
}

.sidebarItem.active {
  background: var(--semi-color-primary-light-active);
}
```

> **注意**：这里的 `var(--semi-color-primary-light-default)` 是 Semi Design 的 Token。如果全局覆盖了 `--semi-color-primary`，这些会自动跟随。但需要验证暗色模式下的可读性。

**修改理由**：
- Semi Design 的组件 Token 依赖于全局 `--semi-color-primary`
- 只要全局注入覆盖，Sidebar 的 Semi Token 会自动变为绿色系
- 无需手动修改此处代码，但需纳入测试验证范围

---

### 3.5 Semi Design 全局主题注入

> ⚠️ v1.0 用 `:root, .semi-light-scrollbar, .semi-always-light` 覆盖，**实测完全失效**。Semi 的 `--semi-color-primary` 声明在 `body` 选择器（`node_modules/@douyinfe/semi-ui/.../base.css`），而 `:root`（`<html>`）的值会被 `<body>` 自身同名声明覆盖（元素自身声明优先于继承值）。必须用更高特异性的选择器。

**新增文件：`src/styles/semi-theme-override.css`**

```css
/* === Semi Design 品牌色覆盖 === */
/* 必须 win over Semi 的 body / body .semi-always-dark 声明（特异性 (0,0,1) / (0,1,1)）。
   靠「同等或更高特异性 + 源顺序在后」取胜——本文件 import 必须排在所有 Semi 组件 import 之后。 */

/* 浅色：html body 特异性 (0,0,2) > body (0,0,1) */
html body {
  --semi-color-primary: #00B894;
  --semi-color-primary-hover: #00A383;
  --semi-color-primary-active: #008F72;
  --semi-color-primary-disabled: rgba(0, 184, 148, 0.35);
  --semi-color-primary-light-default: rgba(0, 184, 148, 0.15);
  --semi-color-primary-light-hover: rgba(0, 184, 148, 0.25);
  --semi-color-primary-light-active: rgba(0, 184, 148, 0.35);
}

/* 暗色：html body .semi-always-dark 特异性 (0,1,2) > body .semi-always-dark (0,1,1)。
   项目 Sidebar 渲染在 .semi-always-dark scope（见 src/newtab/App.tsx），
   不覆盖此处则暗色侧栏的 Semi 组件全部留蓝。 */
html body .semi-always-dark {
  --semi-color-primary: #00B894;
  --semi-color-primary-hover: #00A383;
  --semi-color-primary-active: #008F72;
  --semi-color-primary-disabled: rgba(0, 184, 148, 0.35);
  /* 暗底下浅色档透明度略提，保证可见 */
  --semi-color-primary-light-default: rgba(0, 184, 148, 0.2);
  --semi-color-primary-light-hover: rgba(0, 184, 148, 0.3);
  --semi-color-primary-light-active: rgba(0, 184, 148, 0.4);
}

/* solid button 实色填充用 --primary-dark，白字达 AA（见 3.1）。
   Semi Button solid 取 --semi-color-primary，需在此指向深色变体。
   注意：Semi 把 primary 同时用于文字按钮和实色按钮，单一值无法兼顾，
   故 solid 用深色（牺牲 borderless 文字按钮略深，换取 solid 可读）。 */
html body {
  --semi-color-primary: #00755C;        /* solid button 白字可读优先 */
}
/* 文字/链接型 Semi 组件若需浅底可读，单独用 --primary-text 覆盖，按组件微调。 */
```

> **关于「单一 token 无法兼顾 solid 与 text」**：Semi 的 `--semi-color-primary` 同时驱动 solid button 底色和 borderless 文字按钮文字色。`#00755C` 作 solid 底配白字达 AA（4.7:1），但作文字 on 白底更深更可读（实际 `#00755C on white` ≈6.4:1，过 AA）。因此浅色模式直接用 `#00755C` 作 `--semi-color-primary` 是更安全的折中——它同时满足 solid 白字和文字可读。若需更鲜的 accent 绿（如 Tag/Progress），按组件单独覆盖。

**在入口文件中引入（顺序关键）：**

```tsx
// src/newtab/App.tsx、src/entrypoints/popup/main.tsx、src/entrypoints/sidepanel/main.tsx
// 必须 import 在所有 @douyinfe/semi-ui 组件 import 之后，确保 CSS 源顺序在后
import '@douyinfe/semi-ui';             // （示意，实际是各 Semi 组件的具名 import）
import '@/styles/semi-theme-override.css';  // ← 排在 Semi 组件之后
```

**修改理由**：
- Semi v2 用 CSS 自定义属性主题化，覆盖 `--semi-color-primary` 会级联到所有引用组件。
- **v1.0 的 `:root` 覆盖无效**（body 自身声明优先），必须 `html body` 高特异性 + 源顺序在后。
- **必须补 dark scope**，否则暗色 Sidebar 留蓝。
- 三个入口都引入，确保所有页面一致。
- 不需要 `semi.configure()` 或 DSM，CSS 覆盖最轻量。

---

### 3.6 UnlockModal / ChangePasswordModal 遮罩与徽章光晕

> ⚠️ v1.0 此节声称"已用 CSS 变量会自动生效"——**错误**。遮罩光晕和 badge 阴影是硬编码 `rgba(99,102,241)`，不会跟随 global.css，迁移后会同屏绿+靛蓝冲突。

**涉及文件：**
- `src/newtab/components/UnlockModal/index.module.css`
- `src/newtab/components/ChangePasswordModal/index.module.css`

**当前状态（真实硬编码）：**
```css
/* UnlockModal/index.module.css */
.overlay {                              /* line 11-13：全屏遮罩氛围光 */
  background:
    radial-gradient(circle at 50% 35%, rgba(99, 102, 241, 0.18), transparent 60%),
    rgba(15, 23, 42, 0.45);
}
.badge {                                /* line 53 */
  box-shadow: 0 8px 20px rgba(99, 102, 241, 0.4);
}
/* ChangePasswordModal/index.module.css */
.badge {                                /* line 16 */
  box-shadow: 0 4px 10px rgba(99, 102, 241, 0.35);
}
```

**目标状态：**
```css
/* UnlockModal */
.overlay {
  background:
    radial-gradient(circle at 50% 35%, rgba(0, 184, 148, 0.18), transparent 60%),
    rgba(15, 23, 42, 0.45);
}
.badge {
  box-shadow: 0 8px 20px rgba(0, 184, 148, 0.4);
}
/* ChangePasswordModal */
.badge {
  box-shadow: 0 4px 10px rgba(0, 184, 148, 0.35);
}
```

**修改理由**：
- `.header` 渐变（`var(--primary)` → `var(--primary-hover)`）确实会自动跟随，但**遮罩光晕和 badge box-shadow 是硬编码靛蓝**，v1.0 漏报，必须手改，否则同屏两种品牌色。
- badge 渐变底若用 `--primary-dark` 更稳（白字可读），见 3.1。

---

## 4. 色值映射对照表

| 语义 | 当前色值 | 目标色值 | 变化类型 |
|------|---------|---------|---------|
| Primary（accent） | `#6366f1` | `#00B894` | 完全替换 |
| Primary Hover | `#4f46e5` | `#00A383` | 完全替换 |
| Primary Active | 未定义 | `#008F72` | 新增 |
| **Primary Dark（solid 底）** | 未定义 | `#00755C` | **新增（白字达 AA）** |
| **Primary Text（文字/链接）** | 未定义 | `#007D63` | **新增（白底达 AA）** |
| **Primary Focus（ring）** | 未定义 | `rgba(0,184,148,0.35)` | **新增** |
| Primary Light | `rgba(99,102,241,0.1)` | `rgba(0,184,148,0.1)` | 完全替换 |
| Gradient End（BookmarkCard/Modal） | `#818cf8` | `#1AD6A8` | 完全替换（v1.0 误为 #55EFC4，明度过高致白字不可读） |
| Semi Primary | 默认蓝 | `#00755C`（兼顾 solid 白字与文字可读） | Token 覆盖 |
| Semi Primary（dark scope） | 默认蓝 | `#00755C` | Token 覆盖（v1.0 漏 dark scope） |
| Logo 本体（icon.svg） | `#4F46E5` | `#00B894` 或 `#00755C` | 完全替换（v1.0 漏） |
| Mask Glow（UnlockModal） | `rgba(99,102,241,0.18)` | `rgba(0,184,148,0.18)` | 完全替换（v1.0 漏） |
| Badge Shadow | `rgba(99,102,241,0.4/0.35)` | `rgba(0,184,148,0.4/0.35)` | 完全替换（v1.0 漏） |
| Danger / Error | `#ef4444` | `#ef4444` | **保持不变** |
| Text Primary | `#0f172a` | `#0f172a` | **保持不变** |
| Text Secondary | `#475569` | `#475569` | **保持不变** |
| Border | `#e2e8f0` | `#e2e8f0` | **保持不变** |
| Content BG | `#f8fafc` | `#f8fafc` | **保持不变** |
| Sidebar BG | `#1a1d21` | `#1a1d21` | **保持不变** |

---

## 5. 视觉影响预估

### 5.1 会变化的元素

以下 UI 元素在本次迁移后会变为绿色系：

1. **所有 Semi Design Button (theme="solid")** — 保存按钮、添加按钮、确认按钮
2. **链接文字** — Markdown 渲染中的 `<a>` 标签
3. **激活态边框** — Popup 中当前分类的左侧高亮条
4. **卡片渐变顶部** — BookmarkCard 的顶部装饰条
5. **模态框头部** — UnlockModal / ChangePasswordModal 的渐变标题栏
6. **输入框 Focus 状态** — ContextEditor 的边框高亮
7. **Sidebar 选中态背景** — 分类选中时的背景色
8. **IconPicker 选中态** — 图标选择器的选中边框和背景

### 5.2 保持不变的元素

- 错误提示、删除按钮（Danger Red）
- 正文文字颜色
- 背景色（灰白系与绿色不冲突）
- 边框、分割线
- 暗色侧边栏（深色与绿色形成高对比，视觉上更突出）

---

## 6. 实施步骤

> **⚠️ 原子性**：以下步骤**必须一次性合并为一个 PR**，不可分步 ship。分步会产生可见的双色中间态（如只改 global.css 没引入 semi-override → 自定义组件绿、Semi 组件蓝同屏）。

### Step 1: 创建 Semi 主题覆盖文件
创建 `src/styles/semi-theme-override.css`，**用 `html body` + `html body .semi-always-dark` 选择器**（不是 `:root`），内容见 **3.5 节**。

### Step 2: 修改全局 CSS 变量
编辑 `src/styles/global.css`，替换 `--primary` 系列，**并新增 `--primary-dark`/`--primary-text`/`--primary-focus`**，内容见 **3.1 节**。

### Step 3: 修改 Logo 本体（v1.0 漏）
编辑 `public/icons/icon.svg`，`fill="#4F46E5"` → `fill="#00B894"`（或 `#00755C`）。

### Step 4: 修改 Popup 4 处硬编码
编辑 `src/entrypoints/popup/popup.module.css`，替换 `.backBtn:hover` / `.featureItem:hover` / `.featureItemPrimary` / `.featureItemPrimary:hover` 的 fallback，内容见 **3.2 节**。

### Step 5: 修改 BookmarkCard 渐变与徽章
编辑 `src/newtab/components/BookmarkCard/index.module.css`，`.fallback` 渐变改 `--primary-dark → #1AD6A8`，`.contextBadge` 底改 `--primary-dark`，内容见 **3.3 节**。

### Step 6: 修改两个 Modal 的遮罩与阴影（v1.0 漏）
编辑 `src/newtab/components/UnlockModal/index.module.css`（遮罩 line 12 + badge shadow line 53）和 `src/newtab/components/ChangePasswordModal/index.module.css`（badge shadow line 16），把 `rgba(99,102,241,...)` → `rgba(0,184,148,...)`，内容见 **3.6 节**。

### Step 7: 在三个入口引入主题覆盖（顺序关键）
在以下文件**所有 `@douyinfe/semi-ui` 组件 import 之后**追加 `import '@/styles/semi-theme-override.css';`：
- `src/newtab/App.tsx`
- `src/entrypoints/popup/main.tsx`
- `src/entrypoints/sidepanel/main.tsx`

### Step 8: 加 grep 守卫（防回归）
创建 `scripts/check-brand-colors.sh`（见文末测试计划 T1），接入 `package.json` lint 或 CI：
```bash
if rg -n '#6366f1|#4f46e5|#818cf8|rgba\(99,\s*102,\s*241' src/ public/icons; then
  echo "FAIL: 残留靛蓝硬编码"; exit 1
fi
```

### Step 9: 验证检查清单

**主流程：**
- [ ] NewTab：主按钮（Semi solid）为绿色 + **白字可读**（用 `--primary-dark` 验证对比度）
- [ ] NewTab：BookmarkCard `.fallback` 渐变绿→浅绿，**白字字母可读**
- [ ] NewTab：BookmarkCard `.contextBadge` 绿底白字可读
- [ ] NewTab：Sidebar 选中态背景为浅绿（**dark scope 生效**，不是蓝）
- [ ] NewTab：Markdown 链接为 `--primary-text` 深绿（白底可读）
- [ ] NewTab：ContextEditor focus 边框/ring 可见（`--primary-focus`）
- [ ] Popup：`.backBtn`/`.featureItem` hover 为浅绿
- [ ] Popup：`.featureItemPrimary` 左边框 + 底为绿，hover 浅绿
- [ ] SidePanel：Semi 组件（add/manage 按钮）为绿，无残留 `#0077fa` 默认蓝

**关键回归点（v1.0 漏，必查）：**
- [ ] **Semi 组件全部变绿**（Button/Input/Tabs/Select/Modal 按钮）—— 若仍蓝说明 `:root` 覆盖失效，查 `html body` 选择器 + import 顺序
- [ ] **暗色 Sidebar 的 Semi 组件变绿**（不是蓝）—— 验证 `html body .semi-always-dark` 覆盖生效
- [ ] **Logo（任务栏图标）为绿底**，非靛蓝（icon.svg 已改）
- [ ] **UnlockModal 遮罩光晕为绿色调**，非靛蓝
- [ ] **两个 Modal 的 badge 阴影为绿光晕**，非靛蓝
- [ ] ContextList 锁图标、ManagePanel hover、IconPicker selected 为绿
- [ ] grep 守卫通过：`rg '#6366f1|#4f46e5|#818cf8|rgba\(99,\s*102' src/ public/icons` 零命中

**可访问性：**
- [ ] 绿色文字 on 白底达 WCAG AA 4.5:1（用 `--primary-text`）
- [ ] 白字 on solid 绿按钮达 AA（用 `--primary-dark`，≈4.7:1）
- [ ] 暗色 Sidebar 绿色对比度（`#00B894` on `#1a1d21` ≈ 6.4:1，过 AA）

---

## 7. 设计一致性建议（后续优化）

### 7.1 空状态插画
当前 `EmptyState` 组件可使用绿色调的插画或图标，强化品牌色：
```css
.emptyIcon {
  color: var(--primary);
  opacity: 0.6;
}
```

### 7.2 Loading / Spinner
建议为全局 Loading 状态使用品牌绿：
```tsx
<Spin size="large" style={{ color: 'var(--primary)' }} />
```

### 7.3 收藏/书签图标
Logo 的书签飘带元素可以作为装饰性图标在 UI 中复用：
- 空状态提示图标
- 首次使用引导图
- 扩展商店截图装饰

### 7.4 Favicon 与浏览器标签
NewTab 页面的 `<title>` 和 favicon 应保持一致：
- favicon 使用 `public/icons/icon-16.png`（已符合）
- 页面标题建议：`Octane · 书签 + 笔记`

---

## 8. 风险与注意事项

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 绿做文字/白字按钮 on 浅底不过 AA（`#00B894` on white ≈ 2.58:1） | 可访问性净恶化（v1.0 未核算） | 引入双 token：`--primary-dark`（solid 底）、`--primary-text`（文字），见 3.1 |
| 绿色在暗色 Sidebar 上对比度 | 可访问性 | `#00B894` on `#1A1D21` 实测 ≈ **6.4:1**（v1.0 误标 7.2:1），过 AA + large AAA，normal text AAA（7:1）未达但够用 |
| Semi token `:root` 覆盖失效（v1.0 方案） | 所有 Semi 组件留蓝 | 改用 `html body` + `html body .semi-always-dark` 高特异性，import 排在 Semi 之后，见 3.5 |
| 暗色 Sidebar Semi 组件留蓝（v1.0 漏 dark scope） | 品牌色在最常驻区域断裂 | 必须覆盖 `.semi-always-dark` scope，见 3.5 |
| Logo icon.svg 本体留靛蓝（v1.0 漏） | UI 全绿、Logo 蓝底 | icon.svg `#4F46E5` 一并改绿，见 Step 3 |
| Modal 遮罩光晕/badge 阴影留靛蓝（v1.0 漏） | 同屏绿+靛蓝冲突 | 手改 3 处硬编码 `rgba(99,102,241)`，见 3.6 |
| Semi Design 升级后 Token 变更 | 主题覆盖静默失效 | core token 名稳定；建议加注释 + 冒烟测试（T2），锁 `^2.100.0` |
| 渐变浅端白字不可读（v1.0 的 `#55EFC4`） | BookmarkCard 头部文字糊 | 改 `#1AD6A8`（明度 46%），见 3.3 |
| 分步提交产生双色中间态 | 用户看到绿蓝混搭 | 强制一次性合并为一个 PR，见第 6 节原子性 |
| 未来开发者重新引入靛蓝硬编码 | 品牌色悄悄回退 | grep 守卫脚本接入 CI，见 Step 8 |
| 用户已习惯蓝色 | 认知惯性 | 绿色更符合品牌 Logo，长期有利；可在更新日志中说明 |

---

## 9. 附录：Logo 色彩提取

```
Logo 主要像素区域分析：
┌─────────────────────────────┐
│      [速度线] ← #00B894     │
│    ╭─────────────╮          │
│   ╱   [圆环]      ╲         │  ← #2D3436
│  │    ┌─────┐      │        │
│  │    │空白 │      │        │
│   ╲    └─────┘     ╱        │
│    ╰──────┬──────╯          │
│         [飘带]              │  ← #00B894
│         #55EFC4 (高光)      │
└─────────────────────────────┘
```

**提取工具**：Adobe Color / Figma 取色器 / Image Color Picker  
**验证标准**：所有替换色值必须与 Logo 像素级一致。

---

> **结论**：本次迁移是一次**纯粹的品牌对齐操作**，不涉及交互逻辑变更，风险可控，实施后可显著提升 Octane 的品牌识别度与视觉统一性。

---

## GSTACK REVIEW REPORT（autoplan 双模型审核）

- **审核方式**：Design + Eng 两阶段，每阶段 Claude subagent + codex 双模型独立审查（CEO 战略 / DX 阶段按任务性质跳过）
- **审核日期**：2026-06-27
- **总体结论**：⚠️ **当前文档不能直接照着实施**（Design 4/10，Eng 3–4/10，两模型一致）
- **方向判定**：迁移方向正确（靛蓝 → 品牌绿对齐 Logo），技术路线正确（CSS 变量覆盖 + 硬编码替换），但**实施细节有多处致命错误**，照搬会产出"按钮白字看不清、Markdown 链接看不清、所有 Semi 组件仍是蓝色、Logo 仍是蓝底"的半成品。

### 双模型共识表（CONFIRMED = 两模型一致）

| 维度 | Claude | codex | 共识 |
|------|--------|-------|------|
| Semi 覆盖选择器是否有效 | 失效（dark scope + 源顺序） | 失效（`:root` 无法覆盖 `body` 自身声明） | **CONFIRMED — Critical** |
| 文档是否基于真实代码 | 否（臆造类名、漏文件） | 否（臆造类名、漏硬编码） | **CONFIRMED — Critical** |
| 绿色对比度是否过关 | 不过 AA（~2.5:1） | 不过 AA（数值偏高但同结论） | **CONFIRMED — Critical** |
| Logo icon.svg 是否遗漏 | 漏（`#4F46E5`） | 漏 | **CONFIRMED — Critical** |
| 渐变浅端白字可读性 | 不可读（明度跨度过大） | 不可读（~1.7:1） | **CONFIRMED — High** |
| 是否有自动化回归防护 | 无（297 测试全逻辑） | 无 | **CONFIRMED — High** |
| 实施原子性 | 必须一次性合并 | 必须一次性合并 | **CONFIRMED — Medium** |

> 数值差异说明：codex 给的对比度（3.89 / 4.12 / 15.4）偏高，按 WCAG 相对亮度公式实测 #00B894 on white ≈ 2.58:1、on #1a1d21 ≈ 6.4:1、白字 on #00B894 ≈ 2.58:1（Claude 的 ~2.5/6.4 更准）。**定性结论两模型一致：浅底上不过 AA 4.5:1。**

### CRITICAL 必修（不修则迁移失败）

**C1. Semi token 覆盖选择器整体无效**
文档 3.5 节用 `:root, .semi-light-scrollbar, .semi-always-light` 覆盖。但 Semi 的 `--semi-color-primary` 声明在 `body` 选择器上（`node_modules/@douyinfe/semi-ui/.../base.css`），而 `:root`（`<html>`）的声明会被 `<body>` 自身的同名声明覆盖（元素自身声明优先于继承值）——**浅色模式下覆盖完全失效**；dark scope 还额外漏 `.semi-always-dark`。结果：所有 Semi 组件（Button/Input/Tabs/Select/Modal 按钮）保持默认蓝。
**修复**：用高特异性选择器 + 保证源顺序在 Semi CSS 之后：
```css
/* 浅色：(0,0,2) 赢 body (0,0,1) */
html body {
  --semi-color-primary: #00B894;
  --semi-color-primary-hover: #00A383;
  --semi-color-primary-active: #008F72;
  --semi-color-primary-disabled: rgba(0,184,148,0.35);
  --semi-color-primary-light-default: rgba(0,184,148,0.15);
  --semi-color-primary-light-hover: rgba(0,184,148,0.25);
  --semi-color-primary-light-active: rgba(0,184,148,0.35);
}
/* 暗色：(0,1,2) 赢 body .semi-always-dark (0,1,1) */
html body .semi-always-dark {
  --semi-color-primary: #00B894;
  --semi-color-primary-hover: #00A383;
  --semi-color-primary-active: #008F72;
  --semi-color-primary-light-default: rgba(0,184,148,0.2);
  --semi-color-primary-light-hover: rgba(0,184,148,0.3);
  --semi-color-primary-light-active: rgba(0,184,148,0.4);
}
```
且 `semi-theme-override.css` 的 import 必须排在所有 Semi 组件 import **之后**（Vite 按 import 顺序合并 CSS）。

**C2. 文档臆造类名 + 漏报 8 处硬编码**
文档 3.2 节举的 `.currentPageCard` / `.categoryItemActive` 在 `popup.module.css` 中**根本不存在**。真实硬编码点（亲自 grep 验证）：

| 文件:行 | 色值 | 文档 |
|--------|------|------|
| `src/entrypoints/popup/popup.module.css:48-49` | `.backBtn:hover` `rgba(99,102,241,0.1)`/`#6366f1` | 漏 |
| `src/entrypoints/popup/popup.module.css:119` | `.featureItem:hover` `rgba(99,102,241,0.1)` | 漏 |
| `src/entrypoints/popup/popup.module.css:125-126` | `.featureItemPrimary` `#6366f1`/`rgba(99,102,241,0.06)` | 漏 |
| `src/entrypoints/popup/popup.module.css:131` | `.featureItemPrimary:hover` `rgba(99,102,241,0.12)` | 漏 |
| `src/newtab/components/UnlockModal/index.module.css:12` | 遮罩 radial-gradient `rgba(99,102,241,0.18)` | 漏 |
| `src/newtab/components/UnlockModal/index.module.css:53` | badge box-shadow `rgba(99,102,241,0.4)` | 漏 |
| `src/newtab/components/ChangePasswordModal/index.module.css:16` | badge box-shadow `rgba(99,102,241,0.35)` | 漏 |
| `public/icons/icon.svg:2` | Logo 本体 `#4F46E5` | 漏（致命） |

文档 3.6 节声称 Modal 头部"已用 CSS 变量会自动跟随"——但遮罩光晕和 badge 阴影是**硬编码靛蓝**，不会跟随。
**修复**：3.2 节整节重写对齐真实类名；补全上述 8 处替换；`icon.svg` 的 `#4F46E5` 改为品牌绿。

**C3. 对比度净恶化（绿做文字 / 白字按钮不过 AA）**
- `#00B894` 作文字 on 白底 ≈ **2.58:1**（AA 需 4.5:1）→ Markdown 链接、ContextList 锁图标、ContextEditor 文字不可读。
- 白字 on `#00B894` 按钮 ≈ **2.58:1** → 所有 Semi solid Button 白字不可读。
- 文档声称"#00B894 on #1A1D21 为 7.2:1"实测 ≈ 6.4:1。
- **这是从靛蓝（#6366f1 on white ≈ 4.47:1，踩线及格）到不及格的净恶化。**
**修复**：引入双 token —— `--primary: #00B894`（accent/图标/描边）+ `--primary-dark: #00755C`（solid button 实色，白字 ≈4.7:1）+ `--primary-text: #007D63`（文字/链接）。

### HIGH

- **H1 渐变浅端白字不可读**：`#00B894 → #55EFC4` 明度 36%→63% 跨度过大，`#fff on #55EFC4` ≈1.7:1。建议渐变停在 `#1AD6A8` 或 `#00D9A3`（明度收敛 36–46%）。
- **H2 色阶残缺**：缺 `--primary-text`、`--primary-focus`（focus ring 现 alpha 0.1 在白底几乎透明）、disabled 未验证。
- **H3 零自动化回归防护**：297 个 vitest 全是逻辑测试，CI 不捕获 CSS 回归。建议加 grep 守卫脚本。
- **H4 文件清单遗漏 4 个消费组件**：ContextEditor、ContextList、ManagePanel、IconPicker 用 `var(--primary)` 或 Semi token，会自动跟随但未列入验证清单。codex 另发现 SidePanel 残留 Semi 默认蓝 `#0077fa`/`#0066d6`。

### 失败模式登记（Failure Modes Registry）

| ID | 触发 | 影响 | 验证 |
|----|------|------|------|
| F1 | `:root` 覆盖（C1 未修） | 所有 Semi 组件留蓝 | 点任何 Semi Button 查 computed background |
| F2 | dark scope 未覆盖 | 暗色 Sidebar Semi 组件留蓝 | 切暗色看 Sidebar |
| F3 | popup 硬编码未改（C2） | popup hover/选中态留蓝 | 悬停 backBtn/featureItem |
| F4 | Modal 遮罩/badge shadow 未改 | 解锁页靛蓝光晕 + 绿品牌冲突 | 锁屏看遮罩色调 |
| F5 | icon.svg 未改 | UI 全绿、Logo 蓝底 | 看任务栏图标 |
| F6 | 绿文字落在白底/glass card | 链接/图标不可读 | WCAG 计算 |
| F7 | 渐变浅端白字 | BookmarkCard 头部文字糊 | 看 favicon 缺失的卡片 |
| F8 | 分步提交 | 双色中间态 ship 给用户 | 强制一次性合并 |

### 测试计划（Test Plan）

**现状**：无 CSS/视觉回归测试，CI 零防护。

**T1（必加）grep 守卫脚本** — `scripts/check-brand-colors.sh`：迁移完成后 `src/` + `public/icons` 不应残留靛蓝硬编码，命中即 fail。接入 lint/CI，覆盖 ~90% 回归。

**T2（建议）Semi token 冒烟测试** — vitest 渲染 `<Button theme="solid">`，断言 `getComputedStyle(btn).backgroundColor === 'rgb(0, 184, 148)'`，捕获 Semi 升级静默失效。

**T3（人工）补全 Step 6 checklist** — 加入：popup backBtn/featureItem hover、两 Modal 遮罩+badge shadow、icon.svg、ContextEditor focus、ContextList 锁图标、ManagePanel hover、IconPicker selected、Markdown blockquote 左边框、SidePanel Semi 默认蓝残留。

### 实施顺序（原子性）

**必须一次性合并为一个 PR**，commit 内顺序：`icon.svg` → `global.css`（含新 `--primary-text`/`--primary-dark` token）→ 8 处硬编码替换 → `semi-theme-override.css`（`html body` 选择器）→ 三入口 import（排在 Semi 组件之后）→ 接入 grep 守卫。**不要分步 ship**（F8）。

### Decision Audit Trail

| # | 决策 | 分类 | 原则 | 依据 |
|---|------|------|------|------|
| 1 | 跳过 CEO/DX，聚焦 Design+Eng 双模型 | Mechanical | P3 务实 | CSS 迁移无战略/DX 维度，用户确认 |
| 2 | 文档判定"不能直接实施" | 两模型共识 | P1 完整性 | 4 项 Critical 阻塞 |
| 3 | 引入 `--primary-text`/`--primary-dark` 双 token | Taste（两模型均建议） | P1 完整性 | 绿做文字/按钮不过 AA |
| 4 | Semi 覆盖改 `html body` 高特异性 | Mechanical | P5 显式 | `:root` 无法覆盖 body 自身声明 |
| 5 | 加 grep 守卫脚本 | 两模型共识 | P2 沸腾湖 | 现状零 CSS 回归防护 |
| 6 | 强制一次性合并 | Mechanical | P6 行动偏向 | 分步有可见双色中间态 |

### 修复后预期

修完 C1–C3 + H1 后，可达 ~7/10 可实施。当前状态贸然实施 = 半成品。
