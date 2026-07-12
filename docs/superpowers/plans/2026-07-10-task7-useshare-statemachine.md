# Task7 useShare 状态机 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ShareExportModal/ShareImportModal 的 local state 提取到新建 useShare store(zustand),与 useBackup 模式统一,功能/行为逐字节不变。

**Architecture:** 新建 `src/store/useShare.ts`(一个 store 含 export+import 两套独立状态 + actions,工厂函数产 INITIAL 防嵌套引用共享)。两个 Modal 消费 useShare selector,移除 useState。ShareSection/SettingsModal/useBackup 不变(入口零变化)。Modal 测试 mock 边界不变,仅 beforeEach 加 store reset(防全局 store 状态泄漏)。

**Tech Stack:** WXT + React + Semi Design + TypeScript + Vitest 4 + zustand + @testing-library/react。

## Global Constraints

- 语言:代码注释/日志/测试 describe·it 标题**强制中文**。
- 测试规范(`docs/standards/testing.md`):不 mock Semi(真实渲染);只 mock 副作用边界(exportAllData/buildBackupBlob/parseBackupFile/sendMessage/URL/a.click);query `getByRole`/`getByText`/`querySelector('input[type=file]')`;`userEvent`;jest-dom;**不 `vi.mock('lottie-web')`**(全局 alias)。
- **功能不变**:纯状态提取,ShareExportModal/ShareImportModal 用户可见行为逐字节一致(导出/导入/勾选/预览/salt 提示/kind 防护/footer 状态切换)。
- **入口零变化**:ShareSection / SettingsModal / useBackup 不动。
- **双绿锁定**:Task5/6 既有 Modal 测试(mock 方式不变 + 加 reset)必须仍绿——这是本 Task 最大风险点。
- pnpm;单测 `pnpm vitest run <file>`,全量 `pnpm run test`,类型 `pnpm run typecheck`。
- 分步提交:每个子任务完成独立 commit。

---

## File Structure

| 文件 | 责任 | 动作 |
|---|---|---|
| `src/store/useShare.ts` | 分享导出/导入状态机 store(export+import 两套状态 + actions) | Create |
| `src/store/__tests__/useShare.test.ts` | store 单测(export+import 全状态机) | Create |
| `src/components/backup/ShareExportModal.tsx` | 消费 useShare,移除 useState | Modify |
| `src/components/backup/ShareImportModal.tsx` | 消费 useShare,移除 useState | Modify |
| `src/components/backup/__tests__/ShareExportModal.test.tsx` | beforeEach 加 useShare resetExport | Modify |
| `src/components/backup/__tests__/ShareImportModal.test.tsx` | beforeEach 加 useShare resetImport | Modify |

---

## Task 7-1: useShare 状态机 store(service 层 TDD)

**Files:**
- Create: `src/store/useShare.ts`
- Test: `src/store/__tests__/useShare.test.ts`

**Interfaces:**
- Consumes: `exportAllData`(@/shared/db/database)、`buildBackupBlob`/`parseBackupFile`/`type ShareImportResult`(@/services/BackupService)、`browser.runtime.sendMessage`(WXT 全局,mock wxt/browser)、类型 `BackupData`/`Bookmark`/`Category`/`ShareSelection`/`Workspace`(@/shared/types)
- Produces: `useShare` store(export+import 状态 + 9 actions),供 Task 7-2/7-3 Modal 消费

- [ ] **Step 1: 写失败测试**

