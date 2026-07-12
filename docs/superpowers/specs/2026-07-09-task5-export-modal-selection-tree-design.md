# Task5 施工设计：导出分享包 Modal + SelectionTree + buildBackupBlob 重构

- 日期：2026-07-09
- 状态：DRAFT（待用户 review）
- 分支：feature/0.1.11.3
- 范围：**仅 Task5（导出侧）**。Task6（导入预览 Modal + applyShareImport 编排）、Task7（background 消息 + useShare + SettingsModal 接入）、Task8（真机 e2e + ship）不在本 spec。
- 关联唯一真源：`~/.gstack/projects/octane/vicohu-feature-0.1.11.3-design-20260709-122114.md`（APPROVED，含完整 Premises / Cross-Model / 导出导入流程 / UI/UX Spec）。本 spec 是其 Task5 章节的**施工级落地**，不重复 design doc 已定的高层设计。

## 1. 背景与现状

0.1.11.3 部分导出/导入的逻辑层（Task1-4）已全部完成并提交：灾备回归测试网（`8209ac8`）、类型层 v3 `kind`（`0f70e8c`）、`mergeImportRaw` 单事务（`368efca`）、四大服务纯函数（`bf237b4`）。working tree clean，622 测试绿。

Task5 是 UI 层起点：让用户在 home 设置页勾选工作区/分类、选择是否含上下文，生成 `kind:'share'` 分享包并下载。

现状关键代码：

- `src/services/BackupService.ts:169` `buildBackupBlob(): Promise<Blob>` —— 无参，内部 `exportAllData()` 全量 6 表 + `kind:'backup'`。
- 2 个调用点（均无参）：`src/store/useBackup.ts:59` `exportData()`（本地导出按钮）、`src/store/useBackup.ts:87` `uploadCloudBackup()`（云上传）。
- `src/entrypoints/home/components/SettingsModal/index.tsx` —— 左 Tabs，"数据备份和同步" tab 已含 `LocalBackupSection` + `CloudBackupSection` + `FaviconCacheSection`。
- `src/components/backup/LocalBackupSection.tsx` —— 导出/导入按钮 + 弹出覆盖确认 Modal 的 section 模式（Task5 复用此模式）。

## 2. 目标与成功标准

**目标**：home 设置页"数据备份和同步" tab 内新增分享导出入口，用户勾选工作区/分类 + 上下文 checkbox，生成自洽的 `kind:'share'` 分享包下载；`buildBackupBlob` 重构为支持 `selection` 参数且**无参路径逐字节不变**。

**强成功标准**（可独立验证）：

- SC1：`buildBackupBlob()` 无参调用产出的 blob 与重构前逐字节一致（灾备网 `backup-regression.test.ts` 全绿）。
- SC2：`buildBackupBlob(selection, includeContexts)` 产出的分享包 `kind='share'`，自洽无孤儿（选 category 连带其书签；选 workspace 连带其全部分类 + pinnedTabs）。
- SC3：`includeContexts=false` → `contexts:[]` + `cryptoMetadata:null`；`includeContexts=true` → 选中书签的全部上下文（含密文）+ 发送方 `cryptoMetadata`。
- SC4：SelectionTree 勾工作区 → 其全部分类联动选中；勾部分分类 → 工作区半选态；onChange 产出正确的 `ShareSelection`（整选 workspace 进 `workspaceIds`，半选 workspace 下的选中 category 进 `categoryIds`）。
- SC5：未勾选任何节点 → 「导出分享包」按钮 disabled；导出中 → loading 防重复点；成功 → Modal 内 ✓ success（不用 Toast）。
- SC6：typecheck + 全量测试双绿。

