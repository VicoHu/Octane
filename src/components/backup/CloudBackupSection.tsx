import { useEffect, useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Toast } from '@/components/ui/toast';
import { Typography } from '@/components/ui/typography';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { useBackup } from '@/store/useBackup';
import { useCrypto } from '@/store/useCrypto';
import { cloudProviders, getCloudProvider } from '@/services/cloud/providers';
import { getCloudConfig, getLastBackupAt } from '@/services/CloudStorageService';
import { S3_PRESETS, WEBDAV_PRESETS } from '@/services/cloud/presets';
import type { BackupData } from '@/shared/types';
import type { CloudStorageConfig, ConfigFieldDef, ProviderId, S3Preset, WebdavPreset } from '@/services/cloud/types';
import styles from './CloudBackupSection.module.css';

/** Tab 列表从注册表动态生成（去硬编码）。 */
const TABS = Object.keys(cloudProviders) as ProviderId[];

/** select 字段的候选 → label 映射（preset 用人类可读名）。 */
function optionLabel(field: ConfigFieldDef, value: string): string {
  if (field.name === 's3Preset') return S3_PRESETS[value as S3Preset]?.label ?? value;
  if (field.name === 'webdavPreset') return WEBDAV_PRESETS[value as WebdavPreset]?.label ?? value;
  return value;
}

