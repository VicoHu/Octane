import React, { useState, useCallback } from 'react';
import { Select, Button, Input, Modal, SideSheet } from '@douyinfe/semi-ui';
import { IconPlus, IconDelete, IconSetting } from '@douyinfe/semi-icons';
import { useWorkspace } from '@/store/useWorkspace';
import { LocalBackupSection } from '@/components/backup/LocalBackupSection';
import { CloudBackupSection } from '@/components/backup/CloudBackupSection';
import styles from './index.module.css';

export const Sidebar: React.FC = () => {
  const workspaces = useWorkspace((s) => s.workspaces);
  const currentWorkspaceId = useWorkspace((s) => s.currentWorkspaceId);
  const categories = useWorkspace((s) => s.categories);
  const currentCategoryId = useWorkspace((s) => s.currentCategoryId);
  const selectWorkspace = useWorkspace((s) => s.selectWorkspace);
  const createCategory = useWorkspace((s) => s.createCategory);
  const deleteCategory = useWorkspace((s) => s.deleteCategory);
  const createWorkspace = useWorkspace((s) => s.createWorkspace);

  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;
    await createCategory(newCategoryName.trim(), '📂');
    setNewCategoryName('');
    setShowNewCategory(false);
  };

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    await createWorkspace(newWorkspaceName.trim(), '📁');
    setNewWorkspaceName('');
    setShowNewWorkspace(false);
  };

  const getPopupContainer = useCallback(() => document.getElementById('sidebar-container') || document.body, []);

  return (
    <div className={styles.sidebar}>
      {/* 品牌标题 */}
      <div className={styles.header}>
        <div className={styles.logo}>O</div>
        <div className={styles.title}>Octane</div>
      </div>

      {/* 工作区 */}
      <div className={styles.sectionLabel}>工作区</div>
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
      <Button
        block
        className={styles.addButton}
        onClick={() => setShowNewWorkspace(true)}
      >
        + 新建工作区
      </Button>

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
      </Modal>

      {/* 分类 */}
      <div className={styles.sectionLabel}>分类</div>
      <div className={styles.categoryList}>
        {categories.map((cat) => {
          const isActive = currentCategoryId === cat.id;
          return (
            <div
              key={cat.id}
              onClick={() => useWorkspace.getState().selectCategory(cat.id)}
              className={`${styles.categoryItem} ${isActive ? styles.categoryItemActive : ''}`}
            >
              <span className={styles.categoryName}>
                {cat.icon} {cat.name}
              </span>
              <IconDelete
                className={styles.deleteIcon}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteCategory(cat.id);
                }}
              />
            </div>
          );
        })}
      </div>

      <div className={styles.bottomButton}>
        <Button
          icon={<IconPlus />}
          block
          onClick={() => setShowNewCategory(true)}
        >
          添加分类
        </Button>
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

      {/* 设置侧边抽屉：本地数据导入导出（newtab 主管理页的备份入口） */}
      <SideSheet
        title="设置"
        visible={showSettings}
        onCancel={() => setShowSettings(false)}
        width={380}
      >
        <LocalBackupSection />
        <CloudBackupSection />
      </SideSheet>

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
      </Modal>
    </div>
  );
};
