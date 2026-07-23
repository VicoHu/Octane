# TODOS

本文件记录已确认但未做的工作(带上下文,避免遗忘)。

## 0.1.6.0 — home 页「打开的标签页」视图

### 本期推迟(已实现核心,R6 性能项)
- **useOpenTabs onUpdated 事件 debounce**(autoplan Eng Review R6,MEDIUM):
  `onUpdated` 每次属性变化(标题/favicon/状态/audible)都触发全量 `chrome.tabs.query` + setState。
  活跃浏览 + 30+ tab 时可能有冗余 re-render。v1 影响有限(setState 轻量、React 批处理),
  未做以保持简单。需要时加 ~200ms debounce(cleanup 清 timer),注意 fake-timer + async query
  的测试脆弱性。相关:`src/entrypoints/home/hooks/useOpenTabs.ts`。

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
  - **✓ 已在 0.1.7.1 实现**：`updateBookmark` 白名单加了 `workspaceId`；新增 `moveBookmark(id, targetWsId, targetCatId)` action，一致性由 `BookmarkOpsPanel` 级联 Select（categoriesLoader 加载目标 ws 的分类）在 UI 层保证。service 层仍无运行时 guard（信任 caller），若未来其他调用方传入 ws/cat 不一致组合需补 guard。

### 推迟的功能项（taste / 后续）
- **抓取当前页面选区/整页 markdown → 上下文**：双 voice 共识这是 side panel 结构性优势（喂养加密护城河），但本期就地创建先做 inline；页面抓取列后续。
- **sidepanel 加密 context 锁定后自动隐藏**：~~`useEncryptedContexts` 无 cryptoMetadata 订阅，本期不修，记为既有局限。~~ **✓ 已在 0.1.8.0 实现**：加密分层解锁（`UnlockSession` 分 surface gate，切断 home 联动）+ 上下文级粒度（密文未解锁渲染锁占位、明文始终可见）+ TTL（grace 失焦锁 / hardCap 硬上限）+ home lockSession 连带锁 sidepanel。
- **import channel（`octane-import`）全量刷新**：sourceMap/useHostBookmarks 均不监听，与 newtab reload 对齐留后续。

## 0.1.12 — 拖拽排序 a11y 债（V1.1，本期仅鼠标）

> 来源：plan-design-review 2026-07-14（D11），用户选「本期仅鼠标，键盘拖拽推迟 V1.1」。绑定 V1.1 跨容器拖拽（需三栏布局）一起做。设计文档：`~/.gstack/projects/octane/vicohu-master-design-20260713-191433.md`。

- **键盘拖拽**：grip 本期已是 `<button>`（为 focus/语义预留），V1.1 挂 dnd-kit keyboard sensor（空格拾起 / 方向键移动 / 回车落）。`src/entrypoints/home/components/{BookmarkCard,Sidebar,PinnedArea,ManagePanel}`。
- **announcement 中文化**：dnd-kit `accessibility.customAnnouncements` 默认英文（"item picked up"），V1.1 配置中文（"已拾起 X" / "移动到第 N 位" / "已放下"）。
- **焦点管理**：drop 后焦点回源 grip（本期未定义去向）。
- **触屏 grip 44px**：本期 grip 20×20（桌面鼠标优先），Chromebook/触屏难命中，V1.1 提到 ≥44px 或区分手势。

## App Rail 移动端适配
- **移动端展示方案**：当前 `<=760px` 隐藏 app-rail，并在 Sidebar 保留工作区 Select 与新建入口。后续需设计 app-rail 在移动端的展示、展开与触控交互，再移除该回退入口。相关：`src/entrypoints/home/components/AppRail`、`src/entrypoints/home/components/Sidebar`、`src/entrypoints/home/App.css`。

## 0.1.13.0 — AppRail 占位按钮待接线

- **搜索 / 打开标签页按钮**：AppRail 左栏「搜索」「打开标签页」按钮本期为占位（disabled，ship 前 review 发现为死按钮）。后续需接线：搜索 → 聚焦 / 打开搜索入口；打开标签页 → 对应 home「标签页」视图（0.1.6.0）或 chrome.tabs 列表。相关：`src/entrypoints/home/components/AppRail/index.tsx`。

## 待确认 — 插件 License

- **仓库 License 待确认**：仓库根暂无 LICENSE 文件。「关于」Tab 是否显示 License 项、显示何值，待确认仓库实际 License 类型后决定（可能需补 LICENSE 文件）。来源：关于 Tab + 新版本检测特性设计（2026-07-22，`docs/superpowers/specs/2026-07-22-about-tab-update-check-design.md`）。

## 工作区标签隔离 v1.1 — hide 模式（折叠·省内存 / 折叠·保状态）

> **设计文档（已定稿）**：`docs/superpowers/specs/2026-07-23-workspace-tab-isolation-v1.1-design.md` — /plan-ceo-review HOLD + codex outside voice 10 findings（2 CRITICAL + 5 MAJOR + 3 MINOR）全采纳。
> v1（close-only）已 ship **0.2.0.0**（PR#41，2026-07-23）。memory：`[[workspace-tab-isolation-design]]`（施工进度 + 测试范式）。

v1.1 = 切换行为 2 档 → 4 档（加 hide 两档）。设计核心决策：
- **title 拼 workspaceId 哈希标识**（`工作区名 ·wsId前8hex`）作 tabGroup 稳定唯一标识；去 storage 映射；C3 两路径回找（标识回找 → 兜底 restore）；ws 删除时清该 ws 标识组（孤儿组）。
- **归属语义**（codex #2）：Chrome group membership = 工作区归属；散 tab = 当前 binding ws；跨组拖拽 = 主动重分配。
- **失败状态机**（codex #5/#6）：切换前激活 pinned home；dispose/restore 失败不更新 binding；restore 返回 {opened,failed} 原子性；discard 部分失败降级 hide + token 记实际。
- **undo 入队**（codex #7）：走 per-window 串行队列 + generation token，组结构变化拒绝 undo。
- **跨档 normalize**（codex #3）：hide→close 清非当前 ws 标识组，窗口回归 close 语义。
- pinned tab（除 home）归档档下 remove 处理（Chrome 禁 pinned 入组，C4b）；incognito 不纳入。
- 相关：`src/shared/tabs/workspaceSwitch.ts`（performSwitch 加 mode 分支 + 失败状态机）/ `src/entrypoints/home/components/SettingsModal/sections/WorkspaceTabsSection.tsx`（RadioGroup 4 档）/ `src/shared/tabIsolationSetting.ts`（加 `'hide-discard'|'hide'`）/ `wxt.config.ts`（加 `tabGroups` 权限）。

### 推迟项（记此，后续评估）
- **自动归档**（Arc 式 alarms + 窗口 lastActive，跑 MV3 SW）：用户决定 v1.1 只做 hide，推迟。相关 `src/entrypoints/background.ts`（alarms 注册 + 监听）+ `src/shared/tabs/workspaceSwitch.ts`（archive 抽出 SW/home 共用 helper）。
- **同 ws 多窗 session 隔离**（TabSession key 加 windowId）：/plan-ceo-review tension 3 备选方案。v1.1 暂继承 v1「同 ws 多窗最后归档胜出」已知限制（多窗同 ws 低频）；后续据用户反馈评估是否做。

> **不在 v1.1**：lazy restore（v1.x）/ 跨设备 tab 会话备份（不做，设备本地临时）。详见 v1.1 设计文档 + v1 设计文档 NOT in scope。
