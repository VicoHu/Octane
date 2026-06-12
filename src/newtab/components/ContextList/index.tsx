import React, { useState, useEffect, useCallback } from 'react';
import { SideSheet, Button, Popconfirm, Toast, Spin, Empty } from '@douyinfe/semi-ui';
import { IconPlus, IconLock, IconDelete } from '@douyinfe/semi-icons';
import { getContexts, createContext, deleteContext } from '@/services/ContextService';
import { ContextEditor } from '@/newtab/components/ContextEditor';
import { useBookmarks } from '@/store/useBookmarks';
import type { Bookmark, Context } from '@/shared/types';
import { ContextType } from '@/shared/types';
import styles from './index.module.css';

interface ContextListProps {
  bookmark: Bookmark | null;
  visible: boolean;
  onClose: () => void;
}

/** 自动生成标题：上下文 1、上下文 2 ... */
function generateTitle(existingCount: number): string {
  return `上下文 ${existingCount + 1}`;
}

export const ContextList: React.FC<ContextListProps> = ({ bookmark, visible, onClose }) => {
  const [contexts, setContexts] = useState<Context[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingContext, setEditingContext] = useState<Context | null>(null);
  const [titleCounter, setTitleCounter] = useState(0);
  const refreshBookmark = useBookmarks((s) => s.refreshBookmark);

  // 加载上下文列表
  const loadContexts = useCallback(async () => {
    if (!bookmark || !visible) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getContexts(bookmark.id);
      setContexts(result);
      setTitleCounter(result.length);
    } catch {
      setError('加载上下文失败');
    } finally {
      setLoading(false);
    }
  }, [bookmark?.id, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (visible && bookmark) {
      setEditingContext(null);
      loadContexts();
    }
  }, [visible, bookmark?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 新增上下文
  const handleCreate = async () => {
    if (!bookmark) return;
    try {
      const ctx = await createContext(
        bookmark.id,
        ContextType.NOTE,
        generateTitle(titleCounter),
        '',
        false,
      );
      setTitleCounter((c) => c + 1);
      setEditingContext(ctx);
    } catch (e) {
      Toast.error('创建失败：' + (e as Error).message);
    }
  };

  // 删除上下文
  const handleDelete = async (id: string) => {
    try {
      await deleteContext(id);
      await refreshBookmark(bookmark!.id);
      setContexts((prev) => prev.filter((c) => c.id !== id));
      setTitleCounter((c) => c - 1);
    } catch {
      Toast.error('删除失败');
    }
  };

  // 编辑器返回
  const handleEditorBack = async () => {
    setEditingContext(null);
    await loadContexts();
  };

  const handleClose = () => {
    setEditingContext(null);
    onClose();
  };

  return (
    <SideSheet
      title={
        bookmark ? (
          <div className={styles.titleRow}>
            <span className={styles.titleName}>{bookmark.name}</span>
            {bookmark.hasEncryptedContext && <IconLock className={styles.lockIcon} />}
          </div>
        ) : null
      }
      visible={visible && !!bookmark}
      onCancel={handleClose}
      width={500}
      placement="right"
      footer={editingContext ? null : (
        bookmark ? (
          <div className={styles.footer}>
            <Button
              theme="solid"
              icon={<IconPlus />}
              onClick={handleCreate}
            >
              新增上下文
            </Button>
          </div>
        ) : null
      )}
    >
      {bookmark && (
        editingContext ? (
          <ContextEditor
            context={editingContext}
            onBack={handleEditorBack}
          />
        ) : (
          <div className={styles.listContainer}>
            {loading ? (
              <div className={styles.loading}>
                <Spin />
              </div>
            ) : error ? (
              <div className={styles.error}>
                <Empty description={error} />
                <Button onClick={loadContexts}>重试</Button>
              </div>
            ) : contexts.length === 0 ? (
              <Empty
                description="暂无上下文"
              >
                <Button theme="solid" icon={<IconPlus />} onClick={handleCreate}>
                  添加第一条上下文
                </Button>
              </Empty>
            ) : (
              <div className={styles.list}>
                {contexts.map((ctx) => (
                  <div
                    key={ctx.id}
                    className={styles.contextItem}
                    onClick={() => setEditingContext(ctx)}
                  >
                    <div className={styles.contextInfo}>
                      <div className={styles.contextTitle}>
                        {ctx.title || '无标题'}
                        {ctx.isEncrypted && <IconLock className={styles.contextLock} />}
                      </div>
                      <div className={styles.contextTime}>
                        {new Date(ctx.updatedAt).toLocaleString()}
                      </div>
                    </div>
                    <Popconfirm
                      title="确认删除该上下文？"
                      onConfirm={(e) => {
                        e?.stopPropagation();
                        handleDelete(ctx.id);
                      }}
                      onCancel={(e) => e?.stopPropagation()}
                    >
                      <button
                        className={styles.deleteBtn}
                        onClick={(e) => e.stopPropagation()}
                        aria-label="删除"
                      >
                        <IconDelete />
                      </button>
                    </Popconfirm>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      )}
    </SideSheet>
  );
};
