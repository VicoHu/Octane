import { useEffect, useState } from 'react';
import { Tabs, Input, Button, Modal, Banner, Toast, Typography, Checkbox } from '@douyinfe/semi-ui';
import { useBackup } from '@/store/useBackup';
import { useCrypto } from '@/store/useCrypto';
import { getCloudProvider } from '@/services/cloud/providers';
import { getLastBackupAt } from '@/services/CloudStorageService';
import type { BackupData } from '@/shared/types';
import type { CloudStorageConfig, ProviderId } from '@/services/cloud/types';
import styles from './CloudBackupSection.module.css';

const TABS: ProviderId[] = ['oss', 'cos'];

/** 云备份区：OSS/COS 配置 + 连通测试 + 上传/恢复（覆盖式，恢复为破坏性强确认）。popup/newtab 共享。 */
export function CloudBackupSection() {
  // 主密码状态来自全局 store（newtab/popup 入口处 checkStatus 写入）
  const unlocked = useCrypto((s) => s.unlocked);
  const passwordSet = useCrypto((s) => s.passwordSet);
  const openUnlockModal = useCrypto((s) => s.openUnlockModal);

  const [tab, setTab] = useState<ProviderId>('oss');
  // 表单按 provider 分组，切换 Tab 不丢失输入
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const [lastBackup, setLastBackup] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreData, setRestoreData] = useState<BackupData | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const provider = getCloudProvider(tab);

  useEffect(() => {
    getLastBackupAt(tab).then(setLastBackup).catch(() => setLastBackup(null));
  }, [tab, busy]);

  const fieldVal = (name: string) => forms[tab]?.[name] ?? '';
  const setField = (name: string, val: string) =>
    setForms((f) => ({ ...f, [tab]: { ...(f[tab] ?? {}), [name]: val } }));

  const disabled = !unlocked || busy;
  const lockLabel = !passwordSet ? '设置主密码' : '解锁主密码';

  const handleTest = async () => {
    setBusy(true);
    try {
      await useBackup.getState().testCloudConnection(tab);
      Toast.success('连接成功，桶可访问');
    } catch {
      Toast.error('连接失败：请检查桶 CORS 与 AK/SK 权限');
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    for (const f of provider.configFields) {
      if (f.required && !fieldVal(f.name).trim()) {
        Toast.error(`请填写 ${f.label}`);
        return;
      }
    }
    setBusy(true);
    try {
      const cfg: CloudStorageConfig = {
        region: fieldVal('region'),
        bucket: fieldVal('bucket'),
        accessKeyId: fieldVal('accessKeyId'),
        accessKeySecret: fieldVal('accessKeySecret'),
        endpoint: fieldVal('endpoint') || undefined,
      };
      await useBackup.getState().saveCloudConfig(tab, cfg);
      Toast.success('配置已保存');
    } catch {
      Toast.error('保存失败：请先设置/解锁主密码');
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    try {
      await useBackup.getState().clearCloudConfig(tab);
      Toast.success('已清除云配置');
    } catch {
      Toast.error('清除失败');
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async () => {
    setBusy(true);
    try {
      await useBackup.getState().uploadCloudBackup(tab);
      Toast.success('已上传备份');
    } catch {
      Toast.error('上传失败：请检查网络与权限');
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreClick = async () => {
    setBusy(true);
    try {
      const data = await useBackup.getState().restoreFromCloud(tab);
      setRestoreData(data);
      setConfirmed(false);
    } catch {
      Toast.error('下载失败：请检查网络与权限');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!restoreData) return;
    setBusy(true);
    try {
      await useBackup.getState().applyCloudRestore(restoreData);
      setRestoreData(null);
      Toast.success('恢复完成，如含加密数据请用原密码解锁');
    } catch {
      Toast.error('恢复失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.cloudSection}>
      {!unlocked && (
        <Banner
          type="warning"
          description={
            <span>
              云备份凭证由主密码加密，{passwordSet ? '请先解锁' : '请先设置'}主密码。
              <Button size="small" theme="borderless" onClick={openUnlockModal}>{lockLabel}</Button>
            </span>
          }
        />
      )}
      <Tabs activeKey={tab} onTabChange={(k) => setTab(k as ProviderId)}>
        {TABS.map((id) => (
          <Tabs.TabPane key={id} itemKey={id} tab={getCloudProvider(id).label} />
        ))}
      </Tabs>

      <div className={styles.fieldGroup}>
        {provider.configFields.map((f) => (
          <div key={f.name} className={styles.fieldRow}>
            <label htmlFor={`cloud-${tab}-${f.name}`} className={styles.fieldLabel}>{f.label}</label>
            <Input
              id={`cloud-${tab}-${f.name}`}
              mode={f.type === 'password' ? 'password' : undefined}
              disabled={disabled}
              value={fieldVal(f.name)}
              placeholder={f.placeholder}
              onChange={(v) => setField(f.name, v)}
            />
          </div>
        ))}
      </div>

      <div className={styles.actions}>
        <Button disabled={disabled} loading={busy} onClick={handleTest}>测试连接</Button>
        <Button theme="solid" disabled={disabled} onClick={handleSave}>保存配置</Button>
        <Button disabled={disabled} onClick={handleClear}>清除配置</Button>
      </div>

      <Typography.Text type="tertiary" className={styles.lastTime}>
        上次备份：{lastBackup ? new Date(lastBackup).toLocaleString() : '尚未备份'}
      </Typography.Text>

      <div className={styles.actions}>
        <Button theme="solid" disabled={disabled} loading={busy} onClick={handleUpload}>上传备份</Button>
        <Button type="danger" disabled={disabled} onClick={handleRestoreClick}>从云恢复</Button>
      </div>

      <Modal
        title="确认覆盖全部数据"
        visible={restoreData !== null}
        onCancel={() => setRestoreData(null)}
        maskClosable={false}
        footer={
          <Button theme="solid" type="danger" block disabled={!confirmed || busy} loading={busy} onClick={handleConfirmRestore}>
            确认覆盖
          </Button>
        }
      >
        <div className={styles.confirmBody}>
          <Typography.Text>
            此操作将清除当前全部工作区、书签与上下文，并替换为云端备份内容，不可撤销。
            {restoreData?.cryptoMetadata ? ' 云端备份含加密数据，恢复后请用导出端主密码解锁。' : ''}
          </Typography.Text>
          <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked ?? false)}>
            我了解此操作不可撤销
          </Checkbox>
        </div>
      </Modal>
    </div>
  );
}
