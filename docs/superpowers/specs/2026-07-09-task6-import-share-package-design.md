# Task6 施工设计：导入分享包(接收方预览 + applyShareImport 编排 + background 消息)

- 日期：2026-07-09
- 状态：DRAFT（待用户 review）
- 分支：feature/0.1.11.3
- 范围：**Task6 导入侧完整闭环**——接收方选分享包文件 → 预览勾选 → background 合并导入 → 成功。含 `applyShareImport` 编排、`octane:apply-share-import` background 消息、kind UI 双向拒绝、ShareImportModal、ShareSection 导入入口。
- 排除（Task7）：`useShare` 状态机（替代 local state）、SettingsModal 细化接入。
- 关联唯一真源：`~/.gstack/projects/octane/vicohu-feature-0.1.11.3-design-20260709-122114.md`（APPROVED，导入流程步骤1-10 + UI/UX Spec 接收方预览）。本 spec 是其 Task6 章节的施工级落地。

## 1. 背景与现状

Task5（导出侧）已 ship：`buildShareData` / `buildBackupBlob(selection?, includeContexts?)` / `SelectionTree` / `ShareExportModal` / `ShareSection`（导出按钮）。逻辑层四纯函数（`remapShareIds`/`resolveNameConflicts`/`filterEncryptedBySalt`/`recomputeRedundancy`，`src/services/shareImport.ts`）+ `mergeImportRaw`（`src/shared/db/database.ts`）+ `validateBackup` 返回 `kind`（Task2）均已就绪。

Task6 让接收方能导入分享包：选文件 → 预览（数量 + 安全提示）→ 勾选 → 后台单事务合并 → 不覆盖现有数据。

现状关键代码：
- `src/services/BackupMessaging.ts:13` `handleMessage(msg)` 路由 `octane:apply-import` → `applyImport`（覆盖）。background.ts:14 顶层注册 listener。
- `src/services/BackupService.ts:143` `applyImport`（覆盖）：`replaceAllDataRaw` → `syncContextMeta` → `lock` → broadcast。Task6 的 `applyShareImport` 类似但用 `mergeImportRaw` + 不 `lock` + salt 冲突处理。
- `src/store/useBackup.ts:31` `pickFile`：`parseBackupFile` → `confirming`（pendingData）。Task6 加 kind 检查（拒绝 share 包）。
- `src/components/backup/ShareSection.tsx`：Task5 导出按钮 + ShareExportModal。Task6 加导入按钮 + ShareImportModal。
- `src/components/backup/SelectionTree.tsx`（Task5）：受控 checkable，`{workspaces, categories, bookmarks, value, onChange}`。Task6 复用，数据源换成包内 data。

## 2. 目标与成功标准

**目标**：接收方在 home 设置页选分享包文件，预览内容 + 勾选要装的工作区/分类，经 background 单事务合并导入，不覆盖现有数据；salt 冲突时过滤死密文并提示。

**强成功标准**：
- SC1：选 `kind:'share'` 文件 → 预览数量徽章（N 工作区 · M 分类 · K 书签 · [X 加密笔记]）+ 安全提示「合并到你的库，不覆盖」。
- SC2：接收方 `SelectionTree` 勾选 → 自洽补全（勾 category 连带 parent ws）→ `applyShareImport` 只装勾选的。
- SC3：ID 重映射无残留——导入后无 FK 指向发送方 ID（逻辑层 `remapShareIds` 已测，编排复用）。
- SC4：salt 冲突（接收方已设不同密码）→ 加密 context 不入库（仅明文）+ 不覆盖接收方 cryptoMetadata + 提示「X 条加密笔记未导入」。
- SC5：kind 双向拒绝——分享包走备份入口（`useBackup.pickFile`）被拒；备份包走分享入口（ShareImportModal）被拒。
- SC6：`mergeImportRaw` 单事务原子——不调 `lock()`（合并不改接收方加密设置）。
- SC7：导入按钮 loading（防重复点，合并非幂等）→ Modal 内 ✓ success（明确数量 + 关闭，不用 Toast）。
- SC8：typecheck + 全量测试双绿。

