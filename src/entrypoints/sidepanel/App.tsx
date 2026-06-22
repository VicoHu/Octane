import { useCurrentTabContext } from './hooks/useCurrentTabContext';
import { useHostBookmarks } from './hooks/useHostBookmarks';
import { StickyHeader } from './components/StickyHeader';
import { BookmarkGroup } from './components/BookmarkGroup';
import { focusOrCreateHomeTab } from '@/shared/tabs/focusOrCreateHomeTab';
import styles from './App.module.css';

/** 唤起 logo tab：当前窗口已有 pinned home tab → 聚焦，否则创建 pinned。 */
function openNewtab() {
  void focusOrCreateHomeTab();
}

/**
 * Side Panel 根组件：四状态编排 + 按书签分组渲染。
 *
 * 状态机：
 * - tab loading → 加载中
 * - hostname null（非 http(s)）→ 此页面不支持联动
 * - useHostBookmarks loading → 匹配中
 * - matched 空 → 空状态
 * - matched 有 → StickyHeader + BookmarkGroup[]
 */
export default function App() {
  const { hostname, loading: tabLoading } = useCurrentTabContext();
  const { matched, loading: matching } = useHostBookmarks(hostname);

  if (tabLoading) {
    return <div className={styles.state}>加载中…</div>;
  }
  if (!hostname) {
    return <div className={styles.state}>此页面不支持联动</div>;
  }
  if (matching) {
    return <div className={styles.state}>匹配中…</div>;
  }
  if (matched.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyText}>该页面暂无匹配书签</div>
        <button className={styles.manageBtn} onClick={openNewtab}>在 Octane 管理</button>
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <StickyHeader hostname={hostname} matchCount={matched.length} onAdd={openNewtab} />
      <div className={styles.list} role="list">
        {matched.map((b) => (
          <BookmarkGroup key={b.id} bookmark={b} />
        ))}
      </div>
    </div>
  );
}
