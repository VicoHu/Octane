import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Toast } from '@/components/ui/toast';
import { useCrypto } from '@/store/useCrypto';
import { useBookmarks } from '@/store/useBookmarks';
import { updateContext } from '@/services/ContextService';
import { renderMarkdown } from '@/shared/utils/markdown';
import type { Context } from '@/shared/types';
import styles from './index.module.css';

interface ContextEditorProps {
  context: Context;
  onBack: () => void;
}

export const ContextEditor: React.FC<ContextEditorProps> = ({ context, onBack }) => {
  const [title, setTitle] = useState(context.title);
  const [content, setContent] = useState(context.content);
  const [isEncrypted, setIsEncrypted] = useState(context.isEncrypted);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(true);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlocked = useCrypto((s) => s.unlocked);
  const refreshBookmark = useBookmarks((s) => s.refreshBookmark);

  // 当 context 变化时重置状态
  useEffect(() => {
    setTitle(context.title);
    setContent(context.content);
    setIsEncrypted(context.isEncrypted);
    setSaved(true);
    setTab('edit');
  }, [context.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 自动保存 debounce 1s
  const debouncedSave = useCallback(
    (newTitle: string, text: string, encrypted: boolean) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaved(false);
      saveTimerRef.current = setTimeout(async () => {
        try {
          setSaving(true);
          await updateContext(context.id, {
            title: newTitle,
            content: text,
            sensitive: encrypted,
          });
          await refreshBookmark(context.bookmarkId);
          setSaved(true);
        } catch (e) {
          Toast.error('保存失败：' + (e as Error).message);
        } finally {
          setSaving(false);
        }
      }, 1000);
    },
    [context.id, context.bookmarkId, refreshBookmark],
  );

  const handleTitleChange = (value: string) => {
    setTitle(value);
    debouncedSave(value, content, isEncrypted);
  };

  const handleContentChange = (value: string) => {
    setContent(value);
    debouncedSave(title, value, isEncrypted);
  };

  const handleEncryptionToggle = (checked: boolean) => {
    if (checked && !unlocked) {
      Toast.warning('请先解锁主密码');
      return;
    }
    setIsEncrypted(checked);
    if (content) {
      debouncedSave(title, content, checked);
    }
  };

  const handleBack = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    onBack();
  };

  return (
    <div className={styles.editor}>
      {/* 顶部：返回按钮 + 标题输入 */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={handleBack}>
          ← 返回
        </button>
        <div className={styles.meta}>
          <span className={styles.typeTag}>笔记</span>
          <span className={styles.saveStatus}>
            {saving ? '保存中...' : saved ? '已保存' : '未保存'}
          </span>
        </div>
      </div>

      <Input
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        placeholder="上下文标题"
        className={styles.titleInput}
      />

      <div className={styles.encryptRow}>
        <span className={`${styles.encryptLabel} ${isEncrypted ? styles.encryptActive : styles.encryptInactive}`}>
          {isEncrypted ? '🔒 加密' : '普通'}
        </span>
        <Switch
          checked={isEncrypted}
          onCheckedChange={handleEncryptionToggle}
          size="sm"
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'edit' | 'preview')}>
        <TabsList>
          <TabsTrigger value="edit">编辑</TabsTrigger>
          <TabsTrigger value="preview">预览</TabsTrigger>
        </TabsList>
        <TabsContent value="edit">
          <textarea
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            placeholder="点击开始记录...（支持 Markdown）"
            className={styles.textarea}
          />
        </TabsContent>
        <TabsContent value="preview">
          <div
            className={`markdown-body ${styles.previewBody}`}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};