/** 云备份区：S3(阿里/腾讯)/WebDAV(坚果云) 配置 + 连通测试 + 上传/恢复（覆盖式，恢复为破坏性强确认）。popup/home 共享。 */
export function CloudBackupSection() {
  // 主密码状态来自全局 store（home/popup 入口处 checkStatus 写入）
  const unlocked = useCrypto((s) => s.unlocked);
  const passwordSet = useCrypto((s) => s.passwordSet);
  const openUnlockModal = useCrypto((s) => s.openUnlockModal);

  const [tab, setTab] = useState<ProviderId>(TABS[0] ?? 's3');
  // 表单按 provider 分组，切换 Tab 不丢失输入
  const [forms, setForms] = useState<Partial<Record<ProviderId, Record<string, string>>>>({});
  const [lastBackup, setLastBackup] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreData, setRestoreData] = useState<BackupData | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const provider = getCloudProvider(tab);

  useEffect(() => {
    getLastBackupAt(tab).then(setLastBackup).catch(() => setLastBackup(null));
  }, [tab, busy]);

  // 解锁后从已保存配置回填当前 tab 表单（刷新后仍展示已存凭证）。仅在该 tab 尚无本地输入时回填，避免覆盖用户编辑。
  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    getCloudConfig(tab)
      .then((cfg) => {
        if (cancelled || !cfg) return;
        setForms((prev) => {
          if (prev[tab] && Object.keys(prev[tab] as Record<string, string>).length > 0) return prev;
          const loaded: Record<string, string> = {};
          for (const f of provider.configFields) {
            const v = (cfg as Record<string, unknown>)[f.name];
            if (typeof v === 'string') loaded[f.name] = v;
          }
          return { ...prev, [tab]: loaded };
        });
      })
      .catch(() => {
        /* 未配置或解锁前——忽略 */
      });
    return () => {
      cancelled = true;
    };
  }, [tab, unlocked, provider]);

  const fieldVal = (name: string) => forms[tab]?.[name] ?? '';
  const setField = (name: string, val: string) =>
    setForms((f) => ({ ...f, [tab]: { ...(f[tab] ?? {}), [name]: val } }));

  /** region 字段占位：S3 下按当前 preset 联动 regionPlaceholder。 */
  const placeholderOf = (f: ConfigFieldDef): string => {
    if (tab === 's3' && f.name === 'region') {
      const preset = forms['s3']?.['s3Preset'] as S3Preset | undefined;
      if (preset && S3_PRESETS[preset]) return S3_PRESETS[preset].regionPlaceholder;
    }
    return f.placeholder ?? '';
  };

  const disabled = !unlocked || busy;
  const lockLabel = !passwordSet ? '设置主密码' : '解锁主密码';

  const handleTest = async () => {
    setBusy(true);
    try {
      await useBackup.getState().testCloudConnection(tab);
      Toast.success('连接成功');
    } catch (e) {
      Toast.error((e as Error).message || '连接失败');
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
      // 从 configFields 通用收集（含 select），不再硬编码字段集
      const values: Record<string, string> = {};
      for (const f of provider.configFields) values[f.name] = fieldVal(f.name);
      await useBackup.getState().saveCloudConfig(tab, values as unknown as CloudStorageConfig);
      Toast.success('配置已保存');
    } catch (e) {
      Toast.error((e as Error).message || '保存失败：请先设置/解锁主密码');
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
    } catch (e) {
      Toast.error((e as Error).message || '上传失败：请检查网络与权限');
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
    } catch (e) {
      Toast.error((e as Error).message || '下载失败：请检查网络与权限');
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
        <Alert>
          <AlertDescription>
            <span>
              云备份凭证由主密码加密，{passwordSet ? '请先解锁' : '请先设置'}主密码。
              <Button size="sm" variant="ghost" onClick={openUnlockModal}>{lockLabel}</Button>
            </span>
          </AlertDescription>
        </Alert>
      )}
      <Tabs value={tab} onValueChange={(v) => setTab(v as ProviderId)}>
        <TabsList>
          {TABS.map((id) => (
            <TabsTrigger key={id} value={id}>{cloudProviders[id].label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className={styles.fieldGroup}>
        {provider.configFields.map((f) => (
          <div key={f.name} className={styles.fieldRow}>
            <label htmlFor={`cloud-${tab}-${f.name}`} className={styles.fieldLabel}>{f.label}</label>
            {f.type === 'select' ? (
              <Select
                value={fieldVal(f.name) || undefined}
                onValueChange={(v) => setField(f.name, v as string)}
                disabled={disabled}
              >
                <SelectTrigger id={`cloud-${tab}-${f.name}`} className="w-full">
                  <SelectValue placeholder="请选择" />
                </SelectTrigger>
                <SelectContent>
                  {(f.options ?? []).map((opt) => (
                    <SelectItem key={opt} value={opt}>{optionLabel(f, opt)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={`cloud-${tab}-${f.name}`}
                type={f.type === 'password' ? 'password' : 'text'}
                disabled={disabled}
                value={fieldVal(f.name)}
                placeholder={placeholderOf(f)}
                onChange={(e) => setField(f.name, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>

      <div className={styles.actions}>
        <Button variant="outline" disabled={disabled || busy} onClick={handleTest}>
          {busy && <Spinner />}
          测试连接
        </Button>
        <Button variant="default" disabled={disabled} onClick={handleSave}>保存配置</Button>
        <Button variant="outline" disabled={disabled} onClick={handleClear}>清除配置</Button>
      </div>

      <Typography.Text type="tertiary" className={styles.lastTime}>
        上次备份：{lastBackup ? new Date(lastBackup).toLocaleString() : '尚未备份'}
      </Typography.Text>

      <div className={styles.actions}>
        <Button variant="default" disabled={disabled || busy} onClick={handleUpload}>
          {busy && <Spinner />}
          上传备份
        </Button>
        <Button variant="destructive" disabled={disabled} onClick={handleRestoreClick}>从云恢复</Button>
      </div>

      <Dialog open={restoreData !== null} onOpenChange={(o) => !o && setRestoreData(null)} disablePointerDismissal>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认覆盖全部数据</DialogTitle>
          </DialogHeader>
          <div className={styles.confirmBody}>
            <Typography.Text>
              此操作将清除当前全部工作区、书签与上下文，并替换为云端备份内容，不可撤销。
              {restoreData?.cryptoMetadata ? ' 云端备份含加密数据，恢复后请用导出端主密码解锁。' : ''}
            </Typography.Text>
            <label className="flex items-center gap-2">
              <Checkbox checked={confirmed} onCheckedChange={(c) => setConfirmed(c)} />
              我了解此操作不可撤销
            </label>
          </div>
          <DialogFooter>
            <Button variant="destructive" className="w-full" disabled={!confirmed || busy} onClick={handleConfirmRestore}>
              {busy && <Spinner />}
              确认覆盖
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
