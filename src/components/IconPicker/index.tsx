import React, { useState } from 'react';
import { Input } from '@douyinfe/semi-ui';
import { isEmoji } from '@/shared/utils/emoji';
import { PRESET_ICONS } from './preset';
import styles from './index.module.css';

export interface IconPickerProps {
  /** 当前选中的 icon */
  value: string;
  /** 选中变化回调（仅在校验通过时触发） */
  onChange: (icon: string) => void;
}

/**
 * emoji 图标选择器：预设网格 + 自由输入（带 Unicode 校验）。
 *
 * - 网格点击：来自预设清单，天然合法，直接回调。
 * - 输入框：onChange 实时用 isEmoji 校验；
 *   合法 → 回调并清空错误；非法 → 不回调并显示错误；空值 → 静默（允许中间态）。
 *
 * 详见 docs/workspace-icon-custom-design.md §4。
 */
export const IconPicker: React.FC<IconPickerProps> = ({ value, onChange }) => {
  const [error, setError] = useState(false);

  const handleInputChange = (input: string) => {
    if (input === '') {
      setError(false);
      return;
    }
    if (isEmoji(input)) {
      setError(false);
      onChange(input);
    } else {
      setError(true);
    }
  };

  return (
    <div>
      {/* 当前选中预览 */}
      <div className={styles.preview}>
        <span className={styles.previewIcon} data-testid="icon-preview">
          {value}
        </span>
        <span>当前图标</span>
      </div>

      {/* 预设网格 */}
      <div className={styles.grid} data-testid="icon-grid">
        {PRESET_ICONS.map((icon) => (
          <button
            key={icon}
            type="button"
            className={`${styles.gridItem} ${icon === value ? styles.selected : ''}`}
            onClick={() => {
              setError(false);
              onChange(icon);
            }}
            aria-label={`选择 ${icon}`}
          >
            {icon}
          </button>
        ))}
      </div>

      {/* 自定义输入 */}
      <div className={styles.inputRow}>
        <Input
          data-testid="icon-input"
          placeholder="或粘贴 / 输入自定义 emoji"
          maxLength={8}
          onChange={handleInputChange}
        />
        {error && (
          <div className={styles.error} data-testid="icon-error">
            仅支持单个 emoji 字符
          </div>
        )}
      </div>
    </div>
  );
};
