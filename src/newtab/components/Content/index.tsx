import React, { useState } from 'react';
import { Input, Button, Modal, Form, Toast, Skeleton } from '@douyinfe/semi-ui';
import { IconPlus, IconSearch } from '@douyinfe/semi-icons';
import { useWorkspace } from '@/store/useWorkspace';
import { useBookmarks } from '@/store/useBookmarks';
import { useSearch } from '@/store/useSearch';
import { BookmarkCard } from '@/newtab/components/BookmarkCard';
import { EmptyState } from '@/newtab/components/EmptyState';
import { ContextList } from '@/newtab/components/ContextList';
import type { Bookmark } from '@/shared/types';
import styles from './index.module.css';

export const Content: React.FC = () => {
  const categories = useWorkspace((s) => s.categories);
  const currentCategoryId = useWorkspace((s) => s.currentCategoryId);
  const currentWorkspaceId = useWorkspace((s) => s.currentWorkspaceId);
  const bookmarks = useBookmarks((s) => s.bookmarks);
  const contextPreviews = useBookmarks((s) => s.contextPreviews);
  const loading = useBookmarks((s) => s.loading);
  const createBookmark = useBookmarks((s) => s.createBookmark);
  const query = useSearch((s) => s.query);
  const setQuery = useSearch((s) => s.setQuery);

  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedBookmark, setSelectedBookmark] = useState<Bookmark | null>(null);
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [addFormApi, setAddFormApi] = useState<any>(null);
  const [editFormApi, setEditFormApi] = useState<any>(null);

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

  const handleCardClick = (bookmark: Bookmark) => {
    window.open(bookmark.url, '_blank');
  };

  const handleViewContexts = (bookmark: Bookmark) => {
    setSelectedBookmark(bookmark);
  };

  const handleEditBookmark = (bookmark: Bookmark) => {
    setEditingBookmark(bookmark);
  };

  const handleBookmarkUpdate = async (values: Record<string, string>) => {
    if (!editingBookmark) return;
    try {
      const { updateBookmark } = await import('@/services/BookmarkService');
      await updateBookmark(editingBookmark.id, {
        name: values['name'] ?? editingBookmark.name,
        url: values['url'] ?? editingBookmark.url,
        description: values['description'] ?? editingBookmark.description,
      });
      await useBookmarks.getState().refreshBookmark(editingBookmark.id);
      setEditingBookmark(null);
      Toast.success('书签已更新');
    } catch (e) {
      Toast.error('更新失败：' + (e as Error).message);
    }
  };

  // 无分类时的空状态
  if (!currentCategoryId) {
    return (
      <EmptyState message="请先选择或创建一个分类" />
    );
  }

  return (
    <div className={styles.content}>
      {/* 顶部操作栏 */}
      <div className={styles.toolbar}>
        <h1 className={styles.title}>
          {currentCategory?.icon} {currentCategory?.name ?? ''}
        </h1>

        <Input
          prefix={<IconSearch />}
          placeholder="搜索书签..."
          value={query}
          onChange={setQuery}
          className={styles.searchInput}
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
        <div className={styles.searchHint}>
          找到 {filteredBookmarks.length} 个结果（加密上下文内容不参与搜索）
        </div>
      )}

      {/* 卡片网格 / 空状态 / 加载中 */}
      {loading ? (
        <div className={styles.grid}>
          {[1, 2, 3].map((i) => (
            <Skeleton
              key={i}
              active
              placeholder={
                <div className={styles.skeletonCard}>
                  <Skeleton.Title style={{ width: '60%', marginBottom: 12 }} />
                  <Skeleton.Paragraph rows={2} />
                </div>
              }
            />
          ))}
        </div>
      ) : filteredBookmarks.length === 0 ? (
        <EmptyState
          message={query ? '没有找到匹配的书签' : '添加你的第一个书签'}
          actionLabel={query ? undefined : '添加书签'}
          onAction={query ? undefined : () => setShowAddModal(true)}
        />
      ) : (
        <div className={styles.grid}>
          {filteredBookmarks.map((bookmark) => (
            <BookmarkCard
              key={bookmark.id}
              bookmark={bookmark}
              contextPreview={contextPreviews[bookmark.id]}
              onClick={handleCardClick}
              onViewContexts={handleViewContexts}
              onEditBookmark={handleEditBookmark}
            />
          ))}
        </div>
      )}

      {/* 添加书签弹窗 */}
      <Modal
        title="添加书签"
        visible={showAddModal}
        onCancel={() => setShowAddModal(false)}
        footer={
          <>
            <Button onClick={() => setShowAddModal(false)}>取消</Button>
            <Button theme="solid" onClick={() => addFormApi?.submitForm()}>添加</Button>
          </>
        }
      >
        <Form getFormApi={setAddFormApi} onSubmit={(values) => handleAddBookmark(values as Record<string, string>)}>
          <Form.Input field="url" label="URL" placeholder="https://example.com" rules={[{ required: true, message: '请输入 URL' }]} />
          <Form.Input field="name" label="名称" placeholder="留空则使用域名" />
          <Form.TextArea field="description" label="描述" placeholder="可选" maxLength={200} />
        </Form>
      </Modal>

      {/* 上下文列表（侧滑面板） */}
      <ContextList
        bookmark={selectedBookmark}
        visible={!!selectedBookmark}
        onClose={() => setSelectedBookmark(null)}
      />

      {/* 书签信息编辑弹窗 */}
      <Modal
        title="编辑书签"
        visible={!!editingBookmark}
        onCancel={() => setEditingBookmark(null)}
        footer={
          <>
            <Button onClick={() => setEditingBookmark(null)}>取消</Button>
            <Button theme="solid" onClick={() => editFormApi?.submitForm()}>保存</Button>
          </>
        }
      >
        <Form
          key={editingBookmark?.id}
          getFormApi={setEditFormApi}
          onSubmit={(values) => handleBookmarkUpdate(values as Record<string, string>)}
          initValues={{
            url: editingBookmark?.url ?? '',
            name: editingBookmark?.name ?? '',
            description: editingBookmark?.description ?? '',
          }}
        >
          <Form.Input field="url" label="URL" placeholder="https://example.com" rules={[{ required: true, message: '请输入 URL' }]} />
          <Form.Input field="name" label="名称" placeholder="留空则使用域名" />
          <Form.TextArea field="description" label="描述" placeholder="可选" maxLength={200} />
        </Form>
      </Modal>
    </div>
  );
};
