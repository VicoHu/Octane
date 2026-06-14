import type { ReactNode } from 'react';
import { Avatar, List, Typography, Button, Dropdown } from '@douyinfe/semi-ui';
import {
  IconBookmark,
  IconSetting,
  IconChevronRight,
  IconUser,
} from '@douyinfe/semi-icons';
import { useUser } from '../hooks/useUser';
import type { View } from '../navigation';
import styles from '../popup.module.css';

interface HomeViewProps {
  /** 切换到目标视图。 */
  onNavigate: (view: View) => void;
}

interface Feature {
  key: Exclude<View, 'home'>;
  icon: ReactNode;
  title: string;
  desc: string;
  /** 主操作行：视觉强调。 */
  primary?: boolean;
}

/** 首页：用户卡 + 功能列表。 */
export default function HomeView({ onNavigate }: HomeViewProps) {
  const user = useUser();

  const features: Feature[] = [
    {
      key: 'save',
      icon: <IconBookmark />,
      title: '保存当前页面',
      desc: '把这个网页加入书签',
      primary: true,
    },
  ];

  return (
    <div className={styles.home}>
      {/* 用户卡 */}
      <div className={styles.userCard}>
        {user ? (
          <>
            <Avatar color="indigo" size="large" src={user.avatarUrl} alt={user.name}>
              {user.name.slice(0, 1)}
            </Avatar>
            <div className={styles.userInfo}>
              <Typography.Text strong>{user.name}</Typography.Text>
              <Typography.Text type="tertiary" size="small">
                {user.email}
              </Typography.Text>
            </div>
          </>
        ) : (
          <>
            <Avatar color="grey" size="large" alt="未登录">
              <IconUser />
            </Avatar>
            <div className={styles.userInfo}>
              <Typography.Text strong>Octane</Typography.Text>
              <Typography.Text type="tertiary" size="small">
                登录后同步你的书签
              </Typography.Text>
            </div>
            <Button size="small" theme="borderless" type="tertiary" aria-label="登录">
              登录
            </Button>
          </>
        )}

        {/* 右上角下拉：设置 / 退出 */}
        <Dropdown
          position="bottomRight"
          render={
            <Dropdown.Menu>
              <Dropdown.Item onClick={() => onNavigate('settings')}>设置</Dropdown.Item>
              <Dropdown.Item disabled>退出登录</Dropdown.Item>
            </Dropdown.Menu>
          }
        >
          <Button
            className={styles.userMenuTrigger}
            icon={<IconSetting />}
            theme="borderless"
            type="tertiary"
            aria-label="账户菜单"
          />
        </Dropdown>
      </div>

      {/* 功能列表 */}
      <Typography.Text type="tertiary" size="small" className={styles.sectionLabel}>
        功能
      </Typography.Text>
      <List className={styles.featureList} split>
        {features.map((f) => (
          <List.Item
            key={f.key}
            className={f.primary ? styles.featureItemPrimary : styles.featureItem}
            header={f.icon}
            main={
              <>
                <Typography.Text strong={f.primary}>{f.title}</Typography.Text>
                {f.desc && (
                  <Typography.Text type="tertiary" size="small">
                    {f.desc}
                  </Typography.Text>
                )}
              </>
            }
            extra={<IconChevronRight />}
            onClick={() => onNavigate(f.key)}
          />
        ))}
      </List>
    </div>
  );
}
