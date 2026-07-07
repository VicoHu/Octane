import { describe, it, expect, vi } from 'vitest';
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: () => ({ destroy() {}, play() {}, pause() {}, addEventListener() {}, removeEventListener() {} }),
    destroy() {}, registerAnimation() {},
  },
}));
vi.mock('@/services/ContextService', () => ({
  getContexts: vi.fn().mockResolvedValue([
    { id: 'ctx1', title: '上下文一', isEncrypted: false, updatedAt: 0, type: 'note', order: 0, createdAt: 0 },
  ]),
  createContext: vi.fn(),
  deleteContext: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/store/useBookmarks', () => ({
  useBookmarks: (sel: (s: Record<string, unknown>) => unknown) => sel({ refreshBookmark: vi.fn() }),
}));
vi.mock('../../ContextEditor', () => ({ ContextEditor: () => null }));

import { render, screen } from '@testing-library/react';
import { ContextList } from '../../ContextList';
import type { Bookmark } from '@/shared/types';

const bookmark = {
  id: 'b1', workspaceId: 'w1', categoryId: 'c1', name: '测试书签',
  url: 'https://github.com', description: '', faviconUrl: '',
  contextCount: 1, hasEncryptedContext: false, createdAt: 0, updatedAt: 0,
} as Bookmark;

describe('ContextList（T6 Semi List 迁移）', () => {
  it('加载后渲染上下文列表项', async () => {
    render(<ContextList bookmark={bookmark} visible={true} onClose={vi.fn()} />);
    expect(await screen.findByText('上下文一')).toBeTruthy();
  });
});
