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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { Toast } from '@/components/ui/toast';
import { TriangleAlert } from 'lucide-react';
import { unlock, setupPin, disablePin } from '@/services/CryptoService';
import { useCrypto } from '@/store/useCrypto';
import type { PinFormat } from '@/shared/types';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** enable = 启用/修改 PIN；disable = 关闭 PIN（仅验证主密码） */
  intent: 'enable' | 'disable';
}

const FORMAT_OPTIONS: { value: PinFormat; label: string }[] = [
  { value: 'digits-4', label: '4 位数字' },
  { value: 'digits-6', label: '6 位数字' },
  { value: 'custom', label: '自定义（至少 4 位，可含字母）' },
];

/**
 * 快速解锁 PIN 管理弹窗（#96）。
 *
 * 主密码门槛：启用/修改/关闭均强制验证主密码（即使当前已解锁——防止解锁状态下离席被劫持）。
 * 验证直接走 CryptoService.unlock：成功即派生校验并写入共享 key，随后的 setupPin 有密钥可包装。
 */
export const PinSetupModal: React.FC<Props> = ({ visible, intent, onClose }) => {
  const refreshPinStatus = useCrypto((s) => s.refreshPinStatus);
  const [masterPassword, setMasterPassword] = useState('');
  const [format, setFormat] = useState<PinFormat>('digits-6');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [persistEnvelope, setPersistEnvelope] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 防双触发：Enter 连按时避免并发 setup/disable
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      setMasterPassword('');
      setFormat('digits-6');
      setPin('');
      setConfirmPin('');
      setPersistEnvelope(false);
      setError('');
    }
  }, [visible]);

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      setError('');

      // 主密码验证（强制完整 PBKDF2 + verifier，成功顺带解锁）
      const ok = await unlock(masterPassword);
      if (!ok) {
        setError('主密码错误');
        return;
      }

      if (intent === 'disable') {
        await disablePin();
        await refreshPinStatus();
        Toast.success('PIN 已关闭');
        onClose();
        return;
      }

      if (pin !== confirmPin) {
        setError('两次 PIN 不一致');
        return;
      }
      if (pin === masterPassword) {
        setError('PIN 不能与主密码相同');
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
      // unlock（未设主密码等）/ disablePin / refreshPinStatus 拒绝时兜底展示，避免 unhandled rejection
      setError((e as Error).message || '操作失败，请重试');
    } finally {
      setSubmitting(false);
      submittingRef.current = false;
    }
  };

  const isDisable = intent === 'disable';

  return (
    <Dialog open={visible} onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby="pin-setup-desc">
        <DialogHeader>
          <DialogTitle>{isDisable ? '关闭快速解锁 PIN' : '设置快速解锁 PIN'}</DialogTitle>
          <DialogDescription id="pin-setup-desc">
            {isDisable
              ? '验证主密码后关闭 PIN。之后解锁将始终要求主密码。'
              : '用 PIN 代替主密码日常解锁。主密码仍是唯一加密根，忘记 PIN 时随时可改用主密码。'}
          </DialogDescription>
        </DialogHeader>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input
            type="password"
            placeholder="主密码（验证身份）"
            value={masterPassword}
            onChange={(e) => setMasterPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSubmit();
            }}
            autoFocus
          />

          {!isDisable && (
            <>
              <div className="grid gap-2">
                {FORMAT_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <input
                      type="radio"
                      name="pin-format"
                      value={opt.value}
                      checked={format === opt.value}
                      onChange={() => setFormat(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              <Input
                type="password"
                inputMode={format === 'custom' ? undefined : 'numeric'}
                placeholder={format === 'custom' ? '输入 PIN（至少 4 位）' : `输入 ${format === 'digits-4' ? '4' : '6'} 位数字 PIN`}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
              <Input
                type="password"
                inputMode={format === 'custom' ? undefined : 'numeric'}
                placeholder="确认 PIN"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSubmit();
                }}
              />
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <Checkbox
                  checked={persistEnvelope}
                  onCheckedChange={(checked) => setPersistEnvelope(checked === true)}
                  className="mt-0.5"
                />
                <span>
                  重启浏览器后仍可用 PIN 解锁（无需主密码）
                </span>
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
            </>
          )}

          {error && (
            <div style={{ color: 'var(--destructive)', fontSize: 13 }}>{error}</div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant={isDisable ? 'destructive' : 'default'}
            className="w-full"
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting && <Spinner data-icon="inline-start" />}
            {isDisable ? '关闭 PIN' : '启用 PIN'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
