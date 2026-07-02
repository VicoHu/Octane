import { useState } from 'react';
import { Input, TextArea, Switch, Button, Toast } from '@douyinfe/semi-ui';
import { isUnlocked } from '@/services/UnlockSession';
import { useUnlockRequest } from '../unlockContext';
import { createContext } from '@/services/ContextService';
import { ContextType } from '@/shared/types';
import styles from './InlineContextEditor.module.css';

interface InlineContextEditorProps {
  bookmarkId: string;
  /** 保存成功（收起）或取消时回调 */
  onDone: () => void;
}

/**
 * 就地创建上下文编辑器：标题（可选）+ 正文（Markdown）+ 加密 Switch + 保存/取消。
 *
 * - R2 加密 gate（sidepanel surface）：Switch onChange 异步 `await isUnlocked('sidepanel')`
 *   （读 sidepanel 独立标记，**非共享 key**——切断与 home 的联动）；未解锁 → Toast +
 *   触发 requestUnlock（弹 sidepanel 解锁框）+ Switch 回滚 off + 输入保留。
 * - R7 四态：idle / saving（按钮 loading+disabled，防双击重复 createContext）/ saved（1.5s ✓ 反馈后收起清空）/ error（Toast.error + 保留输入不收起）。
 * - 保存后经 createContext → syncContextMeta → BroadcastChannel('octane-db') 广播 →
 *   useHostBookmarks 重匹配 + useEncryptedContexts（含 contextCount 依赖，R3）重拉 → 新卡出现。
 */
export function InlineContextEditor({ bookmarkId, onDone }: InlineContextEditorProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [encrypted, setEncrypted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const requestUnlock = useUnlockRequest();

  const handleEncryptToggle = async (checked: boolean) => {
    if (checked && !(await isUnlocked('sidepanel'))) {
      // sidepanel surface 未解锁（即使 home 解了锁也不联动）→ 引导解锁，Switch 回滚 off
      Toast.warning('请先解锁加密上下文');
      requestUnlock();
      return;
    }
    setEncrypted(checked);
  };

  const handleSave = async () => {
    if (saving || saved) return; // 防双击 / 防已保存后重复
    if (!content.trim()) return;
    setSaving(true);
    try {
      await createContext(bookmarkId, ContextType.NOTE, title, content, encrypted);
      setSaving(false);
      setSaved(true);
      setTimeout(onDone, 1500); // 1.5s ✓ 反馈后收起
    } catch (e) {
      setSaving(false);
      Toast.error('保存失败：' + (e as Error).message); // 保留输入，不收起
    }
  };

  return (
    <div className={styles.editor}>
      <Input
        value={title}
        onChange={setTitle}
        placeholder="标题（可选）"
        aria-label="title"
      />
      <TextArea
        value={content}
        onChange={setContent}
        placeholder="从页面复制粘贴…（支持 Markdown）"
        autosize={{ minRows: 3, maxRows: 8 }}
        aria-label="content"
      />
      <div className={styles.row}>
        <span className={styles.encrypt}>
          <Switch checked={encrypted} onChange={handleEncryptToggle} aria-label="encrypt" />
          <span className={encrypted ? styles.encryptOn : styles.encryptOff}>
            {encrypted ? '🔒 加密' : '普通'}
          </span>
        </span>
        <span className={styles.actions}>
          <Button disabled={saving || saved} onClick={onDone} aria-label="取消">取消</Button>
          <Button
            theme="solid"
            loading={saving}
            disabled={saving || saved || !content.trim()}
            onClick={handleSave}
            aria-label="保存"
          >
            {saved ? '已保存 ✓' : '保存'}
          </Button>
        </span>
      </div>
    </div>
  );
}
