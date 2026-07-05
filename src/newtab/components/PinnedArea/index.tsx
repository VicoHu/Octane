import { useEffect, useState } from 'react';
import { Modal, Input, Toast } from '@douyinfe/semi-ui';
import { IconPlus, IconClose } from '@douyinfe/semi-icons';
import { usePinnedTabs } from '@/store/usePinnedTabs';
import { useFavicon } from '@/newtab/hooks/useFavicon';
import { BookmarkFaviconPreview } from '@/newtab/components/BookmarkFaviconPreview';
import { PINNED_TAB_CAP } from '@/services/PinnedTabService';
import type { PinnedTab } from '@/shared/types';
import styles from './index.module.css';

interface PinnedAreaProps {
  workspaceId: string;
}

interface PinnedAreaProps {
  workspaceId: string;
}

/**
 * 常驻标签区（per-workspace 跨分类）。挂在 Sidebar 工作区切换下方、分类列表上方。
 *
 * - 数据：mount/workspaceId 变更时 loadPinnedTabs；跨 context 实时刷新由 newtab App 订阅 BroadcastChannel（T6）
 * - 空状态（D4=B）：始终渲染「常驻」标题 + 空提示，chip 行末位「+」按钮始终在
 * - chip：方向 A 方形（图标上/名称下），中性炭灰抬升面，不用绿（守 §2.3 绿色预算）
 * - 上限：PINNED_TAB_CAP=8，满则「+」disabled + Toast
 */
export function PinnedArea({ workspaceId }: PinnedAreaProps) {
  const pinnedTabs = usePinnedTabs((s) => s.pinnedTabs);
  const loadPinnedTabs = usePinnedTabs((s) => s.loadPinnedTabs);
  const createPinnedTab = usePinnedTabs((s) => s.createPinnedTab);
  const deletePinnedTab = usePinnedTabs((s) => s.deletePinnedTab);

  useEffect(() => {
    loadPinnedTabs(workspaceId);
  }, [workspaceId, loadPinnedTabs]);

  const [modalOpen, setModalOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');

  const atCap = pinnedTabs.length >= PINNED_TAB_CAP;

  const handleDelete = (id: string) => {
    // 失败也给用户反馈，避免 unhandled rejection 静默
    deletePinnedTab(id).catch(() => Toast.error('删除失败，请重试'));
  };

  const handleAddClick = () => {
    if (atCap) {
      Toast.warning(`该工作区常驻标签已满 (${PINNED_TAB_CAP}/${PINNED_TAB_CAP})`);
      return;
    }
    setUrl('');
    setName('');
    setModalOpen(true);
  };

  const handleCreate = async () => {
    const u = url.trim();
    const n = name.trim();
    if (!u || !n) return;
    try {
      await createPinnedTab(workspaceId, { url: u, name: n });
      Toast.success(`已常驻「${n}」`);
      setModalOpen(false);
    } catch (e) {
      // cap/dedup 错误：Toast 提示，不抛到 UI（store 已保持切片不变）
      Toast.warning((e as Error).message);
    }
  };

  return (
    <div className={styles.area}>
      <div className={styles.sectionLabel}>常驻</div>
      {pinnedTabs.length === 0 && (
        <div className={styles.emptyHint}>点 + 添加常驻标签</div>
      )}
      <div className={styles.chipRow}>
        {pinnedTabs.map((pin) => (
          <PinChip key={pin.id} pin={pin} onDelete={() => handleDelete(pin.id)} />
        ))}
        <button
          type="button"
          className={styles.addBtn}
          aria-label="添加常驻标签"
          disabled={atCap}
          onClick={handleAddClick}
        >
          <IconPlus />
        </button>
      </div>

      <Modal
        title="添加常驻标签"
        visible={modalOpen}
        onOk={handleCreate}
        onCancel={() => setModalOpen(false)}
        okText="确定"
        maskClosable={false}
      >
        <div className={styles.modalForm}>
          <Input placeholder="链接 URL" value={url} onChange={setUrl} aria-label="常驻标签 URL" />
          <Input placeholder="名称" value={name} onChange={setName} aria-label="常驻标签名称" />
          <div className={styles.previewRow}>
            <BookmarkFaviconPreview url={url} />
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** 单个常驻 chip：favicon 上 / 名称下，hover 出 × 删除 */
function PinChip({ pin, onDelete }: { pin: PinnedTab; onDelete: () => void }) {
  const faviconSrc = useFavicon(pin.url);
  const src = faviconSrc?.src;
  const initial = (pin.name.charAt(0) || '?').toUpperCase();

  return (
    <div className={styles.chipWrap}>
      <button
        type="button"
        className={styles.chip}
        aria-label={`打开 ${pin.name}`}
        title={pin.name}
        onClick={() => window.open(pin.url, '_blank')}
      >
        <div className={styles.favicon}>
          {src ? (
            <img src={src} alt="" className={styles.faviconImg} />
          ) : (
            <span className={styles.fallback}>{initial}</span>
          )}
        </div>
        <span className={styles.chipName}>{pin.name}</span>
      </button>
      <button
        type="button"
        className={styles.deleteBtn}
        aria-label={`取消常驻 ${pin.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <IconClose />
      </button>
    </div>
  );
}
