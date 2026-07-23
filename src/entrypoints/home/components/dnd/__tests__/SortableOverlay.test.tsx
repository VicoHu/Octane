import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SortableOverlay } from '../SortableOverlay';

/**
 * SortableOverlay 的 invalid 传递测(M5)。
 *
 * DragOverlay 是 dnd-kit 的 portal 呈现原语(非拖拽时不渲染 children),为隔离测
 * SortableOverlay 的 invalid→overlayInvalid 类组合契约,局部 mock 为透传(类似规范
 * 对 Semi Toast 的 partial mock —— DragOverlay 是呈现依赖,非被测对象)。dnd-kit 真
 * 拖拽在 jsdom 难测(brief),留给真机 QA。
 */
const dragOverlayProps = vi.hoisted(() => ({ modifiers: undefined as unknown }));

vi.mock('@dnd-kit/core', () => ({
  DragOverlay: ({ children, modifiers }: { children: ReactNode; modifiers?: unknown }) => {
    dragOverlayProps.modifiers = modifiers;
    return children;
  },
}));

describe('SortableOverlay — invalid 传递(M5 非法落区 overlay)', () => {
  it('invalid=false(默认):应用 overlay + tone 描边类,无 overlayInvalid', () => {
    render(
      <SortableOverlay tone="light">
        <span>卡</span>
      </SortableOverlay>,
    );
    const overlay = screen.getByText('卡').parentElement!;
    expect(overlay.className).toMatch(/overlay/);
    expect(overlay.className).toMatch(/overlayLight/);
    expect(overlay.className).not.toMatch(/overlayInvalid/);
  });

  it('invalid=true:叠加 overlayInvalid 类(降透明 .5 + not-allowed,由 CSS 实现)', () => {
    render(
      <SortableOverlay tone="dark" invalid>
        <span>卡</span>
      </SortableOverlay>,
    );
    const overlay = screen.getByText('卡').parentElement!;
    expect(overlay.className).toMatch(/overlayInvalid/);
  });

  it('tone=dark:应用 overlayDark 类(深色面浅描边,非炭灰)', () => {
    render(
      <SortableOverlay tone="dark">
        <span>卡</span>
      </SortableOverlay>,
    );
    const overlay = screen.getByText('卡').parentElement!;
    expect(overlay.className).toMatch(/overlayDark/);
  });

  it('透传 workspace overlay 的位移约束', () => {
    const modifiers = [vi.fn()];
    render(
      <SortableOverlay modifiers={modifiers}>
        <span>受约束卡</span>
      </SortableOverlay>,
    );

    expect(dragOverlayProps.modifiers).toBe(modifiers);
  });
});
