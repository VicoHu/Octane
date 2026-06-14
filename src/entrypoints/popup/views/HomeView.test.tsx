import { describe, it, expect, vi } from 'vitest';
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: () => ({
      destroy() {},
      play() {},
      pause() {},
      addEventListener() {},
      removeEventListener() {},
    }),
    destroy() {},
    registerAnimation() {},
  },
}));
import { render, screen, fireEvent } from '@testing-library/react';
import { useUser } from '../hooks/useUser';
import HomeView from './HomeView';

// 自动 mock useUser，逐测试用 vi.mocked 控制返回值
vi.mock('../hooks/useUser');

describe('HomeView', () => {
  it('guest 态：展示品牌名与登录引导', () => {
    vi.mocked(useUser).mockReturnValue(null);
    render(<HomeView onNavigate={vi.fn()} />);
    expect(screen.getByText('Octane')).toBeTruthy();
    expect(screen.getByText('登录后同步你的书签')).toBeTruthy();
    expect(screen.getByRole('button', { name: '登录' })).toBeTruthy();
  });

  it('登录态：展示用户名与邮箱', () => {
    vi.mocked(useUser).mockReturnValue({
      id: 'u1',
      name: 'VicoHu',
      email: 'vico@example.com',
    });
    render(<HomeView onNavigate={vi.fn()} />);
    expect(screen.getByText('VicoHu')).toBeTruthy();
    expect(screen.getByText('vico@example.com')).toBeTruthy();
  });

  it('点击「保存当前页面」调用 onNavigate("save")', () => {
    vi.mocked(useUser).mockReturnValue(null);
    const onNavigate = vi.fn();
    render(<HomeView onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('保存当前页面'));
    expect(onNavigate).toHaveBeenCalledWith('save');
  });

  it('渲染账户菜单入口（设置按钮）', () => {
    vi.mocked(useUser).mockReturnValue(null);
    render(<HomeView onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: '账户菜单' })).toBeTruthy();
  });
});
