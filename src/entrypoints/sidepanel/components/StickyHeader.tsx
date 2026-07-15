import { Plus } from 'lucide-react';
import { useFavicon } from '@/hooks/useFavicon';
import styles from './StickyHeader.module.css';

interface StickyHeaderProps {
  hostname: string;
  matchCount: number;
  /** 添加按钮回调（导航到 home tab） */
  onAdd: () => void;
  /** Pin 当前 Tab 回调（图标按钮，挂在 addBtn 旁） */
  onPin: () => void;
}

/**
 * side panel 顶栏：favicon + hostname + 命中统计 + Pin 按钮 + 添加按钮。
 * sticky 固定在顶部，滚动时常驻。
 */
export function StickyHeader({ hostname, matchCount, onAdd, onPin }: StickyHeaderProps) {
  const faviconSrc = useFavicon(`https://${hostname}`);
  return (
    <div className={styles.header}>
      <img
        src={faviconSrc?.src ?? ''}
        alt=""
        className={styles.favicon}
        style={{ visibility: faviconSrc ? undefined : 'hidden' }}
        onError={faviconSrc?.onError}
      />
      <div className={styles.info}>
        <div className={styles.hostname}>{hostname}</div>
        <div className={styles.count}>{matchCount} 个书签命中</div>
      </div>
      <button className={styles.iconBtn} onClick={onPin} aria-label="Pin 当前 Tab" title="Pin 当前 Tab">
        📌
      </button>
      <button className={styles.addBtn} onClick={onAdd} aria-label="添加书签" title="添加书签">
        <Plus />
      </button>
    </div>
  );
}
