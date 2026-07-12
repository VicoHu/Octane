# Task7 useShare 状态机 Design Spec

> 0.1.11.3 部分导出/导入 — Task7。Task5（导出）+ Task6（导入）已用 Modal local state 实现并 ship/全量双绿。Task7 把两 Modal 的 local state 提取到统一 useShare store（与 useBackup 模式一致），功能/行为不变。

## Goal

把 `ShareExportModal` / `ShareImportModal` 的 local state（structure/selection/status/result 等）提取到新建的 `src/store/useShare.ts`（zustand），与 useBackup「一个 store 含多流程」的模式统一。功能/行为不变，提升架构一致性与可测试性。

## 背景

- Task5 ShareExportModal：`useState(structure / selection / includeContexts / status)`。
- Task6 ShareImportModal：`useState(data / selection / result / errorMessage / status)`。
- 两个 Modal 各自 local state，与 useBackup（覆盖导入/导出的集中 store）模式不一致。
- design doc（0.1.11.3 唯一真源）步骤7 = useShare 状态机；line 163 留「useBackup vs 新增 useShare」未决 → **本 Task 决策新建 useShare**（分享域独立于灾备 useBackup，职责清晰，不污染灾备管道）。

## Architecture

### 边界
- 新建 `src/store/useShare.ts`：分享导出 + 导入两套独立状态（一个 store，两套字段，不合并 union）。
- `ShareExportModal` / `ShareImportModal`：消费 useShare selector，**移除 `useState`**。
- `ShareSection` / `SettingsModal` / `useBackup`：**不变**（入口零变化）。

### 为何一个 store（含 export+import 两套字段）而非两个 store
- 与 useBackup 一个 store 含 `exportData` + `pickFile`/`confirmImport` 多流程一致。
- 分享导出/导入同属「分享」域，一个 store 聚合。
- 两套字段独立（exportSelection / importSelection 不混），各自 reset，无交叉污染。

### 为何不用 discriminated union
- 两状态机字段差异大（export: structure/includeContexts；import: data/result/errorMessage），union 类型复杂化、收益低。独立字段 + 各自 status 更简单可读。

## state shape

```typescript
import type { BackupData, Bookmark, Category, ShareSelection, Workspace } from '@/shared/types';
import type { ShareImportResult } from '@/services/BackupService';

type ExportStatus = 'idle' | 'loading' | 'exporting' | 'success' | 'error';
type ImportStatus = 'idle' | 'parsing' | 'previewing' | 'importing' | 'success' | 'error';

interface ExportStructure {
  workspaces: Workspace[];
  categories: Category[];
  bookmarks: Bookmark[];
}

interface ShareState {
  // 导出侧
  exportStatus: ExportStatus;
  exportStructure: ExportStructure | null;
  exportSelection: ShareSelection;
  includeContexts: boolean;
  // 导入侧
  importStatus: ImportStatus;
  importData: BackupData | null;
  importSelection: ShareSelection;
  importResult: ShareImportResult | null;
  importError: string | null;
  // actions
  openExport: () => Promise<void>;
  setExportSelection: (sel: ShareSelection) => void;
  toggleIncludeContexts: (v: boolean) => void;
  runExport: () => Promise<void>;
  pickImportFile: (file: File) => Promise<void>;
  setImportSelection: (sel: ShareSelection) => void;
  runImport: () => Promise<void>;
  resetExport: () => void;
  resetImport: () => void;
}
```

## actions 语义

### 导出
- `openExport()`：reset export 字段 → `exportStatus='loading'` → `exportAllData()` 取 structure → `exportStatus='idle'`（待用户勾选）。失败 → 'error'。
- `setExportSelection(sel)`：set exportSelection。
- `toggleIncludeContexts(v)`：set includeContexts。
- `runExport()`：`exportStatus='exporting'` → `buildBackupBlob(exportSelection, includeContexts)` → 下载（createObjectURL + a.click + revoke）→ `exportStatus='success'`；catch → 'error'。

### 导入
- `pickImportFile(file)`：reset import 字段 → `importStatus='parsing'` → `parseBackupFile(file)`：
  - `!ok` → 'error' + importError = r.error；
  - `kind !== 'share'` → 'error' + importError「此为全量备份,会覆盖现有数据,请使用备份恢复入口」（kind 防护 C2，与 Task6-3/6-4 对称）；
  - 否则 `importData = r.data`，`importStatus='previewing'`。