## 3. 决策记录（已与用户确认）

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| D1 | Task6 范围 | **含 background 消息（完整闭环）** | 导入是事务（`mergeImportRaw`），必须在 background service worker 跑（popup 中断风险）。ShareImportModal 触发导入需经 `octane:apply-share-import`。Task7 只接 useShare 状态机。每 plan 须产出可独立验证的可工作软件。 |
| D2 | 接收方勾选过滤 | **复用 `buildShareData`**（导出/导入共用按 selection 取子集纯函数） | DRY：导出侧（从全量取）与导入侧（从包内取）的"按 ShareSelection 过滤 ws/cat/bookmark/pin + 决策 B"逻辑同构。决策 B 对称（单选分类连带 parent ws 不连带 pin）。更新注释为"导出/导入共用"。 |
| D3 | SelectionTree | **复用 Task5 的** | 受控 checkable 已验证（Task3 + 鲁棒性测试）。数据源换成包内 data（而非 exportAllData）。 |
| D4 | cryptoMetadata 冲突 | **不提供覆盖选项**（design doc OQ5 已决策） | 接收方已有不同 salt → 过滤加密 context（仅明文）+ 不写发送方 meta + 提示。salt 相同/接收方无 meta → 写发送方 meta。 |
| D5 | kind 防护 | **复用 `parseBackupFile`（Task2 已返回 kind）+ UI 双向检查** | 不新写 parseShareFile。备份入口（pickFile）与分享入口（ShareImportModal）各自检查 kind 拒绝。 |

## 4. 文件结构与接口

### 4.1 `applyShareImport`（`src/services/BackupService.ts` 新增）

```ts
export interface ShareImportResult {
  workspaces: number;
  categories: number;
  bookmarks: number;
  /** 因接收方 salt 不同被过滤的加密 context 数 */
  skippedEncrypted: number;
}

/**
 * 合并导入分享包（接收方）。单事务 put 不 clear，不覆盖接收方现有数据。
 * 编排：buildShareData 过滤 → remapShareIds → recomputeRedundancy →
 *   resolveNameConflicts → filterEncryptedBySalt → mergeImportRaw → syncContextMeta → broadcast。
 * 不调 lock()（合并不改接收方加密设置）。
 */
export async function applyShareImport(
  data: BackupData,         // 分享包 data（kind='share'）
  selection: ShareSelection, // 接收方勾选
): Promise<ShareImportResult>
```

**编排步骤**（design doc 导入步骤5-10）：
1. 识别 mode：`data.cryptoMetadata` 非空 → `'full'`；null → `'structure'`。记 `senderSalt = data.cryptoMetadata?.salt ?? null`。
2. 接收方过滤：`const selected = buildShareData(data, selection, mode === 'full')`（复用，决策 B 对称）。`includeContexts` 仅全拷贝包带 contexts。
3. `const remapped = remapShareIds(selected)`（5 Map + 双 FK + pinnedTab 主键）。
4. `const recomputed = { ...remapped, bookmarks: recomputeRedundancy(remapped.bookmarks, remapped.contexts) }`。
5. 读接收方现有同名：`const existing = { workspaces: new Set((await getAll('workspaces')).map(w=>w.name)), categories: new Set((await getAll('categories')).map(c=>c.name)) }`。
6. `const resolved = resolveNameConflicts(recomputed, existing)`。
7. 读接收方 cryptoMetadata：`const receiverMeta = await getByKey('cryptoMetadata', 'singleton')`。
8. `const { contexts: filteredContexts, skippedEncrypted } = filterEncryptedBySalt(resolved.contexts, senderSalt, receiverMeta)`。
9. cryptoMeta 写入决策：`const cryptoMetaToWrite = (!receiverMeta || senderSalt === null || senderSalt === receiverMeta.salt) ? resolved.cryptoMetadata : undefined`（接收方无/salt 相同 → 写发送方；salt 不同 → 不写，保留接收方）。
10. `await mergeImportRaw({ ...resolved, contexts: filteredContexts }, cryptoMetaToWrite ?? undefined)`（单事务，cryptoMetaToWrite 为 null 时传 undefined 不写）。
11. syncContextMeta 兜底（非致命，try/catch）：`for (b of resolved.bookmarks) await syncContextMeta(b.id)`。
12. broadcast：`broadcastChange` 5 表 + `broadcastImport()`。**不 lock**。
13. 返回 `{ workspaces: resolved.workspaces.length, categories: resolved.categories.length, bookmarks: resolved.bookmarks.length, skippedEncrypted }`。

