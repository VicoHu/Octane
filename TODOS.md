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
