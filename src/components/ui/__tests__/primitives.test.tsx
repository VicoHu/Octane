import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Plus } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

describe('共享 UI 原语', () => {
  it('默认按钮使用炭灰主操作语义且不影响描边按钮', () => {
    render(
      <>
        <Button>
          <Plus data-icon="inline-start" />
          添加书签
        </Button>
        <Button variant="outline">取消</Button>
      </>,
    );

    const primary = screen.getByRole('button', { name: '添加书签' });
    const outline = screen.getByRole('button', { name: '取消' });

    expect(primary).toHaveClass(
      'bg-action-primary',
      'text-action-primary-foreground',
      'hover:bg-action-primary-hover',
      'active:bg-action-primary-active',
      '[&_svg]:text-action-primary-icon',
    );
    expect(primary).not.toHaveClass('bg-primary', 'text-primary-foreground');
    expect(outline).not.toHaveClass(
      'bg-action-primary',
      'text-action-primary-foreground',
    );
  });

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

  it('纵向 Tabs 内嵌横向 Tabs 时不继承外层方向选择器', () => {
    render(
      <Tabs defaultValue="settings" orientation="vertical">
        <TabsList aria-label="外层标签页" variant="line">
          <TabsTrigger value="settings">设置</TabsTrigger>
        </TabsList>
        <TabsContent value="settings">
          <Tabs defaultValue="local" orientation="horizontal">
            <TabsList
              aria-label="内层备份方式"
              aria-orientation="horizontal"
            >
              <TabsTrigger value="local">本地备份</TabsTrigger>
            </TabsList>
            <TabsContent value="local">本地备份内容</TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>,
    );

    const outerList = screen.getByRole('tablist', { name: '外层标签页' });
    const innerList = screen.getByRole('tablist', { name: '内层备份方式' });
    const innerTrigger = screen.getByRole('tab', { name: '本地备份' });

    expect(outerList).toHaveAttribute('aria-orientation', 'vertical');
    expect(innerList).toHaveAttribute('aria-orientation', 'horizontal');
    expect(innerList).toHaveClass('data-[orientation=horizontal]:h-9');
    expect(innerList).not.toHaveClass(
      'group-data-[orientation=vertical]/tabs:h-fit',
    );
    expect(innerTrigger).toHaveClass(
      'data-[orientation=horizontal]:after:bottom-[-5px]',
    );
    expect(innerTrigger).not.toHaveClass(
      'group-data-[orientation=vertical]/tabs:w-full',
    );
  });

  it('Alert 以警报语义呈现正文', () => {
    render(
      <Alert variant="default">
        <AlertDescription>同步将在网络恢复后继续。</AlertDescription>
      </Alert>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('同步将在网络恢复后继续。');
  });
});
