import { useEffect } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Typography } from '@/components/ui/typography';
import { Spinner } from '@/components/ui/spinner';
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

  return (
    <Dialog open={visible} onOpenChange={(o) => !o && handleClose()} disablePointerDismissal>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>导出分享包</DialogTitle>
        </DialogHeader>
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
              <Spinner />
            )}

            <div style={{ marginTop: 12 }}>
              <label className="flex items-center gap-2">
                <Checkbox checked={includeContexts} onCheckedChange={(c) => toggleIncludeContexts(c)} />
                包含上下文（含加密笔记）
              </label>
              {includeContexts && (
                <Alert style={{ marginTop: 8 }}>
                  <AlertDescription>含加密笔记，仅适合自己跨设备迁移（需相同主密码）。分享给他人请勿勾选。</AlertDescription>
                </Alert>
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
        <DialogFooter>
          {status === 'success' ? (
            <Button variant="outline" onClick={() => { resetExport(); onClose(); }}>关闭</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={status === 'exporting'}>取消</Button>
              <Button
                variant="default"
                disabled={!hasSelection || status === 'exporting'}
                onClick={runExport}
              >
                {status === 'exporting' && <Spinner />}
                导出分享包
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
