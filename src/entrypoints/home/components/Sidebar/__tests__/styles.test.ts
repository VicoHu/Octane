import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/entrypoints/home/components/Sidebar/index.module.css'),
  'utf8',
);

describe('Sidebar 分类选中态样式', () => {
  it('绿色指示条沿用选中项左侧圆角，内侧保持直角', () => {
    const activeIndicator = css.match(/\.catActive::before\s*\{([^}]*)\}/)?.[1];

    expect(activeIndicator).toContain(
      'border-radius: var(--radius-sm) 0 0 var(--radius-sm);',
    );
  });

  it('分类主按钮 hover 保持透明，避免覆盖整行选中标识', () => {
    const categoryMainHover = css.match(
      /\.cat\s*>\s*\.categoryMain:hover\s*\{([^}]*)\}/,
    )?.[1];

    expect(categoryMainHover ?? '').toContain('background: transparent;');
  });
});
