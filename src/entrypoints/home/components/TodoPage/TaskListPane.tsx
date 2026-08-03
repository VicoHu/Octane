import { TodoNavigationTrigger } from './TodoNavigation';
import styles from './index.module.css';

export function TaskListPane({ onOpenNavigation }: { onOpenNavigation: () => void }) {
  return (
    <section className={styles.listPane} aria-label="待办列表">
      <header className={styles.paneHeader}>
        <TodoNavigationTrigger onClick={onOpenNavigation} />
        <h1>待办事项</h1>
      </header>
      <div className={styles.paneBody}>暂无待办</div>
    </section>
  );
}
