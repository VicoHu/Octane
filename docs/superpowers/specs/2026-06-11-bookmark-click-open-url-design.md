# 书签点击行为变更 — 打开 URL + 独立编辑按钮

## 背景

当前点击书签卡片会打开笔记编辑器（NoteEditor 侧滑面板）。用户更常见的需求是快速访问书签 URL，编辑笔记是次要操作。

## 需求

1. **卡片主体点击** → 在新 tab 页打开书签的 URL
2. **卡片右侧新增窄条编辑按钮** → 点击打开笔记编辑页（原行为）
3. 编辑按钮始终显示，无论书签是否有笔记

## 设计

### 方案：在 BookmarkCard 内部增加右侧操作区

在 `.card` 容器内，信息区（`.info`）右侧新增 `.editAction` 窄条区域，包含编辑图标。

- 卡片主体点击 → `window.open(bookmark.url, '_blank')`
- 右侧按钮点击 → `onEditNote(bookmark)`，`stopPropagation` 阻止冒泡到卡片

### 改动文件

1. **`src/newtab/components/BookmarkCard/index.tsx`**
   - 新增 `onEditNote: (bookmark: Bookmark) => void` prop
   - 卡片主体 `onClick` 改为打开 URL
   - 新增右侧 `.editAction` 区域，内含编辑图标（Semi Design `IconEdit`）
   - 按钮点击 `stopPropagation`

2. **`src/newtab/components/BookmarkCard/index.module.css`**
   - 新增 `.editAction` 样式：窄条形，~28px 宽，右边缘齐平，背景色区分卡片主体
   - hover 效果

3. **`src/newtab/components/Content/index.tsx`**
   - `handleCardClick` 改为 `window.open(bookmark.url, '_blank')`
   - 新增 `handleEditNote` 回调，设置 `selectedBookmark`（原 `handleCardClick` 行为）
   - 将 `onEditNote={handleEditNote}` 传给 `BookmarkCard`

### 视觉

- 编辑按钮：窄条形区域，~28px 宽，位于卡片右侧边缘
- 背景色：`var(--card-bg)` 或略深，与卡片主体形成视觉分区
- 图标：Semi Design `IconEdit`，居中显示
- hover：背景加深，图标高亮

## 不在范围内

- 按钮的 tooltip（后续可加）
- 无障碍优化（已有 `role="listitem"`，按钮需补充 `aria-label`）
- 右键菜单、中键点击行为
