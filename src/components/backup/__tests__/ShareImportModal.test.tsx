import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// vi.mock 工厂会被 hoist 到文件顶部，工厂内引用的变量必须用 vi.hoisted 提前初始化，
// 否则触发 TDZ（Cannot access '...' before initialization）。
const { shareData, parseBackupFile, sendMessage } = vi.hoisted(() => ({
  // 接收方预览样本（仅结构包：cryptoMetadata null）
  shareData: {
    workspaces: [{ id: 'ws-1', name: '工作', icon: '📁', createdAt: 1, order: 0 }],
    categories: [{ id: 'cat-1', workspaceId: 'ws-1', name: '工具', icon: '📂', order: 0, createdAt: 1 }],
    bookmarks: [{ id: 'bm-1', workspaceId: 'ws-1', categoryId: 'cat-1', name: 'A', url: '', description: '', faviconUrl: '', contextCount: 0, hasEncryptedContext: false, createdAt: 1, updatedAt: 1 }],
    contexts: [], pinnedTabs: [], cryptoMetadata: null,
  },
  parseBackupFile: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('@/services/BackupService', () => ({ parseBackupFile }));
// WXT 全局注入 browser；测试统一 mock wxt/browser（与 useBackup.test 一致）
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage } } }));

beforeEach(() => { vi.clearAllMocks(); });

import { ShareImportModal } from '@/components/backup/ShareImportModal';

describe('ShareImportModal — 接收方导入预览', () => {
  it('选 share 文件 → 预览数量 + 安全提示「不覆盖」', async () => {
    parseBackupFile.mockResolvedValue({ ok: true, data: shareData, kind: 'share' });
    const user = userEvent.setup();
    render(<ShareImportModal visible={true} onClose={() => {}} />);
    // 选文件（input type=file，真实 DOM input 非 mock 桩，querySelector 合法）
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    await user.upload(input, new File([JSON.stringify({})], 'share.json'));
    await waitFor(() => expect(screen.getByText(/不覆盖/)).toBeInTheDocument());
    expect(screen.getByText(/工作/)).toBeInTheDocument();
  });

  it('选 backup 文件 → 拒绝提示「请使用备份恢复」', async () => {
    parseBackupFile.mockResolvedValue({ ok: true, data: shareData, kind: 'backup' });
    const user = userEvent.setup();
    render(<ShareImportModal visible={true} onClose={() => {}} />);
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    await user.upload(input, new File([JSON.stringify({})], 'b.json'));
    expect(await screen.findByText(/备份恢复|会覆盖/)).toBeInTheDocument();
  });

  it('勾选 + 导入 → sendMessage(octane:apply-share-import) + success 含数量', async () => {
    parseBackupFile.mockResolvedValue({ ok: true, data: shareData, kind: 'share' });
    sendMessage.mockResolvedValue({ ok: true, result: { workspaces: 1, categories: 1, bookmarks: 1, skippedEncrypted: 0 } });
    const user = userEvent.setup();
    render(<ShareImportModal visible={true} onClose={() => {}} />);
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    await user.upload(input, new File([JSON.stringify({})], 'share.json'));
    await waitFor(() => expect(screen.getByText(/工作/)).toBeInTheDocument());
    // 勾工作区（Semi Tree checkbox，Task5 实测 getAllByRole('checkbox')[0] 落点）
    await user.click(screen.getAllByRole('checkbox')[0]!);
    // 点合并导入
    await user.click(screen.getByRole('button', { name: /合并导入/ }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'octane:apply-share-import' }));
    expect(await screen.findByText(/已导入/)).toBeInTheDocument();
  });

  it('salt 冲突(skippedEncrypted>0) → 提示「X 条加密笔记未导入」', async () => {
    parseBackupFile.mockResolvedValue({ ok: true, data: shareData, kind: 'share' });
    sendMessage.mockResolvedValue({ ok: true, result: { workspaces: 1, categories: 1, bookmarks: 1, skippedEncrypted: 2 } });
    const user = userEvent.setup();
    render(<ShareImportModal visible={true} onClose={() => {}} />);
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    await user.upload(input, new File([JSON.stringify({})], 'share.json'));
    await waitFor(() => expect(screen.getByText(/工作/)).toBeInTheDocument());
    await user.click(screen.getAllByRole('checkbox')[0]!);
    await user.click(screen.getByRole('button', { name: /合并导入/ }));
    expect(await screen.findByText(/2 条加密笔记/)).toBeInTheDocument();
  });
});