- `setImportSelection(sel)`：set importSelection。
- `runImport()`：`importStatus='importing'` → `browser.runtime.sendMessage({type:'octane:apply-share-import', data: importData, selection: importSelection})`：
  - `res?.ok` → `importResult = res.result`，'success'；
  - 否则 'error' + importError。
- `resetExport()` / `resetImport()`：重置对应字段到 INITIAL（Modal 关闭调）。

## Modal 改造

### ShareExportModal
- 移除 `useState(structure/selection/includeContexts/status)`。
- `const { exportStatus, exportStructure, exportSelection, includeContexts, openExport, setExportSelection, toggleIncludeContexts, runExport, resetExport } = useShare();`
- `useEffect(() => { if (visible) openExport(); }, [visible])`。
- footer/body 按 `exportStatus` 渲染（逻辑不变，仅状态源 local → store）。
- `onClose` → `resetExport()`。

### ShareImportModal
- 移除 `useState(status/data/selection/result/errorMessage)`。
- `const { importStatus, importData, importSelection, importResult, importError, pickImportFile, setImportSelection, runImport, resetImport } = useShare();`
- `<input onChange>` → `pickImportFile(file)`；合并导入按钮 → `runImport()`。
- footer/body 按 `importStatus` 渲染（**保留 Task6-4 的 footer `previewing|importing` 修正**，逻辑不变）。

## 测试

### useShare.test.ts（新增，`src/store/__tests__/`）
- spyOn `@/shared/db/database`（exportAllData）、`@/services/BackupService`（buildBackupBlob/parseBackupFile）、`wxt/browser`（sendMessage），与 useBackup.test 一致。
- 覆盖：
  - export 全状态机：openExport loading→idle（structure 加载）、runExport exporting→success（buildBackupBlob 收 selection/includeContexts + 下载）、runExport error。
  - import 全状态机：pickImportFile parsing→previewing（kind=share）、pickImportFile kind=backup→error、pickImportFile !ok→error、runImport importing→success（sendMessage 收 type+data+selection）、runImport res.ok=false→error、salt 冲突（importResult.skippedEncrypted>0）。

### ShareExportModal.test / ShareImportModal.test（调整）
- 改为**真实 useShare store + mock 副作用边界**（不再 mock 整个 `@/services/BackupService`，因 Modal 不再直接调 service，而是调 store action）。
- 组件通过 store action 驱动：upload file → store.pickImportFile；click checkbox → store.setImportSelection；click 按钮 → store.runImport。
- 断言不变（预览数量/不覆盖/勾选导入/salt 冲突/kind 拒绝），验证 store + 组件集成正确。

## Success Criteria

- ✅ ShareExportModal/ShareImportModal 移除 local state，改用 useShare。
- ✅ 用户可见行为逐字节不变（导出/导入/勾选/预览/salt 提示/kind 防护/footer 状态切换）。
- ✅ useShare.test 覆盖 export+import 全状态机。
- ✅ ShareExportModal/ShareImportModal 测试（真实 store）调整后绿。
- ✅ 全量 typecheck + test 双绿（含 Task5/6 既有测试）。
- ✅ 入口零变化（ShareSection/SettingsModal/useBackup 不动）。

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `src/store/useShare.ts` | 分享导出/导入状态机 store | Create |
| `src/store/__tests__/useShare.test.ts` | store 单测（export+import 全状态机） | Create |
| `src/components/backup/ShareExportModal.tsx` | 消费 useShare，移除 useState | Modify |
| `src/components/backup/ShareImportModal.tsx` | 消费 useShare，移除 useState | Modify |
| `src/components/backup/__tests__/ShareExportModal.test.tsx` | 真实 store + mock 边界 | Modify |
| `src/components/backup/__tests__/ShareImportModal.test.tsx` | 真实 store + mock 边界 | Modify |

## YAGNI / 风险

- **功能不变**：纯状态提取，行为一致（无新功能/新状态/新分支）。
- **入口零变化**：ShareSection / SettingsModal / useBackup 不动。
- **双绿锁定**：Task5/6 既有 Modal 测试（mock 方式调整后）必须仍绿，防止重构破坏行为 —— 这是本 Task 最大风险点。
- **不做**：discriminated union、两个 store、SettingsModal UI 细化（范围外，留 Task8）。

## Open Questions（已决策）

1. useBackup vs 新建 useShare → **新建 useShare**（分享域独立于灾备）。
2. 一个 store vs 两个 → **一个 useShare 含 export+import 两套字段**（与 useBackup 模式一致）。
3. union vs 独立字段 → **独立字段**（状态机差异大，union 复杂无收益）。
