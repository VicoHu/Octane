import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Lock, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import type { Bookmark } from '@/shared/types';
import { useFavicon } from '@/hooks/useFavicon';
import styles from './index.module.css';

interface BookmarkCardProps {
  bookmark: Bookmark;
  /** 该书签是否匹配到当前窗口已打开的 tab（左侧竖线标识） */
  hasOpenTab?: boolean;
  /** 匹配打开 Tab 时浏览器已解析的 favicon。 */
  runtimeFavIconUrl?: string;
  /** 拖拽手柄 slot(可选;由 SortableBookmarkCard 注入 GripButton,纯 BookmarkCard 不传) */
  grip?: React.ReactNode;
  onClick: (bookmark: Bookmark) => void;
  onViewContexts: (bookmark: Bookmark) => void;
  onEditBookmark: (bookmark: Bookmark) => void;
  onDelete: (bookmark: Bookmark) => void;
}

export const BookmarkCard: React.FC<BookmarkCardProps> = ({ bookmark, hasOpenTab, runtimeFavIconUrl, grip, onClick, onViewContexts, onEditBookmark, onDelete }) => {
  const faviconSrc = useFavicon(bookmark.url, runtimeFavIconUrl);
  // Phase 3：点击已打开书签跳转时，竖线做一次脉冲动效（设计 §4.3）
  const [pulsing, setPulsing] = useState(false);
  // 删除二次确认 AlertDialog 受控开关（shadcn AlertDialogAction 不自动关闭，需手动置 false）
  const [deleteOpen, setDeleteOpen] = useState(false);
  const displayUrl = (() => {
    try {
      return new URL(bookmark.url).hostname;
    } catch {
      return bookmark.url;
    }
  })();

  // 上下文徽章 tooltip / aria-label：有加密时锁优先（设计 §2.1）
  const badgeTooltip = bookmark.hasEncryptedContext
    ? `包含加密上下文（${bookmark.contextCount} 条）`
    : `${bookmark.contextCount} 条上下文`;

  return (
    <Card
      role="listitem"
      aria-label={hasOpenTab ? `${bookmark.name}，已打开` : bookmark.name}
      onClick={() => {
        onClick(bookmark);
        // 有已打开 tab 时触发竖线脉冲（跳转反馈）
        if (hasOpenTab) {
          setPulsing(true);
          setTimeout(() => setPulsing(false), 400);
        }
      }}
      className={`${styles.card} ${hasOpenTab ? styles.cardHasOpenTab : ''} ${pulsing ? styles.pulsing : ''}`}
    >
      {/* 拖拽手柄(D6:grip 是唯一拖拽触发器,hover 显;操作区 data-no-dnd 防冒泡) */}
      {grip && <div className={styles.gripSlot}>{grip}</div>}

      {/* Favicon（useFavicon 加载失败时回退首字母）+ 右下角上下文徽章 */}
      <div className={styles.favicon}>
        {faviconSrc ? (
          <img
            src={faviconSrc.src}
            alt=""
            className={styles.faviconImg}
            onError={faviconSrc.onError}
          />
        ) : (
          <div className={styles.fallback}>
            {bookmark.name.charAt(0).toUpperCase()}
          </div>
        )}
        {bookmark.contextCount > 0 && (
          <Tooltip>
            <TooltipTrigger
              render={<div className={styles.contextBadge} role="img" aria-label={badgeTooltip} />}
            >
              {bookmark.hasEncryptedContext ? (
                <Lock size={10} className={styles.contextBadgeIcon} />
              ) : (
                <span className={styles.contextBadgeDot} />
              )}
            </TooltipTrigger>
            <TooltipContent>{badgeTooltip}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* 右侧信息 */}
      <div className={styles.info}>
        <div className={styles.name}>{bookmark.name}</div>
        <div className={styles.url}>{displayUrl}</div>
        {bookmark.description && (
          <div className={styles.description}>
            {bookmark.description}
          </div>
        )}
      </div>

      {/* 操作按钮区（悬停淡入的右上角悬浮图标按钮）*/}
      {/* 容器级 stopPropagation：按钮间空白不触发卡片跳转（防误触）;data-no-dnd 防拖拽冒泡 */}
      <div className={styles.actions} data-no-dnd onClick={(e) => e.stopPropagation()}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="查看上下文"
                className={styles.actionBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onViewContexts(bookmark);
                }}
              />
            }
          >
            <MessageSquare />
          </TooltipTrigger>
          <TooltipContent>查看上下文</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="编辑书签"
                className={styles.actionBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onEditBookmark(bookmark);
                }}
              />
            }
          >
            <Pencil />
          </TooltipTrigger>
          <TooltipContent>编辑书签</TooltipContent>
        </Tooltip>
        {/* 删除：级联删上下文，AlertDialog 二次确认。文案按 contextCount 分支（0 条时不显示无意义计数）。
            AlertDialogAction 不自动关闭，需 setDeleteOpen(false)；content 经 Portal 不冒泡到卡片。 */}
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogTrigger
            render={
              <Button
                variant="destructive"
                size="icon-sm"
                aria-label="删除书签"
                className={styles.actionBtn}
                onClick={(e) => e.stopPropagation()}
              />
            }
          >
            <Trash2 />
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除书签</AlertDialogTitle>
              <AlertDialogDescription>
                {bookmark.contextCount > 0
                  ? `将同时删除 ${bookmark.contextCount} 条上下文，不可撤销`
                  : '确定删除该书签？'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  onDelete(bookmark);
                  setDeleteOpen(false);
                }}
              >
                删除
              </AlertDialogAction>
              <AlertDialogCancel>取消</AlertDialogCancel>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </Card>
  );
};
