import { useRef, useState } from 'react';
import { Button, Modal, Banner, Toast, Typography, Checkbox } from '@douyinfe/semi-ui';
import { useBackup } from '@/store/useBackup';
import styles from './LocalBackupSection.module.css';

/** 本地备份区：导出 + 导入（覆盖式，破坏性强确认）。popup/home 共享。 */
export function LocalBackupSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const { status, errorMessage, pendingData, pickFile, confirmImport, cancelImport, exportData } = useBackup();

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

  const modalOpen = status === 'confirming' && pendingData !== null;

  return (
    <div className={styles.backupSection}>
      <Banner type="info" description="导出文件含加密笔记的密文（非明文）。在另一台设备恢复时，需使用相同的主密码解锁。" />
      <div className={styles.backupActions}>
        <Button theme="solid" loading={status === 'running' && !modalOpen} onClick={handleExport}>导出数据</Button>
        <Button onClick={() => fileRef.current?.click()}>导入数据</Button>
        <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={handlePick} />
      </div>
      {status === 'error' && errorMessage && (
        <Typography.Text type="danger" role="alert" className={styles.backupError}>{errorMessage}</Typography.Text>
      )}

      <Modal
        title="确认覆盖全部数据"
        visible={modalOpen}
        onCancel={cancelImport}
        maskClosable={false}
        footer={
          <Button
            theme="solid"
            type="danger"
            block
            disabled={!confirmed}
            loading={status === 'running'}
            onClick={handleConfirm}
          >
            确认覆盖
          </Button>
        }
      >
        <div className={styles.backupConfirmBody}>
          <Typography.Text>
            此操作将清除当前全部工作区、书签与上下文，并替换为备份内容，不可撤销。
            {pendingData?.cryptoMetadata ? ' 备份含加密数据，恢复后请用导出端主密码解锁。' : ''}
          </Typography.Text>
          <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked ?? false)}>
            我了解此操作不可撤销
          </Checkbox>
        </div>
      </Modal>
    </div>
  );
}
