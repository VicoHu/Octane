import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { MapPin, Plus, Bookmark as BookmarkIcon } from 'lucide-react';
import type { Bookmark } from '@/shared/types';
import type { OpenTab } from '../../hooks/useOpenTabs';
import { bookmarkMatchesOpenTab } from '@/shared/tabs/matchUrl';
import { isSafeFavIcon } from '@/shared/tabs/safeFavIcon';
import { cn } from '@/lib/utils';
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
    <ul className={styles.list} aria-label="打开的标签页">
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
    </ul>
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
    <li className={styles.card}>
      <Button
        type="button"
        variant="ghost"
        className={cn(styles.mainButton, 'justify-start text-left')}
        aria-label={`打开标签页 ${title}`}
        onClick={onTabClick}
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
            <Tooltip>
              <TooltipTrigger
                render={<div className={styles.savedBadge} role="img" aria-label="已收藏" />}
              >
                <BookmarkIcon className={styles.savedBadgeIcon} />
              </TooltipTrigger>
              <TooltipContent>已在书签库</TooltipContent>
            </Tooltip>
          )}
        </div>

        <div className={styles.info}>
          <div className={styles.title}>{title}</div>
          <div className={styles.host}>{host}</div>
        </div>
      </Button>

      <div className={styles.actions}>
        {tab.pinned && (
          <Tooltip>
            <TooltipTrigger render={<MapPin className={styles.pinIcon} aria-label="已固定" />} />
            <TooltipContent>已固定标签</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                disabled={saveDisabled}
                className={cn(styles.saveBtn, 'text-base')}
                onClick={onSave}
              />
            }
          >
            <Plus />
            存为书签
          </TooltipTrigger>
          <TooltipContent sideOffset={6}>{saveHint || '收藏到当前分类'}</TooltipContent>
        </Tooltip>
      </div>
    </li>
  );
};
