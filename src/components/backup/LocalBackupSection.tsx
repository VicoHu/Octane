import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Toast } from '@/components/ui/toast';
import { Typography } from '@/components/ui/typography';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { useBackup } from '@/store/useBackup';
import { Info } from 'lucide-react';
import styles from './LocalBackupSection.module.css';

/** 本地备份区：导出 + 导入（覆盖式，破坏性强确认）。popup/home 共享。 */
export function LocalBackupSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const importTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreImportFocusRef = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  const { status, errorMessage, pendingBackup, pickFile, confirmImport, cancelImport, exportData } = useBackup();

  const handleExport = async () => {
    await exportData();
    if (useBackup.getState().status === 'success') Toast.success('已导出备份文件');
    else if (useBackup.getState().status === 'error') Toast.error(useBackup.getState().errorMessage || '导出失败');
  };

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setConfirmed(false);
    await pickFile(f);
    if (useBackup.getState().status === 'error') Toast.error(useBackup.getState().errorMessage || '文件无效');
    e.target.value = ''; // 允许重复选同文件
  };

  const handleConfirm = async () => {
    await confirmImport();
    const s = useBackup.getState().status;
    if (s === 'success') Toast.success('导入完成，如含加密数据请用原密码解锁');
    else if (s === 'error') Toast.error(useBackup.getState().errorMessage || '导入失败');
  };

  const modalOpen = status === 'confirming' && pendingBackup !== null;
  const exporting = status === 'running' && !modalOpen;

  useEffect(() => {
    if (modalOpen) {
      restoreImportFocusRef.current = true;
      return;
    }
    if (restoreImportFocusRef.current) {
      restoreImportFocusRef.current = false;
      importTriggerRef.current?.focus();
    }
  }, [modalOpen]);

  return (
    <div className={styles.backupSection}>
      <Alert variant="default" role="note">
        <Info aria-hidden="true" />
        <AlertDescription>导出文件含加密笔记的密文（非明文）。在另一台设备恢复时，需要使用相同的主密码解锁。</AlertDescription>
      </Alert>
      <div className={styles.backupActions}>
        <Button variant="default" disabled={exporting} onClick={handleExport}>
          {exporting && <Spinner />}
          导出数据
        </Button>
        <Button ref={importTriggerRef} variant="outline" onClick={() => fileRef.current?.click()}>导入数据</Button>
        <input ref={fileRef} aria-label="选择备份文件" type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={handlePick} />
      </div>
      {status === 'error' && errorMessage && (
        <Typography.Text type="danger" role="alert" className={styles.backupError}>{errorMessage}</Typography.Text>
      )}

      <Dialog open={modalOpen} onOpenChange={(o) => !o && cancelImport()} disablePointerDismissal>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认覆盖全部数据</DialogTitle>
          </DialogHeader>
          <div className={styles.backupConfirmBody}>
            <Typography.Text>
              现有书签与待办都会被整个快照替换，其他 Workspace 也会回退到该备份状态，不可撤销。
              {pendingBackup?.data.cryptoMetadata ? ' 备份含加密数据，恢复后请用导出端主密码解锁。' : ''}
            </Typography.Text>
            <ul className={styles.backupMetadata}>
              <li>备份时间：{pendingBackup && new Date(pendingBackup.exportedAt).toLocaleString()}</li>
              <li>格式版本：v{pendingBackup?.version}</li>
              <li>包含待办：{pendingBackup?.containsTodoData ? '是' : '否'}</li>
            </ul>
            {pendingBackup?.isLegacyWithoutTodo && (
              <Typography.Text type="danger">旧备份不含待办，确认恢复会清空本机全部待办。</Typography.Text>
            )}
            <label className="flex items-center gap-2">
              <Checkbox checked={confirmed} onCheckedChange={(c) => setConfirmed(c)} />
              我了解此操作不可撤销
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" className="min-h-11" disabled={status === 'running'} onClick={cancelImport}>取消</Button>
            <Button
              variant="destructive"
              className="min-h-11 w-full"
              disabled={!confirmed || status === 'running'}
              onClick={handleConfirm}
            >
              {status === 'running' && <Spinner />}
              确认覆盖
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
