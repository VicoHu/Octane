# Octane 书签状态标识系统设计方案

> 状态：已评审 | 适用版本：v0.1.4.3+ | 作者：Sisyphus (AI Design Agent)

> ⚠️ **历史快照注记（2026-06-30）**：本文档记录的是 v0.1.4.3 的原始设计。其中 §8.1 / §9.3 关于 `useOpenTabs` 排序与书签跳转匹配的描述已在 **v0.1.6.0** 更新——`useOpenTabs` 改为按浏览器位置（`index`）排序（不再按 `lastAccessed` 降序），书签点击跳转改用 `matchUrl.ts` 的 `pickMostRecentMatchingTab` 显式取最近活跃。详见 CHANGELOG `[0.1.6.0]`。下文保留原设计内容作历史记录。

---

## 1. 设计背景

### 1.1 当前问题诊断

在现有 `BookmarkCard` 组件中，当书签拥有关联上下文（`contextCount > 0`）时，卡片底部会插入 `noteRow` 区域：

- **明文上下文**：显示最新上下文的标题预览
- **加密上下文**：显示 `IconLock` + `••••••••` 脱敏文案

这一设计存在以下问题：

| 问题 | 描述 |
|------|------|
| **卡片高度膨胀** | `noteRow` 额外占用 18–24px 垂直空间，导致卡片在网格中参差不齐 |
| **信息层级冲突** | 上下文预览与 `description` 共用同一视觉层级，用户难以区分“描述”与“上下文” |
| **加密感知弱** | `••••••••` 文本脱敏方式不够直觉，且与明文上下文布局混杂 |
| **扩展性差** | 底部已有 `noteRow` 占位，后续叠加“已打开 Tab”标识将严重拥挤 |

### 1.2 设计目标

1. **压缩卡片高度**：移除底部 `noteRow`，保持卡片紧凑
2. **强化上下文感知**：用图标徽章替代文字预览，一眼识别“有上下文”及加密状态
3. **预留 Tab 标识位**：为“书签有已打开 Tab”的标识预留不冲突的展示位置
4. **建立交互心智模型**：通过视觉隐喻，为后续“点击已打开 Tab 的书签 → 直接跳转 Tab”功能做铺垫

---

## 2. 设计方案

### 2.1 上下文标识：Favicon 右下角微徽章

**核心策略**：将上下文指示器从卡片正文移除，改为叠加在 **Favicon 右下角** 的微徽章。

#### 视觉示意

```
┌──────────────────────────────────┐
│ ┌────┐  书签名称                  │
│ │ G  │  github.com            ✏️ │
│ │ 🔒 │  代码托管平台          💬 │
│ └────┘                            │
└──────────────────────────────────┘
     ↑
  14px 徽章（叠加于 40×40 Favicon 区域）
```

#### 徽章状态定义

| 状态 | 徽章样式 | 说明 | Hover Tooltip |
|------|----------|------|---------------|
| **有明文上下文** | **纯色小圆点**（`var(--primary)`） | 圆点直径 8px，徽章容器 14px | "N 条上下文" |
| **有加密上下文** | **微型锁图标**（`var(--primary)`） | 10px 锁图标，徽章容器 14px | "包含加密上下文" |
| **两者皆有** | **微型锁图标优先** | 加密状态语义更重，优先展示锁 | "包含加密上下文（N 条）" |

#### 技术实现参考

```css
/* BookmarkCard/index.module.css */
.favicon {
  position: relative;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.contextBadge {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--primary);
  border: 2px solid var(--card-bg); /* 切割效果，融入卡片背景 */
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: #fff;
  z-index: 1;
}

.contextBadgeDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor; /* 继承徽章颜色 */
}
```

```tsx
{/* BookmarkCard/index.tsx — 在 favicon 容器内追加徽章 */}
<div className={styles.favicon}>
  {bookmark.faviconUrl && !faviconError ? (
    <img ... />
  ) : (
    <div className={styles.fallback}>...</div>
  )}
  {bookmark.contextCount > 0 && (
    <Tooltip content={badgeTooltip}>
      <div className={styles.contextBadge}>
        {bookmark.hasEncryptedContext ? (
          <IconLock size="extra-small" />
        ) : (
          <div className={styles.contextBadgeDot} />
        )}
      </div>
    </Tooltip>
  )}
</div>
```

#### 设计理由

- **零额外高度**：徽章完全在 Favicon 40×40 的区域内，不增加卡片整体高度
- **直觉性强**：类似消息未读角标，用户无需额外学习成本
- **安全感知强**：微型锁徽章比文字 `••••••••` 更直观地传递“加密”信息
- **Tooltip 补充信息**：悬停时展示具体数量/状态，兼顾简洁与信息完整

---

