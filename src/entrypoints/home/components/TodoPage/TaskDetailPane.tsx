import { Button } from '@/components/ui/button';
import styles from './index.module.css';

export function TaskDetailPane({ mobile, onBack }: { mobile: boolean; onBack: () => void }) {
  return (
    <section className={styles.detailPane} aria-label="待办详情">
      <header className={styles.paneHeader}>
        {mobile && <Button variant="ghost" size="sm" onClick={onBack}>返回列表</Button>}
        <h2>详情</h2>
      </header>
      <div className={styles.paneBody}>选择一条待办</div>
    </section>
  );
}