Create `src/store/__tests__/useShare.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useShare } from '@/store/useShare';
import * as BackupService from '@/services/BackupService';
import * as DB from '@/shared/db/database';

// WXT 全局 browser（sendMessage）— vi.hoisted 避 TDZ（与 useBackup.test 一致）
const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage } } }));

const structureData = {
  workspaces: [{ id: 'ws-1', name: '工作', icon: '📁', createdAt: 1, order: 0 }],
  categories: [{ id: 'cat-1', workspaceId: 'ws-1', name: '工具', icon: '📂', order: 0, createdAt: 1 }],
  bookmarks: [],
  contexts: [], pinnedTabs: [], cryptoMetadata: null,
};
const sharePkg = { ...structureData };

beforeEach(() => {
  useShare.getState().resetExport();
  useShare.getState().resetImport();
  sendMessage.mockReset();
  vi.restoreAllMocks();
});

describe('useShare — 导出状态机', () => {
  it('openExport → loading→idle + exportStructure 加载', async () => {
    vi.spyOn(DB, 'exportAllData').mockResolvedValue(structureData);
    await useShare.getState().openExport();
    const s = useShare.getState();
    expect(s.exportStatus).toBe('idle');
    expect(s.exportStructure?.workspaces).toHaveLength(1);
  });

  it('openExport 失败 → error', async () => {
    vi.spyOn(DB, 'exportAllData').mockRejectedValue(new Error('读库失败'));
    await useShare.getState().openExport();
    expect(useShare.getState().exportStatus).toBe('error');
  });

  it('runExport → buildBackupBlob(selection, includeContexts) + 下载 + success', async () => {
    vi.spyOn(DB, 'exportAllData').mockResolvedValue(structureData);
    await useShare.getState().openExport();
    useShare.getState().setExportSelection({ workspaceIds: ['ws-1'], categoryIds: [] });
    useShare.getState().toggleIncludeContexts(true);
    const buildSpy = vi.spyOn(BackupService, 'buildBackupBlob').mockResolvedValue(new Blob(['{}']));
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:fake'), revokeObjectURL: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await useShare.getState().runExport();
    expect(buildSpy).toHaveBeenCalledWith({ workspaceIds: ['ws-1'], categoryIds: [] }, true);
    expect(useShare.getState().exportStatus).toBe('success');
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('runExport 失败 → error', async () => {
    vi.spyOn(BackupService, 'buildBackupBlob').mockRejectedValue(new Error('打包失败'));
    await useShare.getState().runExport();
    expect(useShare.getState().exportStatus).toBe('error');
  });
});

describe('useShare — 导入状态机', () => {
  it('pickImportFile kind=share → parsing→previewing + importData', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: true, data: sharePkg, kind: 'share' });
    await useShare.getState().pickImportFile(new File(['{}'], 's.json'));
    const s = useShare.getState();
    expect(s.importStatus).toBe('previewing');
    expect(s.importData).toEqual(sharePkg);
  });

  it('pickImportFile kind=backup → error 分流', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: true, data: sharePkg, kind: 'backup' });
    await useShare.getState().pickImportFile(new File(['{}'], 'b.json'));
    const s = useShare.getState();
    expect(s.importStatus).toBe('error');
    expect(s.importError).toMatch(/备份恢复|会覆盖/);
  });

  it('pickImportFile !ok → error', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: false, error: '坏文件' });
    await useShare.getState().pickImportFile(new File(['{}'], 'x.json'));
    expect(useShare.getState().importStatus).toBe('error');
    expect(useShare.getState().importError).toBe('坏文件');
  });

  it('runImport → sendMessage(octane:apply-share-import, data, selection) + success', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: true, data: sharePkg, kind: 'share' });
    await useShare.getState().pickImportFile(new File(['{}'], 's.json'));
    useShare.getState().setImportSelection({ workspaceIds: ['ws-1'], categoryIds: [] });
    sendMessage.mockResolvedValue({ ok: true, result: { workspaces: 1, categories: 1, bookmarks: 0, skippedEncrypted: 0 } });
    await useShare.getState().runImport();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'octane:apply-share-import',
      data: sharePkg,
      selection: { workspaceIds: ['ws-1'], categoryIds: [] },
    }));
    const s = useShare.getState();
    expect(s.importStatus).toBe('success');
    expect(s.importResult?.workspaces).toBe(1);
  });

  it('runImport res.ok=false → error', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: true, data: sharePkg, kind: 'share' });
    await useShare.getState().pickImportFile(new File(['{}'], 's.json'));
    sendMessage.mockResolvedValue({ ok: false, error: '事务失败' });
    await useShare.getState().runImport();
    expect(useShare.getState().importStatus).toBe('error');
    expect(useShare.getState().importError).toBe('事务失败');
  });

  it('runImport salt 冲突 → success + skippedEncrypted 计数', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({ ok: true, data: sharePkg, kind: 'share' });
    await useShare.getState().pickImportFile(new File(['{}'], 's.json'));
    sendMessage.mockResolvedValue({ ok: true, result: { workspaces: 1, categories: 1, bookmarks: 0, skippedEncrypted: 2 } });
    await useShare.getState().runImport();
    expect(useShare.getState().importResult?.skippedEncrypted).toBe(2);
    expect(useShare.getState().importStatus).toBe('success');
  });
});
```

