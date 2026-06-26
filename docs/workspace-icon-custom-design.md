# Workspace / Category 图标自定义设计方案

> 状态：待实现 | 适用版本：v0.1.4.4+ | 方案：C（预设网格 + 自由输入 + Unicode 校验）

---

## 1. 设计背景

### 1.1 当前问题诊断

- `Workspace.icon: string` 与 `Category.icon: string` 字段早已存在（`src/shared/types/index.ts:5,16`），数据结构支持任意字符
- 但创建时 icon 被**硬编码**：
  - workspace → `'📁'`（`src/newtab/components/Sidebar/index.tsx:41`）
  - category → `'📂'`（`src/newtab/components/Sidebar/index.tsx:34`）
- **无任何 UI 让用户选择或修改 icon**：新建 Modal 仅有一个名称 Input（Sidebar:84-96、182-194）
- **无编辑/重命名入口**：当前只有「创建」与「删除」，workspace/category 一旦创建，名称与 icon 都无法修改

### 1.2 设计目标

1. 让用户能在**新建** workspace/category 时选择 icon
2. 让用户能**修改**已有 workspace/category 的 icon（与名称）
3. **防止用户填入非 emoji 字符**（字母、长文本、特殊符号），避免破坏视觉一致性
4. 数据模型零改动，复用现有 `icon: string` 字段
5. workspace 与 category 复用同一 `IconPicker` 组件，保证一致性

### 1.3 非目标

- 不支持图片上传（icon 始终是单字符 emoji）
- 不改 `Workspace`/`Category` 的 schema 与 IndexedDB 版本
- 不引入第三方 emoji picker 库（保持零新依赖）

---

## 2. 方案抉择记录

经 office-hours 评审，从 4 个候选方案中选定 **C**：

| 方案 | 说明 | Effort | Risk | 取舍 |
|------|------|--------|------|------|
| A 第三方 Emoji Picker | 引入 emoji-picker-react | M | Med | 体验最佳但 +40KB 依赖，与 Semi 体系并存 ❌ |
| **B 仅预设网格** | 只能从精选 emoji 选 | S | Low | 最简但无法自定义，用户找不到想要的 ❌ |
| **C 网格+输入+校验** ✅ | 精选网格 + 自由输入 + Unicode 正则校验 | M | Med | 零依赖、兼顾便捷与自由 |
| D 纯输入框+校验 | 普通输入框限长 + 正则 | S | Low | 改动最小但体验差 ❌ |

**选定理由**：C 在零新依赖前提下兼顾便捷（网格快捷选）与自由度（输入框），且 `\p{Extended_Pictographic}` 是浏览器原生支持的 Unicode 属性转义，正好满足「防止非 emoji」需求。

---

## 3. 核心设计：Emoji 校验策略

### 3.1 Unicode 属性正则

采用 ECMAScript 标准 Unicode 属性转义，无需第三方库：

```ts
// src/shared/utils/emoji.ts

/**
 * 匹配「单个 emoji 字符」。
 *
 * 使用 \p{Extended_Pictographic} 覆盖绝大多数 emoji（含多码点组合的基础码点）。
 * 允许可选的 Variation Selector-16（️）与 Zero Width Joiner（‍），
 * 以兼容组合 emoji（如 👨‍💻、🏳️‍🌈）。
 *
 * 限制：旗子（区域标志 🇨🇳）与肤色修饰（👍🏽）等多码点序列，
 * 本方案按「首码点为 Extended_Pictographic」宽松放行，不做严格序列校验。
 * 这是「防滥用」而非「严格只允许标准 emoji」的权衡（见 §6 风险）。
 */
const EMOJI_REGEX = /^\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*️?$/u;

/** 判断输入是否为合法 emoji（单字符，最多容纳一个组合序列） */
export function isEmoji(input: string): boolean {
  if (!input) return false;
  // 码点数上限 7（覆盖 👨‍💻 这类 3 码点 + VS16 的极端情况），防超长粘贴
  const codePoints = [...input];
  if (codePoints.length > 7) return false;
  return EMOJI_REGEX.test(input);
}
```

### 3.2 校验策略：宽松放行 + 长度兜底