### 2.2 已打开 Tab 标识：左侧彩色竖线

**核心策略**：当书签 URL 匹配到已打开 Tab 时，在卡片 **左侧** 显示一条 3px 品牌色竖线。

#### 视觉示意

```
┌──────────────────────────────────┐
│▎┌────┐  书签名称                  │
│▎│ G  │  github.com            ✏️ │
│▎│ 🔒 │  代码托管平台          💬 │
│ └────┘                            │
└──────────────────────────────────┘
 ↑
 3px 竖线，圆角末端
```

#### 状态定义

| 状态 | 样式 | 说明 |
|------|------|------|
| **有已打开 Tab** | 左侧 3px 竖线，`background: var(--primary)` | 竖线高度约占卡片 60%，居中 |
| **无已打开 Tab** | 无竖线 | 默认状态，卡片无左侧装饰 |

#### 技术实现参考

```css
/* BookmarkCard/index.module.css */
.card {
  cursor: pointer;
  position: relative;
  overflow: hidden; /* 确保伪元素不溢出圆角 */
}

.cardHasOpenTab::before {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--primary);
  transition: transform var(--transition-normal);
}

/* 可选：点击时的脉冲反馈（后续扩展） */
@keyframes tabIndicatorPulse {
  0%   { transform: scaleY(1); }
  50%  { transform: scaleY(1.2); }
  100% { transform: scaleY(1); }
}
```

```tsx
{/* BookmarkCard/index.tsx — 动态追加 className */}
<Card
  className={`${styles.card} ${hasOpenTab ? styles.cardHasOpenTab : ''}`}
  ...
>
```

#### 设计理由

- **行业惯例**：VS Code 活动标签、Chrome 当前标签均使用左侧竖线表示“活跃/已打开”
- **空间不冲突**：竖线在左，上下文角标在右（Favicon 上），物理位置互不侵占
- **低噪音**：仅 3px 细线，不影响卡片整体视觉重心
- **交互铺垫**：用户会逐渐建立“左侧有竖线 = 这个书签已打开 = 点击可跳转”的心智模型，为后续“点击跳转 Tab”功能铺路

---

### 2.3 改造后的 BookmarkCard 结构

```
Card
├── ::before 伪元素（条件渲染：左侧 Tab 指示竖线）
├── Favicon 区域
│   ├── favicon 图片 / 首字母回退
│   └── ContextBadge（条件渲染：右下角微徽章）
├── Info 区域
│   ├── 书签名
│   ├── 域名
│   └── 描述（无上下文时展示，不再被 noteRow 挤占）
└── Actions 区域（悬停淡入）
    ├── 查看上下文
    └── 编辑书签
```

---

## 3. 方案对比

| 维度 | 当前方案（noteRow） | 新方案（角标 + 竖线） |
|------|---------------------|-----------------------|
| **垂直空间占用** | 底部额外 18–24px | **零增加** |
| **视觉噪音** | 文字预览挤占信息层级，与 `description` 冲突 | **图标徽章轻量直观** |
| **加密上下文感知** | 弱（锁图标 + `••••••••` 文字） | **强（锁徽章直觉）** |
| **Tab 标识扩展** | 底部已占满，难以叠加 | **左侧竖线天然预留** |
| **Hover 信息补充** | 无 | **Tooltip 提供数量/加密状态** |
| **网格整齐度** | 卡片高度参差不齐 | **统一紧凑** |

---

## 4. 后续扩展路径

### 4.1 Phase 1：纯视觉标识（当前设计）

- 实现 Favicon 角标 + Tab 竖线
- `onClick` 行为保持不变（`window.open(url, '_blank')`）

### 4.2 Phase 2：Tab 跳转交互（后续迭代）

当用户明确需要“点击已打开 Tab 的书签 → 直接跳转 Tab”时：

```tsx
const handleCardClick = (bookmark: Bookmark) => {
  if (bookmark.openTabId) {
    // 已打开：聚焦到对应 Tab
    chrome.tabs.update(bookmark.openTabId, { active: true });
  } else {
    // 未打开：新建标签页
    window.open(bookmark.url, '_blank');
  }
};
```

**视觉基础已打好**：
1. 用户已习惯“左侧竖线 = 可跳转”
2. 仅需在 `onClick` 中判断 `hasOpenTab`，无需新增 UI 元素

### 4.3 Phase 3：动效增强（可选）

点击已打开 Tab 的书签时，竖线可做一次轻微脉冲动效：

```css
@keyframes tabPulse {
  0%   { transform: scaleY(1); opacity: 1; }
  50%  { transform: scaleY(1.3); opacity: 0.8; }
  100% { transform: scaleY(1); opacity: 1; }
}
```

强化“跳转成功”的交互反馈。

