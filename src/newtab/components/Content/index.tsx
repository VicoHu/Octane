import React, { useEffect, useState } from 'react';
import { Input, Button, Modal, Form, Toast, Skeleton, Tabs, TabPane } from '@douyinfe/semi-ui';
import { IconPlus, IconSearch } from '@douyinfe/semi-icons';
import { useWorkspace } from '@/store/useWorkspace';
import { useBookmarks } from '@/store/useBookmarks';
import { useSearch } from '@/store/useSearch';
import { useOpenTabs } from '@/newtab/hooks/useOpenTabs';
import type { OpenTab } from '@/newtab/hooks/useOpenTabs';
import { bookmarkMatchesOpenTab, pickMostRecentMatchingTab } from '@/shared/tabs/matchUrl';
import { focusTab } from '@/shared/tabs/focusTab';
import { BookmarkCard } from '@/newtab/components/BookmarkCard';
import { EmptyState } from '@/newtab/components/EmptyState';
import { ContextList } from '@/newtab/components/ContextList';
import { TabList } from '@/newtab/components/TabList';
import type { Bookmark } from '@/shared/types';
import styles from './index.module.css';

type View = 'bookmarks' | 'tabs';

export const Content: React.FC = () => {
  const categories = useWorkspace((s) => s.categories);
  const currentCategoryId = useWorkspace((s) => s.currentCategoryId);
  const currentWorkspaceId = useWorkspace((s) => s.currentWorkspaceId);
  const bookmarks = useBookmarks((s) => s.bookmarks);
  const allBookmarks = useBookmarks((s) => s.allBookmarks);
  const loading = useBookmarks((s) => s.loading);
  const createBookmark = useBookmarks((s) => s.createBookmark);
  const loadAllByWorkspace = useBookmarks((s) => s.loadAllByWorkspace);
  const openTabs = useOpenTabs();
  const query = useSearch((s) => s.query);
  const setQuery = useSearch((s) => s.setQuery);

  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedBookmark, setSelectedBookmark] = useState<Bookmark | null>(null);
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [addFormApi, setAddFormApi] = useState<any>(null);
  const [editFormApi, setEditFormApi] = useState<any>(null);
  // 视图切换:默认「书签」(向后兼容);「标签页」= 打开的 tab 一等视图
  const [activeView, setActiveView] = useState<View>('bookmarks');
  // 从 tab 触发保存时携带的预填源(null=手动「添加书签」)
  const [saveFromTab, setSaveFromTab] = useState<OpenTab | null>(null);

  const currentCategory = categories.find((c) => c.id === currentCategoryId);

  // 跨分类去重数据源:进入工作区即加载全量书签(独立于当前分类切片 bookmarks)
  useEffect(() => {
    if (currentWorkspaceId) void loadAllByWorkspace(currentWorkspaceId);
  }, [currentWorkspaceId, loadAllByWorkspace]);

  // 过滤书签
  const filteredBookmarks = query
    ? bookmarks.filter(
        (b) =>
          b.name.toLowerCase().includes(query.toLowerCase()) ||
          b.url.toLowerCase().includes(query.toLowerCase()) ||
          b.description.toLowerCase().includes(query.toLowerCase()),
      )
    : bookmarks;

  const openAddForTab = (tab: OpenTab) => {
    setSaveFromTab(tab);
    setShowAddModal(true);
  };

  const openAddManual = () => {
    setSaveFromTab(null);
    setShowAddModal(true);
  };

  const handleAddBookmark = async (values: Record<string, string>) => {
    if (!currentWorkspaceId) return;
    // 分类:表单选择器优先,回退当前选中分类(R4 升级,防存错桶)
    const categoryId = values['categoryId'] || currentCategoryId;
    if (!categoryId) return;
    try {
      const url = values['url'] ?? '';
      const name = values['name'] || (() => { try { return new URL(url).hostname; } catch { return url; } })();
      const created = await createBookmark(currentWorkspaceId, categoryId, {
        name,
        url,
        description: values['description'],
      });
      setShowAddModal(false);
      setSaveFromTab(null);
      // save→context 漏斗(R5):保存后引导加上下文,把 tab/书签引流进 Octane 加密护城河
      Toast.success({
        content: (
          <span>
            书签已保存{' '}
            <a
              role="button"
              onClick={() => setSelectedBookmark(created)}
              style={{ fontWeight: 600 }}
            >
              添加上下文
            </a>
          </span>
        ),
        duration: 5,
      });
    } catch (e) {
      Toast.error('添加失败：' + (e as Error).message);
    }
  };

  const handleTabClick = (tab: OpenTab) => {
    // 跳转到对应 tab;focusTab 内置 stale tabId 兜底(R2)
    void focusTab(tab.tabId, tab.url);
  };

  const handleCardClick = (bookmark: Bookmark) => {
    // Phase 2：匹配到已打开 tab → 聚焦「最近活跃」的那个;否则新建标签。
    // useOpenTabs 数据源按 index 排序,这里用 pickMostRecentMatchingTab 显式取最近活跃,
    // 不依赖数组顺序(保持原 Phase 2 语义)。
    const tab = pickMostRecentMatchingTab(openTabs, bookmark.url);
    if (tab) {
      void focusTab(tab.tabId, tab.url);
    } else {
      window.open(bookmark.url, '_blank');
    }
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
      // description 允许清空：Semi Form 清空字段提交值为 undefined，
      // 不能用 `?? editingBookmark.description` 回退（会把"清空"误判为"未改动"）。
      // name/url 保留原值兜底（url 必填；name 清空时回退原名，避免空名）。
      await updateBookmark(editingBookmark.id, {
        name: values['name'] ?? editingBookmark.name,
        url: values['url'] ?? editingBookmark.url,
        description: values['description'] ?? '',
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

  // 添加书签弹窗的预填值 + key(切换源时重置表单)
  const addModalKey = saveFromTab ? `tab-${saveFromTab.tabId}` : 'manual';
  const addInitValues: Record<string, string> = {
    categoryId: currentCategoryId,
    url: saveFromTab?.url ?? '',
    name: saveFromTab?.title ?? '',
    description: '',
  };

  return (
    <div className={styles.content}>
      {/* 顶部操作栏 */}
      <div className={styles.toolbar}>
        <h1 className={styles.title}>
          {currentCategory?.icon} {currentCategory?.name ?? ''}
        </h1>

        {/* tabs 视图:显式提示保存目标分类(防存错桶,Design 决议) */}
        {activeView === 'tabs' && (
          <span className={styles.saveTarget}>
            保存至：{currentCategory?.icon} {currentCategory?.name}
          </span>
        )}

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
          onClick={openAddManual}
        >
          添加书签
        </Button>
      </div>

      {/* 搜索提示(仅书签视图) */}
      {activeView === 'bookmarks' && query && (
        <div className={styles.searchHint}>
          找到 {filteredBookmarks.length} 个结果（加密上下文内容不参与搜索）
        </div>
      )}

      {/* 视图切换:卡片式 Tabs(书签 / 标签页)。默认书签,向后兼容 */}
      <Tabs
        type="card"
        activeKey={activeView}
        onChange={(key) => setActiveView(key as View)}
        keepDOM={false}
        contentStyle={{ paddingTop: 'var(--space-md)' }}
      >
        <TabPane tab="书签" itemKey="bookmarks">
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
              onAction={query ? undefined : openAddManual}
            />
          ) : (
            <div className={styles.grid}>
              {filteredBookmarks.map((bookmark) => (
                <BookmarkCard
                  key={bookmark.id}
                  bookmark={bookmark}
                  hasOpenTab={openTabs.some((t) => bookmarkMatchesOpenTab(bookmark.url, t.url))}
                  onClick={handleCardClick}
                  onViewContexts={handleViewContexts}
                  onEditBookmark={handleEditBookmark}
                />
              ))}
            </div>
          )}
        </TabPane>

        <TabPane tab={`标签页(${openTabs.length})`} itemKey="tabs">
          <TabList
            tabs={openTabs}
            bookmarks={allBookmarks}
            currentCategoryId={currentCategoryId}
            onTabClick={handleTabClick}
            onSaveTab={openAddForTab}
          />
        </TabPane>
      </Tabs>

      {/* 添加书签弹窗(支持从 tab 预填 + 分类选择器 R4) */}
      <Modal
        title={saveFromTab ? '从标签页保存书签' : '添加书签'}
        visible={showAddModal}
        onCancel={() => {
          setShowAddModal(false);
          setSaveFromTab(null);
        }}
        footer={
          <>
            <Button onClick={() => { setShowAddModal(false); setSaveFromTab(null); }}>取消</Button>
            <Button theme="solid" onClick={() => addFormApi?.submitForm()}>添加</Button>
          </>
        }
      >
        <Form
          key={addModalKey}
          getFormApi={setAddFormApi}
          initValues={addInitValues}
          onSubmit={(values) => handleAddBookmark(values as Record<string, string>)}
        >
          <Form.Select
            field="categoryId"
            label="分类"
            style={{ width: '100%' }}
            optionList={categories.map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` }))}
          />
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
