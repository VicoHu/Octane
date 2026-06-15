# Side Panel P2 组件渲染 — 四状态 + 按书签分组

## 背景

side panel v0.1.3.3 的 **P1 critical 已完成**（纯函数 `findBookmarksByHost`/`extractHostname`、tab 联动 hook `useCurrentTabContext`、加密解锁 hook `useEncryptedContexts`、entrypoint 骨架），测试 97 passed。`App.tsx` 仍是占位（仅显示 hostname）。

P2 是 test plan 起手顺序 4（组件渲染）：接通四状态 UI + 按书签分组渲染 + 完整数据流。

本 spec 补整体 design doc（`vicohu-feature-0.1.3.2-design-20260615-201117.md`）的一处缺口：design 数据流写"遍历 bookmarks"但**未明确 bookmarks 来源**（改动清单甚至误写单参 `findBookmarksByHost(hostname)`，实际实现是双参 `findBookmarksByHost(bookmarks, hostname)`）。

## 设计决策（brainstorming 定稿）

1. **书签范围：全局匹配**。`getAll('bookmarks')` → `findBookmarksByHost(all, hostname)`。不引入 `useWorkspace` / 跨上下文同步。理由：side panel 入口语义是"当前页面"而非"某个工作区"，跨 workspace 查同 host 上下文更有用；zustand store 不跨扩展上下文共享，限定 workspace 需额外 `chrome.storage` 持久化机制（design 未规划 side panel 的 workspace 切换器）。来源信息由分类 Tag 体现。

2. **匹配数据层：抽 `useHostBookmarks(hostname)` hook**。返回 `{ matched, loading }`，独立单测。App 只编排四状态 UI。`useCurrentTabContext` 仍只管 hostname（与 checkpoint 的分层决策一致——tab hook 不承担匹配）。

3. **组件拆分：两层 `BookmarkGroup` + `ContextCard`**。`BookmarkGroup`（每个书签一个，内部调 `useEncryptedContexts`，四态切换）+ `ContextCard`（纯展示）。
   - 命名说明：用 `BookmarkGroup` 而非 `BookmarkCard`，贴合 design"按书签分组"语义，且与 newtab 已有的 `src/newtab/components/BookmarkCard/` 区分（不同 entrypoint，职责不同）。

4. **添加按钮 / CTA：P2 先占位**。点击导航到 newtab 对应页（或最小保存）。完整内联保存表单（迁 `SaveBookmarkView` 逻辑）列后续。

## 组件树 & 数据流

```
App
 ├ useCurrentTabContext()         → { hostname, loading }
 ├ useHostBookmarks(hostname)     → { matched: Bookmark[], loading }
 └ 四状态编排
     ├ StickyHeader(hostname, matchCount)
     └ matched.map(b => <BookmarkGroup bookmark={b} />)
            ├ useEncryptedContexts(b.id) → { contexts, locked, error, loading }
            └ 四态: locked 暖色卡 / loading 骨架 / error / contexts 列表
                 └ contexts.map(c => <ContextCard context={c} />)
```

数据流：`useCurrentTabContext` 取 hostname → `useHostBookmarks` 全局 `getAll` + `findBookmarksByHost` 得命中书签 → `BookmarkGroup` 每书签 `useEncryptedContexts` 解锁 gate → `ContextCard` 展示。

## App 级状态机

| 条件 | 渲染 |
|------|------|
| `tab.loading` | "加载中…" |
| `hostname === null`（非 http(s)） | "此页面不支持联动" |
| `useHostBookmarks.loading` | skeleton（D4：<300ms 不闪） |
| `matched.length === 0` | 空状态（"添加为书签" CTA + "在 Octane 管理"） |
| `matched.length > 0` | StickyHeader + BookmarkGroup[] |

## 新增 / 改动文件

- 新 `src/entrypoints/sidepanel/hooks/useHostBookmarks.ts` — `(hostname: string|null) => { matched, loading }`；hostname null 返回 [] 不调 getAll；hostname 变化重新匹配（丢弃过期结果）
- 新 `src/entrypoints/sidepanel/components/StickyHeader.tsx` — favicon + hostname + 命中数 + 添加按钮（占位）
- 新 `src/entrypoints/sidepanel/components/BookmarkGroup.tsx` — 单书签四态，内调 `useEncryptedContexts`；header（书签名 + 分类 Tag + 命中数）
- 新 `src/entrypoints/sidepanel/components/ContextCard.tsx` — 纯展示：标题 + markdown 预览 + hover 复制
- 改 `src/entrypoints/sidepanel/App.tsx` — 占位 → 四状态编排
- 改 `src/entrypoints/sidepanel/main.tsx`（或 wxt.config.ts，plan 阶段确认 WXT 机制）— `openPanelOnActionClick` 配置，让点扩展图标直达 side panel

## 测试映射（对齐 test plan 起手顺序 4）

- `hooks/__tests__/useHostBookmarks.test.ts`（unit）：hostname null → 不调 getAll、matched=[]；有值 → getAll + findBookmarksByHost 命中；hostname 变化 → 重匹配
- `components/__tests__/BookmarkGroup.test.tsx`（component）：locked → 暖色 locked 卡不渲染明文；loading → 骨架；error → 错误提示；contexts → ContextCard 列表
- **#21 分组渲染**（component，mock `useCurrentTabContext` + `useHostBookmarks`）：命中书签按书签分组渲染（书签名 + Tag + 计数）、不命中不出现、空状态渲染

## 视觉

对齐已 APPROVED 草图 `/tmp/octane-sidepanel-sketch.html`（Semi，主色 #0077FA）。四状态细节见整体 design doc"Side Panel 四状态"段。

## scope（本次）

含：四状态渲染 + 按书签分组 + 完整数据流（`useHostBookmarks`）+ `openPanelOnActionClick` 配置 + `ContextCard` 展示/复制

## 不在范围内（列后续）

- 完整"添加书签"内联保存表单（迁 `SaveBookmarkView` 逻辑）—— 本次按钮/CTA 占位
- `ContextCard` 的编辑交互（本次仅复制）
- Firefox `sidebar_action` 适配层（P3）
- BroadcastChannel 跨上下文同步（M7，P3）
- tabId→contexts 缓存（M8，P3）
- 右键菜单入口（P3）
- `@types/chrome` 类型修复（单独，10 个 TS2304）

## 关联 artifact

- 整体 design（APPROVED）：`~/.gstack/projects/octane/vicohu-feature-0.1.3.2-design-20260615-201117.md`
- test plan（15 codepath）：`vicohu-feature-0.1.3.2-test-plan-20260615-210232.md`
- memory：`side-panel-design.md`