---

## 5. 实施清单

> 实施状态见 §7.1：前 4 块（BookmarkCard 组件/样式、Content、测试）已完成；Side Panel BookmarkGroup（§5 末项，可选）未实施。

- [ ] **BookmarkCard 组件**
  - [ ] 移除 `noteRow` 及其相关样式（`notePreview`, `noteText`, `noteIcon`）
  - [ ] 在 Favicon 容器内添加 `ContextBadge` 组件
  - [ ] 支持 `hasOpenTab` prop，动态追加 `cardHasOpenTab` className
  - [ ] 更新 `aria-label`：包含上下文数量及加密状态

- [ ] **BookmarkCard 样式**
  - [ ] 新增 `.contextBadge`、`.contextBadgeDot` 样式
  - [ ] 新增 `.cardHasOpenTab::before` 伪元素样式
  - [ ] 移除 `.noteRow`、`.notePreview`、`.noteText`、`.noteIcon` 样式
  - [ ] 调整 `.description` 默认边距（无需再适配 `noteRow`）

- [ ] **Content 组件**
  - [ ] 从 `useBookmarks` 或新 hook 中获取 `openTabIds` 映射
  - [ ] 向 `BookmarkCard` 传递 `hasOpenTab` 属性

- [ ] **测试更新**
  - [ ] 更新 `BookmarkCard.test.tsx`：移除 noteRow 断言，新增徽章存在性测试
  - [ ] 新增 `hasOpenTab` 渲染测试
  - [ ] 加密上下文徽章渲染测试（替代旧脱敏文案测试）

- [ ] **Side Panel BookmarkGroup（可选）**
  - [ ] Side Panel 中的 BookmarkGroup 若也需统一风格，可将锁图标从头部的内联文本改为 Favicon 角标模式（但因 Side Panel 已展示完整上下文列表，优先级较低）

---

## 6. 参考文件

| 文件 | 说明 |
|------|------|
| `src/newtab/components/BookmarkCard/index.tsx` | 书签卡片主组件 |
| `src/newtab/components/BookmarkCard/index.module.css` | 书签卡片样式 |
| `src/newtab/components/Content/index.tsx` | 书签网格容器 |
| `src/store/useBookmarks.ts` | 书签状态管理（含 `contextPreviews`） |
| `src/shared/types/index.ts` | `Bookmark` 类型定义 |

---

*文档生成时间：2026-06-22*

---

## 7. 实现记录（2026-06-22 实施）

### 7.1 已实施范围（对应 §5 实施清单）

**全部完成**（§5 前 4 块）：
- ✅ BookmarkCard 组件：移除 noteRow + favicon 右下角徽章 + hasOpenTab prop
- ✅ BookmarkCard 样式：contextBadge / contextBadgeDot / contextBadgeIcon / cardHasOpenTab::before + 清理 noteRow 系列样式 + .card overflow:hidden
- ✅ Content 组件：接入 useOpenTabs + 传 hasOpenTab
- ✅ 测试更新：锁徽章 / 圆点徽章 / 无上下文无徽章 / hasOpenTab aria-label

**未实施**：
- ⏸ Side Panel BookmarkGroup（§5 标注优先级低，保持原样）

### 7.2 与设计的偏差（用户决策 + 实现细化）

1. **URL 匹配策略（§2.2）**：设计未定义匹配规则，实现采用用户决策的 **host + pathname 精确比较**（忽略 protocol/query/hash），非 hostname 模糊匹配。工具：`src/shared/tabs/matchUrl.ts`。**注**：该精确匹配方案后在 §9 修正为段边界前缀匹配（修复 tab 导航子路径后竖线失配）。
2. **contextPreviews 死代码清理（超出 §5 清单）**：设计只提移除 noteRow 样式，实际还清理了 `useBookmarks` 的整个 `contextPreviews` 数据层（state + loadBookmarks 批量加载段 + deleteBookmark 清理段）+ Content 的 `contextPreview` prop + BookmarkCard 的 `contextPreview` prop。遵循 CLAUDE.md「删除因修改而未使用的变量」。
3. **useOpenTabs hook 新建（§2.2 细化）**：设计只说"从 useBookmarks 或新 hook 获取"，实际新建独立 `src/newtab/hooks/useOpenTabs.ts`（挂载 query + 监听 tabs.onCreated/onUpdated/onRemoved 实时刷新），不污染 useBookmarks 职责。
4. **aria-label 分层（§5 细化）**：设计说 Card aria-label 含上下文数量，实际改为分层——Card 承载「书签名 + 已打开」，徽章 role="img" 承载「上下文数量 + 加密状态」。避免屏幕阅读器重复读。
5. **IconLock 大小**：用 className（font-size:10px）而非 size="extra-small"，与项目现有 IconLock 用法（sidepanel BookmarkGroup）一致。
6. **chrome 类型**：沿用项目 `declare const chrome: unknown` 局部断言模式（项目无 @types/chrome）。

