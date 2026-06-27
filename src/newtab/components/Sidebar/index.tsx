import React, { useState, useCallback } from 'react';
import { Select, Button, Input, Modal, List } from '@douyinfe/semi-ui';
import { IconPlus, IconDelete, IconSetting } from '@douyinfe/semi-icons';
import { useWorkspace } from '@/store/useWorkspace';
import { IconPicker } from '@/shared/components/IconPicker';
import { ManagePanel } from '@/newtab/components/ManagePanel';
import { SettingsModal } from '@/newtab/components/SettingsModal';
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
  const [newCategoryIcon, setNewCategoryIcon] = useState('📂');
  const [showNewWorkspace, setShowNewWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceIcon, setNewWorkspaceIcon] = useState('📁');
  const [showManage, setShowManage] = useState(false);
  // 系统设置中心（统一收纳快捷键 / 数据备份 / 主密码，见 SettingsModal）
  const [showSettings, setShowSettings] = useState(false);

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
      <Button
        block
        size="small"
        theme="borderless"
        onClick={() => setShowManage(true)}
      >
        管理
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
        <div style={{ marginTop: 12 }}>
          <IconPicker value={newWorkspaceIcon} onChange={setNewWorkspaceIcon} />
        </div>
      </Modal>

      {/* 分类 */}
      <div className={styles.sectionLabel}>分类</div>
      <div className={styles.categoryList}>
        {categories.length === 0 ? (
          <div className={styles.emptyHint}>暂无分类</div>
        ) : (
          <List size="small">
            {categories.map((cat) => {
              const isActive = currentCategoryId === cat.id;
              return (
                <List.Item
                  key={cat.id}
                  className={isActive ? styles.catActive : undefined}
                  onClick={() => useWorkspace.getState().selectCategory(cat.id)}
                  main={
                    <span className={styles.categoryName}>
                      {cat.icon} {cat.name}
                    </span>
                  }
                  extra={
                    <IconDelete
                      className={styles.deleteIcon}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteCategory(cat.id);
                      }}
                    />
                  }
                />
              );
            })}
          </List>
        )}
      </div>

      <div className={styles.bottomButton}>
        <Button
          icon={<IconPlus />}
          block
          onClick={() => setShowNewCategory(true)}
        >
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

      {/* 工作区与分类管理：编辑名称与图标 */}
      <ManagePanel visible={showManage} onCancel={() => setShowManage(false)} />

      {/* 系统设置中心 */}
      <SettingsModal
        visible={showSettings}
        onCancel={() => setShowSettings(false)}
      />
    </div>
  );
};
