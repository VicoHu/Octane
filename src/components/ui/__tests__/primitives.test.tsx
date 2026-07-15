import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

describe('共享 UI 原语', () => {
  it('TabsList 支持 line 视觉变体', () => {
    render(
      <Tabs defaultValue="overview">
        <TabsList aria-label="线型标签页" variant="line">
          <TabsTrigger value="overview">概览</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">概览内容</TabsContent>
      </Tabs>,
    );

    expect(
      screen.getByRole('tablist', { name: '线型标签页' }),
    ).toHaveAttribute('data-variant', 'line');
  });

  it('TabsList 支持 segmented 视觉变体', () => {
    render(
      <Tabs defaultValue="overview">
        <TabsList aria-label="分段标签页" variant="segmented">
          <TabsTrigger value="overview">概览</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">概览内容</TabsContent>
      </Tabs>,
    );

    expect(
      screen.getByRole('tablist', { name: '分段标签页' }),
    ).toHaveAttribute('data-variant', 'segmented');
  });

  it('vertical Tabs 暴露垂直方向并可切换内容', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="general" orientation="vertical">
        <TabsList>
          <TabsTrigger value="general">通用</TabsTrigger>
          <TabsTrigger value="privacy">隐私</TabsTrigger>
        </TabsList>
        <TabsContent value="general">通用设置</TabsContent>
        <TabsContent value="privacy">隐私设置</TabsContent>
      </Tabs>,
    );

    expect(screen.getByRole('tablist')).toHaveAttribute(
      'aria-orientation',
      'vertical',
    );
    expect(screen.getByText('通用设置')).toBeVisible();

    await user.click(screen.getByRole('tab', { name: '隐私' }));

    expect(screen.getByText('隐私设置')).toBeVisible();
    expect(screen.queryByText('通用设置')).not.toBeInTheDocument();
  });

  it('info Alert 以警报语义呈现正文', () => {
    render(
      <Alert variant="info">
        <AlertDescription>同步将在网络恢复后继续。</AlertDescription>
      </Alert>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-variant', 'info');
    expect(alert).toHaveTextContent('同步将在网络恢复后继续。');
  });
});
