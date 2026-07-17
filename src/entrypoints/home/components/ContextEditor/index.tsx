import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
        <Button variant="ghost" size="sm" className={styles.backBtn} onClick={handleBack}>
          <ChevronLeft data-icon="inline-start" />
          返回
        </Button>
        <div className={styles.meta}>
          <span className={styles.typeTag}>笔记</span>
          <span className={styles.saveStatus}>
            {saving ? '保存中...' : saved ? '已保存' : '未保存'}
          </span>
        </div>
      </div>

      <Input
        aria-label="上下文标题"
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        placeholder="上下文标题"
        className={styles.titleInput}
      />

      <div className={styles.encryptRow}>
        <span className={`${styles.encryptLabel} ${isEncrypted ? styles.encryptActive : styles.encryptInactive}`}>
          {isEncrypted && <LockKeyhole aria-hidden="true" />}
          {isEncrypted ? '加密' : '普通'}
        </span>
        <Switch
          aria-label="加密上下文"
          className={styles.switchControl}
          checked={isEncrypted}
          onCheckedChange={handleEncryptionToggle}
          size="sm"
        />
      </div>

      <Tabs
        className={styles.tabs}
        value={tab}
        onValueChange={(v) => setTab(v as 'edit' | 'preview')}
      >
        <TabsList className={styles.tabsList}>
          <TabsTrigger value="edit" className={styles.tabTrigger}>
            编辑
          </TabsTrigger>
          <TabsTrigger value="preview" className={styles.tabTrigger}>
            预览
          </TabsTrigger>
        </TabsList>
        <TabsContent value="edit" className={styles.tabContent}>
          <Textarea
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            placeholder="点击开始记录...（支持 Markdown）"
            aria-label="上下文内容"
            className={styles.textarea}
          />
        </TabsContent>
        <TabsContent value="preview" className={styles.tabContent}>
          <div className={styles.previewScroll}>
            <div
              className={`markdown-body ${styles.previewBody}`}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
