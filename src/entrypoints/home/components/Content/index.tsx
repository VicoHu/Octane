import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Form } from '@douyinfe/semi-ui';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Toast } from '@/components/ui/toast';
import { Plus, Search, X } from 'lucide-react';
import { useWorkspace } from '@/store/useWorkspace';
import { useBookmarks } from '@/store/useBookmarks';
import { useSearch } from '@/store/useSearch';
import { usePinnedTabs } from '@/store/usePinnedTabs';
import type { OpenTab } from '../../hooks/useOpenTabs';
import { bookmarkMatchesOpenTab, pickMostRecentMatchingTab } from '@/shared/tabs/matchUrl';
import { focusTab } from '@/shared/tabs/focusTab';
import { openUrlInNewTab } from '@/shared/tabs/openTab';
import * as CategoryService from '@/services/CategoryService';
import * as BookmarkService from '@/services/BookmarkService';
import { cn } from '@/lib/utils';
import { buildTagSuggestions, normalizeTags } from '@/shared/utils/tagRules';
import { BookmarkCard } from '../BookmarkCard';
import { TagFilter } from './TagFilter';
import { SortableBookmarkCard } from '../BookmarkCard/SortableBookmarkCard';
import { SortableOverlay } from '../dnd/SortableOverlay';
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
import { TagInput } from '@/components/TagInput';
import { EmptyState } from '../EmptyState';
import { ContextList } from '../ContextList';
import { TabList } from '../TabList';
import { AddPinnedTabDialog } from '../AddPinnedTabDialog';
import type { Bookmark } from '@/shared/types';
import styles from './index.module.css';

type View = 'bookmarks' | 'tabs';

interface ContentProps {
  openTabs: OpenTab[];
}

