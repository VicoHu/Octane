import React, { useState, useCallback } from 'react';
import { Select, Button, Input, Modal, SideSheet } from '@douyinfe/semi-ui';
import { IconPlus, IconDelete, IconSetting, IconKey, IconSave } from '@douyinfe/semi-icons';
import { useWorkspace } from '@/store/useWorkspace';
import { useCrypto } from '@/store/useCrypto';
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

  // 主密码状态：驱动设置菜单「主密码」项的文案与动作
  const passwordSet = useCrypto((s) => s.passwordSet);
  const unlocked = useCrypto((s) => s.unlocked);
  const openUnlockModal = useCrypto((s) => s.openUnlockModal);
  const lockSession = useCrypto((s) => s.lockSession);

  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);

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

  // 主密码项自适应：未设置→设置；已设未解锁→解锁；已解锁→锁定
  const passwordLabel = !passwordSet ? '设置主密码' : unlocked ? '锁定主密码' : '解锁主密码';
  const handlePasswordClick = () => {
    if (unlocked) lockSession();
    else openUnlockModal();
  };

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
        {/* 设置：前置选项（主密码 / 数据备份和同步），点击展开内联菜单 */}
        {settingsMenuOpen && (
          <div className={styles.settingsMenu}>
            <button
              type="button"
              className={styles.settingsMenuItem}
              onClick={() => { setSettingsMenuOpen(false); handlePasswordClick(); }}
            >
              <IconKey /> {passwordLabel}
            </button>
            <button
              type="button"
              className={styles.settingsMenuItem}
              onClick={() => { setSettingsMenuOpen(false); setShowSettings(true); }}
            >
              <IconSave /> 数据备份和同步
            </button>
          </div>
        )}
        <Button
          icon={<IconSetting />}
          block
          className={styles.settingsButton}
          aria-label="设置"
          onClick={() => setSettingsMenuOpen((o) => !o)}
        >
          设置
        </Button>
      </div>

      {/* 设置侧边抽屉：本地 + 云数据备份（newtab 主管理页的备份入口） */}
      <SideSheet
        title="数据备份和同步"
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