- [ ] **Step 2: 跑测试验证失败**

Run: `pnpm vitest run src/store/__tests__/useShare.test.ts`
Expected: FAIL — `useShare` 模块不存在（无法 resolve `@/store/useShare`）。

- [ ] **Step 3: 实现 useShare store**

Create `src/store/useShare.ts`:

```typescript
import { create } from 'zustand';
import { exportAllData } from '@/shared/db/database';
import { buildBackupBlob, parseBackupFile, type ShareImportResult } from '@/services/BackupService';
import type { BackupData, Bookmark, Category, ShareSelection, Workspace } from '@/shared/types';

type ExportStatus = 'idle' | 'loading' | 'exporting' | 'success' | 'error';
type ImportStatus = 'idle' | 'parsing' | 'previewing' | 'importing' | 'success' | 'error';

/** 导出结构（SelectionTree 数据源） */
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

// 工厂函数产 INITIAL：每次 reset 新对象，防嵌套 selection 共享引用被 mutate
const exportInitial = () => ({
  exportStatus: 'idle' as ExportStatus,
  exportStructure: null as ExportStructure | null,
  exportSelection: { workspaceIds: [], categoryIds: [] } as ShareSelection,
  includeContexts: false,
});
const importInitial = () => ({
  importStatus: 'idle' as ImportStatus,
  importData: null as BackupData | null,
  importSelection: { workspaceIds: [], categoryIds: [] } as ShareSelection,
  importResult: null as ShareImportResult | null,
  importError: null as string | null,
});

/**
 * 分享导出/导入状态机（与 useBackup「一个 store 含多流程」模式一致）。
 * 导出与导入两套独立状态 + actions；browser 全局由 WXT auto-inject（测试 mock wxt/browser）。
 */
export const useShare = create<ShareState>((set, get) => ({
  ...exportInitial(),
  ...importInitial(),

  openExport: async () => {
    set({ ...exportInitial(), exportStatus: 'loading' });
    try {
      const d = await exportAllData();
      set({
        exportStructure: { workspaces: d.workspaces, categories: d.categories, bookmarks: d.bookmarks },
        exportStatus: 'idle',
      });
    } catch {
      set({ exportStatus: 'error' });
    }
  },
  setExportSelection: (sel) => set({ exportSelection: sel }),
  toggleIncludeContexts: (v) => set({ includeContexts: v }),

  runExport: async () => {
    set({ exportStatus: 'exporting' });
    try {
      const { exportSelection: selection, includeContexts } = get();
      const blob = await buildBackupBlob(selection, includeContexts);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `octane-share-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      set({ exportStatus: 'success' });
    } catch {
      set({ exportStatus: 'error' });
    }
  },

  pickImportFile: async (file) => {
    set({ ...importInitial(), importStatus: 'parsing' });
    const r = await parseBackupFile(file);
    if (!r.ok) {
      set({ importStatus: 'error', importError: r.error });
      return;
    }
    // kind 防护（C2）：分享入口只接受 share；全量备份走备份恢复入口
    if (r.kind !== 'share') {
      set({ importStatus: 'error', importError: '此为全量备份,会覆盖现有数据,请使用备份恢复入口' });
      return;
    }
    set({ importData: r.data, importStatus: 'previewing' });
  },
  setImportSelection: (sel) => set({ importSelection: sel }),

  runImport: async () => {
    const data = get().importData;
    if (!data) return;
    set({ importStatus: 'importing' });
    try {
      const res = await browser.runtime.sendMessage({
        type: 'octane:apply-share-import',
        data,
        selection: get().importSelection,
      });
      if (res && res.ok) {
        set({ importResult: res.result ?? null, importStatus: 'success' });
      } else {
        set({ importStatus: 'error', importError: (res?.error as string) || '导入失败' });
      }
    } catch (e) {
      set({ importStatus: 'error', importError: (e as Error).message || '导入失败' });
    }
  },

  resetExport: () => set(exportInitial()),
  resetImport: () => set(importInitial()),
}));
```

- [ ] **Step 4: 跑测试验证通过**

Run: `pnpm vitest run src/store/__tests__/useShare.test.ts`
Expected: PASS（10 用例：export 4 + import 6）。

- [ ] **Step 5: typecheck + commit**

Run: `pnpm run typecheck` → 无错。

```bash
git add src/store/useShare.ts src/store/__tests__/useShare.test.ts
git commit -m "feat(share): useShare 导出/导入状态机 store(0.1.11.3 第7步-1)"
```

---

## Task 7-2: ShareExportModal 改造(消费 useShare)

**Files:**
- Modify: `src/components/backup/ShareExportModal.tsx`(全文替换为消费 useShare 版)
- Modify: `src/components/backup/__tests__/ShareExportModal.test.tsx`(beforeEach 加 resetExport)

**Interfaces:**
- Consumes: `useShare` store(Task 7-1)
- Produces: ShareExportModal 行为不变,状态源 local → store

- [ ] **Step 1: 改 ShareExportModal(全文替换)**

Replace `src/components/backup/ShareExportModal.tsx`:

```tsx
import { useEffect } from 'react';
import { Modal, Button, Checkbox, Banner, Typography, Spin } from '@douyinfe/semi-ui';
import { SelectionTree } from './SelectionTree';
import { shareStats } from './shareSelection';
import { useShare } from '@/store/useShare';