- **网格点击**：来自预设清单，天然合法，无需校验
- **输入框**：`onChange` 时实时校验
  - 合法 → 写入 state，清空错误
  - 非法 → 不写入，显示「仅支持单个 emoji」错误提示
- **提交兜底**：`onOk` 前再校验一次；非法则回退默认 `📁` / `📂`，不阻断流程

---

## 4. 组件设计：IconPicker

### 4.1 位置与职责

```
src/shared/components/IconPicker/
  ├── index.tsx          # 组件主体
  ├── preset.ts          # 精选 emoji 清单
  └── index.module.css   # 样式（复用 Semi token，参考 docs/semi-design-spec.md）
```

放 `src/shared/` 而非 `newtab/components/`，因为 workspace/category 在 newtab 与 popup（SaveBookmarkView）都有渲染，IconPicker 供多入口复用。

### 4.2 Props

```ts
interface IconPickerProps {
  /** 当前选中的 icon */
  value: string;
  /** 选中变化回调（仅在校验通过时触发） */
  onChange: (icon: string) => void;
  /** 默认 icon，用于清空回退 */
  defaultIcon?: string;
  /** 选项尺寸，默认 'default' */
  size?: 'default' | 'small';
}
```

### 4.3 视觉结构

```
┌──────────────────────────────────────────┐
│  当前：[ 📁 ]   ← 大号预览（32px）        │
├──────────────────────────────────────────┤
│  📁 📚 💼 🛒 🎯 ⚙️ 🎨 🎬  ← 精选网格     │
│  🏠 💡 🔒 🔑 📦 🚀 🌟 ⭐  （8 列 × N 行） │
│  ...点击即选，选中态：高亮边框            │
├──────────────────────────────────────────┤
│  或输入 emoji：[ ____ ]  ← Semi Input    │
│  ⚠ 仅支持单个 emoji        ← 错误态      │
└──────────────────────────────────────────┘
```

- 网格用 CSS Grid，每格 32×32，hover/选中用 `var(--semi-color-primary)` 边框
- 输入框用 Semi `<Input>`，`maxLength={8}`（码点维度由 `isEmoji` 控制）
- 整体可内嵌在 Modal 内，无需额外 Popover 层（保持与现有 Modal 一致）

### 4.4 精选 emoji 清单（preset.ts）

按主题分组，约 32-48 个，覆盖常见 workspace 场景：

```ts
export const PRESET_ICONS = [
  // 通用容器
  '📁', '📂', '📚', '📦', '🗃️',
  // 工作/项目
  '💼', '🎯', '🚀', '⚙️', '🛠️', '📈', '💡', '🏆',
  // 创意/媒体
  '🎨', '🎬', '🎵', '📷', '✏️', '📝',
  // 科技/开发
  '💻', '🖥️', '🔧', '🔑', '🔒', '🌐', '⚡',
  // 生活/兴趣
  '🏠', '🛒', '🍳', '🎮', '⚽', '✈️', '🌍', '🌟', '⭐', '❤️',
] as const;
```

清单可后续按用户反馈增补，无需改组件逻辑。

---

## 5. 接入设计

### 5.1 新建流程改造

**「新建工作区」「新建分类」Modal**（Sidebar:84-96、182-194）：

```
┌─ 新建工作区 ──────────────────────┐
│  名称：[ ________________ ]        │
│  图标：[ IconPicker 组件    ]      │
│                                   │
│              [ 取消 ] [ 确定 ]     │
└───────────────────────────────────┘
```

- 新增 state `newWorkspaceIcon`，初值 `📁`（默认）
- Modal 内在名称 Input 下方插入 `<IconPicker value={newWorkspaceIcon} onChange={setNewWorkspaceIcon} />`
- `handleCreateWorkspace` 传入选中的 icon（替代硬编码 `'📁'`）
- category 同理，默认 `📂`

### 5.2 编辑流程（新增能力）

当前无编辑入口，需新增。**最小改动方案**：

- workspace：在 Select 下方「+ 新建工作区」按钮旁，hover workspace 项时显示「编辑」icon（`IconEdit`）
  - 或复用现有交互：点击 workspace 项 = 切换；右侧小 icon = 编辑
