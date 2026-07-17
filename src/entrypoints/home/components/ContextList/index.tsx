import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { Toast } from '@/components/ui/toast';
import { Spinner } from '@/components/ui/spinner';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { Plus, Lock, Trash2 } from 'lucide-react';
import { getContexts, createContext, deleteContext } from '@/services/ContextService';
import { ContextPanelShell } from '../ContextPanelShell';
import { ContextEditor } from '../ContextEditor';
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
  const [creating, setCreating] = useState(false);
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
    if (!bookmark || creating) return;
    setCreating(true);
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
    } finally {
      setCreating(false);
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

  const listFooter =
    !editingContext && bookmark ? (
      <Button className={styles.createButton} variant="default" onClick={handleCreate} disabled={creating}>
        {creating ? <Spinner /> : <Plus data-icon="inline-start" />}
        新增上下文
      </Button>
    ) : undefined;

  return (
    <ContextPanelShell
      open={visible && !!bookmark}
      title={bookmark?.name ?? ''}
      encrypted={bookmark?.hasEncryptedContext}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
      footer={listFooter}
    >
      {editingContext ? (
        <ContextEditor context={editingContext} onBack={handleEditorBack} />
      ) : (
        <section className={styles.listContainer} aria-labelledby="context-list-heading">
          <div className={styles.listHeader}>
            <h3 id="context-list-heading" className={styles.listHeading}>
              上下文
            </h3>
            <p className={styles.recordCount}>{contexts.length} 条记录</p>
          </div>
          <div className={styles.listScroll}>
            {loading ? (
              <div className={styles.loading}>
                <Spinner />
              </div>
            ) : error ? (
              <div className={styles.error}>
                <Empty>
                  <EmptyDescription>{error}</EmptyDescription>
                </Empty>
                <Button className={styles.listAction} variant="outline" onClick={loadContexts}>
                  重试
                </Button>
              </div>
            ) : contexts.length === 0 ? (
              <Empty>
                <EmptyDescription>暂无上下文</EmptyDescription>
                <Button className={styles.listAction} variant="default" onClick={handleCreate}>
                  <Plus data-icon="inline-start" />
                  添加第一条上下文
                </Button>
              </Empty>
            ) : (
              <ul className={styles.contextList}>
                {contexts.map((ctx) => (
                  <li key={ctx.id} className={styles.contextItem}>
                    <Button
                      type="button"
                      variant="ghost"
                      className={`${styles.contextAction} h-auto min-w-0 flex-1 justify-start overflow-hidden px-3 py-2`}
                      aria-label={`编辑上下文 ${ctx.title || '无标题'}`}
                      onClick={() => setEditingContext(ctx)}
                    >
                      <div className={styles.contextInfo}>
                        <div className={styles.contextTitle}>
                          <span className="min-w-0 truncate">{ctx.title || '无标题'}</span>
                          {ctx.isEncrypted && (
                            <Lock className={`${styles.contextLock} shrink-0`} />
                          )}
                        </div>
                        <div className={styles.contextTime}>
                          {new Date(ctx.updatedAt).toLocaleString()}
                        </div>
                      </div>
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`删除上下文 ${ctx.title || '无标题'}`}
                            className={`${styles.deleteBtn} shrink-0`}
                          />
                        }
                      >
                        <Trash2 />
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>确认删除该上下文？</AlertDialogTitle>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => handleDelete(ctx.id)}
                          >
                            删除
                          </AlertDialogAction>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </ContextPanelShell>
  );
};
