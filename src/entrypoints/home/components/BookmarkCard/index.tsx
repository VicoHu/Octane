import React, { useEffect, useState } from 'react';
import { Card as SemiCard, Button, Tooltip, Popconfirm } from '@douyinfe/semi-ui';
import { IconLock, IconComment, IconEdit, IconDelete } from '@douyinfe/semi-icons';
import type { Bookmark } from '@/shared/types';
import { useFavicon } from '@/hooks/useFavicon';
import styles from './index.module.css';

// Semi Card 的 CardProps 未声明 role / onClick，运行时透传到 DOM 但类型缺失。
// 这里扩展为带 HTML 属性的组件类型，保留 a11y 与点击行为。
const Card = SemiCard as React.ComponentType<
  React.ComponentProps<typeof SemiCard> & { role?: string; onClick?: React.MouseEventHandler<HTMLElement> }
>;

interface BookmarkCardProps {
  bookmark: Bookmark;
  /** 该书签是否匹配到当前窗口已打开的 tab（左侧竖线标识） */
  hasOpenTab?: boolean;
  /** 拖拽手柄 slot(可选;由 SortableBookmarkCard 注入 GripButton,纯 BookmarkCard 不传) */
  grip?: React.ReactNode;
  onClick: (bookmark: Bookmark) => void;
  onViewContexts: (bookmark: Bookmark) => void;
  onEditBookmark: (bookmark: Bookmark) => void;
  onDelete: (bookmark: Bookmark) => void;
}

export const BookmarkCard: React.FC<BookmarkCardProps> = ({ bookmark, hasOpenTab, grip, onClick, onViewContexts, onEditBookmark, onDelete }) => {
  const faviconSrc = useFavicon(bookmark.url);
  const [faviconError, setFaviconError] = useState(false);
  // src 变化（remote 占位 → 后台抓取切 blob，或 url 切换）时重置 error 态。
  // 否则早先 remote 占位加载失败置的 faviconError 会遮盖后续成功的 blob，永远显示首字母。
  useEffect(() => {
    setFaviconError(false);
  }, [faviconSrc?.src]);
  // Phase 3：点击已打开书签跳转时，竖线做一次脉冲动效（设计 §4.3）
  const [pulsing, setPulsing] = useState(false);
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
      shadows="hover"
      bodyStyle={{ display: 'flex', gap: 'var(--space-md)', padding: 'var(--space-lg)', alignItems: 'center' }}
      className={`${styles.card} ${hasOpenTab ? styles.cardHasOpenTab : ''} ${pulsing ? styles.pulsing : ''}`}
    >
      {/* 拖拽手柄(D6:grip 是唯一拖拽触发器,hover 显;操作区 data-no-dnd 防冒泡) */}
      {grip && <div className={styles.gripSlot}>{grip}</div>}

      {/* Favicon（useFavicon 加载失败时回退首字母）+ 右下角上下文徽章 */}
      <div className={styles.favicon}>
        {faviconSrc && !faviconError ? (
          <img
            src={faviconSrc.src}
            alt=""
            className={styles.faviconImg}
            onError={() => setFaviconError(true)}
          />
        ) : (
          <div className={styles.fallback}>
            {bookmark.name.charAt(0).toUpperCase()}
          </div>
        )}
        {bookmark.contextCount > 0 && (
          <Tooltip content={badgeTooltip}>
            <div
              className={styles.contextBadge}
              role="img"
              aria-label={badgeTooltip}
            >
              {bookmark.hasEncryptedContext ? (
                <IconLock className={styles.contextBadgeIcon} />
              ) : (
                <span className={styles.contextBadgeDot} />
              )}
            </div>
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
        <Tooltip content="查看上下文">
          <Button
            theme="borderless"
            type="tertiary"
            icon={<IconComment />}
            aria-label="查看上下文"
            className={styles.actionBtn}
            onClick={(e) => {
              e.stopPropagation();
              onViewContexts(bookmark);
            }}
          />
        </Tooltip>
        <Tooltip content="编辑书签">
          <Button
            theme="borderless"
            type="tertiary"
            icon={<IconEdit />}
            aria-label="编辑书签"
            className={styles.actionBtn}
            onClick={(e) => {
              e.stopPropagation();
              onEditBookmark(bookmark);
            }}
          />
        </Tooltip>
        {/* 删除：级联删上下文，Popconfirm 二次确认。文案按 contextCount 分支（0 条时不显示无意义计数）。
            onConfirm 用 body block 不返回 Promise——否则 Semi Popconfirm 进入异步 loading 模式，
            其 overlay(z-index 1030) 遮挡 Toast(1010)，导致删除成功 Toast 不可见。 */}
        <Popconfirm
          title="删除书签"
          content={
            bookmark.contextCount > 0
              ? `将同时删除 ${bookmark.contextCount} 条上下文，不可撤销`
              : '确定删除该书签？'
          }
          okType="danger"
          position="bottomRight"
          onConfirm={() => {
            onDelete(bookmark);
          }}
        >
          <Button
            theme="borderless"
            type="danger"
            icon={<IconDelete />}
            aria-label="删除书签"
            className={styles.actionBtn}
            onClick={(e) => e.stopPropagation()}
          />
        </Popconfirm>
      </div>
    </Card>
  );
};