## 3. 决策记录（已与用户确认）

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| D1 | SelectionTree 实现 | **Semi Design Tree** | 查证满足 design doc 全部要求：`multiple` + `checkRelation='related'`（父子联动+半选）+ 受控 `value`/`onChange` + `defaultExpandAll` + `renderLabel`（icon+名称+书签数）+ 自动 a11y（`role=tree`/`aria-checked`/`aria-level`，满足 design doc Pass 6）+ `virtualize`（量大时启用）。不满足才自建的回退路径无需走。 |
| D2 | 分享导出入口位置 | **"数据备份和同步" tab 内新增 `ShareSection`** | 分享本质是数据导出的一种，与本地/云备份同属"数据流动"组；design doc D4 明示"复用 LocalBackupSection 模式"；不新增一级 tab，信息架构不碎。 |
| D3 | 导出 Modal 状态管理 | **组件内 local state** | Task5 仅导出（纯前端，不走 background）；Task7 才接 `useShare` 状态机。导出动作复用现有 `exportData` 的纯前端模式（`buildBackupBlob` + 浏览器下载，不 `sendMessage`）。 |
| D4 | Semi Tree `autoMergeValue` | **默认 true（不改）** | 选 workspace 整选时 `onChange` 的 value 只含 workspace key（不含其 category keys），使 value[]→ShareSelection 转换更干净。 |

## 4. 组件结构

```
home SettingsModal
└─ "数据备份和同步" tab（TabPane itemKey="backup"）
   ├─ LocalBackupSection     （已有）
   ├─ CloudBackupSection     （已有）
   ├─ FaviconCacheSection    （已有）
   └─ ShareSection           【新增】入口
      └─ "导出分享包" Button → setVisible(true)
         └─ ShareExportModal 【新增】
            ├─ SelectionTree（选工作区/分类）
            ├─ Checkbox「包含上下文（含加密笔记）」+ salt 警告（勾选时）
            └─ 底栏：取消 + 「导出分享包」主按钮（品牌绿 #00B894）
```

### 4.1 `SelectionTree`（新组件，Semi Tree 包装）

**职责**：渲染 Workspace→Category 两级可勾选树，产出 `ShareSelection`。

**Props**：
```ts
interface SelectionTreeProps {
  /** 全量数据（用于构造 treeData + 书签数统计），由 Modal 从 store 取后传入 */
  workspaces: Workspace[];
  categories: Category[];
  bookmarks: Bookmark[];
  value: ShareSelection;          // 受控
  onChange: (sel: ShareSelection) => void;
}
```

**treeData 构造**：
- 一级节点：每个 Workspace，`key=ws.id`，`label`=renderLabel（icon + 名称 + 书签数 badge）
- 二级节点：该 Workspace 下的每个 Category，`key=cat.id`，`label`=renderLabel（icon + 名称 + 该分类书签数）

**Semi Tree 配置**：`multiple` + `checkRelation="related"` + `defaultExpandAll` + 受控 `value`/`onChange` + `renderLabel`。

**value[] → ShareSelection 转换**（核心纯函数 `treeValueToSelection(valueKeys, treeData)`）：
- 遍历 treeData：若 workspace.key ∈ valueKeys → `workspaceIds.push(ws.id)`
- 否则遍历其 category：若 cat.key ∈ valueKeys → `categoryIds.push(cat.id)`
- 依赖 `autoMergeValue=true`：整选 workspace 时 value 只含 workspace key，半选时含其部分 category key。

**反向 ShareSelection → value[]**（受控初始化）：`workspaceIds` + `categoryIds` 拼成 valueKeys（Modal 打开时默认空选）。

### 4.2 `ShareExportModal`（新组件）

**职责**：选择 + 上下文 checkbox + 导出下载 + 状态反馈。

**Props**：`{ visible: boolean; onClose: () => void; workspaces; categories; bookmarks }`

**local state**：`status: 'idle' | 'exporting' | 'success' | 'error'`、`selection: ShareSelection`、`includeContexts: boolean`（默认 false）。

