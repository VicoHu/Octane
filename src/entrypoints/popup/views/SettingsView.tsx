import { Typography } from '@douyinfe/semi-ui';
import SubPageHeader from './SubPageHeader';
import styles from '../popup.module.css';

interface SettingsViewProps {
  /** 返回首页。 */
  onBack: () => void;
}

/** 设置子页面（v1 占位空壳，等待账户/偏好系统接入）。 */
export default function SettingsView({ onBack }: SettingsViewProps) {
  return (
    <div className={styles.settingsView}>
      <SubPageHeader title="设置" onBack={onBack} />
      <Typography.Text type="tertiary">设置功能开发中</Typography.Text>
    </div>
  );
}
