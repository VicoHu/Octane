import { IconPlus } from '@douyinfe/semi-icons';
import { useFavicon } from '@/newtab/hooks/useFavicon';
import styles from './StickyHeader.module.css';

interface StickyHeaderProps {
  hostname: string;
  matchCount: number;
  /** 添加按钮回调（P2 占位：导航到 newtab） */
  onAdd: () => void;
}

/**
 * side panel 顶栏：favicon + hostname + 命中统计 + 添加按钮（占位）。
 * sticky 固定在顶部，滚动时常驻。
 */
export function StickyHeader({ hostname, matchCount, onAdd }: StickyHeaderProps) {
  // CONCERN: 跨 entrypoint import（sidepanel → newtab/hooks）。wxt/vite 可解析，
  // 但耦合了 entrypoint 边界；后续可考虑提到 shared 层。
  const faviconSrc = useFavicon(`https://${hostname}`);
  return (
    <div className={styles.header}>
      <img
        src={faviconSrc?.src ?? ''}
        alt=""
        className={styles.favicon}
        style={{ visibility: faviconSrc ? undefined : 'hidden' }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.visibility = 'hidden';
        }}
      />
      <div className={styles.info}>
        <div className={styles.hostname}>{hostname}</div>
        <div className={styles.count}>{matchCount} 个书签命中</div>
      </div>
      <button className={styles.addBtn} onClick={onAdd} aria-label="添加书签">
        <IconPlus />
      </button>
    </div>
  );
}