interface ShareExportModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * 导出分享包 Modal：消费 useShare 状态机（Task7）。
 * SelectionTree 选工作区/分类 + 上下文 checkbox + 导出下载。状态源在 store。
 */
export function ShareExportModal({ visible, onClose }: ShareExportModalProps) {
  const {
    exportStatus: status, exportStructure: structure, exportSelection: selection, includeContexts,
    openExport, setExportSelection, toggleIncludeContexts, runExport, resetExport,
  } = useShare();

  useEffect(() => {
    if (visible) openExport();
  }, [visible, openExport]);

  const hasSelection = selection.workspaceIds.length > 0 || selection.categoryIds.length > 0;
  const stats = structure
    ? shareStats(structure.workspaces, structure.categories, structure.bookmarks, selection)
    : { ws: 0, cat: 0, bm: 0 };

  const handleClose = () => {
    if (status === 'exporting') return; // 导出中防关
    resetExport();
    onClose();
  };

  // footer 按 status 动态：success=关闭；其余=取消+导出分享包
  const footer =
    status === 'success' ? (
      <Button onClick={() => { resetExport(); onClose(); }}>关闭</Button>
    ) : (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={handleClose} disabled={status === 'exporting'}>取消</Button>
        <Button theme="solid" loading={status === 'exporting'} disabled={!hasSelection} onClick={runExport}>
          导出分享包
        </Button>
      </div>
    );

  return (
    <Modal title="导出分享包" visible={visible} onCancel={handleClose} maskClosable={false} width={560} footer={footer}>
      {status === 'success' ? (
        <Typography.Text>
          ✓ 已导出 {stats.ws} 个工作区 · {stats.cat} 个分类 · {stats.bm} 个书签
        </Typography.Text>
      ) : (
        <>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            勾选要分享的工作区或分类，生成分享包（合并导入到对方库，不覆盖）。
          </Typography.Text>
          {structure ? (
            <SelectionTree
              workspaces={structure.workspaces}
              categories={structure.categories}
              bookmarks={structure.bookmarks}
              value={selection}
              onChange={setExportSelection}
            />
          ) : (
            <Spin />
          )}

          <div style={{ marginTop: 12 }}>
            <Checkbox
              checked={includeContexts}
              onChange={(e) => toggleIncludeContexts(e.target.checked ?? false)}
            >
              包含上下文（含加密笔记）
            </Checkbox>
            {includeContexts && (
              <Banner
                type="warning"
                description="含加密笔记，仅适合自己跨设备迁移（需相同主密码）。分享给他人请勿勾选。"
                style={{ marginTop: 8 }}
              />
            )}
          </div>

          {status === 'error' && (
            <Typography.Text type="danger" role="alert" style={{ display: 'block', marginTop: 12 }}>
              导出失败，请重试。
            </Typography.Text>
          )}

          {!hasSelection && (
            <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 12 }}>
              勾选至少一个工作区或分类
            </Typography.Text>
          )}
        </>
      )}
    </Modal>
  );
}
```

- [ ] **Step 2: 改测试 beforeEach(加 resetExport)**

在 `src/components/backup/__tests__/ShareExportModal.test.tsx` 的 `beforeEach` 开头加一行（store 是全局单例，防测试间状态泄漏）:

```typescript
beforeEach(() => {
  useShare.getState().resetExport();   // ← 新增
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
  const origCreate = Document.prototype.createElement;
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = origCreate.call(document, tag);
    if (tag === 'a') el.click = clickSpy;
    return el;
  });
});
```

并在测试文件顶部 import（与其他 import 并列）:

```typescript
import { useShare } from '@/store/useShare';
```

> 既有 3 个用例（未勾选 disabled / 勾选导出 / 包含上下文 banner）的断言与 DOM 交互**不变**——mock 边界（exportAllData/buildBackupBlob）仍覆盖 store 调用，组件通过 store action 驱动。

- [ ] **Step 3: 跑测试验证通过**

Run: `pnpm vitest run src/components/backup/__tests__/ShareExportModal.test.tsx`
Expected: PASS（3 用例）。若 Semi Tree/Modal 在 jsdom 交互异常，按 Task5 经验调整（getAllByRole('checkbox')[0] 落点不变）。

- [ ] **Step 4: typecheck + commit**

Run: `pnpm run typecheck` → 无错。

```bash
git add src/components/backup/ShareExportModal.tsx src/components/backup/__tests__/ShareExportModal.test.tsx
git commit -m "refactor(share): ShareExportModal 消费 useShare(0.1.11.3 第7步-2)"
```

---

## Task 7-3: ShareImportModal 改造(消费 useShare)

**Files:**
- Modify: `src/components/backup/ShareImportModal.tsx`(全文替换为消费 useShare 版)
- Modify: `src/components/backup/__tests__/ShareImportModal.test.tsx`(beforeEach 加 resetImport)

**Interfaces:**
- Consumes: `useShare` store(Task 7-1)
- Produces: ShareImportModal 行为不变,状态源 local → store

- [ ] **Step 1: 改 ShareImportModal(全文替换)**

Replace `src/components/backup/ShareImportModal.tsx`:

```tsx
import { useRef, type ChangeEvent } from 'react';
import { Modal, Button, Banner, Spin, Typography } from '@douyinfe/semi-ui';
import { SelectionTree } from './SelectionTree';
import { shareStats } from './shareSelection';
import { useShare } from '@/store/useShare';

