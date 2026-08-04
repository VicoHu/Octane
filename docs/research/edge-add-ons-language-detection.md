# Edge Add-ons 商城语言识别：为什么硬编码中文被识别为英语

> 研究笔记 · 2026-08-04
> 关联：Octane 扩展提交 Edge Partner Center 审核时，listing 语言被自动识别为英语。

## 问题陈述

一个 WXT 构建的 Chrome MV3 扩展，`manifest.json` 的 `name` / `description` 是硬编码中文字符串，包内没有 `_locales/` 目录、`manifest.json` 也没有 `default_locale` 字段。提交 Edge Partner Center 审核时，商城把该扩展的 listing 语言识别为**英语**。

本笔记用**第一方文档**（Microsoft Learn、Chrome for Developers、WXT）回答：Partner Center 如何识别语言？上述配置违反了哪条契约？为什么会导致显示英语？

术语约定：

- **「官方/直接支撑」** = 第一方文档原文直接陈述该结论。
- **「推断/灰色地带」** = 由官方文字 + 观察到的 UI 现象组合得出，**不是** Microsoft 公开保证的行为，不能写进回归测试或当契约用。

## 关键结论表

| #   | 结论                                                                                                                                                | 状态 / 来源                            | 支撑原文（摘录）                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Partner Center 靠 manifest 里 `name`/`description` 的 `__MSG_xxx__` 引用 + 每个 locale 的 `messages.json` 来识别可用语言；并要求 `default_locale`。 | ✅ 官方直接支撑                        | "Partner Center uses these message references to identify available languages." [[Learn]](#1-microsoft-learn发布-microsoft-edge-扩展)                                                 |
| 2   | 要让某语言被识别，`name`/`description` 必须用 `__MSG_...__` 占位符，对应 key 必须在该 locale 的 `messages.json` 里；否则该语言**被跳过**。          | ✅ 官方直接支撑                        | "If these message references are missing, the language will be skipped." [[Learn]](#1-microsoft-learn发布-microsoft-edge-扩展)                                                        |
| 3   | 硬编码字符串（非占位符）会导致只显示一个 locale，即便包内含多种语言。                                                                               | ✅ 官方直接支撑                        | "This happens when the manifest file uses hardcoded strings instead of localized message references." [[Learn]](#1-microsoft-learn发布-microsoft-edge-扩展)                           |
| 4   | 含 `_locales` 的扩展必须声明 `default_locale`；没有 `_locales` 的扩展该字段**必须缺失**。                                                           | ✅ 官方直接支撑                        | "This field is required for localized extensions ... but must be absent in extensions that have no `_locales` directory." [[Chrome]](#3-chrome-for-developersmanifest-default_locale) |
| 5   | locale code 必须在 Chrome 支持列表内（`zh_CN`/`zh_TW`/`en` 等），否则被忽略。                                                                       | ✅ 官方直接支撑                        | "If you use an unsupported locale, Google Chrome ignores it." [[Chrome]](#2-chrome-for-developerschromei18n)                                                                          |
| 6   | 零 `_locales`、零 `default_locale`、`name`/`description` 全硬编码中文时，Partner Center **会固定回退成英语**。                                      | ⚠️ **推断 / 灰色地带**，无官方文档背书 | 见 [最关键灰色地带](#最关键灰色地带硬编码中文的唯一语言包)                                                                                                                            |
| 7   | WXT 不会从中文字符串推导 `default_locale` 或自动转成 message reference；需在 `wxt.config.ts` 显式配置，`_locales` 放 `public/`。                    | ✅ 官方直接支撑                        | "Add `default_locale` to your manifest ... `public/_locales/<locale>/messages.json`" [[WXT]](#4-wxti18n)                                                                              |

## 验证过的第一方来源

### 1. Microsoft Learn：发布 Microsoft Edge 扩展

URL：<https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension>
关键锚点章节：[If a single locale appears, but the package includes multiple languages](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension#if-a-single-locale-appears-but-the-package-includes-multiple-languages)

原文摘录（本笔记逐字核对）：

> Sometimes only one locale appears in the Store Listings tab at Partner Center, even though an extension's package includes multiple languages. This happens when the manifest file uses **hardcoded strings** instead of localized message references.

> Update your manifest.json file by replacing the name and description fields with i18n placeholders:
>
> ```json
> {
>   "manifest_version": 3,
>   "name": "__MSG_extensionName__",
>   "description": "__MSG_extensionDescription__"
> }
> ```

> Include a `default_locale` in your manifest, such as `"default_locale": "en"`.

> Make sure your `_locales` folder contains a properly structured `messages.json` file for each language. **Partner Center uses these message references to identify available languages. If these message references are missing, the language will be skipped.**

同页"Review manifest field values"章节还说明 manifest 字段在上传后只读、改 manifest 必须重传包：

> The Name field, which populates the Extension name on the Details for `<language>` page.

### 2. Chrome for Developers：`chrome.i18n`

URL：<https://developer.chrome.com/docs/extensions/reference/api/i18n>

> If an extension has a `/_locales` directory, the manifest must define `"default_locale"`.

> You can use any of the supported locales. If you use an unsupported locale, Google Chrome ignores it.

支持列表含 `en`、`en_US`、`zh_CN`、`zh_TW` 等 —— 这解释了为什么项目用下划线 `zh_CN` 而非 BCP 47 的 `zh-CN`。

> Search the messages file for the default locale.

⚠️ 注意：这一行说的是**运行时 message 查找顺序**（用户 locale → 无地区语言码 → `default_locale`），**不是** Partner Center 的商城标签策略。不能把它误引成"无 locale 包的 English fallback 规则"。

### 3. Chrome for Developers：Manifest `default_locale`

URL：<https://developer.chrome.com/docs/extensions/reference/manifest/default-locale>

> Defines the default language of an extension that supports multiple locales. It is the name of the subdirectory in `_locales` that contains the default language for this extension.

> This field is required for localized extensions (those with a `_locales` directory), but **must be absent in extensions that have no `_locales` directory**.

关键规范限定：题设的"没有 `_locales` 也没有 `default_locale`"组合对**非国际化 Chromium 扩展本身是合规的**；它只是不向 Partner Center 提供任何可枚举的语言元数据。

### 4. WXT：I18n

URL：<https://wxt.dev/guide/essentials/i18n>

> Add `default_locale` to your manifest:
>
> ```ts
> manifest: {
>   default_locale: "en";
> }
> ```
>
> Create `messages.json` files in the `public/` directory:
>
> ```text
> public/_locales/en/messages.json
> ```
>
> Optional: Add translations for extension name and description:
>
> ```ts
> manifest: {
>   name: '__MSG_extName__',
>   description: '__MSG_extDescription__',
>   default_locale: 'en',
> }
> ```

WXT 指南：[Manifest](https://wxt.dev/guide/essentials/config/manifest) —— WXT 不在源码里维护手写 `manifest.json`，而是从 `wxt.config.ts` 的 `manifest` 配置生成，产物落在 `.output/{target}/manifest.json`。所以应审构建产物，不是源目录。

## 对 Octane 的诊断

### 提交时的根因（违反的契约）

原始 `wxt.config.ts`：

```ts
manifest: {
  name: 'Octane',                                              // ❌ 硬编码，非占位符
  description: '不止存网址——...（中文）',                        // ❌ 硬编码，非占位符
  // ❌ 无 default_locale
}
```

构建出的 `.output/chrome-mv3/manifest.json` 也无 `default_locale`，且项目无 `public/_locales/`。

对照结论表 #1 / #2 / #3：Microsoft 的识别契约要求 manifest 提供结构化的 message references。Octane 的包**既不满足"已国际化"形态（无 `_locales`/`default_locale`/占位符），又是硬编码字符串**，于是 Partner Center 拿不到任何可枚举的语言元数据。

### 为什么表现为"英语"？（诚实分级）

| 部分                                                  | 证据等级                |
| ----------------------------------------------------- | ----------------------- |
| 硬编码 `name`/`description` 会导致只显示一个 locale   | ✅ Microsoft 原文直接说 |
| 这个唯一 locale 被标注成 English 的具体 fallback 算法 | ⚠️ **Microsoft 没公开** |

所以严格表述应是：**硬编码中文且无 i18n 元数据的包没给 Partner Center 提供 Microsoft 要求的 message references；UI 显示 English 这一现象的精确 fallback 规则未由第一方文档公开**（见灰色地带章节）。修复手段（下）有官方依据，但"为什么是英语"的精确机制属推断。

### 已应用的修复

已改三个文件（本笔记对应此次提交）：

```ts
// wxt.config.ts
manifest: {
  default_locale: 'zh_CN',
  name: '__MSG_extensionName__',
  description: '__MSG_extensionDescription__',
  // ...
}
```

```jsonc
// public/_locales/zh_CN/messages.json
{
  "extensionName": { "message": "Octane" },
  "extensionDescription": {
    "message": "不止存网址——给书签加上下文笔记，侧栏随当前网页自动联动；本地加密，自有云同步。"
  }
}
```

构建产物验证（`pnpm run build` 后）：

```bash
# .output/chrome-mv3/manifest.json
default_locale: zh_CN
name: __MSG_extensionName__
description: __MSG_extensionDescription__

# .output/chrome-mv3/_locales/zh_CN/messages.json  ← 已打进包
```

`zh_CN` 在 Chrome 官方支持 locale 列表内。三件齐全（占位符 + `default_locale` + 默认 locale 的 `messages.json`），符合 Microsoft Learn 的识别契约。

### 上传前检查清单（解包验证 zip，而非源码）

1. 解压 `.output/chrome-mv3.zip`，确认根目录含 `_locales/zh_CN/messages.json`（不是被嵌套进子目录）。
2. 确认 zip 内 `manifest.json` 的 `default_locale: "zh_CN"`、`name`/`description` 为 `__MSG_...__`。
3. 确认两个 message key 与 manifest 占位符**完全匹配**。Microsoft 明确：缺 message references 则语言被跳过。
4. 重新上传该 zip 到 Partner Center；manifest 字段只读、改了必须重传包。

## 最关键灰色地带：硬编码中文的唯一语言包

**有官方直接答案的：**

- 多语言包却只显示一个 locale → Microsoft 直接归因到 manifest 硬编码字符串，并给出占位符 + `default_locale` + `messages.json` 修复方案。[[Learn]](#1-microsoft-learn发布-microsoft-edge-扩展)
- 完全未国际化的扩展可以没有 `_locales`，且必须没有 `default_locale`。[[Chrome]](#3-chrome-for-developersmanifest-default_locale)

**第一方文档没说的：**

- 零 `_locales`、零 `default_locale`、`name`/`description` 全硬编码中文时，Partner Center 是否检测 Unicode 文本语言？
- 若不检测，是否必然创建名为 English 的默认 listing？显示的 "English" 标签到底是 manifest 字符串的语言分类，还是 Partner Center 无本地化时的默认 UI？
- 历史包若已显示 English，能否在 Partner Center 手工改名纠正？（文档只建议把结构化 i18n 打进新包重传）

所以 "Edge 自动识别为英语" **不能**写成已证实的文本语言识别 / fallback 机制。严格且可审计的表述是：硬编码中文 + 无 i18n 元数据的包没给 Partner Center 提供 message references；若 UI 显示 English，其精确 fallback 规则未公开。

## 残余风险

- **高（历史/待上传包）**：实际上传 zip 若仍用硬编码 `name`/`description` 且无 i18n，Partner Center 按其内容处理。须解包 zip 验证，不能从当前工作区推断已发布版本。
- **中（商城 UI 刷新）**：即使满足中文 locale 结构，Partner Center 显示/缓存可能要重新上传后才刷新；文档要求重传包，但未承诺刷新时延或缓存策略。
- **中（文档边界）**：Microsoft 只公开了"硬编码导致多语言包只显示一个 locale"的诊断；未公开零 locale 单语言包的 English fallback 算法。别当契约。
- **建议验证**：把当前构建 zip 上传到非生产草稿，记录 Store Listings 是否显示 Chinese (China) / `zh-CN`。这是验证 Partner Center 实际行为的唯一可靠方式。