**交互**：
- 上下文 checkbox 默认不勾；勾选时显示 Banner warning「含加密笔记，仅适合自己跨设备迁移（需相同主密码）」。
- 未勾选任何节点（`selection.workspaceIds` 与 `categoryIds` 均空）→ 主按钮 disabled + 灰提示「勾选至少一个工作区或分类」。
- 点「导出分享包」→ `setStatus('exporting')` → `await buildBackupBlob(selection, includeContexts)` → 下载 `octane-share-{date}.json` → `setStatus('success')`（Modal 内 ✓「已导出 N 个工作区 · M 个分类」）。
- error → Modal 内 danger 文案「导出失败，请重试」+ 重试。

**下载实现**：复用 `useBackup.exportData` 的 `URL.createObjectURL` + `a.click` + `revokeObjectURL` 模式（抽公共 helper 或直接内联）。

### 4.3 `ShareSection`（新组件）

**职责**：backup tab 内的入口区块。一个「导出分享包」Button + 简短说明 Banner（区分全量备份）。点击打开 `ShareExportModal`。

## 5. `buildBackupBlob` 重构

### 5.1 签名

```ts
export async function buildBackupBlob(
  selection?: ShareSelection,
  includeContexts?: boolean,
): Promise<Blob>
```

### 5.2 入口零变化契约（SC1）

`selection` 为 undefined/空 → 走**原逻辑**（`exportAllData()` 全量 + `kind:'backup'`），逐字节不变。现有 2 个无参调用点（`exportData` / `uploadCloudBackup`）行为不变。灾备网 `backup-regression.test.ts` 锁定此契约。

### 5.3 `buildShareData(selection, includeContexts)`（内部纯取数函数）

从 `exportAllData()` 全量 BackupData 中按 selection 精确取数，产出 `kind:'share'` 的 BackupData：

1. **规范化 selection**（导出方自洽，对称 design doc 导入步骤4）：
   - `effectiveWorkspaceIds = selection.workspaceIds`
   - `effectiveCategoryIds = selection.categoryIds ∪ (effectiveWorkspaceIds 下所有 category 的 id)`
2. **workspaces**：`effectiveWorkspaceIds` 对应的 workspace。
3. **categories**：`effectiveCategoryIds` 对应的 category。
4. **bookmarks**：`categoryId ∈ effectiveCategoryIds` 的书签。
5. **pinnedTabs**：`workspaceId ∈ effectiveWorkspaceIds` 的常驻标签（pinnedTabs 绑 workspace 不绑 category）。
6. **contexts**：
   - `includeContexts === true` → `bookmarkId ∈ 选中 bookmarks.id` 的**全部**上下文（含 `isEncrypted` 密文）。
   - 否则 → `[]`。
7. **cryptoMetadata**：`includeContexts === true` ? 发送方的 : `null`。
8. **自洽校验**（Premise 2，断言）：无孤儿——所有 category.workspaceId ∈ effectiveWorkspaceIds；所有 bookmark.categoryId ∈ effectiveCategoryIds ∧ bookmark.workspaceId ∈ effectiveWorkspaceIds；所有 context.bookmarkId ∈ 选中 bookmarks。校验失败 throw（开发期防御，正常 UI 路径不会触发）。

产出 `{ schema, version:3, kind:'share', exportedAt, appVersion, data: shareData }` → Blob。

## 6. TDD 计划（red→green）

按逻辑层 → UI 层顺序，每步独立提交（用户分步提交节奏）。

### 6.1 逻辑层：`buildBackupBlob` 重构 + `buildShareData`

测试位置：`src/services/__tests__/BackupService.test.ts`（或新建 share 取数测试，遵循 testing.md §7 `src/services/__tests__/` 惯例）。

- **SC1**：无参 `buildBackupBlob()` 与重构前逐字节一致（灾备网复验，不重复写）。
- **SC2 自洽**：选 1 workspace（含 2 category、3 bookmark、1 pinnedTab）→ 产出含全部关联实体，无孤儿。
- **SC2 跨边界**：选 1 workspace + 另一 workspace 的 1 category → effectiveCategoryIds 含整选 ws 的全部分类 + 单选 category；bookmarks 仅属这些 category。
- **SC3 不含上下文**：`includeContexts=false` → `contexts:[]`、`cryptoMetadata:null`、`kind:'share'`。
- **SC3 含上下文**：`includeContexts=true` → 选中 bookmarks 的全部 context（含加密）+ 发送方 cryptoMetadata。
- **自洽校验 throw**：构造非法 selection（category 指向未选 workspace）→ throw。

