import { describe, it, expect, vi, beforeEach } from 'vitest';
// Semi 加载动画依赖 lottie-web；jsdom 无 canvas，mock 掉
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: () => ({
      destroy() {},
      play() {},
      pause() {},
      addEventListener() {},
      removeEventListener() {},
    }),
    destroy() {},
    registerAnimation() {},
  },
}));
import { render, screen, fireEvent } from '@testing-library/react';
import { LocalBackupSection } from '@/components/backup/LocalBackupSection';
import { useBackup } from '@/store/useBackup';
import * as BackupService from '@/services/BackupService';

// 注：项目未安装 @testing-library/jest-dom，沿用现有测试范式（.toBeTruthy() / disabled 断言），
// 断言语义与 brief 一致（元素存在 / 按钮禁用）。
beforeEach(() => useBackup.getState().reset());

describe('LocalBackupSection', () => {
  it('渲染导出/导入按钮 + 密文说明 Banner', () => {
    render(<LocalBackupSection />);
    expect(screen.getByText('导出数据')).toBeTruthy();
    expect(screen.getByText('导入数据')).toBeTruthy();
    expect(screen.getByText(/密文/)).toBeTruthy();
  });

  it('选合法文件 → 弹出覆盖确认 Modal', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({
      ok: true, kind: 'backup', data: { workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null, taskLists: [], tasks: [], checklistItems: [], taskTags: [], taskTagAssignments: [] },
    } as never);
    render(<LocalBackupSection />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'b.json')] } });
    // Modal 标题为「确认覆盖全部数据」，用更具体的子串避免与按钮文案歧义
    expect(await screen.findByText(/确认覆盖全部数据/)).toBeTruthy();
  });

  it('未勾选确认 Checkbox 时，确认按钮禁用', async () => {
    vi.spyOn(BackupService, 'parseBackupFile').mockResolvedValue({
      ok: true, kind: 'backup', data: { workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null, taskLists: [], tasks: [], checklistItems: [], taskTags: [], taskTagAssignments: [] },
    } as never);
    render(<LocalBackupSection />);
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'b.json')] },
    });
    // 用 role=button + 精确 name 消除与 Modal 标题的歧义
    const confirmBtn = await screen.findByRole('button', { name: '确认覆盖' }) as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
  });
});
