import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { PinCodeInput } from '@/components/PinCodeInput';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { Toast } from '@/components/ui/toast';
import { TriangleAlert } from 'lucide-react';
import { unlock, setupPin, disablePin } from '@/services/CryptoService';
import { useCrypto } from '@/store/useCrypto';
import type { PinFormat } from '@/shared/types';
import styles from './index.module.css';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** enable = 启用/修改 PIN（两步：验证主密码 → 设置）；disable = 关闭 PIN（仅验证主密码） */
  intent: 'enable' | 'disable';
}

const FORMAT_OPTIONS: { value: PinFormat; label: string; hint: string }[] = [
  { value: 'digits-6', label: '6 位数字', hint: '推荐，便利与防护均衡' },
  { value: 'digits-4', label: '4 位数字', hint: '最快，防护最弱' },
  { value: 'custom', label: '自定义', hint: '至少 4 位，可含字母，防护最强' },
];

/**
 * 快速解锁 PIN 管理弹窗（#96）——两步向导（enable）：
 *
 * 第 1 步「验证身份」：强制完整 PBKDF2 + verifier 校验主密码（即使当前已解锁——防离席劫持），
 * 成功顺带写入共享 key，第 2 步的 setupPin 才有密钥可包装。
 * 第 2 步「设置 PIN」：形态选择 + 输入确认 + 重启保持开关（默认关，开启显示暴力破解警示）。
 * disable 模式保持单步（仅验证主密码）。
 *
 * 交互准则（ui-ux-pro-max）：多步流程带步骤指示；异步提交禁用按钮防双击；
 * 错误就近显示在触发表单下方；输入均有 label 关联。
 */
