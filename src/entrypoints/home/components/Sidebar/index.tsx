import React, { useState, useCallback } from 'react';
import { Select, Button, Input, Modal, List, Toast } from '@douyinfe/semi-ui';
import { IconPlus, IconDelete, IconSetting } from '@douyinfe/semi-icons';
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
import { PinnedArea } from '../PinnedArea';
import type { OpenTab } from '../../hooks/useOpenTabs';
import { GripButton } from '../dnd/GripButton';
import { SortableOverlay } from '../dnd/SortableOverlay';
import dndStyles from '../dnd/dnd.module.css';
import styles from './index.module.css';

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
  const createWorkspace = useWorkspace((s) => s.createWorkspace);
  const reorderCategories = useWorkspace((s) => s.reorderCategories);

  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryIcon, setNewCategoryIcon] = useState('📂');
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceIcon, setNewWorkspaceIcon] = useState('📁');
  const [showManage, setShowManage] = useState(false);
  // 待删除的分类（非 null 时显示二次确认 Modal）；确认短语输入
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [confirmText, setConfirmText] = useState('');
  // 系统设置中心（统一收纳快捷键 / 数据备份 / 主密码，见 SettingsModal）
  const [showSettings, setShowSettings] = useState(false);

  // === T6 分类拖拽排序 ===
  // activationConstraint distance:8 兜底(grip listener)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [activeCatId, setActiveCatId] = useState<string | null>(null);
  const activeCat = activeCatId ? categories.find((c) => c.id === activeCatId) ?? null : null;
  // 连发锁:drop 写入期间锁定分类容器(防 store 乐观回滚与回滚竞态)
  const [reordering, setReordering] = useState(false);
  // M5 非法落区:over=null(拖出 categoryList)→ overlay 降透明 .5
  const [invalid, setInvalid] = useState(false);

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
    await createCategory(newCategoryName.trim(), newCategoryIcon);
    setNewCategoryName('');
    setNewCategoryIcon('📂');
    setShowNewCategory(false);
  };

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    await createWorkspace(newWorkspaceName.trim(), newWorkspaceIcon);
    setNewWorkspaceName('');
    setNewWorkspaceIcon('📁');
    setShowNewWorkspace(false);
  };

  // 删除分类二次确认：要求输入完整短语才解锁删除按钮（去掉所有空白以容忍空格差异）
  const expectedPhrase = deleteTarget ? `我确认删除${deleteTarget.name} 分类` : '';
  const normalize = (s: string) => s.replace(/\s+/g, '');
  const canConfirmDelete =
    deleteTarget !== null && normalize(confirmText) === normalize(expectedPhrase);

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !canConfirmDelete) return;
    await deleteCategory(deleteTarget.id);
    setConfirmText('');
    // Modal 由 visible={deleteTarget !== null} 控制，清空即关闭
    setDeleteTarget(null);
  };

  const cancelDelete = () => {
    setDeleteTarget(null);
    setConfirmText('');
  };

  const getPopupContainer = useCallback(
    () => document.getElementById('sidebar-container') || document.body,
    [],
  );

  return (
    <div className={styles.sidebar}>
      {/* 品牌标题 */}
      <div className={styles.header}>
        <img className={styles.logo} src="/icons/icon-128.png" alt="Octane" />
        <div className={styles.title}>Octane</div>
      </div>

      {/* 工作区 */}
      <div className={styles.sectionLabel}>工作区</div>
      <div className={styles.workspaceSelect}>
        <Select
          value={currentWorkspaceId}
          onChange={(val) => val && selectWorkspace(val as string)}
          className={styles.select}
          placeholder="选择工作区"
          getPopupContainer={getPopupContainer}
          optionList={workspaces.map((ws) => ({
            value: ws.id,
            label: `${ws.icon} ${ws.name}`,
          }))}
        />
        <Button icon={<IconPlus />} onClick={() => setShowNewWorkspace(true)}></Button>
      </div>
      <Button block size="small" theme="borderless" onClick={() => setShowManage(true)}>
        管理
      </Button>

      {/* 常驻标签区：per-workspace 跨分类，挂在工作区切换下方、分类列表上方 */}
      {currentWorkspaceId && <PinnedArea workspaceId={currentWorkspaceId} openTabs={openTabs} />}

      <Modal
        title="新建工作区"
        visible={showNewWorkspace}
        onOk={handleCreateWorkspace}
        onCancel={() => setShowNewWorkspace(false)}
      >
        <Input
          placeholder="工作区名称"
          value={newWorkspaceName}
          onChange={setNewWorkspaceName}
          onEnterPress={handleCreateWorkspace}
        />
        <div style={{ marginTop: 12 }}>
          <IconPicker value={newWorkspaceIcon} onChange={setNewWorkspaceIcon} />
        </div>
      </Modal>

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
              <List size="small">
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
              </List>
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
          <List size="small">
            {categories.map((cat) => (
              <List.Item
                key={cat.id}
                className={`${styles.cat} ${currentCategoryId === cat.id ? styles.catActive : ''}`}
                onClick={() => useWorkspace.getState().selectCategory(cat.id)}
                main={
                  <span className={styles.categoryName}>
                    {cat.icon} {cat.name}
                  </span>
                }
                extra={
                  <IconDelete
                    className={styles.deleteIcon}
                    aria-label={`删除分类 ${cat.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmText('');
                      setDeleteTarget(cat);
                    }}
                  />
                }
              />
            ))}
          </List>
        )}
      </div>

      <div className={styles.bottomButton}>
        <Button icon={<IconPlus />} block onClick={() => setShowNewCategory(true)}>
          添加分类
        </Button>
        {/* 系统设置：点击直开设置中心 Modal（主密码/数据备份/快捷键统一收纳） */}
        <Button
          icon={<IconSetting />}
          block
          className={styles.settingsButton}
          aria-label="设置"
          onClick={() => setShowSettings(true)}
        >
          设置
        </Button>
      </div>

      <Modal
        title="新建分类"
        visible={showNewCategory}
        onOk={handleCreateCategory}
        onCancel={() => setShowNewCategory(false)}
      >
        <Input
          placeholder="分类名称"
          value={newCategoryName}
          onChange={setNewCategoryName}
          onEnterPress={handleCreateCategory}
        />
        <div style={{ marginTop: 12 }}>
          <IconPicker value={newCategoryIcon} onChange={setNewCategoryIcon} />
        </div>
      </Modal>

      {/* 删除分类二次确认：级联删除书签与上下文，要求输入短语解锁 */}
      <Modal
        title="删除分类"
        visible={deleteTarget !== null}
        onOk={handleConfirmDelete}
        onCancel={cancelDelete}
        okType="danger"
        okText="删除"
        okButtonProps={{ disabled: !canConfirmDelete }}
        maskClosable={false}
      >
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
            onChange={setConfirmText}
            placeholder={expectedPhrase}
            aria-label="确认删除短语"
            autoFocus
          />
        </div>
      </Modal>

      {/* 工作区与分类管理：编辑名称与图标 */}
      <ManagePanel visible={showManage} onCancel={() => setShowManage(false)} />

      {/* 系统设置中心 */}
      <SettingsModal visible={showSettings} onCancel={() => setShowSettings(false)} />
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
 * - D6:listeners 收敛到 grip GripButton(extra 区),List.Item onClick(selectCategory)保留。
 * - 1D verticalListSortingStrategy:wrapper 承载 setNodeRef + translateY 让位。
 * - 深色面:overlay 浅描边(tone="dark" 在 Sidebar 层 SortableOverlay);grip 跟随 sidebar-text-muted。
 * - isDragging 原位 visibility:hidden 保留 List.Item 高度(measured rect 占位),DragOverlay 副本浮于指针。
 * - IconDelete data-no-dnd 防拖拽冒泡。
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
      <List.Item
        className={`${styles.cat} ${isActive ? styles.catActive : ''}${isDragging ? ` ${styles.dragGhost}` : ''}`}
        onClick={onSelect}
        main={
          <span className={styles.categoryName}>
            {cat.icon} {cat.name}
          </span>
        }
        extra={
          <span className={styles.catExtra}>
            <span className={styles.gripSlot}>
              <GripButton listeners={listeners} />
            </span>
            <IconDelete
              className={styles.deleteIcon}
              aria-label={`删除分类 ${cat.name}`}
              data-no-dnd
              onClick={onDelete}
            />
          </span>
        }
      />
    </div>
  );
};