### 4.2 `BackupMessaging.ts`（改）

`handleMessage` 加 `octane:apply-share-import` 分支 → `applyShareImport(data.data, data.selection)`（消息携带 data + selection）。返回 `{ok:true, result}` 或 `{ok:false, error}`。

```ts
export type ShareImportMessage = {
  type: 'octane:apply-share-import';
  data: BackupData;
  selection: ShareSelection;
};
// handleMessage 内：
if (m.type === 'octane:apply-share-import') {
  try {
    const result = await applyShareImport((m as ShareImportMessage).data, (m as ShareImportMessage).selection);
    return { ok: true, result };
  } catch (e) { return { ok: false, error: ... }; }
}
```

### 4.3 `ShareImportModal`（`src/components/backup/ShareImportModal.tsx` 新建）

**Props**：`{ visible: boolean; onClose: () => void }`

**local state**：`status: 'idle' | 'parsing' | 'previewing' | 'importing' | 'success' | 'error'`、`parsedData: BackupData | null`、`selection: ShareSelection`、`result: ShareImportResult | null`、`errorMessage`。

**交互**：
- 文件选择（input type=file）→ `parseBackupFile` → kind 检查：`kind !== 'share'` → error「此为全量备份，会覆盖现有数据，请使用备份恢复」；否则 `setParsedData` + `previewing`。
- 预览：数量徽章（包内 `shareStats`）+ 安全提示「来自分享 · 合并到你的库，不覆盖现有数据」+ `SelectionTree`（包内 data）。
- 勾选 → selection。未勾选 → 导入按钮 disabled + 提示。
- 导入按钮「合并导入 N 个工作区」→ `importing`（loading）→ `browser.runtime.sendMessage({type:'octane:apply-share-import', data, selection})` → success。
- success：Modal 内 ✓「已导入 N 工作区 · M 分类 · K 书签」+（若 skippedEncrypted>0）warn「X 条加密笔记因本机加密设置不同未导入」+ 关闭。
- error：danger 文案 + 重试。

**数量统计**：复用 `shareStats`（包内 data + selection，决策 B 一致）。

### 4.4 `ShareSection`（改：加导入入口）

加「导入分享包」按钮（与导出按钮并列）+ 隐藏 file input + `ShareImportModal`。

### 4.5 `useBackup.pickFile`（改：kind 防护）

`parseBackupFile` 后检查：`r.kind === 'share'` → `set({status:'error', errorMessage:'此为分享包，请使用分享导入入口'})`（拒绝分享包走覆盖入口）。备份入口只接受 `kind='backup'`/无 kind。

## 5. TDD 计划（6 子任务）

### Task6-1：`applyShareImport` 编排（service 层 TDD）
测试 `src/services/__tests__/applyShareImport.test.ts`。fake-indexeddb（读接收方现有 + mergeImportRaw 落盘）+ mock broadcast/syncContextMeta（或真实）。
- 选 1 ws + 1 cat + 1 bookmark → 合并后接收方多这些（ID 重映射，无残留发送方 ID）。
- salt 相同 → 加密 context 入库 + cryptoMetadata 写入。
- salt 不同 → 加密 context 不入库（仅明文）+ skippedEncrypted 正确 + 不覆盖接收方 cryptoMetadata。
- 不调 lock（spy CryptoService.lock 未被调）。

