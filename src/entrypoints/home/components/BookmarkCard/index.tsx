import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Lock, MessageSquare, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
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
  onClick: (bookmark: Bookmark, event?: React.MouseEvent<HTMLButtonElement>) => void;
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

  const handleOpen = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.metaKey || event.ctrlKey) {
      onClick(bookmark, event);
    } else {
      onClick(bookmark);
    }
    // 有已打开 tab 时触发竖线脉冲（跳转反馈）
    if (hasOpenTab) {
      setPulsing(true);
      setTimeout(() => setPulsing(false), 400);
    }
  };

  return (
    <Card
      role="listitem"
      aria-label={hasOpenTab ? `${bookmark.name}，已打开` : bookmark.name}
      className={`${styles.card} ${hasOpenTab ? styles.cardHasOpenTab : ''} ${pulsing ? styles.pulsing : ''}`}
    >
      <button
        type="button"
        className={styles.mainAction}
        aria-label={`打开书签 ${bookmark.name}`}
        onClick={handleOpen}
      >
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
          {/* Issue #51：有 Tag 时第三行展示 Tag（前 3 个 + N），隐藏描述；无 Tag 时保留描述 */}
          {bookmark.tags.length > 0 ? (
            <div className={styles.tags} aria-label="书签 Tag">
              {bookmark.tags.slice(0, 3).map((tag) => (
                <span key={tag} className={styles.tag}>{tag}</span>
              ))}
              {bookmark.tags.length > 3 && (
                <span className={styles.tagOverflow}>+{bookmark.tags.length - 3}</span>
              )}
            </div>
          ) : (
            bookmark.description && (
              <div className={styles.description}>
                {bookmark.description}
              </div>
            )
          )}
        </div>
      </button>

      {/* 拖拽手柄(D6:grip 是唯一拖拽触发器,hover 显;操作区 data-no-dnd 防冒泡) */}
      {grip && <div className={styles.gripSlot}>{grip}</div>}

      {/* 更多操作（悬停淡入）；data-no-dnd 防拖拽冒泡 */}
      <div className={styles.actions} data-no-dnd>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="更多操作"
                className={styles.actionBtn}
              >
                <MoreHorizontal />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onViewContexts(bookmark)}>
              <MessageSquare />
              查看上下文
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEditBookmark(bookmark)}>
              <Pencil />
              编辑书签
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 />
              删除书签
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 删除：级联删上下文，AlertDialog 二次确认。 */}
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
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
