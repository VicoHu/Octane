import type { ReactNode } from 'react';
import { IconChevronLeft } from '@douyinfe/semi-icons';
import { Typography } from '@douyinfe/semi-ui';
import styles from '../popup.module.css';

interface SubPageHeaderProps {
  title: string;
  onBack: () => void;
  /** 标题栏右侧槽位（可选）。 */
  right?: ReactNode;
}

/** 子页面通用返回头：左侧返回按钮 + 居中标题 + 可选右侧槽位。 */
export default function SubPageHeader({ title, onBack, right }: SubPageHeaderProps) {
  return (
    <div className={styles.subPageHeader}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={onBack}
        aria-label="返回"
      >
        <IconChevronLeft />
      </button>
      <Typography.Text strong className={styles.subPageTitle}>
        {title}
      </Typography.Text>
      <div className={styles.subPageRight}>{right}</div>
    </div>
  );
}