### 6.2 UI 层：`SelectionTree`

测试位置：`src/components/backup/__tests__/SelectionTree.test.tsx`。

真实渲染 Semi Tree（不 mock Semi），mock 数据来源（workspaces/categories/bookmarks 由测试构造）。

- 勾选 workspace → onChange 的 `workspaceIds` 含该 ws、`categoryIds` 不含其 category（autoMergeValue）。
- 勾选某 workspace 下部分 category → `workspaceIds` 不含该 ws、`categoryIds` 含选中 category。
- renderLabel 显示书签数。

### 6.3 UI 层：`ShareExportModal`

测试位置：`src/components/backup/__tests__/ShareExportModal.test.tsx`。

真实渲染 Semi Modal/Checkbox/Button，mock 副作用边界（`URL.createObjectURL` / `a.click` / `buildBackupBlob` 或 DB 用 fake-indexeddb）。

- 未勾选 → 「导出分享包」disabled。
- 勾选上下文 checkbox → 显示 salt 警告 Banner。
- 点导出 → 触发 `buildBackupBlob(selection, includeContexts)` + 下载 + success 态显示数量。
- exporting 态 → 按钮 loading 防重复点。

## 7. 测试规范要点（遵循 docs/standards/testing.md）

- 不整体 mock `@douyinfe/semi-ui`（真实渲染 Tree/Modal/Checkbox）；仅 Toast 等副作用用 partial mock（本 Task 大概率不需要 mock Toast，导出反馈走 Modal 内文案）。
- **不要再 `vi.mock('lottie-web')`**——`vitest.config.ts` 已全局 alias。
- query 用 `getByRole` / `getByText`；交互用 `userEvent`；断言用 jest-dom matcher（`toBeDisabled()` / `toBeInTheDocument()`）。
- 下载副作用（`URL.createObjectURL` / `a.click`）是合法的副作用边界 mock。
- 参考 `tests/spike-semi-jsdom.test.tsx`（Semi jsdom 真实渲染范本）。

## 8. UI/UX 落地依据（摘自 design doc UI/UX Spec）

- Surface：home 设置页"数据备份和同步" tab（D4）。
- 导出主按钮文案：「导出分享包」（非「导出」，区分全量备份）。
- 导出成功反馈：Modal 内 ✓「已导出 N 个工作区 · M 个分类」+ 关闭（不用 Toast）。
- 上下文 checkbox 默认不勾；勾选时 warning「含加密笔记，仅适合自己跨设备（需相同密码）」。
- DESIGN.md token：品牌绿 accent `#00B894`（主按钮 solid）、炭灰文字 `#0F172A`/`#475569`、focus ring `rgba(0,184,148,.35)`。
- a11y：Semi Tree 自动 `role=tree`/`aria-checked`；按钮 loading 时 `aria-busy`，disabled 时 `aria-disabled`。

## 9. 不在本 spec 范围（显式排除）

- 导入侧（Task6：`parseShareFile`/`validateShare` + 接收方预览 Modal + `applyShareImport` 编排）。
- background 消息 `octane:apply-share-import` + `useShare` 状态机 + SettingsModal 接入（Task7）。
- 真机 e2e + `/design-review` + ship（Task8）。
- `kind` 三层误入口防护的 UI 双向拒绝（Task6/7，解析层防护已在 Task2 `validateBackup` 落地）。

## 10. 参考与关联

- 唯一真源 design doc：`~/.gstack/projects/octane/vicohu-feature-0.1.11.3-design-20260709-122114.md`
- 灾备回归测试网：`tests/services/backup-regression.test.ts`
- 测试规范：`docs/standards/testing.md`
- DESIGN.md token 单一真源
- memory：`partial-export-share-design.md`
