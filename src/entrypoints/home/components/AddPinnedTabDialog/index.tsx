import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { BookmarkFaviconPreview } from '@/components/BookmarkFaviconPreview';
import { usePinnedTabs } from '@/store/usePinnedTabs';
import { PINNED_TAB_CAP } from '@/services/PinnedTabService';
import type { PinnedTab } from '@/shared/types';
import styles from './index.module.css';

interface AddPinnedTabDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** 预填 URL(tab 入口传 tab.url;PinnedArea 入口传空串) */
  initialUrl?: string;
  /** 预填名称(tab 入口传 tab.title;PinnedArea 入口传空串) */
  initialName?: string;
  /** 创建成功回调(可选) */
  onCreated?: (pin: PinnedTab) => void;
}

/**
 * 添加常驻标签 Modal(共享组件)。
 *
 * PinnedArea 的「+」入口与 home 标签页视图的「存为常驻标签」入口共用。
 * - 预填:open 由 false→true 时一次性写入 initialUrl/initialName(只依赖 open,
 *   避免开着手 initialUrl 变化误触);Dialog 模态,打开期间背后点不到其他 tab。
 * - atCap(>=PINNED_TAB_CAP):确定按钮 disabled(兜底;主入口应已在调用前拦截)。
 * - 失败(dedup/cap/scheme):Toast.warning,不关闭,让用户改后重试。
 */
export function AddPinnedTabDialog({
  open,
  onOpenChange,
  workspaceId,
  initialUrl = '',
  initialName = '',
  onCreated,
}: AddPinnedTabDialogProps) {
  const pinnedTabs = usePinnedTabs((s) => s.pinnedTabs);
  const createPinnedTab = usePinnedTabs((s) => s.createPinnedTab);
  const [url, setUrl] = useState(initialUrl);
  const [name, setName] = useState(initialName);

  // open 翻为 true 时一次性预填;依赖 [open] 以避免开着手 initialUrl 变化误触
  useEffect(() => {
    if (open) {
      setUrl(initialUrl);
      setName(initialName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const atCap = pinnedTabs.length >= PINNED_TAB_CAP;

  const handleCreate = async () => {
    const u = url.trim();
    const n = name.trim();
    if (!u || !n) return;
    try {
      const pin = await createPinnedTab(workspaceId, { url: u, name: n });
      Toast.success(`已常驻「${n}」`);
      onCreated?.(pin);
      onOpenChange(false);
    } catch (e) {
      // cap/dedup/scheme 错误:Toast 提示,不关闭(让用户改后重试)
      Toast.warning((e as Error).message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加常驻标签</DialogTitle>
        </DialogHeader>
        <div className={styles.modalForm}>
          <Input placeholder="链接 URL" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="常驻标签 URL" />
          <Input placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} aria-label="常驻标签名称" />
          <div className={styles.previewRow}>
            <BookmarkFaviconPreview url={url} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="default" disabled={atCap} onClick={handleCreate}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
