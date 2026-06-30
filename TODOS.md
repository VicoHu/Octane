# TODOS

本文件记录已确认但未做的工作(带上下文,避免遗忘)。

## 0.1.6.0 — home 页「打开的标签页」视图

### 本期推迟(已实现核心,R6 性能项)
- **useOpenTabs onUpdated 事件 debounce**(autoplan Eng Review R6,MEDIUM):
  `onUpdated` 每次属性变化(标题/favicon/状态/audible)都触发全量 `chrome.tabs.query` + setState。
  活跃浏览 + 30+ tab 时可能有冗余 re-render。v1 影响有限(setState 轻量、React 批处理),
  未做以保持简单。需要时加 ~200ms debounce(cleanup 清 timer),注意 fake-timer + async query
  的测试脆弱性。相关:`src/newtab/hooks/useOpenTabs.ts`。

### 0.2.x — 战略切入点(详见 ceo-plans/2026-06-29-tab-workset-session-save.md)
- 会话保存/恢复(整组 tab 捕获为命名会话)— Workona/Toby 级杀手锏
- 多窗口作用域(`useOpenTabs` 去掉 `currentWindow:true`,按 windowId 分组)
- 三栏布局 Approach B `[Sidebar | Content | TabPanel]`(支撑拖拽)
- 拖拽收纳(tab→分类)
- 批量 triage(批量关闭、save-and-close、重复检测清理)
- 50+ tab 虚拟化/分组

## 0.1.7.0 — side panel 来源辨识 + 就地创建（autoplan 推迟项）

> 来源：autoplan CEO/Eng review（2026-06-30），用户坚持方案 C 主体，以下为推迟/已知风险。

### 已知风险（用户接受，不阻塞）
- **痛点频率未量化**：「同 hostname 跨多工作区命中」占比未统计；方案 C 的 Collapse 分组若命中率低则为过度工程。动工前可跑一次 `findBookmarksByHost` distinct workspaceId 统计验证。
- **0.2.x 可能拆改**：若 0.2.x 将 side panel 改工作区/会话作用域，全局 Collapse 分组层部分变死代码（Premise 2「匹配范围不变」是赌注）。
- **`bookmark.workspaceId` 前瞻 guard**：`updateBookmark` 类型不含 `workspaceId`。今日无跨工作区 move 流程故一致；若未来加「移动书签到其他分类」功能，需加 workspaceId 一致性不变量（或运行时以 `category.workspaceId` 反查）。

### 推迟的功能项（taste / 后续）
- **抓取当前页面选区/整页 markdown → 上下文**：双 voice 共识这是 side panel 结构性优势（喂养加密护城河），但本期就地创建先做 inline；页面抓取列后续。
- **sidepanel 加密 context 锁定后自动隐藏**：`useEncryptedContexts` 无 cryptoMetadata 订阅，本期不修，记为既有局限。
- **import channel（`octane-import`）全量刷新**：sourceMap/useHostBookmarks 均不监听，与 newtab reload 对齐留后续。
