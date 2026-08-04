import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocalBackupSection } from '@/components/backup/LocalBackupSection';
import { useBackup } from '@/store/useBackup';
import { BACKUP_SCHEMA, BACKUP_VERSION } from '@/shared/types';
import type { ValidatedBackup } from '@/services/BackupService';

const data = {
  workspaces: [], categories: [], bookmarks: [], contexts: [], cryptoMetadata: null,
  taskLists: [], tasks: [], checklistItems: [], taskTags: [], taskTagAssignments: [],
};

function setPendingBackup(backup: ValidatedBackup): void {
  useBackup.setState({ status: 'confirming', errorMessage: null, pendingBackup: backup });
}

beforeEach(() => useBackup.getState().reset());

describe('LocalBackupSection — 全量恢复确认', () => {
  it('v6 备份预览显示时间、格式版本、待办状态与全库覆盖范围', () => {
    setPendingBackup({
      ok: true,
      kind: 'backup',
      version: 6,
      exportedAt: 1722470400000,
      appVersion: '1.2.3',
      containsTodoData: true,
      isLegacyWithoutTodo: false,
      data,
    });

    render(<LocalBackupSection />);

    expect(screen.getByText(`备份时间：${new Date(1722470400000).toLocaleString()}`)).toBeInTheDocument();
    expect(screen.getByText('格式版本：v6')).toBeInTheDocument();
    expect(screen.getByText('包含待办：是')).toBeInTheDocument();
    expect(screen.getByText(/现有书签与待办都会被整个快照替换/)).toBeInTheDocument();
    expect(screen.getByText(/其他 Workspace 也会回退/)).toBeInTheDocument();
  });

  it('v1-v5 备份明确警告确认恢复会清空本机全部待办', () => {
    setPendingBackup({
      ok: true,
      kind: 'backup',
      version: 5,
      exportedAt: 1722470400000,
      appVersion: '1.0.0',
      containsTodoData: false,
      isLegacyWithoutTodo: true,
      data,
    });

    render(<LocalBackupSection />);

    expect(screen.getByText(/旧备份不含待办，确认恢复会清空本机全部待办/)).toBeInTheDocument();
  });

  it('选择有效文件后取消恢复确认，只清理待确认备份并恢复触发器焦点', async () => {
    const user = userEvent.setup();
    render(<LocalBackupSection />);
    const file = new File([JSON.stringify({
      schema: BACKUP_SCHEMA,
      version: BACKUP_VERSION,
      kind: 'backup',
      exportedAt: 1722470400000,
      appVersion: '1.2.3',
      data: { ...data, pinnedTabs: [] },
    })], 'backup.json', { type: 'application/json' });

    const importButton = screen.getByRole('button', { name: '导入数据' });
    await user.click(importButton);
    await user.upload(screen.getByLabelText('选择备份文件'), file);
    await screen.findByRole('dialog', { name: '确认覆盖全部数据' });
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(useBackup.getState().status).toBe('idle');
    expect(useBackup.getState().pendingBackup).toBeNull();
    await waitFor(() => expect(importButton).toHaveFocus());
  });
});
