import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appCss = readFileSync(
  resolve(process.cwd(), 'src/entrypoints/home/App.css'),
  'utf8',
);
const sidebarCss = readFileSync(
  resolve(process.cwd(), 'src/entrypoints/home/components/Sidebar/index.module.css'),
  'utf8',
);

const ruleBody = (css: string, selector: string) =>
  css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('AppRail — 工作区导航样式', () => {
  it('工作区列表可纵向滚动且隐藏滚动条', () => {
    const workspaceList = ruleBody(appCss, '.app-rail-workspace-list');

    expect(workspaceList).toContain('overflow-y: auto;');
    expect(appCss).toMatch(/\.app-rail-workspace-list::?-webkit-scrollbar\s*\{[^}]*display:\s*none;/s);
  });

  it('保持 Logo 和头像尺寸不变', () => {
    const logo = ruleBody(appCss, '.app-rail-logo');
    const avatar = ruleBody(appCss, '.app-rail-avatar');

    expect(logo).toMatch(/width:\s*36px;[\s\S]*height:\s*36px;/);
    expect(logo).toContain('flex-shrink: 0;');
    expect(avatar).toMatch(/width:\s*32px;[\s\S]*height:\s*32px;/);
    expect(avatar).toContain('flex-shrink: 0;');
  });

  it('固定导航项不收缩且新旧 rail 分别保持正确间距', () => {
    expect(ruleBody(appCss, '.app-rail-separator')).toContain('flex-shrink: 0;');
    expect(ruleBody(appCss, '.app-rail-group')).toContain('flex-shrink: 0;');
    expect(ruleBody(appCss, '.app-rail-group')).toContain('margin-top: 30px;');
    expect(appCss).toMatch(
      /\.app-rail-separator\s*\+\s*\.app-rail-group\s*\{[^}]*margin-top:\s*0;/,
    );
  });

  it('当前工作区使用品牌绿实底，且不依赖会被裁切的外置竖条', () => {
    const currentWorkspace = ruleBody(appCss, '.app-rail-workspace-button.is-current');

    expect(currentWorkspace).toContain('background: var(--primary);');
    expect(currentWorkspace).toContain('color: var(--primary-foreground);');
    expect(appCss).not.toContain('.app-rail-workspace-button.is-current::before');
  });

  it('主页与待办事项共用互斥的激活态样式', () => {
    const activePage = ruleBody(appCss, '.app-rail-button.is-active');

    expect(activePage).toContain('background: var(--primary);');
    expect(activePage).toContain('color: #202829;');
  });

  it('当前工作区悬停时保持品牌绿选中态', () => {
    const currentWorkspaceHover = ruleBody(
      appCss,
      '.app-rail-workspace-button.is-current:hover',
    );

    expect(currentWorkspaceHover).toContain('background: var(--primary);');
    expect(currentWorkspaceHover).toContain('color: var(--primary-foreground);');
  });

  it('工作区区块仅在 760px 以下恢复显示', () => {
    expect(ruleBody(sidebarCss, '.workspaceSection')).toContain('display: none;');
    expect(sidebarCss).toMatch(
      /@media\s*\(max-width:\s*760px\)[\s\S]*\.workspaceSection\s*\{[^}]*display:\s*flex;/,
    );
  });
});
