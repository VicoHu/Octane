import React from 'react';
import { Popover, Button } from '@douyinfe/semi-ui';
import styles from './dnd.module.css';

interface GripButtonProps {
  /**
   * useSortable().listeners —— dnd-kit SyntheticListenerMap(= Record<string, Function>,
   * 该 type 未从公共入口导出)。这里宽松接收 Record<string, unknown>,内部 spread 时再
   * 当作 button 事件 handler 处理,避免依赖内部类型并绕开 Function 类型 lint。
   */
  listeners?: Record<string, unknown>;
  /** 搜索态/≤1 元素:置灰 + cursor not-allowed + 改 title;HTML disabled 天然阻断 pointer 透传 */
  disabled?: boolean;
  className?: string;
  /** 首启 coachmark(T9):显示「拖动手柄可排序」Popover,关闭/首次拖拽后不再显 */
  coachmark?: { onClose: () => void };
}

/**
 * GripButton —— 4 层拖拽统一的拖拽手柄(D6 根决策)。
 *
 * - useSortable() 的 listeners 收敛到此 button,整卡 onClick(跳转/选中/打开)保留不破坏。
 * - color:inherit 让 grip 自适应所在面:浅色面(BookmarkCard/ManagePanel)随深文,
 *   深色面(Sidebar/PinnedArea)随浅文;opacity .45(静止)/.9(hover)统一。
 * - 常驻态(ManagePanel)由父级 className .gripAlwaysVisible 控制常显。
 * - T9 coachmark:首个书签 grip 首启显示 Popover 提示(localStorage flag 见 Content)。
 */
export const GripButton: React.FC<GripButtonProps> = ({ listeners, disabled, className, coachmark }) => {
  const title = disabled ? '清除搜索后可拖拽排序' : '拖拽排序';
  const inner = (
    <button
      type="button"
      className={`${styles.grip}${className ? ` ${className}` : ''}`}
      aria-roledescription="可拖拽项"
      aria-label={title}
      title={title}
      disabled={disabled}
      {...(disabled ? {} : (listeners as React.ComponentProps<'button'>))}
    >
      {/* 6 点 grip(两列三行),fill=currentColor 跟随 grip 的 color:inherit */}
      <svg
        className={styles.gripIcon}
        width="20"
        height="20"
        viewBox="0 0 20 20"
        aria-hidden="true"
        focusable="false"
        fill="currentColor"
      >
        <circle cx="6" cy="5" r="1.4" />
        <circle cx="14" cy="5" r="1.4" />
        <circle cx="6" cy="10" r="1.4" />
        <circle cx="14" cy="10" r="1.4" />
        <circle cx="6" cy="15" r="1.4" />
        <circle cx="14" cy="15" r="1.4" />
      </svg>
    </button>
  );
  // 无 coachmark:直接返回(4 层绝大多数 grip 走此路径,不引入 Popover 开销)
  if (!coachmark) return inner;
  return (
    <Popover
      visible
      trigger="custom"
      position="top"
      content={
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          {/* grip 小图标呼应 trigger 手柄,增强「这个手柄可拖」语义 */}
          <svg
            width="14"
            height="14"
            viewBox="0 0 20 20"
            aria-hidden="true"
            focusable="false"
            fill="currentColor"
            style={{ color: 'var(--semi-color-text-2)', flexShrink: 0 }}
          >
            <circle cx="6" cy="5" r="1.4" />
            <circle cx="14" cy="5" r="1.4" />
            <circle cx="6" cy="10" r="1.4" />
            <circle cx="14" cy="10" r="1.4" />
            <circle cx="6" cy="15" r="1.4" />
            <circle cx="14" cy="15" r="1.4" />
          </svg>
          <span style={{ fontWeight: 500 }}>拖动手柄可排序</span>
          <Button size="small" theme="solid" onClick={coachmark.onClose}>知道了</Button>
        </div>
      }
    >
      {inner}
    </Popover>
  );
};
