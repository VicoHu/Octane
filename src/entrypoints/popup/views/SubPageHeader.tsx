import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Typography } from '@/components/ui/typography';
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
      <Button
        variant="ghost"
        size="icon-sm"
        className={styles.backBtn}
        onClick={onBack}
        aria-label="返回"
        title="返回"
      >
        <ChevronLeft />
      </Button>
      <Typography.Text strong className={styles.subPageTitle}>
        {title}
      </Typography.Text>
      <div className={styles.subPageRight}>{right}</div>
    </div>
  );
}
