import React, { useState } from 'react';
import { Select, Button, Input, Modal } from '@douyinfe/semi-ui';
import { IconPlus, IconDelete } from '@douyinfe/semi-icons';
import { useWorkspace } from '@/store/useWorkspace';

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '16px 12px' }}>
      {/* 标题 */}
      <div style={{ marginBottom: 16, fontSize: 20, fontWeight: 700, letterSpacing: 1 }}>
        Octane
      </div>

      {/* 工作区选择器 */}
      <Select
        value={currentWorkspaceId}
        onChange={(val) => val && selectWorkspace(val as string)}
        style={{ width: '100%', marginBottom: 16 }}
        placeholder="选择工作区"
        optionList={workspaces.map((ws) => ({
          value: ws.id,
          label: `${ws.icon} ${ws.name}`,
        }))}
      />

      {/* 新建工作区按钮 */}
      <Button
        block
        style={{ marginBottom: 16 }}
        onClick={() => setShowNewWorkspace(true)}
      >
        + 新建工作区
      </Button>

      {/* 新建工作区弹窗 */}
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

      {/* 分类列表 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {categories.map((cat) => (
          <div
            key={cat.id}
            onClick={() => useWorkspace.getState().selectCategory(cat.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderRadius: 6,
              marginBottom: 2,
              cursor: 'pointer',
              background: currentCategoryId === cat.id ? 'var(--sidebar-active-bg)' : 'transparent',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              if (currentCategoryId !== cat.id) {
                e.currentTarget.style.background = 'var(--sidebar-hover-bg)';
              }
            }}
            onMouseLeave={(e) => {
              if (currentCategoryId !== cat.id) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            <span>
              {cat.icon} {cat.name}
            </span>
            <IconDelete
              style={{ fontSize: 14, opacity: 0.5, cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                deleteCategory(cat.id);
              }}
            />
          </div>
        ))}
      </div>

      {/* 添加分类按钮 */}
      <Button
        icon={<IconPlus />}
        block
        style={{ marginTop: 8 }}
        onClick={() => setShowNewCategory(true)}
      >
        添加分类
      </Button>

      {/* 新建分类弹窗 */}
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
