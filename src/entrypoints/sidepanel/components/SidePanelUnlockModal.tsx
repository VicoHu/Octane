import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { unlock } from '@/services/UnlockSession';

interface SidePanelUnlockModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * sidepanel 加密上下文解锁弹窗（仅 unlock 模式）。
 *
 * 与 home 的 UnlockModal 区别：不复用 useCrypto store，提交直接调
 * UnlockSession.unlock('sidepanel', pwd)（每次完整 PBKDF2+verifier，防偷看）。
 * 解锁成功后写入共享 octane-derived-key + sidepanel 标记，onChanged 广播触发
 * 所有 useEncryptedContexts 重渲染。TTL 失焦/硬上限锁由 useSidePanelUnlockLifecycle 负责。
 *
 * 宽度：side panel 视口窄（Chrome side panel 最小 ~300px），用 calc(100vw - 32px) 自适应，
 * 避免默认 460px 横向溢出。按钮放 footer（Semi 自动留底部 padding，不贴边）。
 */
export function SidePanelUnlockModal({ open, onClose }: SidePanelUnlockModalProps) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 防双触发：Enter 连按时避免并发 unlock（session 广播与状态错乱）
  const submittingRef = useRef(false);

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setError('');
      setLoading(true);
      const ok = await unlock('sidepanel', password);
      if (ok) {
        Toast.success('已解锁');
        setPassword('');
        onClose();
      } else {
        setError('密码错误');
      }
    } catch (e) {
      setError((e as Error).message || '解锁失败');
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>解锁加密上下文</DialogTitle>
        </DialogHeader>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, color: 'var(--muted-foreground)', fontSize: 13 }}>
            输入主密码以解锁当前 side panel 的加密上下文。离开超时或达硬上限将自动重新锁定。
          </p>
          <Input
            type="password"
            placeholder="输入主密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
            className="h-9"
            autoFocus
          />
          {error && (
            <div style={{ color: 'var(--destructive)', fontSize: 13 }}>{error}</div>
          )}
        </div>
        <DialogFooter>
          <Button variant="default" size="lg" disabled={loading} onClick={handleSubmit}>
            {loading ? '解锁中…' : '解 锁'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
