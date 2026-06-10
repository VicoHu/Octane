import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SideSheet, Button, Switch, TabPane, Tabs, Toast } from '@douyinfe/semi-ui';
import { IconDelete, IconLock } from '@douyinfe/semi-icons';
import { useCrypto } from '@/store/useCrypto';
import { useBookmarks } from '@/store/useBookmarks';
import { getNote, saveNote } from '@/services/NoteService';
import { renderMarkdown } from '@/shared/utils/markdown';
import type { Bookmark } from '@/shared/types';

interface NoteEditorProps {
  bookmark: Bookmark | null;
  visible: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export const NoteEditor: React.FC<NoteEditorProps> = ({ bookmark, visible, onClose, onDelete }) => {
  const [content, setContent] = useState('');
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(true);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unlocked = useCrypto((s) => s.unlocked);
  const refreshBookmark = useBookmarks((s) => s.refreshBookmark);

  // 加载笔记
  useEffect(() => {
    if (!bookmark || !visible) return;
    const loadNote = async () => {
      try {
        const note = await getNote(bookmark.id);
        setContent(note?.content ?? '');
        setIsEncrypted(note?.isEncrypted ?? false);
        setSaved(true);
      } catch {
        Toast.error('加载笔记失败');
      }
    };
    loadNote();
  }, [bookmark?.id, visible]);

  // 自动保存 debounce 1s
  const debouncedSave = useCallback(
    (text: string, encrypted: boolean) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaved(false);
      saveTimerRef.current = setTimeout(async () => {
        if (!bookmark) return;
        try {
          setSaving(true);
          await saveNote(bookmark.id, text, encrypted);
          await refreshBookmark(bookmark.id);
          setSaved(true);
        } catch (e) {
          Toast.error('保存失败：' + (e as Error).message);
        } finally {
          setSaving(false);
        }
      }, 1000);
    },
    [bookmark?.id, refreshBookmark],
  );

  const handleContentChange = (value: string) => {
    setContent(value);
    debouncedSave(value, isEncrypted);
  };

  const handleEncryptionToggle = (checked: boolean) => {
    if (checked && !unlocked) {
      Toast.warning('请先解锁主密码');
      return;
    }
    setIsEncrypted(checked);
    if (content) {
      debouncedSave(content, checked);
    }
  };

  const handleClose = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    onClose();
  };

  if (!bookmark) return null;

  return (
    <SideSheet
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{bookmark.name}</span>
          {bookmark.isNoteEncrypted && <IconLock style={{ color: 'var(--primary)' }} />}
        </div>
      }
      visible={visible}
      onCancel={handleClose}
      width={500}
      placement="right"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: isEncrypted ? 'var(--primary)' : 'var(--muted)' }}>
              {isEncrypted ? '🔒 加密笔记' : '普通笔记'}
            </span>
            <Switch
              checked={isEncrypted}
              onChange={handleEncryptionToggle}
              size="small"
            />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              {saving ? '保存中...' : saved ? '已保存' : '未保存'}
            </span>
            <Button
              icon={<IconDelete />}
              type="danger"
              onClick={() => {
                onDelete(bookmark.id);
                handleClose();
              }}
            />
          </div>
        </div>
      }
    >
      <Tabs activeKey={tab} onChange={(key) => setTab(key as 'edit' | 'preview')}>
        <TabPane tab="编辑" itemKey="edit">
          <textarea
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            placeholder="点击开始记录...（支持 Markdown）"
            style={{
              width: '100%',
              minHeight: 400,
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              padding: 12,
              fontSize: 14,
              lineHeight: 1.6,
              resize: 'vertical',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        </TabPane>
        <TabPane tab="预览" itemKey="preview">
          <div
            className="markdown-body"
            style={{ minHeight: 400, padding: 12 }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        </TabPane>
      </Tabs>
    </SideSheet>
  );
};
