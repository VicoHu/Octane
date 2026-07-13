import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Input, Button, Modal, Form, Toast, Skeleton, Tabs, TabPane } from '@douyinfe/semi-ui';
import { IconPlus, IconSearch } from '@douyinfe/semi-icons';
import { useWorkspace } from '@/store/useWorkspace';
import { useBookmarks } from '@/store/useBookmarks';
import { useSearch } from '@/store/useSearch';
import { useOpenTabs } from '../../hooks/useOpenTabs';
import type { OpenTab } from '../../hooks/useOpenTabs';
import { bookmarkMatchesOpenTab, pickMostRecentMatchingTab } from '@/shared/tabs/matchUrl';
import { focusTab } from '@/shared/tabs/focusTab';
import * as CategoryService from '@/services/CategoryService';
import { BookmarkCard } from '../BookmarkCard';
import { SortableBookmarkCard } from '../BookmarkCard/SortableBookmarkCard';
import { SortableOverlay } from '../dnd/SortableOverlay';
import { computeDropIndicator } from '../dnd/computeDropIndicator';
import dndStyles from '../dnd/dnd.module.css';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import {
  BookmarkOpsPanel,
  type BookmarkOpsPanelHandle,
  type BookmarkOpsPanelSubmit,
} from '../BookmarkOpsPanel';
import { EmptyState } from '../EmptyState';
import { ContextList } from '../ContextList';
import { TabList } from '../TabList';
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
  const reorderBookmarks = useBookmarks((s) => s.reorderBookmarks);
  const loadAllByWorkspace = useBookmarks((s) => s.loadAllByWorkspace);
  const openTabs = useOpenTabs();
  const query = useSearch((s) => s.query);
  const setQuery = useSearch((s) => s.setQuery);

  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedBookmark, setSelectedBookmark] = useState<Bookmark | null>(null);
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [addFormApi, setAddFormApi] = useState<any>(null);
  // 视图切换:默认「书签」(向后兼容);「标签页」= 打开的 tab 一等视图
  const [activeView, setActiveView] = useState<View>('bookmarks');
  // 从 tab 触发保存时携带的预填源(null=手动「添加书签」)
  const [saveFromTab, setSaveFromTab] = useState<OpenTab | null>(null);

  const currentCategory = categories.find((c) => c.id === currentCategoryId);

  // 编辑面板：工作区列表 + 异步分类加载器（级联 Select 数据源）+ ref（footer 保存按钮调 submit）
  const workspaces = useWorkspace((s) => s.workspaces);
  const editPanelRef = useRef<BookmarkOpsPanelHandle>(null);
  const categoriesLoader = useCallback(
    (wsId: string) => CategoryService.listCategories(wsId),
    [],
  );

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

  // === T4 拖拽排序(Content grid 层)===
  // activationConstraint distance:8 兜底(grip listener),防 click 误触为拖拽
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [activeBookmarkId, setActiveBookmarkId] = useState<string | null>(null);
  const activeBookmark = activeBookmarkId
    ? filteredBookmarks.find((b) => b.id === activeBookmarkId) ?? null
    : null;

  // === T9 首启 coachmark:首个书签 grip 提示「拖动手柄可排序」,localStorage flag 一次性 ===
  const [coachSeen, setCoachSeen] = useState(() => {
    try {
      return localStorage.getItem('dragSortCoachSeen') === 'true';
    } catch {
      return false;
    }
  });
  const markCoachSeen = useCallback(() => {
    setCoachSeen(true);
    try {
      localStorage.setItem('dragSortCoachSeen', 'true');
    } catch {
      // 静默:隐私模式/配额异常不阻断主流程
    }
  }, []);

  // 连发锁:drop 写入期间锁定该容器(防 store 乐观重排与回滚在并发 drop 下相互覆盖)
  const [reordering, setReordering] = useState(false);
  // D7 插入线:grid 容器 ref 定位(2D 轴感知)
  const containerRef = useRef<HTMLDivElement>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    axis: 'horizontal' | 'vertical';
    position: 'before' | 'after';
    top: number;
    left: number;
  } | null>(null);
  // M5 非法落区:over=null(拖出 grid)→ overlay 降透明 .5
  const [invalid, setInvalid] = useState(false);

  const handleDragStart = (e: DragStartEvent) => {
    setActiveBookmarkId(String(e.active.id));
    // 首次拖拽关闭 coachmark(用户已发现手柄)
    if (!coachSeen) markCoachSeen();
  };
  const handleDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) {
      setDropIndicator(null);
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (active.id === over.id) {
      setDropIndicator(null);
      return;
    }
    const activeRect = active.rect.current.translated;
    const overRect = over.rect;
    if (!activeRect || !overRect) return;
    const containerEl = containerRef.current;
    if (!containerEl) return;
    const { axis, position } = computeDropIndicator({ activeRect, overRect, layout: '2d' });
    const cRect = containerEl.getBoundingClientRect();
    setDropIndicator({
      axis,
      position,
      top: overRect.top - cRect.top + (axis === 'horizontal' && position === 'after' ? overRect.height : 0),
      left: overRect.left - cRect.left + (axis === 'vertical' && position === 'after' ? overRect.width : 0),
    });
  };
  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveBookmarkId(null);
    setDropIndicator(null);
    setInvalid(false);
    // 同位 / 无落区 / 无分类 → 不动(回弹由 store 乐观回滚 + useSortable transition)
    if (!over || active.id === over.id || !currentCategoryId) return;
    const oldIndex = filteredBookmarks.findIndex((b) => b.id === active.id);
    const newIndex = filteredBookmarks.findIndex((b) => b.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const orderedIds = arrayMove(filteredBookmarks, oldIndex, newIndex).map((b) => b.id);
    // store 乐观重排 + 失败回滚已处理(波2);UI 层 catch → Toast,卡片自然回弹
    setReordering(true);
    try {
      await reorderBookmarks(currentCategoryId, orderedIds);
      // drop 成功不弹 Toast,顺序即反馈(brief 状态矩阵)
    } catch {
      Toast.error('排序未保存，请重试');
    } finally {
      setReordering(false);
    }
  };

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

  const handleBookmarkSubmit = async (values: BookmarkOpsPanelSubmit) => {
    if (!editingBookmark) return;
    try {
      const { updateBookmark } = await import('@/services/BookmarkService');
      const wsChanged = values.workspaceId !== editingBookmark.workspaceId;
      const catChanged = values.categoryId !== editingBookmark.categoryId;
      const moved = wsChanged || catChanged;
      // name 清空回退原名（与原编辑逻辑一致）；description 清空为 ''
      const nextName = values.name || editingBookmark.name;
      const nextUrl = values.url || editingBookmark.url;
      const nextDesc = values.description ?? '';
      const propsChanged =
        nextName !== editingBookmark.name ||
        nextUrl !== editingBookmark.url ||
        nextDesc !== editingBookmark.description;

      // 1. 属性更新（name/url/description）写库
      if (propsChanged) {
        await updateBookmark(editingBookmark.id, { name: nextName, url: nextUrl, description: nextDesc });
      }
      // 2. 移动（workspaceId/categoryId 变）——moveBookmark 内部 update ws+cat 并按方向同步双切片
      //    不能用 refreshBookmark 处理移动:map 语义无法移除,且会破坏 ContextEditor 第二 caller
      if (moved) {
        await useBookmarks
          .getState()
          .moveBookmark(editingBookmark.id, values.workspaceId, values.categoryId);
      }
      // 3. 属性改后刷新切片。纯编辑→refreshBookmark 刷双切片;
      //    移动+改属性→moveBookmark 用切片旧数据(旧 name),需 refresh 重读 DB 最新:
      //      同ws跨cat:allBookmarks 保留该条,refresh map 拿到新 name ✓
      //      跨ws:allBookmarks 已被 moveBookmark filter 移除,refresh map 无匹配(无害,书签已离开当前视图)
      if (propsChanged) {
        await useBookmarks.getState().refreshBookmark(editingBookmark.id);
      }

      setEditingBookmark(null);
      // 移动三分支 Toast
      if (moved) {
        if (wsChanged) {
          const ws = workspaces.find((w) => w.id === values.workspaceId);
          Toast.success(`已移动到「${ws?.name ?? '其他工作区'}」`);
        } else {
          Toast.success('已移动到其他分类');
        }
      } else {
        Toast.success('书签已更新');
      }
    } catch (e) {
      Toast.error('更新失败：' + (e as Error).message);
    }
  };

  const handleDeleteBookmark = async (bookmark: Bookmark) => {
    try {
      await useBookmarks.getState().deleteBookmark(bookmark.id);
      Toast.success('已删除书签');
    } catch (e) {
      Toast.error('删除失败：' + (e as Error).message);
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
          ) : filteredBookmarks.length > 1 ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={() => { setActiveBookmarkId(null); setDropIndicator(null); setInvalid(false); }}
            >
              <SortableContext
                items={filteredBookmarks.map((b) => b.id)}
                strategy={rectSortingStrategy}
              >
                <div className={styles.grid} ref={containerRef}>
                  {filteredBookmarks.map((bookmark, index) => (
                    <SortableBookmarkCard
                      key={bookmark.id}
                      bookmark={bookmark}
                      disabled={!!query || reordering}
                      coachmark={!query && index === 0 && !coachSeen ? { onClose: markCoachSeen } : undefined}
                      hasOpenTab={openTabs.some((t) => bookmarkMatchesOpenTab(bookmark.url, t.url))}
                      onClick={handleCardClick}
                      onViewContexts={handleViewContexts}
                      onEditBookmark={handleEditBookmark}
                      onDelete={handleDeleteBookmark}
                    />
                  ))}
                  {dropIndicator && (
                    <div
                      className={`${dndStyles.dropLine} ${dropIndicator.axis === 'horizontal' ? dndStyles.dropLineHorizontal : dndStyles.dropLineVertical}`}
                      style={dropIndicator.axis === 'horizontal' ? { top: dropIndicator.top - 1.5 } : { left: dropIndicator.left - 1.5 }}
                      aria-hidden="true"
                    />
                  )}
                </div>
              </SortableContext>
              <SortableOverlay tone="light" invalid={invalid}>
                {activeBookmark && (
                  <BookmarkCard
                    bookmark={activeBookmark}
                    hasOpenTab={openTabs.some((t) => bookmarkMatchesOpenTab(activeBookmark.url, t.url))}
                    onClick={() => {}}
                    onViewContexts={() => {}}
                    onEditBookmark={() => {}}
                    onDelete={() => {}}
                  />
                )}
              </SortableOverlay>
            </DndContext>
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
                  onDelete={handleDeleteBookmark}
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

      {/* 书签编辑弹窗（归属位置 + 书签信息） */}
      <Modal
        title="编辑书签"
        visible={!!editingBookmark}
        onCancel={() => setEditingBookmark(null)}
        footer={
          <>
            <Button onClick={() => setEditingBookmark(null)}>取消</Button>
            <Button theme="solid" onClick={() => editPanelRef.current?.submit()}>保存</Button>
          </>
        }
      >
        {editingBookmark && (
          <BookmarkOpsPanel
            ref={editPanelRef}
            key={editingBookmark.id}
            bookmark={editingBookmark}
            workspaces={workspaces}
            categoriesLoader={categoriesLoader}
            onSubmit={handleBookmarkSubmit}
          />
        )}
      </Modal>
    </div>
  );
};
