# Release v{{VERSION}} — Octane {{TITLE_SUFFIX}}

<!--
适用场景：patch / 小版本发布，无新增功能，主要是 bug 修复或小幅改动。
填充规则同 full.md：把 {{占位符}} 和【填写要求】替换为真实内容，删除不适用的章节。
-->

> **发布日期：** {{DATE}}

## 📣 TL;DR

【填写要求：1~2 句话讲清这次发了什么、要不要升级。从 CHANGELOG 本版本段提炼。】

- 🐛 [关键修复，如有]

**升级（手动安装渠道）：** 下载下方 `octane-{{VERSION}}-chrome.zip` 解压后，在 `chrome://extensions/` 开发者模式下「加载已解压的扩展程序」。已装旧版点「重新加载」即可。

## 🐛 Bug Fixes

【填写要求：对应 CHANGELOG 本版本 `### Fixed` 段。每条关联 issue。】

- 修复了 [场景] 下 [问题]（#issue）

## 🚀 Improvements

【填写要求：对应 CHANGELOG `### Changed` 段，非新增功能但用户可感知的改动。无则删本节。】

- **[模块]**：[改进点]

## 📝 完整变更日志

[`{{PREV_VERSION}}...v{{VERSION}}`](https://github.com/{{REPO}}/compare/{{PREV_VERSION}}...v{{VERSION}}) · [CHANGELOG.md](https://github.com/{{REPO}}/blob/main/CHANGELOG.md)

## 📥 Assets

| 文件                            | 说明                       |
| ------------------------------- | -------------------------- |
| `octane-{{VERSION}}-chrome.zip` | Chrome / Edge 可加载扩展包 |
| `Source code (zip/tar.gz)`      | 源码快照，不可直接加载     |

<!--
发布前自检：
□ {{占位符}} 已替换，【填写要求】已删除
□ 升级话术与 README 一致
□ 无空章节
-->
