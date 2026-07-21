import React, { useState } from 'react';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Toast } from '@/components/ui/toast';
import { Plus, Trash2, Settings } from 'lucide-react';
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
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { useWorkspace } from '@/store/useWorkspace';
import type { Category } from '@/shared/types';
import { IconPicker } from '@/components/IconPicker';
import { ManagePanel } from '../ManagePanel';
import { SettingsModal } from '../SettingsModal';
import { usePendingUpdate } from '../../hooks/usePendingUpdate';
import { PinnedArea } from '../PinnedArea';
import { WorkspaceCreateButton } from '../WorkspaceCreateButton';
import type { OpenTab } from '../../hooks/useOpenTabs';
import { GripButton } from '../dnd/GripButton';
import { SortableOverlay } from '../dnd/SortableOverlay';
import dndStyles from '../dnd/dnd.module.css';
import styles from './index.module.css';

// 项目无 @types/chrome：声明全局 chrome，最小子集断言（参考 ShortcutsSection.tsx）。
declare const chrome: unknown;
interface ChromeLike {
  runtime: { getManifest(): { version: string } };
}

interface SidebarProps {
  openTabs: OpenTab[];
}

export const Sidebar: React.FC<SidebarProps> = ({ openTabs }) => {
  const workspaces = useWorkspace((s) => s.workspaces);
  const currentWorkspaceId = useWorkspace((s) => s.currentWorkspaceId);
  const categories = useWorkspace((s) => s.categories);
  const currentCategoryId = useWorkspace((s) => s.currentCategoryId);
  const selectWorkspace = useWorkspace((s) => s.selectWorkspace);
  const createCategory = useWorkspace((s) => s.createCategory);
  const deleteCategory = useWorkspace((s) => s.deleteCategory);
  const reorderCategories = useWorkspace((s) => s.reorderCategories);

  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryIcon, setNewCategoryIcon] = useState('📂');
  const [showManage, setShowManage] = useState(false);
  // 待删除的分类（非 null 时显示二次确认 Modal）；确认短语输入
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [confirmText, setConfirmText] = useState('');
  // 系统设置中心（统一收纳快捷键 / 数据备份 / 主密码，见 SettingsModal）
  const [showSettings, setShowSettings] = useState(false);

  const { version: pendingVersion } = usePendingUpdate();
  const appVersion = (chrome as unknown as ChromeLike).runtime.getManifest().version;
  // sidebar 版本标记点击 → 打开设置「关于」Tab
  const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined);

  // === T6 分类拖拽排序 ===
  // activationConstraint distance:8 兜底(grip listener)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [activeCatId, setActiveCatId] = useState<string | null>(null);
  const activeCat = activeCatId ? categories.find((c) => c.id === activeCatId) ?? null : null;
  // 连发锁:drop 写入期间锁定分类容器(防 store 乐观回滚与回滚竞态)
  const [reordering, setReordering] = useState(false);
  // M5 非法落区:over=null(拖出 categoryList)→ overlay 降透明 .5
  const [invalid, setInvalid] = useState(false);
  const currentWorkspace = currentWorkspaceId
    ? workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null
    : null;

  const handleCatDragStart = (e: DragStartEvent) => setActiveCatId(String(e.active.id));
  const handleCatDragOver = (e: DragOverEvent) => {
    // 只判非法落区(拖出容器 over=null);落点指示由 placeholder 虚线框承担(用户真机决策去绿线)
    if (!e.over) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
  };
  const handleCatDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveCatId(null);
    setInvalid(false);
    if (!over || active.id === over.id || !currentWorkspaceId) return;
    const oldIndex = categories.findIndex((c) => c.id === active.id);
    const newIndex = categories.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const orderedIds = arrayMove(categories, oldIndex, newIndex).map((c) => c.id);
    setReordering(true);
    try {
      await reorderCategories(currentWorkspaceId, orderedIds);
    } catch {
      Toast.error('排序未保存，请重试');
    } finally {
      setReordering(false);
    }
  };

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;
    try {
      await createCategory(newCategoryName.trim(), newCategoryIcon);
      setNewCategoryName('');
      setNewCategoryIcon('📂');
      setShowNewCategory(false);
    } catch (e) {
      Toast.error('创建失败：' + (e as Error).message);
    }
  };

  // 删除分类二次确认：要求输入完整短语才解锁删除按钮（去掉所有空白以容忍空格差异）
  const expectedPhrase = deleteTarget ? `我确认删除${deleteTarget.name} 分类` : '';
  const normalize = (s: string) => s.replace(/\s+/g, '');
  const canConfirmDelete =
    deleteTarget !== null && normalize(confirmText) === normalize(expectedPhrase);

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !canConfirmDelete) return;
    try {
      await deleteCategory(deleteTarget.id);
      setConfirmText('');
      // Modal 由 visible={deleteTarget !== null} 控制，清空即关闭
      setDeleteTarget(null);
    } catch (e) {
      Toast.error('删除失败：' + (e as Error).message);
    }
  };

  const cancelDelete = () => {
    setDeleteTarget(null);
    setConfirmText('');
  };

  return (
    <div className={styles.sidebar}>
      {/* 品牌标题 */}
      <div className={styles.header}>
        <img className={styles.logo} src="/icons/icon-128.png" alt="Octane" />
        <div className={styles.title}>Octane</div>
        <span className={styles.version}>v{appVersion}</span>
        {pendingVersion && (
          <button
            type="button"
            className={styles.updateBadge}
            aria-label={`新版本 v${pendingVersion} 可用，点击查看`}
            title={`新版本 v${pendingVersion} 可用，点击查看`}
            onClick={() => {
              setSettingsInitialTab('about');
              setShowSettings(true);
            }}
          >
            ↑
          </button>
        )}
      </div>

      {currentWorkspace && (
        <section className={styles.currentWorkspace} aria-label="当前工作区">
          <div className={styles.currentWorkspaceLabel}>当前工作区</div>
          <div className={styles.currentWorkspaceValue}>
            <span className={styles.currentWorkspaceIcon} aria-hidden="true">
              {currentWorkspace.icon}
            </span>
            <span className={styles.currentWorkspaceName}>{currentWorkspace.name}</span>
          </div>
        </section>
      )}

      <div className={styles.workspaceSection}>
        {/* 工作区 */}
        <div className={styles.sectionLabel}>工作区</div>
        <div className={styles.workspaceSelect}>
          <Select
            value={currentWorkspaceId}
            onValueChange={(val) => val && selectWorkspace(val)}
          >
            <SelectTrigger className={styles.select}>
              <SelectValue>
                {(value: string | null) => {
                  const ws = workspaces.find((w) => w.id === value);
                  if (!ws) return '选择工作区';
                  return (
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden="true">{ws.icon}</span>
                      <span className="truncate">{ws.name}</span>
                    </span>
                  );
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.icon} {ws.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <WorkspaceCreateButton />
        </div>
      </div>
      {/* 常驻标签区：per-workspace 跨分类，挂在工作区切换下方、分类列表上方 */}
      {currentWorkspaceId && <PinnedArea workspaceId={currentWorkspaceId} openTabs={openTabs} />}

      {/* 分类 */}
      <div className={styles.sectionLabel}>分类</div>
      <div className={styles.categoryList}>
        {categories.length === 0 ? (
          <div className={styles.emptyHint}>暂无分类</div>
        ) : categories.length > 1 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleCatDragStart}
            onDragOver={handleCatDragOver}
            onDragEnd={handleCatDragEnd}
            onDragCancel={() => { setActiveCatId(null); setInvalid(false); }}
          >
            <SortableContext
              items={categories.map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-1">
                {categories.map((cat) => (
                  <SortableCategory
                    key={cat.id}
                    cat={cat}
                    isActive={currentCategoryId === cat.id}
                    disabled={reordering}
                    onSelect={() => useWorkspace.getState().selectCategory(cat.id)}
                    onDelete={(e) => {
                      e.stopPropagation();
                      setConfirmText('');
                      setDeleteTarget(cat);
                    }}
                  />
                ))}
              </ul>
            </SortableContext>
            <SortableOverlay tone="dark" invalid={invalid}>
              {activeCat && (
                <div className={styles.catGhost}>
                  {activeCat.icon} {activeCat.name}
                </div>
              )}
            </SortableOverlay>
          </DndContext>
        ) : (
          <ul className="flex flex-col gap-1">
            {categories.map((cat) => (
              <li
                key={cat.id}
                className={`${styles.cat} ${currentCategoryId === cat.id ? styles.catActive : ''}`}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={styles.categoryMain}
                  aria-label={`选择分类 ${cat.name}`}
                  aria-current={currentCategoryId === cat.id ? 'page' : undefined}
                  onClick={() => useWorkspace.getState().selectCategory(cat.id)}
                >
                  <span className={styles.categoryName}>
                    {cat.icon} {cat.name}
                  </span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={styles.deleteIcon}
                  aria-label={`删除分类 ${cat.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmText('');
                    setDeleteTarget(cat);
                  }}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.bottomButton}>
        <Button variant="outline" className={styles.addCategoryButton} onClick={() => setShowNewCategory(true)}>
          <Plus />
          添加分类
        </Button>
        <div className={styles.bottomActions}>
          <Button variant="secondary" onClick={() => setShowManage(true)}>管理</Button>
          {/* 系统设置：点击直开设置中心 Modal（主密码/数据备份/快捷键统一收纳） */}
          <Button variant="secondary" aria-label="设置" onClick={() => setShowSettings(true)}>
            <Settings />
            设置
          </Button>
        </div>
      </div>

      <Dialog open={showNewCategory} onOpenChange={(o) => !o && setShowNewCategory(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建分类</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="分类名称"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateCategory(); }}
          />
          <div style={{ marginTop: 12 }}>
            <IconPicker value={newCategoryIcon} onChange={setNewCategoryIcon} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewCategory(false)}>取消</Button>
            <Button onClick={handleCreateCategory}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除分类二次确认：级联删除书签与上下文，要求输入短语解锁 */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && cancelDelete()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除分类</DialogTitle>
          </DialogHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            <div style={{ color: "var(--semi-color-text-0)", lineHeight: 1.7 }}>
              删除分类「{deleteTarget?.icon} {deleteTarget?.name}」将
              <strong style={{ color: "var(--semi-color-danger)" }}>同时删除该分类下的所有书签及其上下文</strong>
              ，且此操作<strong>不可恢复</strong>。
            </div>
            <div style={{ color: "var(--semi-color-text-1)", fontSize: "var(--font-sm)" }}>
              请输入下方短语以确认（可忽略空格）：
            </div>
            <code
              style={{
                padding: "6px 10px",
                background: "var(--semi-color-fill-0)",
                borderRadius: 4,
                fontSize: "var(--font-sm)",
                userSelect: "all",
              }}
            >
              {expectedPhrase}
            </code>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={expectedPhrase}
              aria-label="确认删除短语"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={cancelDelete}>取消</Button>
            <Button variant="destructive" disabled={!canConfirmDelete} onClick={handleConfirmDelete}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 工作区与分类管理：编辑名称与图标 */}
      <ManagePanel visible={showManage} onCancel={() => setShowManage(false)} />

      {/* 系统设置中心 */}
      <SettingsModal
        visible={showSettings}
        initialTab={settingsInitialTab}
        onCancel={() => setShowSettings(false)}
      />
    </div>
  );
};

interface SortableCategoryProps {
  cat: Category;
  isActive: boolean;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
  /** 连发锁:drop 写入期间禁用该 item 拖拽 */
  disabled?: boolean;
}

/**
 * SortableCategory —— 分类项的拖拽 wrapper(T6)。
 *
 * - D6:listeners 收敛到 grip GripButton(extra 区),分类主操作保留。
 * - 1D verticalListSortingStrategy:wrapper 承载 setNodeRef + translateY 让位。
 * - 深色面:overlay 浅描边(tone="dark" 在 Sidebar 层 SortableOverlay);grip 跟随 sidebar-text-muted。
 * - isDragging 原位 visibility:hidden 保留 li 高度(measured rect 占位),DragOverlay 副本浮于指针。
 * - Trash2 data-no-dnd 防拖拽冒泡。
 */
const SortableCategory: React.FC<SortableCategoryProps> = ({ cat, isActive, onSelect, onDelete, disabled }) => {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cat.id, disabled });
  return (
    <div
      ref={setNodeRef}
      className={isDragging ? `${dndStyles.placeholder} ${dndStyles.placeholderDark}` : styles.sortableCat}
      style={{
        transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
        transition,
      }}
    >
      <li
        className={`${styles.cat} ${isActive ? styles.catActive : ''}${isDragging ? ` ${styles.dragGhost}` : ''}`}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={styles.categoryMain}
          aria-label={`选择分类 ${cat.name}`}
          aria-current={isActive ? 'page' : undefined}
          onClick={onSelect}
        >
          <span className={styles.categoryName}>
            {cat.icon} {cat.name}
          </span>
        </Button>
        <span className={styles.catExtra}>
          <span className={styles.gripSlot}>
            <GripButton listeners={listeners} />
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={styles.deleteIcon}
            aria-label={`删除分类 ${cat.name}`}
            data-no-dnd
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </span>
      </li>
    </div>
  );
};