export const PinSetupModal: React.FC<Props> = ({ visible, intent, onClose }) => {
  const refreshPinStatus = useCrypto((s) => s.refreshPinStatus);
  const [step, setStep] = useState<'verify' | 'configure'>('verify');
  const [masterPassword, setMasterPassword] = useState('');
  const [format, setFormat] = useState<PinFormat>('digits-6');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [persistEnvelope, setPersistEnvelope] = useState(false);
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // 防双触发：Enter 连按时避免并发验证/提交
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      setStep('verify');
      setMasterPassword('');
      setFormat('digits-6');
      setPin('');
      setConfirmPin('');
      setPersistEnvelope(false);
      setError('');
    }
  }, [visible]);

  const isDisable = intent === 'disable';

  /** 第 1 步：验证主密码，通过后进入第 2 步（disable 模式直接完成关闭） */
  const handleVerify = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setVerifying(true);
    try {
      setError('');
      const ok = await unlock(masterPassword);
      if (!ok) {
        setError('主密码错误');
        return;
      }
      setMasterPassword(''); // 验证即焚，不留存在表单状态里
      if (isDisable) {
        await disablePin();
        await refreshPinStatus();
        Toast.success('PIN 已关闭');
        onClose();
        return;
      }
      setStep('configure');
    } catch (e) {
      setError((e as Error).message || '操作失败，请重试');
    } finally {
      setVerifying(false);
      submittingRef.current = false;
    }
  };

  /** 第 2 步：校验并启用 PIN（此时主密码已验证，共享 key 在 session） */
  const handleEnable = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      setError('');
      if (pin !== confirmPin) {
        setError('两次 PIN 不一致');
        return;
      }
      if (pin.length === 0) {
        setError('请输入 PIN');
        return;
      }
      try {
        await setupPin(pin, format, persistEnvelope);
      } catch (e) {
        setError((e as Error).message);
        return;
      }
      await refreshPinStatus();
      Toast.success(persistEnvelope ? 'PIN 已启用，重启浏览器后仍可用 PIN 解锁' : 'PIN 已启用');
      onClose();
    } catch (e) {
      setError((e as Error).message || '操作失败，请重试');
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  const pinPlaceholder =
    format === 'custom'
      ? '输入 PIN（至少 4 位）'
      : `输入 ${format === 'digits-4' ? '4' : '6'} 位数字 PIN`;

  return (
    <Dialog open={visible} onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby="pin-setup-desc">
        <DialogHeader>
          <DialogTitle>
            {isDisable ? '关闭快速解锁 PIN' : step === 'verify' ? '启用快速解锁 PIN · 验证身份' : '启用快速解锁 PIN · 设置 PIN'}
          </DialogTitle>
          <DialogDescription id="pin-setup-desc">
            {isDisable
              ? '验证主密码后关闭 PIN。之后解锁将始终要求主密码。'
              : step === 'verify'
                ? '第 1 步，共 2 步：验证主密码以确认是本人操作。'
                : '第 2 步，共 2 步：选择 PIN 形态并设置。忘记 PIN 时随时可改用主密码。'}
          </DialogDescription>
        </DialogHeader>

        {!isDisable && (
          <ol className={styles.steps} aria-label="设置进度">
            <li aria-current={step === 'verify' ? 'step' : undefined} className={step === 'verify' ? styles.stepActive : ''}>
              1. 验证身份
            </li>
            <li aria-current={step === 'configure' ? 'step' : undefined} className={step === 'configure' ? styles.stepActive : ''}>
              2. 设置 PIN
            </li>
          </ol>
        )}

        {isDisable || step === 'verify' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label htmlFor="pin-setup-master" className={styles.fieldLabel}>
                主密码
              </label>
              <Input
                id="pin-setup-master"
                type="password"
                placeholder="输入主密码（验证身份）"
                value={masterPassword}
                onChange={(e) => setMasterPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleVerify();
                }}
                aria-invalid={error ? true : undefined}
                autoFocus
              />
            </div>
            {error && <div className={styles.fieldError}>{error}</div>}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <RadioGroup
              value={format}
              onValueChange={(v) => {
                const next = v as PinFormat;
                if (next !== format) {
                  setFormat(next);
                  // 切换形态必须重新输入:长度与字符集都不同,沿用旧值必然校验失败
                  setPin('');
                  setConfirmPin('');
                }
              }}
              aria-label="PIN 形态"
            >
              {FORMAT_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-start gap-2 text-sm"
                >
                  <RadioGroupItem value={opt.value} className="mt-0.5" />
                  <span>
                    <span className="font-medium">{opt.label}</span>
                    <span className="ml-2 text-muted-foreground">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
            <div>
              <label htmlFor="pin-setup-value" className={styles.fieldLabel}>
                PIN
              </label>
              {format === 'custom' ? (
                <Input
                  id="pin-setup-value"
                  type="password"
                  placeholder={pinPlaceholder}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                />
              ) : (
                <PinCodeInput
                  id="pin-setup-value"
                  length={format === 'digits-4' ? 4 : 6}
                  value={pin}
                  onChange={setPin}
                  aria-invalid={error ? true : undefined}
                />
              )}
            </div>
            <div>
              <label htmlFor="pin-setup-confirm" className={styles.fieldLabel}>
                确认 PIN
              </label>
              {format === 'custom' ? (
                <Input
                  id="pin-setup-confirm"
                  type="password"
                  placeholder="再次输入 PIN"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleEnable();
                  }}
                />
              ) : (
                <PinCodeInput
                  id="pin-setup-confirm"
                  length={format === 'digits-4' ? 4 : 6}
                  value={confirmPin}
                  onChange={setConfirmPin}
                  aria-invalid={error ? true : undefined}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleEnable();
                  }}
                />
              )}
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox
                checked={persistEnvelope}
                onCheckedChange={(checked) => setPersistEnvelope(checked === true)}
                className="mt-0.5"
              />
              <span>重启浏览器后仍可用 PIN 解锁（无需主密码）</span>
            </label>
            {persistEnvelope && (
              <Alert variant="destructive">
                <TriangleAlert className="size-4" />
                <AlertDescription>
                  开启后，用 PIN 加密的解锁信封会保存在本机。能读取本机文件的人可尝试暴力破解短
                  PIN（4 位仅 1 万种组合）。仅在个人设备上开启。
                </AlertDescription>
              </Alert>
            )}
            {error && <div className={styles.fieldError}>{error}</div>}
          </div>
        )}

        <DialogFooter>
          {step === 'configure' && !isDisable ? (
            <div className="flex w-full gap-2">
              <Button
                variant="outline"
                disabled={submitting}
                onClick={() => {
                  setStep('verify');
                  setError('');
                }}
              >
                上一步
              </Button>
              <Button className="flex-1" disabled={submitting} onClick={handleEnable}>
                {submitting && <Spinner data-icon="inline-start" />}
                启用 PIN
              </Button>
            </div>
          ) : (
            <Button
              variant={isDisable ? 'destructive' : 'default'}
              className="w-full"
              disabled={verifying}
              onClick={handleVerify}
            >
              {verifying && <Spinner data-icon="inline-start" />}
              {isDisable ? '关闭 PIN' : '下一步'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
