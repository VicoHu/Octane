import type { ReactNode } from 'react';
import { Bookmark, Settings, ChevronRight, User, Home as HomeIcon } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Typography } from '@/components/ui/typography';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useUser } from '../hooks/useUser';
import { focusOrCreateHomeTab } from '@/shared/tabs/focusOrCreateHomeTab';
import type { View } from '../navigation';
import styles from '../popup.module.css';
import { cn } from '@/lib/utils';

interface HomeViewProps {
  /** 切换到目标视图。 */
  onNavigate: (view: View) => void;
}

interface Feature {
  /** 切换到目标视图（与 onClick 二选一）。 */
  key?: Exclude<View, 'home'>;
  /** 自定义点击行为，如唤起 logo tab（与 key 二选一）。 */
  onClick?: () => void;
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
      icon: <Bookmark />,
      title: '保存当前页面',
      desc: '把这个网页加入书签',
      primary: true,
    },
    {
      onClick: () => void focusOrCreateHomeTab(),
      icon: <HomeIcon />,
      title: '打开书签主页',
      desc: '在固定标签页管理全部书签',
    },
  ];

  return (
    <div className={styles.home}>
      {/* 用户卡 */}
      <div className={styles.userCard}>
        {user ? (
          <>
            <Avatar className="size-10">
              <AvatarImage src={user.avatarUrl} alt={user.name} />
              <AvatarFallback>{user.name.slice(0, 1)}</AvatarFallback>
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
            <Avatar className="size-10">
              <AvatarFallback>
                <User />
              </AvatarFallback>
            </Avatar>
            <div className={styles.userInfo}>
              <Typography.Text strong>Octane</Typography.Text>
              <Typography.Text type="tertiary" size="small">
                登录后同步你的书签
              </Typography.Text>
            </div>
            <Button size="sm" variant="ghost" aria-label="登录">
              登录
            </Button>
          </>
        )}

        {/* 右上角下拉：设置 / 退出 */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                className={styles.userMenuTrigger}
                variant="ghost"
                size="icon-sm"
                aria-label="账户菜单"
              >
                <Settings />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onNavigate('settings')}>设置</DropdownMenuItem>
            <DropdownMenuItem disabled>退出登录</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 功能列表 */}
      <Typography.Text type="tertiary" size="small" className={styles.sectionLabel}>
        功能
      </Typography.Text>
      <ul className={cn(styles.featureList, 'flex flex-col')}>
        {features.map((f) => (
          <li key={f.key ?? 'action'}>
            <Button
              variant="ghost"
              className={cn(
                'h-auto w-full justify-start gap-3 px-3 py-3 text-left whitespace-normal',
                f.primary ? styles.featureItemPrimary : styles.featureItem,
              )}
              onClick={() => {
                if (f.onClick) f.onClick();
                else if (f.key) onNavigate(f.key);
              }}
            >
              <span>{f.icon}</span>
              <span className="flex flex-1 flex-col">
                <Typography.Text strong={f.primary}>{f.title}</Typography.Text>
                {f.desc && (
                  <Typography.Text type="tertiary" size="small">
                    {f.desc}
                  </Typography.Text>
                )}
              </span>
              <ChevronRight className="ml-auto" />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