### Task6-2：background 消息（BackupMessaging TDD）
测试 `src/services/__tests__/BackupMessaging.test.ts`（扩展现有）。
- `octane:apply-share-import` → 调 applyShareImport + 返回 result。
- 其他 type → undefined。

### Task6-3：kind UI 双向拒绝
- `useBackup.pickFile`（store 测试）：kind='share' → error。
- ShareImportModal（UI 测试）：kind='backup' → 拒绝提示。

### Task6-4：`ShareImportModal`（UI TDD）
真实渲染 Semi Modal/SelectionTree，mock `parseBackupFile`/sendMessage/下载无。
- 选 share 文件 → 预览数量徽章 + SelectionTree。
- 未勾选 → 导入 disabled。
- 勾选 + 导入 → sendMessage + success（含 skippedEncrypted 提示）。
- kind='backup' → 拒绝。

### Task6-5：`ShareSection` 导入入口 + 接入
ShareSection 加导入按钮 + ShareImportModal。

### Task6-6：全量 typecheck + test 双绿 + 真机验证

## 6. 测试规范（遵循 docs/standards/testing.md）

- 不 mock Semi（真实渲染 Modal/SelectionTree）；仅 mock 副作用边界（`parseBackupFile`/`sendMessage`/DB 用 fake-indexeddb/broadcast）。
- **不要再 `vi.mock('lottie-web')`**（vitest.config.ts 全局 alias）。
- query 用 `getByRole`/`getByText`；`userEvent`；jest-dom matcher。
- `applyShareImport` 编排测试用 fake-indexeddb（读接收方现有 + mergeImportRaw 落盘验证），mock `broadcastChange`/`broadcastImport`（避免跨上下文）。
- 参考 `tests/services/backup-regression.test.ts`（fake-indexeddb + vi.hoisted mock 模式）+ Task5 SelectionTree/ShareExportModal 测试。

## 7. UI/UX 落地依据（design doc UI/UX Spec 接收方预览）

- Surface：home 设置页 backup tab 的 ShareSection（与导出入口同区）。
- 信息架构：标题「导入分享包」+ 副标题灰字「来自分享 · 合并到你的库，不覆盖」→ 数量徽章组 → SelectionTree → 底栏「取消」+「合并导入 N 个工作区」主按钮（品牌绿，footer）。
- 文案：「合并导入 N 个工作区」（动态数量）/「你现有的工作区、书签不会被修改」/「X 条加密笔记未含或未导入」。
- 状态覆盖：loading（解析 spinner / 合并按钮 loading）/ empty（包无内容）/ error（文件无效 / 事务失败回滚）/ salt 冲突 warn / success ✓。
- 按钮 loading 时 `aria-busy`；SelectionTree a11y 内建。
- DESIGN.md：主按钮炭灰字（Task8 design-review 兜底，本 Task 用 solid）。

## 8. 不在本 spec 范围（Task7/8）

- `useShare` 状态机（替代 ShareImportModal/ShareExportModal 的 local state）。
- SettingsModal 细化接入（分享作为独立 tab 或 ShareSection 增强）。
- 真机 e2e + `/design-review`（主按钮炭灰字等视觉）+ ship（Task8）。

## 9. 参考与关联

- 唯一真源 design doc：`~/.gstack/projects/octane/vicohu-feature-0.1.11.3-design-20260709-122114.md`
- Task5 产出：`buildShareData`/`SelectionTree`/`shareSelection`/`ShareExportModal`/`ShareSection`
- 逻辑层：`src/services/shareImport.ts`（4 纯函数）+ `mergeImportRaw`
- 灾备网：`tests/services/backup-regression.test.ts`
- 测试规范：`docs/standards/testing.md`
- memory：`partial-export-share-design.md`