export const Content: React.FC<ContentProps> = ({ openTabs }) => {
  const categories = useWorkspace((s) => s.categories);
  const currentCategoryId = useWorkspace((s) => s.currentCategoryId);
  const currentWorkspaceId = useWorkspace((s) => s.currentWorkspaceId);
  const bookmarks = useBookmarks((s) => s.bookmarks);
  const allBookmarks = useBookmarks((s) => s.allBookmarks);
  const loading = useBookmarks((s) => s.loading);
  const createBookmark = useBookmarks((s) => s.createBookmark);
  const reorderBookmarks = useBookmarks((s) => s.reorderBookmarks);
  const loadAllByWorkspace = useBookmarks((s) => s.loadAllByWorkspace);
  const pinnedTabs = usePinnedTabs((s) => s.pinnedTabs);
  const loadPinnedTabs = usePinnedTabs((s) => s.loadPinnedTabs);
  const query = useSearch((s) => s.query);
  const setQuery = useSearch((s) => s.setQuery);

  const [showAddModal, setShowAddModal] = useState(false);
  // Tag 筛选：当前 Category 内已选 Tag 集合（#52；记忆范围/切换恢复属 #53/#54）
  const [selectedFilterTags, setSelectedFilterTags] = useState<string[]>([]);
  const [selectedBookmark, setSelectedBookmark] = useState<Bookmark | null>(null);
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [addFormApi, setAddFormApi] = useState<any>(null);
  // 视图切换:默认「书签」(向后兼容);「标签页」= 打开的 tab 一等视图
  const [activeView, setActiveView] = useState<View>('bookmarks');
  // 从 tab 触发保存时携带的预填源(null=手动「添加书签」)
  const [saveFromTab, setSaveFromTab] = useState<OpenTab | null>(null);
  // 添加书签弹窗的 Tag（独立于 Semi Form 字段，受控管理）
  const [addTags, setAddTags] = useState<string[]>([]);
  // 常驻标签:从 tab 触发存为常驻时携带的预填源 + Dialog 开关
  const [pinFromTab, setPinFromTab] = useState<OpenTab | null>(null);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const currentCategory = categories.find((c) => c.id === currentCategoryId);

  // 编辑面板：工作区列表 + 异步分类加载器（级联 Select 数据源）+ ref（footer 保存按钮调 submit）
  const workspaces = useWorkspace((s) => s.workspaces);
  const editPanelRef = useRef<BookmarkOpsPanelHandle>(null);
  const categoriesLoader = useCallback(
    (wsId: string) => CategoryService.listCategories(wsId),
    [],
  );
  // 编辑面板 Tag 建议 loader：加载目标工作区全部书签，聚合 Tag 建议（Issue #49）
  const tagSuggestionsLoader = useCallback(
    async (wsId: string) => {
      const wsBookmarks = await BookmarkService.listBookmarksByWorkspace(wsId);
      return buildTagSuggestions(wsBookmarks);
    },
    [],
  );

  // Tag 建议源:当前 Workspace 全部 Bookmark 聚合后的 Tag（按使用次数降序 + 名称排序）
  const tagSuggestions = useMemo(
    () => buildTagSuggestions(allBookmarks),
    [allBookmarks],
  );

  // 跨分类去重数据源:进入工作区即加载全量书签(独立于当前分类切片 bookmarks)
  useEffect(() => {
    if (currentWorkspaceId) void loadAllByWorkspace(currentWorkspaceId);
  }, [currentWorkspaceId, loadAllByWorkspace]);

  // 常驻标签切片:进入工作区即 load(per-workspace;与 PinnedArea 各自 load,store loadSeq guard 保平安)
  useEffect(() => {
    if (currentWorkspaceId) void loadPinnedTabs(currentWorkspaceId);
  }, [currentWorkspaceId, loadPinnedTabs]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  // 过滤书签：文本搜索（名称/URL/描述/Tag 名称）AND Tag 筛选（多选 AND）
  const filteredBookmarks = useMemo(() => {
    let result = bookmarks;
    // 文本搜索：扩展匹配 Tag 名称（#52）
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.url.toLowerCase().includes(q) ||
          b.description.toLowerCase().includes(q) ||
          b.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    // Tag 筛选：书签必须同时包含所有已选 Tag（AND 语义）
    if (selectedFilterTags.length > 0) {
      const selectedLower = selectedFilterTags.map((t) => t.toLowerCase());
      result = result.filter((b) =>
        selectedLower.every((tag) =>
          b.tags.some((t) => t.toLowerCase() === tag),
        ),
      );
    }
    return result;
  }, [bookmarks, query, selectedFilterTags]);

  // === T4 拖拽排序(Content grid 层)===
  // activationConstraint distance:8 兜底(grip listener),防 click 误触为拖拽
  // 搜索或任一 Tag 筛选存在时禁用拖拽（#53）；全部清除后恢复
  const hasFilter = !!query || selectedFilterTags.length > 0;
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
  // M5 非法落区:over=null(拖出 grid)→ overlay 降透明 .5
  const [invalid, setInvalid] = useState(false);

  const handleDragStart = (e: DragStartEvent) => {
    setActiveBookmarkId(String(e.active.id));
    // 首次拖拽关闭 coachmark(用户已发现手柄)
    if (!coachSeen) markCoachSeen();
  };
  const handleDragOver = (e: DragOverEvent) => {
    // 只判非法落区(拖出容器 over=null);落点指示由 placeholder 虚线框承担(用户真机决策去绿线)
    if (!e.over) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
  };
  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveBookmarkId(null);
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

  const openPinForTab = (tab: OpenTab) => {
    setPinFromTab(tab);
    setPinDialogOpen(true);
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
        tags: addTags,
      });
      setShowAddModal(false);
      setSaveFromTab(null);
      setAddTags([]);
      // save→context 漏斗(R5):保存后引导加上下文,把 tab/书签引流进 Octane 加密护城河
      Toast.success({
        content: (
          <span>
            书签已保存{' '}
            <Button
              variant="link"
              size="sm"
              onClick={() => setSelectedBookmark(created)}
            >
              添加上下文
            </Button>
          </span>
        ),
        duration: 5,
      });
    } catch (e) {
      Toast.error('添加失败：' + (e as Error).message);
    }
  };

  const handleTabClick = (tab: OpenTab, event?: React.MouseEvent<HTMLButtonElement>) => {
    if (event?.metaKey || event?.ctrlKey) {
      void openUrlInNewTab(tab.url, false).catch(() => Toast.error('打开失败'));
      return;
    }
    // 跳转到对应 tab;focusTab 内置 stale tabId 兜底(R2)
    void focusTab(tab.tabId, tab.url);
  };

  const handleCardClick = (bookmark: Bookmark, event?: React.MouseEvent<HTMLButtonElement>) => {
    if (event?.metaKey || event?.ctrlKey) {
      void openUrlInNewTab(bookmark.url, false).catch(() => Toast.error('打开失败'));
      return;
    }
    // Phase 2：匹配到已打开 tab → 聚焦「最近活跃」的那个;否则新建标签。
    // useOpenTabs 数据源按 index 排序,这里用 pickMostRecentMatchingTab 显式取最近活跃,
    // 不依赖数组顺序(保持原 Phase 2 语义)。
    const tab = pickMostRecentMatchingTab(openTabs, bookmark.url);
    if (tab) {
      void focusTab(tab.tabId, tab.url);
    } else {
      void openUrlInNewTab(bookmark.url, true).catch(() => Toast.error('打开失败'));
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
      // Tag 规范化（Issue #49）：大小写去重、清理空白、上限控制
      const nextTags = normalizeTags(values.tags ?? editingBookmark.tags ?? []);
      const propsChanged =
        nextName !== editingBookmark.name ||
        nextUrl !== editingBookmark.url ||
        nextDesc !== editingBookmark.description;
      // Tag 变化判定（顺序敏感：数组不等即变）
      const tagsChanged =
        nextTags.length !== editingBookmark.tags.length ||
        nextTags.some((t, i) => t !== editingBookmark.tags[i]);

      // 1. 属性 / Tag 更新（name/url/description/tags）写库
      //    先于 moveBookmark：确保移动读取 DB 时 Tag 已是最新（moveBookmark 按 ...existing 保留全部字段）
      if (propsChanged || tagsChanged) {
        await updateBookmark(editingBookmark.id, {
          name: nextName,
          url: nextUrl,
          description: nextDesc,
          tags: nextTags,
        });
      }
      // 2. 移动（workspaceId/categoryId 变）——moveBookmark 内部 update ws+cat 并按方向同步双切片
      //    不能用 refreshBookmark 处理移动:map 语义无法移除,且会破坏 ContextEditor 第二 caller
      if (moved) {
        await useBookmarks
          .getState()
          .moveBookmark(editingBookmark.id, values.workspaceId, values.categoryId);
      }
      // 3. 属性/Tag 改后刷新切片。纯编辑→refreshBookmark 刷双切片;
      //    移动+改属性/Tag→moveBookmark 用切片旧数据(旧 name/tags),需 refresh 重读 DB 最新:
      //      同ws跨cat:allBookmarks 保留该条,refresh map 拿到新 name/tags ✓
      //      跨ws:allBookmarks 已被 moveBookmark filter 移除,refresh map 无匹配(无害,书签已离开当前视图)
      if (propsChanged || tagsChanged) {
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
        <div className={styles.headingBlock}>
          <h1 className={styles.title}>{currentCategory?.name ?? ''}</h1>
          <p className={styles.subtitle}>你的 {currentCategory?.name ?? '书签'} 与灵感收藏</p>
        </div>

        {/* tabs 视图:显式提示保存目标分类(防存错桶,Design 决议) */}
        {activeView === 'tabs' && (
          <span className={styles.saveTarget}>
            保存至：{currentCategory?.icon} {currentCategory?.name}
          </span>
        )}

        <div className={cn('relative', styles.searchInput)}>
          <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 opacity-50" />
          <Input
            ref={searchInputRef}
            placeholder="搜索书签、分类或已打开页面..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pr-8 pl-8"
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-1 -translate-y-1/2 opacity-50 hover:opacity-100"
              aria-label="清除搜索"
            >
              <X />
            </Button>
          )}
          {!query && <kbd className={styles.searchShortcut}>⌘ K</kbd>}
        </div>

        <Button variant="default" onClick={openAddManual}>
          <Plus data-icon="inline-start" />
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
      <Tabs className={styles.tabsRoot} value={activeView} onValueChange={(v) => setActiveView(v as View)}>
        <TabsList className={styles.tabsList}>
          <TabsTrigger value="bookmarks" className={styles.tabsTrigger}>书签 {filteredBookmarks.length}</TabsTrigger>
          <TabsTrigger value="tabs" className={styles.tabsTrigger}>标签页 {openTabs.length}</TabsTrigger>
        </TabsList>
        <TabsContent value="bookmarks" className={styles.scrollPanel}>
          <div className={styles.summaryRow}>
            <TagFilter
              bookmarks={bookmarks}
              selectedTags={selectedFilterTags}
              onChange={setSelectedFilterTags}
            />
            <span>拖拽排序 · 最近更新</span>
          </div>
          {loading ? (
            <div className={styles.grid}>
              {[1, 2, 3].map((i) => (
                <div key={i} className={styles.skeletonCard}>
                  <Skeleton className="mb-3 h-4 w-3/5" />
                  <Skeleton className="mb-2 h-3 w-full" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </div>
          ) : filteredBookmarks.length === 0 ? (
            <EmptyState
              message={hasFilter ? '没有找到匹配的书签' : '添加你的第一个书签'}
              actionLabel={hasFilter ? undefined : '添加书签'}
              onAction={hasFilter ? undefined : openAddManual}
              // 组合空状态（#53）：同时提供清空搜索与清除全部 Tag 筛选入口
              secondaryActions={
                hasFilter
                  ? [
                      ...(query ? [{ label: '清空搜索', onClick: () => setQuery('') }] : []),
                      ...(selectedFilterTags.length > 0
                        ? [{ label: '清除全部 Tag 筛选', onClick: () => setSelectedFilterTags([]) }]
                        : []),
                    ]
                  : undefined
              }
            />
          ) : filteredBookmarks.length > 1 ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={() => { setActiveBookmarkId(null); setInvalid(false); }}
            >
              <SortableContext
                items={filteredBookmarks.map((b) => b.id)}
                strategy={rectSortingStrategy}
              >
                <div className={styles.grid}>
                  {filteredBookmarks.map((bookmark, index) => (
                    <SortableBookmarkCard
                      key={bookmark.id}
                      bookmark={bookmark}
                      disabled={hasFilter || reordering}
                      coachmark={!hasFilter && index === 0 && !coachSeen ? { onClose: markCoachSeen } : undefined}
                      hasOpenTab={openTabs.some((t) => bookmarkMatchesOpenTab(bookmark.url, t.url))}
                      onClick={handleCardClick}
                      onViewContexts={handleViewContexts}
                      onEditBookmark={handleEditBookmark}
                      onDelete={handleDeleteBookmark}
                    />
                  ))}
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
              {filteredBookmarks.map((bookmark) => {
                const matchedTab = pickMostRecentMatchingTab(openTabs, bookmark.url);
                return (
                  <BookmarkCard
                    key={bookmark.id}
                    bookmark={bookmark}
                    hasOpenTab={!!matchedTab}
                    runtimeFavIconUrl={matchedTab?.favIconUrl}
                    onClick={handleCardClick}
                    onViewContexts={handleViewContexts}
                    onEditBookmark={handleEditBookmark}
                    onDelete={handleDeleteBookmark}
                  />
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tabs" className={styles.scrollPanel}>
          <TabList
            tabs={openTabs}
            bookmarks={allBookmarks}
            currentCategoryId={currentCategoryId}
            onTabClick={handleTabClick}
            onSaveTab={openAddForTab}
            pinnedTabs={pinnedTabs}
            onPinTab={openPinForTab}
          />
        </TabsContent>
      </Tabs>

      {/* 存为常驻标签弹窗(从 tab 预填,共享 AddPinnedTabDialog) */}
      <AddPinnedTabDialog
        open={pinDialogOpen}
        onOpenChange={setPinDialogOpen}
        workspaceId={currentWorkspaceId ?? ''}
        initialUrl={pinFromTab?.url ?? ''}
        initialName={pinFromTab?.title ?? ''}
      />

      {/* 添加书签弹窗(支持从 tab 预填 + 分类选择器 R4) */}
      <Dialog
        open={showAddModal}
        onOpenChange={(o) => {
          if (!o) {
            setShowAddModal(false);
            setSaveFromTab(null);
            setAddTags([]);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{saveFromTab ? '从标签页保存书签' : '添加书签'}</DialogTitle>
          </DialogHeader>
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
            <Form.Slot label="Tag">
              <TagInput value={addTags} onChange={setAddTags} suggestions={tagSuggestions} />
            </Form.Slot>
          </Form>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowAddModal(false); setSaveFromTab(null); setAddTags([]); }}>取消</Button>
            <Button variant="default" onClick={() => addFormApi?.submitForm()}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 上下文列表（侧滑面板） */}
      <ContextList
        bookmark={selectedBookmark}
        visible={!!selectedBookmark}
        onClose={() => setSelectedBookmark(null)}
      />

      {/* 书签编辑弹窗（归属位置 + 书签信息） */}
      <Dialog
        open={!!editingBookmark}
        onOpenChange={(o) => { if (!o) setEditingBookmark(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑书签</DialogTitle>
          </DialogHeader>
          {editingBookmark && (
            <BookmarkOpsPanel
              ref={editPanelRef}
              key={editingBookmark.id}
              bookmark={editingBookmark}
              workspaces={workspaces}
              categoriesLoader={categoriesLoader}
              tagSuggestionsLoader={tagSuggestionsLoader}
              onSubmit={handleBookmarkSubmit}
            />
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingBookmark(null)}>取消</Button>
            <Button variant="default" onClick={() => editPanelRef.current?.submit()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
