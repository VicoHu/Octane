import { useMemo } from 'react';
import { useCurrentTabContext } from './hooks/useCurrentTabContext';
import { useHostBookmarks } from './hooks/useHostBookmarks';
import { useSourceMap } from './hooks/useSourceMap';
import { groupBookmarksByWorkspace } from './utils/grouping';
import { StickyHeader } from './components/StickyHeader';
import { BookmarkGroup } from './components/BookmarkGroup';
import { focusOrCreateHomeTab } from '@/shared/tabs/focusOrCreateHomeTab';
import styles from './App.module.css';

/** 唤起 logo tab：当前窗口已有 pinned home tab → 聚焦，否则创建 pinned。 */
function openNewtab() {
  void focusOrCreateHomeTab();
}

/**
 * Side Panel 根组件：四状态编排 + 按工作区/分类分组渲染（来源辨识）。
 *
 * 状态机：
 * - tab loading → 加载中
 * - hostname null（非 http(s)）→ 此页面不支持联动
 * - useHostBookmarks loading → 匹配中
 * - matched 空 → 空状态
 * - matched 有 → StickyHeader + 按工作区→分类分组（sourceMap 就绪后）
 *
 * 来源辨识：sourceMap 未就绪时退化为平铺（不渲染来源名，避免闪烁 undefined）；
 * 就绪后渲染工作区段头 + 分类段头 + 书签卡（卡上常驻分类 chip，R1）。
 */
export default function App() {
  const { hostname, loading: tabLoading } = useCurrentTabContext();
  const { matched, loading: matching } = useHostBookmarks(hostname);
  const { workspaces, categories, ready } = useSourceMap();

  const groups = useMemo(
    () => (ready ? groupBookmarksByWorkspace(matched, workspaces, categories) : []),
    [matched, workspaces, categories, ready],
  );

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
        {groups.map((ws) => {
          const wsCount = ws.categories.reduce((n, c) => n + c.bookmarks.length, 0);
          return (
            <section key={ws.workspaceId} className={styles.wsSection}>
              <div className={styles.wsHeader}>
                <span className={styles.wsIcon}>{ws.workspace?.icon ?? '❓'}</span>
                <span className={styles.wsName}>{ws.workspace?.name ?? '未知工作区'}</span>
                <span className={styles.wsCount}>{wsCount} 个书签</span>
              </div>
              {ws.categories.map((cat) => (
                <div key={cat.categoryId} className={styles.catSection}>
                  <div className={styles.catHeader}>
                    <span className={styles.catIcon}>{cat.category?.icon ?? '❓'}</span>
                    <span className={styles.catName}>{cat.category?.name ?? '未知分类'}</span>
                  </div>
                  {cat.bookmarks.map((b) => (
                    <BookmarkGroup
                      key={b.id}
                      bookmark={b}
                      categoryName={cat.category?.name}
                      categoryIcon={cat.category?.icon}
                    />
                  ))}
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
