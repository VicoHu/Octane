import React, { useState } from 'react';
import { Modal, Input, Button } from '@douyinfe/semi-ui';
import { useWorkspace } from '@/store/useWorkspace';
import { IconPicker } from '@/shared/components/IconPicker';
import styles from './index.module.css';

interface EntityEditRowProps {
  id: string;
  name: string;
  icon: string;
  onSave: (id: string, updates: { name: string; icon: string }) => Promise<void> | void;
}

/** 单个 workspace/category 的可编辑行：点击展开名称 + 图标编辑。 */
const EntityEditRow: React.FC<EntityEditRowProps> = ({ id, name, icon, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftIcon, setDraftIcon] = useState(icon);

  const enterEdit = () => {
    setDraftName(name);
    setDraftIcon(icon);
    setEditing(true);
  };

  const handleSave = async () => {
    await onSave(id, { name: draftName.trim() || name, icon: draftIcon });
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className={styles.item}>
        <div className={styles.itemDisplay} onClick={enterEdit}>
          <span className={styles.itemIcon}>{icon}</span>
          <span>{name}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.item}>
      <div className={styles.editRow}>
        <Input value={draftName} onChange={setDraftName} placeholder="名称" />
        <IconPicker value={draftIcon} onChange={setDraftIcon} />
        <div className={styles.editActions}>
          <Button size="small" theme="solid" onClick={handleSave}>保存</Button>
          <Button size="small" onClick={() => setEditing(false)}>取消</Button>
        </div>
      </div>
    </div>
  );
};

interface ManagePanelProps {
  visible: boolean;
  onCancel: () => void;
}

/**
 * 工作区与分类管理面板（居中 Modal）。
 * 列出所有 workspace 与当前 workspace 的 category，点击进入编辑态
 * 修改名称与图标，保存调用 store update action。
 */
export const ManagePanel: React.FC<ManagePanelProps> = ({ visible, onCancel }) => {
  const workspaces = useWorkspace((s) => s.workspaces);
  const categories = useWorkspace((s) => s.categories);
  const updateWorkspace = useWorkspace((s) => s.updateWorkspace);
  const updateCategory = useWorkspace((s) => s.updateCategory);

  return (
    <Modal
      title="管理工作区与分类"
      visible={visible}
      onCancel={onCancel}
      centered
      size="medium"
      footer={null}
      bodyStyle={{ maxHeight: '70vh', overflow: 'auto' }}
    >
      <div className={styles.section}>工作区</div>
      {workspaces.map((w) => (
        <EntityEditRow key={w.id} id={w.id} name={w.name} icon={w.icon} onSave={updateWorkspace} />
      ))}

      <div className={styles.section}>分类（当前工作区）</div>
      {categories.length === 0 ? (
        <div style={{ color: 'var(--semi-color-text-2)', fontSize: 'var(--font-xs)' }}>暂无分类</div>
      ) : (
        categories.map((c) => (
          <EntityEditRow key={c.id} id={c.id} name={c.name} icon={c.icon} onSave={updateCategory} />
        ))
      )}
    </Modal>
  );
};
