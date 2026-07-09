import { useState, useEffect } from 'react';
import { Modal, Button, Checkbox, Banner, Typography, Spin } from '@douyinfe/semi-ui';
import { exportAllData } from '@/shared/db/database';
import { buildBackupBlob } from '@/services/BackupService';
import { SelectionTree } from './SelectionTree';
import { shareStats } from './shareSelection';
import type { Bookmark, Category, ShareSelection, Workspace, BackupData } from '@/shared/types';

interface ShareExportModalProps {
  visible: boolean;
  onClose: () => void;
}

type Status = 'idle' | 'exporting' | 'success' | 'error';

/** 全量结构（SelectionTree 数据源；store 是切片式，故 Modal 自取全量） */
interface Structure {
  workspaces: Workspace[];
  categories: Category[];
  bookmarks: Bookmark[];
}

/**
 * 导出分享包 Modal：SelectionTree 选工作区/分类 + 上下文 checkbox + 导出下载。
 * 纯前端（不走 background）。local state（Task7 才接 useShare 状态机）。
 */
export function ShareExportModal({ visible, onClose }: ShareExportModalProps) {
  const [structure, setStructure] = useState<Structure | null>(null);
  const [selection, setSelection] = useState<ShareSelection>({ workspaceIds: [], categoryIds: [] });
  const [includeContexts, setIncludeContexts] = useState(false);
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    if (!visible) return;
    setStatus('idle');
    setSelection({ workspaceIds: [], categoryIds: [] });
    setIncludeContexts(false);
    exportAllData().then((d: BackupData) =>
      setStructure({ workspaces: d.workspaces, categories: d.categories, bookmarks: d.bookmarks }),
    );
  }, [visible]);

  const hasSelection = selection.workspaceIds.length > 0 || selection.categoryIds.length > 0;
  const stats = structure
    ? shareStats(structure.workspaces, structure.categories, structure.bookmarks, selection)
    : { ws: 0, cat: 0, bm: 0 };

  const handleExport = async () => {
    setStatus('exporting');
    try {
      const blob = await buildBackupBlob(selection, includeContexts);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `octane-share-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('success');
    } catch {
      setStatus('error');
    }
  };

  const handleClose = () => {
    if (status === 'exporting') return; // 导出中防关
    onClose();
  };

  // footer 按 status 动态：success=关闭；其余=取消+导出分享包
  const footer =
    status === 'success' ? (
      <Button onClick={onClose}>关闭</Button>
    ) : (
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={handleClose} disabled={status === 'exporting'}>
          取消
        </Button>
        <Button
          theme="solid"
          loading={status === 'exporting'}
          disabled={!hasSelection}
          onClick={handleExport}
        >
          导出分享包
        </Button>
      </div>
    );

  return (
    <Modal
      title="导出分享包"
      visible={visible}
      onCancel={handleClose}
      maskClosable={false}
      width={560}
      footer={footer}
    >
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
              onChange={setSelection}
            />
          ) : (
            <Spin />
          )}

          <div style={{ marginTop: 12 }}>
            <Checkbox
              checked={includeContexts}
              onChange={(e) => setIncludeContexts(e.target.checked ?? false)}
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