### 7.3 验证

- ✅ vitest：38 文件 / 231 测试全绿（含新增 4 个徽章 + hasOpenTab 用例）
- ✅ wxt build：904ms 构建成功（输出 .output/chrome-mv3/）
- ⚠️ tsc --noEmit：报错均为项目既有问题（chrome 未声明、Semi Card role 属性、测试 handlers 隐式 any），本次改动**未引入新类型错误**

---

## 8. Phase 2/3 实现记录（2026-06-23 实施，issue #15）

### 8.1 Phase 2：点击已打开书签直接跳转 Tab

- **useOpenTabs 扩展**：返回 `Set<string>` → `Map<host+pathname, tabId>`，同 key 多 tab 取 `lastAccessed` 最新（最近活跃）。<!-- v0.1.6.0 已更新：useOpenTabs 改按 index 排序，「最近活跃」改由 pickMostRecentMatchingTab 显式取，见文档头部注记 -->
- **新建 focusTab helper**（`src/shared/tabs/focusTab.ts`）：`chrome.tabs.update(tabId, {active:true})`。tab 来自 currentWindow 查询，无需 windows.update。
- **Content handleCardClick**：有匹配 tab → `focusTab(tabId)`；无 → `window.open(url,'_blank')`。

### 8.2 Phase 3：跳转脉冲动效

- 点击 hasOpenTab 书签触发竖线 0.4s 脉冲（`tabPulse` keyframes）。
- `pulsing` state + setTimeout(400ms) 清除（保留 Phase 1 伪元素竖线，未改结构）。
- `prefers-reduced-motion` 下禁用动画。

### 8.3 验证

- ✅ vitest：231 测试全绿（未破坏现有用例）
- ✅ wxt build：732ms 构建成功
- ✅ tsc：零新增错误
- commit：`1a150d7`（Phase 2）、`6d1319e`（Phase 3）

---

## 9. 匹配方案修正：段边界前缀（2026-06-23，#15）

### 9.1 问题

§8.1 的实现（`Map<host+pathname, tabId>` + **精确匹配**）存在缺陷：书签 `vicohu.com` 打开后，tab 在页面内导航到 `/archives/hello-halo`，pathname 变化导致精确匹配失配，竖线消失。

### 9.2 方案演进（双轨 → 单轨）

- **office-hours 定双轨**：识别轨（站点匹配）+ 跳转轨（tabId binding via `chrome.storage.session`）。
- **plan-eng-review outside voice（Codex）推翻为单轨**，两个理由：
  1. **P0 跨窗静默失败**：`storage.session` 是扩展级、不 window-scoped，跨窗口 binding + `focusTab`（仅 `tabs.update` 不跨窗）= 窗口 B 点书签静默失败。
  2. **战略过度工程**：原始 bug 严重度低（竖线视觉不准，点击仍正常新建），双轨为「同站多书签」罕见场景引入 binding+storage+监听，违反简单优先。

### 9.3 最终实现（50 行单轨）

- **`matchUrl.ts`**：保留 `normalizeUrl`，新增 `bookmarkMatchesOpenTab(bmUrl, tabUrl)`：host 相等 + 段边界前缀（`tabPath===bmPath || tabPath.startsWith(bmPath+'/')`，`normPath` 归一末尾斜杠、根 `/`→`''`）。
- **`useOpenTabs.ts`**：返回 `Array<{url,tabId,lastAccessed}>`（替代 §8.1 的 `Map`），按 `lastAccessed` 降序——`handleCardClick` 的 `find` 取首个即最近活跃。<!-- v0.1.6.0 已更新：改为按 index 升序（浏览器 tab 栏顺序），handleCardClick 改用 pickMostRecentMatchingTab 显式取最近活跃，见文档头部注记 -->
- **`Content/index.tsx`**：`hasOpenTab` 用 `some`、`handleCardClick` 用 `find`，无 binding，未匹配走 `window.open`。

### 9.4 接受的权衡

- 根书签（path `/`）匹配同站任意页（站点根书签，开着站点任何页算）。
- 同站多书签点击退化为「聚焦最近活跃同站 tab」（场景罕见，实际等价）。

### 9.5 验证

- ✅ vitest：`matchUrl.test.ts`（15，含 `[REGRESSION]` + mutation 验证段边界）+ `useOpenTabs.test.ts`（6）；全量 252/252 pass。
- ✅ tsc：改动文件零新增错误。
- commit：`6c8ba19`（fix）、`58946a0`（release 0.1.4.3）；PR #16。
