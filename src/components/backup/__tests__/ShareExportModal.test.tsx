import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// vi.mock 工厂会被 hoist 到文件顶部，工厂内引用的变量必须用 vi.hoisted 提前初始化，
// 否则触发 TDZ（Cannot access '...' before initialization）。
const { sampleData, buildBackupBlob } = vi.hoisted(() => ({
  // exportAllData 全量结构数据源（Modal 打开时调一次）。返回固定样本。
  sampleData: {
    workspaces: [{ id: 'ws-1', name: '工作', icon: '📁', createdAt: 1, order: 0 }],
    categories: [{ id: 'cat-1a', workspaceId: 'ws-1', name: '工具', icon: '📂', order: 0, createdAt: 1 }],
    bookmarks: [{ id: 'bm-1a', workspaceId: 'ws-1', categoryId: 'cat-1a', name: 'A', url: '', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1 }],
    contexts: [], pinnedTabs: [], cryptoMetadata: null,
  },
  // buildBackupBlob：mock 成成功返回 blob，断言收到 selection/includeContexts
  buildBackupBlob: vi.fn(async () => new Blob(['{}'], { type: 'application/json' })),
}));

vi.mock('@/shared/db/database', () => ({
  exportAllData: vi.fn(async () => sampleData),
}));
vi.mock('@/services/BackupService', () => ({ buildBackupBlob }));

// 下载副作用：createObjectURL/click/revoke 是合法副作用边界 mock
const clickSpy = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
  // 拦截 a.click：用原型方法拿原始 createElement，避免 spyOn 跨测试累积后
  // document.createElement.bind 捕获到 spy 自身导致无限递归。
  const origCreate = Document.prototype.createElement;
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = origCreate.call(document, tag);
    if (tag === 'a') el.click = clickSpy;
    return el;
  });
});

import { ShareExportModal } from '@/components/backup/ShareExportModal';

describe('ShareExportModal — 导出分享包弹窗', () => {
  it('未勾选 → 「导出分享包」按钮 disabled', async () => {
    render(<ShareExportModal visible={true} onClose={() => {}} />);
    // 等 exportAllData 数据加载
    await waitFor(() => expect(screen.getByText(/工具/)).toBeInTheDocument());
    const btn = screen.getByRole('button', { name: /导出分享包/ });
    expect(btn).toBeDisabled();
  });

  it('勾选工作区 + 点导出 → 调 buildBackupBlob(selection, false) + 下载 + success', async () => {
    const user = userEvent.setup();
    render(<ShareExportModal visible={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/工具/)).toBeInTheDocument());
    // 勾工作区
    await user.click(screen.getAllByRole('checkbox')[0]!);
    // 点导出
    await user.click(screen.getByRole('button', { name: /导出分享包/ }));
    await waitFor(() => expect(buildBackupBlob).toHaveBeenCalled());
    expect(buildBackupBlob).toHaveBeenCalledWith(
      { workspaceIds: ['ws-1'], categoryIds: [] },
      false,
    );
    expect(clickSpy).toHaveBeenCalled(); // 触发下载
    // success 文案（含数量）
    expect(await screen.findByText(/已导出/)).toBeInTheDocument();
  });

  it('勾选「包含上下文」checkbox → 显示加密警告 Banner', async () => {
    const user = userEvent.setup();
    render(<ShareExportModal visible={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/工具/)).toBeInTheDocument());
    const ctxCheckbox = screen.getByRole('checkbox', { name: /包含上下文/ });
    await user.click(ctxCheckbox);
    expect(screen.getByText(/跨设备|相同主密码/)).toBeInTheDocument();
  });
});
