import React, { useState } from 'react';
import { Button, Tooltip } from '@douyinfe/semi-ui';
import { IconMapPin, IconPlus, IconBookmark } from '@douyinfe/semi-icons';
import type { Bookmark } from '@/shared/types';
import type { OpenTab } from '../../hooks/useOpenTabs';
import { bookmarkMatchesOpenTab } from '@/shared/tabs/matchUrl';
import { isSafeFavIcon } from '@/shared/tabs/safeFavIcon';
import styles from './index.module.css';

interface TabListProps {
  /** 当前窗口已打开 tab(useOpenTabs,已过滤内部页) */
  tabs: OpenTab[];
  /** 当前工作区全量书签(跨分类,useBookmarks.allBookmarks),用于跨分类去重判定 */
  bookmarks: Bookmark[];
  /** 当前选中分类;未选则禁用保存 */
  currentCategoryId?: string;
  onTabClick: (tab: OpenTab) => void;
  onSaveTab: (tab: OpenTab) => void;
}

/**
 * 「打开的标签页」紧凑列表(非卡片网格)。
 *
 * autoplan Design 决议:tab 视图用紧凑行(favicon+堆叠 title/host+单 hover 按钮),
 * 密度高于 BookmarkCard。跨分类去重:对每个 tab 遍历全量 bookmarks,命中即「已收藏」、
 * 保存按钮禁用(防跨分类脏数据,见 Eng Review R1)。
 */
export const TabList: React.FC<TabListProps> = ({
  tabs,
  bookmarks,
  currentCategoryId,
  onTabClick,
  onSaveTab,
}) => {
  if (tabs.length === 0) {
    return <div className={styles.empty}>当前窗口没有其他标签页</div>;
  }

  const canSave = !!currentCategoryId;

  // 直接渲染传入的 tabs——排序职责归 useOpenTabs(按浏览器 index 序,与 tab 栏一致)。
  // 此处不二次排序,保持单一数据源。
  return (
    <div className={styles.list} role="list" aria-label="打开的标签页">
      {tabs.map((tab) => {
        // 跨分类去重:命中任意已有书签 → 已收藏
        const saved = bookmarks.some((bm) => bookmarkMatchesOpenTab(bm.url, tab.url));
        return (
          <TabCard
            key={tab.tabId}
            tab={tab}
            saved={saved}
            canSave={canSave}
            onTabClick={() => onTabClick(tab)}
            onSave={() => onSaveTab(tab)}
          />
        );
      })}
    </div>
  );
};

interface TabCardProps {
  tab: OpenTab;
  saved: boolean;
  canSave: boolean;
  onTabClick: () => void;
  onSave: () => void;
}

const TabCard: React.FC<TabCardProps> = ({ tab, saved, canSave, onTabClick, onSave }) => {
  const [faviconError, setFaviconError] = useState(false);
  // title 缺失回退 host,再回退 url
  const host = (() => {
    try {
      return new URL(tab.url).hostname;
    } catch {
      return tab.url;
    }
  })();
  const title = tab.title?.trim() || host;
  const showFavIcon = isSafeFavIcon(tab.favIconUrl) && !faviconError;
  const saveDisabled = saved || !canSave;
  // 保存不可用原因(Tooltip 提示,accessible name 仍取按钮文本「存为书签」)
  const saveHint = saved ? '已在书签库' : canSave ? '' : '请先选择分类';

  return (
    <div
      role="listitem"
      className={styles.card}
      onClick={onTabClick}
      aria-label={`${title}${saved ? ',已收藏' : ''}`}
    >
      <div className={styles.favicon}>
        {showFavIcon ? (
          <img
            src={tab.favIconUrl}
            alt=""
            className={styles.faviconImg}
            onError={() => setFaviconError(true)}
          />
        ) : (
          <div className={styles.fallback}>{title.charAt(0).toUpperCase()}</div>
        )}
        {/* 已收藏角标(favicon 角,镜像 BookmarkCard 的 contextBadge 思路) */}
        {saved && (
          <Tooltip content="已在书签库">
            <div className={styles.savedBadge} role="img" aria-label="已收藏">
              <IconBookmark className={styles.savedBadgeIcon} />
            </div>
          </Tooltip>
        )}
      </div>

      <div className={styles.info}>
        <div className={styles.title}>{title}</div>
        <div className={styles.host}>{host}</div>
      </div>

      <div className={styles.actions}>
        {tab.pinned && (
          <Tooltip content="已固定标签">
            <IconMapPin className={styles.pinIcon} aria-label="已固定" />
          </Tooltip>
        )}
        <Tooltip content={saveHint || '收藏到当前分类'} spacing={6}>
          <Button
            theme="borderless"
            type="tertiary"
            size="small"
            icon={<IconPlus />}
            disabled={saveDisabled}
            className={styles.saveBtn}
            onClick={(e) => {
              e.stopPropagation();
              onSave();
            }}
          >
            存为书签
          </Button>
        </Tooltip>
      </div>
    </div>
  );
};
