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
