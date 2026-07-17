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
    expect(ruleBody(appCss, '.app-rail-logo')).toMatch(/width:\s*36px;[\s\S]*height:\s*36px;/);
    expect(ruleBody(appCss, '.app-rail-avatar')).toMatch(/width:\s*32px;[\s\S]*height:\s*32px;/);
  });

  it('工作区区块仅在 760px 以下恢复显示', () => {
    expect(ruleBody(sidebarCss, '.workspaceSection')).toContain('display: none;');
    expect(sidebarCss).toMatch(
      /@media\s*\(max-width:\s*760px\)[\s\S]*\.workspaceSection\s*\{[^}]*display:\s*flex;/,
    );
  });
});