interface ShareImportModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * 接收方导入分享包 Modal：消费 useShare 状态机（Task7）。
 * 选文件 → 预览（数量+安全提示）→ 勾选 → background 合并导入。状态源在 store。
 */
export function ShareImportModal({ visible, onClose }: ShareImportModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const {
    importStatus: status, importData: data, importSelection: selection, importResult: result, importError: errorMessage,
    pickImportFile, setImportSelection, runImport, resetImport,
  } = useShare();

  const handlePick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) pickImportFile(f);
    e.target.value = '';
  };

  const stats = data
    ? shareStats(data.workspaces, data.categories, data.bookmarks, selection)
    : { ws: 0, cat: 0, bm: 0 };

  // footer 按 status 动态：success=关闭；previewing|importing=取消+合并导入（importing 时 loading）；其余=关闭
  const footer =
    status === 'success' ? (
      <Button onClick={() => { resetImport(); onClose(); }}>关闭</Button>
    ) : status === 'previewing' || status === 'importing' ? (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={() => { resetImport(); onClose(); }} disabled={status === 'importing'}>取消</Button>
        <Button
          theme="solid"
          loading={status === 'importing'}
          disabled={stats.ws === 0 && stats.cat === 0}
          onClick={runImport}
        >
          合并导入{stats.ws > 0 ? ` ${stats.ws} 个工作区` : ''}
        </Button>
      </div>
    ) : (
      <Button onClick={() => { resetImport(); onClose(); }}>关闭</Button>
    );

  return (
    <Modal title="导入分享包" visible={visible} onCancel={() => { resetImport(); onClose(); }} maskClosable={false} width={560} footer={footer}>
      <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={handlePick} />

      {status === 'idle' && (
        <Button onClick={() => fileRef.current?.click()}>选择分享包文件</Button>
      )}
      {status === 'parsing' && <Spin />}
      {status === 'error' && errorMessage && (
        <Typography.Text type="danger" role="alert">{errorMessage}</Typography.Text>
      )}
      {status === 'previewing' && data && (
        <>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            来自分享 · 合并到你的库，<strong>不覆盖</strong>现有数据。
          </Typography.Text>
          {data.cryptoMetadata && (
            <Banner type="warning" description="此分享包含加密笔记，需与发送方相同主密码才能查看。" style={{ marginBottom: 8 }} />
          )}
          {data.workspaces.length === 0 ? (
            <Typography.Text type="tertiary">这个分享包是空的</Typography.Text>
          ) : (
            <SelectionTree
              workspaces={data.workspaces}
              categories={data.categories}
              bookmarks={data.bookmarks}
              value={selection}
              onChange={setImportSelection}
            />
          )}
        </>
      )}
      {status === 'success' && result && (
        <>
          <Typography.Text>
            ✓ 已导入 {result.workspaces} 个工作区 · {result.categories} 个分类 · {result.bookmarks} 个书签
          </Typography.Text>
          {result.skippedEncrypted > 0 && (
            <Banner type="warning" style={{ marginTop: 8 }}
              description={`${result.skippedEncrypted} 条加密笔记因本机加密设置不同未导入`} />
          )}
        </>
      )}
    </Modal>
  );
}
```

- [ ] **Step 2: 改测试 beforeEach(加 resetImport)**

在 `src/components/backup/__tests__/ShareImportModal.test.tsx` 的 `beforeEach` 开头加一行:

```typescript
beforeEach(() => {
  useShare.getState().resetImport();   // ← 新增
  vi.clearAllMocks();
});
```

并在测试文件顶部 import:

```typescript
import { useShare } from '@/store/useShare';
```

> 既有 4 个用例（share 预览 / backup 拒绝 / 勾选导入 / salt 冲突）的断言与 DOM 交互**不变**——mock 边界（parseBackupFile/sendMessage）仍覆盖 store 调用。

- [ ] **Step 3: 跑测试验证通过**

Run: `pnpm vitest run src/components/backup/__tests__/ShareImportModal.test.tsx`
Expected: PASS（4 用例）。

- [ ] **Step 4: typecheck + commit**

Run: `pnpm run typecheck` → 无错。

```bash
git add src/components/backup/ShareImportModal.tsx src/components/backup/__tests__/ShareImportModal.test.tsx
git commit -m "refactor(share): ShareImportModal 消费 useShare(0.1.11.3 第7步-3)"
```

---

## Task 7-4: 全量双绿

- [ ] **Step 1: 全量回归确认**

Run: `pnpm run typecheck && pnpm run test`
Expected: 全绿（含 Task7-1 新 store 测试 10 + Task5/6 既有 Modal 测试 7 + 灾备网 + Task6 全部）。

- [ ] **Step 2: 行为一致性核查（人工）**

逐项核对 ShareExportModal/ShareImportModal 改造前后行为一致（Global Constraint「功能不变」）:
- 导出：未勾选 disabled / 勾选+导出下载+success / 包含上下文 banner。
- 导入：share 预览+不覆盖 / backup 拒绝 / 勾选+合并导入+success / salt 冲突提示。
- footer 状态切换（success/previewing|importing/其他）一致。

- [ ] **Step 3: 视觉 QA 记下,留 Task8 /design-review**

主按钮炭灰字、focus ring、Modal 间距。

---

## Self-Review

**1. Spec coverage**（对照 Task7 spec）:
- 新建 useShare store（export+import 两套状态 + 9 actions）→ Task 7-1 ✓
- ShareExportModal 消费 useShare，移除 useState → Task 7-2 ✓
- ShareImportModal 消费 useShare，移除 useState → Task 7-3 ✓
- useShare.test 覆盖 export+import 全状态机 → Task 7-1（10 用例）✓
- Modal 测试 beforeEach 加 reset → Task 7-2/7-3 ✓
- 全量双绿 + 行为一致性 → Task 7-4 ✓
- 入口零变化（ShareSection/SettingsModal/useBackup 不在改动文件列表）✓

**2. Placeholder**:无 TBD/TODO；每步含完整代码与命令。Modal 测试「断言不变」是显式说明（既有测试代码已存在，仅 beforeEach 加 reset），非占位。

**3. Type consistency**:
- `useShare` store 字段名（exportStatus/exportStructure/exportSelection/includeContexts + importStatus/importData/importSelection/importResult/importError）在 Task 7-1 定义、7-2/7-3 Modal 消费逐字一致 ✓
- actions 名（openExport/setExportSelection/toggleIncludeContexts/runExport + pickImportFile/setImportSelection/runImport + resetExport/resetImport）全链路一致 ✓
- `ShareImportResult` 类型从 BackupService 导入（Task6-1 已加）✓
- footer `previewing|importing` 修正（Task6-4）在 Task 7-3 保留 ✓

**已知风险点（实现时注意）**:
- useShare 是全局 zustand 单例：Modal 测试 beforeEach 必须调 resetExport/resetImport，否则跨用例状态泄漏（selection/result 残留致断言失真）。
- `openExport` 的 useEffect 依赖 `[visible, openExport]`：zustand action 引用稳定（store create 一次），effect 仅在 visible 变化时跑，与原 useEffect 行为一致。
- Modal 测试 mock 边界（exportAllData/buildBackupBlob/parseBackupFile/sendMessage）不变——store 调这些，mock 仍生效；组件通过 store action 驱动，DOM 断言不变。
- `browser.runtime.sendMessage` 在 store 用 WXT 全局（与 useBackup 一致），测试 mock `wxt/browser`（vi.hoisted sendMessage）。
