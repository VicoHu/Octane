# Release v{{VERSION}} — Octane {{TITLE_SUFFIX}}

<!--
本模板由 octane-release skill 使用。
所有 {{占位符}} 在发版流程中由脚本/人工填写。
【填写要求：…】是「该段填什么、怎么算合格」的说明，发布前必须全部替换为真实内容或删除该段。

Octane 版本号说明：本项目用 chrome extension 4 段版本号（如 0.2.3.0），非标准 SemVer，
但项目内统一以此为准；改动是否 breaking 以 CHANGELOG 该版本的 Added/Changed/Fixed 内容为准。
-->

> **发布日期：** {{DATE}}

---

## 📣 TL;DR / 版本速览

【填写要求：2~4 条短句，给「只想扫一眼的用户」回答三件事——这次发了什么、为什么重要、要不要升级。
必须能让读者 10 秒内判断「这次跟我有没有关系」。每条不超过 1 行。
来源：优先从 CHANGELOG 本版本的 Added/Changed 段提炼，不要新造 CHANGELOG 里没有的功能。】

- ✨ [最值得提的 1~2 个新功能或改进（从 Added 提炼）]
- 🐛 [关键修复（从 Fixed 提炼，如无则删此条）]
- 📈 [可感知的体验/性能变化（如可量化给数字）]

---

## 📥 安装 / 升级（手动安装渠道）

【填写要求：GitHub Releases 是 Octane 的「手动安装渠道」，区别于 Chrome 商店 / Edge 商店。
本节必须告诉用户：① 下载哪个 zip；② 怎么加载到浏览器。话术对齐 README「安装到浏览器」一节，不要另造步骤。】
【注意：Octane 没有 Firefox 稳定分发，仅当本次明确打包了 firefox zip 时才追加 Firefox 段。】

**Chrome / Edge：**

1. 下载下方 Assets 中的 `octane-{{VERSION}}-chrome.zip` 并解压
2. 打开 `chrome://extensions/`（或 `edge://extensions/`）
3. 开启「开发者模式」
4. 点击「加载已解压的扩展程序」，选择**解压后的目录**（非 zip 文件本身）

> 💡 已安装旧版本？在扩展管理页点击已装扩展的「重新加载」按钮即可生效，无需先卸载。

---

## ✨ New Features（新功能）

【填写要求：对应 CHANGELOG 本版本的 `### Added` 段。
每个 feature：① 一句话说清价值（解决了什么问题 / 带来什么能力）；② 如有 UI 变化，附截图/GIF；
③ 不写实现细节（那是 Internal，放下方 Internal 段或省略）。
判断标准：用户无法直接感知的内部改动不放这里。】

### 1. [功能名称]

[一句话价值描述]

![截图或 GIF](#)

---

## 🚀 Improvements（改进与优化）

【填写要求：对应 CHANGELOG 本版本的 `### Changed` 段中「接口/行为对用户可见但非新增功能」的条目。
能量化就量化（启动快 X%、体积 -YKB），给数字比形容词有力。每条一行，简洁。】

- **[模块/场景]**：[改进点]，[可量化的收益]

---

## 🐛 Bug Fixes（问题修复）

【填写要求：对应 CHANGELOG 本版本的 `### Fixed` 段。只列用户可能实际遇到的 bug。
每条尽量关联 issue 编号（`#123`），无则省略编号。格式：`- 修复了 [场景] [问题]`。】

- 修复了 [场景] 下 [具体问题]

---

## 🔒 Security（安全修复）

【填写要求：**仅当本版本有安全相关修复时才保留**（CHANGELOG 的 Added/Changed/Fixed 里凡涉及加密、
权限、CSP、XSS、会话密钥、数据隔离的改动）。安全修复必须单列，不要混进 Bug Fixes。
每条：① 漏洞简述；② 是否建议立即升级；③ 修复方式概述。无安全修复整节删除。】

- **[简述]**：[影响] —— 建议立即升级。

---

## 📦 权限 / 依赖变更

【填写要求：仅当本版本 manifest 权限（`permissions` / `host_permissions`）或对用户可见的依赖发生变化时保留。
Octane 用户对「扩展又要了什么权限」敏感，新增权限**必须**在此说明用途，避免被当恶意更新。
无变更整节删除。】

- 新增 `tabGroups` 权限：用于 [用途说明]

---

## 🐞 Known Issues（已知问题）

【填写要求：坦诚列出本版本**已知但未修复**的问题。每条关联 issue 编号 + 说明是否有 workaround。
没有就整节删除。保持坦诚能显著降低 issue 区重复提问。】

- [问题描述]，临时解决办法：[workaround]（#issue）

---

## 🙏 Contributors（贡献者）

【填写要求：列出本版本贡献者 @github 用户名。单人项目可固定写作者，或省略本节。】

---

## 📝 完整变更日志

**代码差异：** [`{{PREV_VERSION}}...v{{VERSION}}`](https://github.com/{{REPO}}/compare/{{PREV_VERSION}}...v{{VERSION}})

按 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范归类（完整内容见 [CHANGELOG.md](https://github.com/{{REPO}}/blob/main/CHANGELOG.md)）：

- **Added**：[新增能力]
- **Changed**：[对现有功能的变更]
- **Fixed**：[bug 修复]
- **Internal**：[内部改进，用户不可见]

---

## 📥 Assets

| 文件                             | 说明                                                         |
| -------------------------------- | ------------------------------------------------------------ |
| `octane-{{VERSION}}-chrome.zip`  | Chrome / Edge 可加载扩展包（解压后「加载已解压的扩展程序」） |
| `Source code (zip)` / `(tar.gz)` | GitHub 自动生成的源码快照，**不可直接加载**（无编译后产物）  |

<!--
================== 发布前自检清单（逐条核对）==================
□ 所有 {{占位符}} 已替换为真实值
□ 所有【填写要求】占位说明已删除或替换为真实内容
□ 已删除不适用的空章节（无安全修复删 Security；无权限变更删权限段；无已知问题删 Known Issues）
□ TL;DR 提炼自 CHANGELOG，没有新造 CHANGELOG 未提及的功能
□ 安装步骤与 README「安装到浏览器」一致
□ 如本次有 Firefox zip，已追加 Firefox 安装段；否则未追加
□ Assets 表格里 zip 文件名与实际上传文件一致
===================================================================
-->