- category：复用现有 `List.Item` 的 `IconDelete` 位，**左侧加 `IconEdit`**
- 点击编辑 → 打开「编辑工作区/分类」Modal（复用同一表单组件，预填 name + icon）
- 提交调用 `updateWorkspace(id, { name, icon })` / `updateCategory`

**store 层补全**：
- `useWorkspace` 需新增 `updateWorkspaceLocally` / `updateCategoryLocally`（当前 store 无 update action）
- `WorkspaceService.updateWorkspace` 已存在（`src/services/WorkspaceService.ts:30`），支持 `{ name, icon, order }`
- `CategoryService.updateCategory` 需确认是否存在，不存在则补齐对称 API

### 5.3 渲染点（无需改动，仅验证）

icon 直接渲染处已用字符串拼接，自动生效：
- newtab Sidebar Select（`src/newtab/components/Sidebar/index.tsx:73`）
- popup SaveBookmarkView（`src/entrypoints/popup/views/SaveBookmarkView.tsx:150,164`）
- popup HomeView 不涉及 workspace icon

---

## 6. 边界与风险

| 风险 | 说明 | 缓解 |
|------|------|------|
| **Unicode 正则不完美** | `\p{Extended_Pictographic}` 不覆盖旗子序列（🇨🇳 是 regional indicator）与部分文字 emoji | 接受：本方案目标是「防字母/长文本滥用」，非「严格只允许标准 emoji」。旗子能放行属可接受 |
| **组合 emoji 边界** | 👨‍💻 含 ZWJ 的多码点序列 | 正则已支持 `‍` 续接，码点上限 7 兜底 |
| **历史脏数据** | 旧数据 icon 已是 `'📁'`/`'📂'`，无需迁移 | 渲染兼容任意 string，无需数据迁移 |
| **编辑入口交互冲突** | workspace 项既要点选切换又要点击编辑 | category 已有右侧 icon 模式可复用；workspace Select 需评估是否够放编辑触发（见 §8 待评估） |
| **校验绕过** | 用户通过开发者工具直接改 IndexedDB | 非目标。校验仅在 UI 输入层，存储层信任 string |

---

## 7. 实施计划（TDD）

按 CLAUDE.md 「目标驱动执行」，每步先写测试再实现：

```
1. isEmoji 工具 + 测试 → 验证：单元测试覆盖合法/非法/边界（旗子、肤色、ZWJ、空串、长串）
2. IconPicker 组件 + 测试 → 验证：渲染快照、网格点击 onChange、输入校验拒绝非法、预览同步
3. 新建 Modal 接入（workspace + category）→ 验证：创建后 DB 记录 icon 为所选值
4. 编辑 Modal + store update action → 验证：编辑后 DB 与 UI 同步更新
5. 视觉走查（dark/light）→ 验证：选中态、错误态、Modal 内布局无溢出
```

**实现阶段 skill 用法**：
- `frontend-design`：IconPicker 组件视觉与交互细节
- `ui-ux-pro-max`：编辑入口交互模式（workspace Select 如何承载编辑触发）
- `semi-ui-skills`：复用 `<Input>`、`<Modal>`、token 化样式（见 `docs/semi-design-spec.md`）

---

## 8. 待评估 / 开放问题

1. **workspace 编辑触发**：当前 workspace 用 Semi `<Select>` 切换，无 hover 编辑位。需决定：
   - (a) Select 项右侧加编辑 icon（需自定义 `renderCustomItem`）
   - (b) 改用类似 category 的 List 结构（改动较大）
   - (c) 在「+ 新建工作区」旁加一个「管理」入口打开编辑列表
2. **category update API**：需确认 `CategoryService.updateCategory` 是否存在，缺失则补齐
3. **popup 是否需要编辑能力**：popup 是轻量入口，建议编辑仅限 newtab；popup SaveBookmarkView 仅展示

---

## 9. Assignment（下一步行动）

**唯一下一步**：先回答 §8 的开放问题 1（workspace 编辑触发方式），它决定 §5.2 的实现形态。回答后即可进入实现阶段（按 §7 计划，先 `isEmoji` 工具 + 测试）。
