import SubPageHeader from './SubPageHeader';
import { LocalBackupSection } from './backup/LocalBackupSection';
import styles from '../popup.module.css';

interface SettingsViewProps {
  onBack: () => void;
}

/** 设置子页面：本地数据备份（导入/导出）。 */
export default function SettingsView({ onBack }: SettingsViewProps) {
  return (
    <div className={styles.settingsView}>
      <SubPageHeader title="设置" onBack={onBack} />
      <LocalBackupSection />
    </div>
  );
}
