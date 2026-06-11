import React, { useState } from 'react';
import { Input, Button, Modal, Form, Toast } from '@douyinfe/semi-ui';
import { IconPlus, IconSearch } from '@douyinfe/semi-icons';
import { useWorkspace } from '@/store/useWorkspace';
import { useBookmarks } from '@/store/useBookmarks';
import { useSearch } from '@/store/useSearch';
import { BookmarkCard } from '@/newtab/components/BookmarkCard';
import { EmptyState } from '@/newtab/components/EmptyState';
import { NoteEditor } from '@/newtab/components/NoteEditor';
import type { Bookmark } from '@/shared/types';

export const Content: React.FC = () => {
  const categories = useWorkspace((s) => s.categories);
  const currentCategoryId = useWorkspace((s) => s.currentCategoryId);
  const currentWorkspaceId = useWorkspace((s) => s.currentWorkspaceId);
  const bookmarks = useBookmarks((s) => s.bookmarks);
  const loading = useBookmarks((s) => s.loading);
  const createBookmark = useBookmarks((s) => s.createBookmark);
  const deleteBookmark = useBookmarks((s) => s.deleteBookmark);
  const query = useSearch((s) => s.query);
  const setQuery = useSearch((s) => s.setQuery);

  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedBookmark, setSelectedBookmark] = useState<Bookmark | null>(null);

  const currentCategory = categories.find((c) => c.id === currentCategoryId);

  // 过滤书签
  const filteredBookmarks = query
    ? bookmarks.filter(
        (b) =>
          b.name.toLowerCase().includes(query.toLowerCase()) ||
          b.url.toLowerCase().includes(query.toLowerCase()) ||
          b.description.toLowerCase().includes(query.toLowerCase()),
      )
    : bookmarks;

  const handleAddBookmark = async (values: Record<string, string>) => {
    if (!currentWorkspaceId || !currentCategoryId) return;
    try {
      const url = values['url'] ?? '';
      const name = values['name'] || (() => { try { return new URL(url).hostname; } catch { return url; } })();
      await createBookmark(currentWorkspaceId, currentCategoryId, {
        name,
        url,
        description: values['description'],
      });
      setShowAddModal(false);
      Toast.success('书签已添加');
    } catch (e) {
      Toast.error('添加失败：' + (e as Error).message);
    }
  };

  const handleDeleteBookmark = async (id: string) => {
    try {
      await deleteBookmark(id);
      if (selectedBookmark?.id === id) {
        setSelectedBookmark(null);
      }
      Toast.success('书签已删除');
    } catch {
      Toast.error('删除失败');
    }
  };

  const handleCardClick = (bookmark: Bookmark) => {
    setSelectedBookmark(bookmark);
  };

  // 无分类时的空状态
  if (!currentCategoryId) {
    return (
      <EmptyState message="请先选择或创建一个分类" />
    );
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      {/* 顶部操作栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, flexShrink: 0 }}>
          {currentCategory?.icon} {currentCategory?.name ?? ''}
        </h1>

        <Input
          prefix={<IconSearch />}
          placeholder="搜索书签..."
          value={query}
          onChange={setQuery}
          style={{ flex: 1, maxWidth: 400 }}
          showClear
          onClear={() => setQuery('')}
        />

        <Button
          theme="solid"
          icon={<IconPlus />}
          onClick={() => setShowAddModal(true)}
        >
          添加书签
        </Button>
      </div>

      {/* 搜索提示 */}
      {query && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          找到 {filteredBookmarks.length} 个结果（加密笔记内容不参与搜索）
        </div>
      )}

      {/* 卡片网格 / 空状态 / 加载中 */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ height: 100, background: '#eee', borderRadius: 'var(--radius-md)' }} />
          ))}
        </div>
      ) : filteredBookmarks.length === 0 ? (
        <EmptyState
          message={query ? '没有找到匹配的书签' : '添加你的第一个书签'}
          actionLabel={query ? undefined : '添加书签'}
          onAction={query ? undefined : () => setShowAddModal(true)}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {filteredBookmarks.map((bookmark) => (
            <BookmarkCard
              key={bookmark.id}
              bookmark={bookmark}
              onClick={handleCardClick}
            />
          ))}
        </div>
      )}

      {/* 添加书签弹窗 */}
      <Modal
        title="添加书签"
        visible={showAddModal}
        footer={null}
        onCancel={() => setShowAddModal(false)}
      >
        <Form onSubmit={(values) => handleAddBookmark(values as Record<string, string>)}>
          <Form.Input field="url" label="URL" placeholder="https://example.com" rules={[{ required: true, message: '请输入 URL' }]} />
          <Form.Input field="name" label="名称" placeholder="留空则使用域名" />
          <Form.TextArea field="description" label="描述" placeholder="可选" maxLength={200} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Button onClick={() => setShowAddModal(false)}>取消</Button>
            <Button htmlType="submit" theme="solid">添加</Button>
          </div>
        </Form>
      </Modal>

      {/* 笔记编辑器（侧滑面板） */}
      <NoteEditor
        bookmark={selectedBookmark}
        visible={!!selectedBookmark}
        onClose={() => setSelectedBookmark(null)}
        onDelete={handleDeleteBookmark}
      />
    </div>
  );
};
