import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type { Workspace, Category, Bookmark } from '@/shared/types';
import { listWorkspaces } from '@/services/WorkspaceService';
import { listCategories } from '@/services/CategoryService';
import {
  listBookmarksByWorkspace,
  createBookmark,
} from '@/services/BookmarkService';
import { isUrlValid, findDuplicateUrl } from '../utils';
import styles from '../popup.module.css';
import SubPageHeader from './SubPageHeader';
import { BookmarkFaviconPreview } from '@/components/BookmarkFaviconPreview';
import {
  LAST_WS_KEY,
  LAST_CAT_BY_WS_KEY,
  resolveLastWs,
  resolveLastCat,
} from '@/shared/lastSelection';

/** Q1：保存成功后的短反馈展示时长，随后自动关闭 popup */
const CLOSE_DELAY_MS = 800;

interface SaveBookmarkViewProps {
  /** 返回首页。 */
  onBack: () => void;
}

export default function SaveBookmarkView({ onBack }: SaveBookmarkViewProps) {
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [duplicate, setDuplicate] = useState<Bookmark | null>(null);

  // mount：加载工作区 + 抓取当前页 + 读取记忆
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [wss, tabs, stored] = await Promise.all([
          listWorkspaces(),
          chrome.tabs.query({ active: true, currentWindow: true }),
          chrome.storage.local.get([LAST_WS_KEY, LAST_CAT_BY_WS_KEY]),
        ]);
        if (cancelled) return;
        setWorkspaces(wss);

        const tab = tabs[0];
        setUrl(tab?.url ?? '');
        setName(tab?.title ?? '');

        // 确定工作区：上次记忆（若仍存在）> 第一个
        const lastWs = stored[LAST_WS_KEY] as string | undefined;
        const wsId = resolveLastWs(lastWs, wss) ?? '';
        setSelectedWorkspaceId(wsId);

        // 加载该工作区的分类
        if (wsId) {
          const cats = await listCategories(wsId);
          if (cancelled) return;
          setCategories(cats);
          // per-workspace：取该工作区上次的分类
          const catMap = (stored[LAST_CAT_BY_WS_KEY] as Record<string, string>) ?? {};
          const catId = resolveLastCat(wsId, cats, catMap) ?? '';
          setSelectedCategoryId(catId);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 工作区切换：重新加载分类，恢复该工作区上次的分类（per-workspace）
  const handleWorkspaceChange = async (wsId: string) => {
    setSelectedWorkspaceId(wsId);
    setSelectedCategoryId('');
    setDuplicate(null);
    // 切工作区即 persist（未保存就关闭也不再丢上次切到的工作区）
    void chrome.storage.local.set({ [LAST_WS_KEY]: wsId }).catch(() => {});
    const cats = await listCategories(wsId);
    setCategories(cats);
    const stored = await chrome.storage.local.get(LAST_CAT_BY_WS_KEY);
    const catMap = (stored[LAST_CAT_BY_WS_KEY] as Record<string, string>) ?? {};
    setSelectedCategoryId(resolveLastCat(wsId, cats, catMap) ?? '');
  };

  const handleSave = async (forceSave = false) => {
    if (!isUrlValid(url) || saving || !selectedWorkspaceId || !selectedCategoryId) return;
    setSaving(true);
    setDuplicate(null);
    try {
      if (!forceSave) {
        const bms = await listBookmarksByWorkspace(selectedWorkspaceId);
        const dup = findDuplicateUrl(bms, selectedCategoryId, url);
        if (dup) {
          setDuplicate(dup);
          setSaving(false);
          return;
        }
      }
      const finalName = name || (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return url;
        }
      })();
      await createBookmark(selectedWorkspaceId, selectedCategoryId, {
        name: finalName,
        url,
        description: description || undefined,
      });
      // persist ws + per-workspace cat map（read-modify-write，避免覆盖其它工作区条目）
      const stored = await chrome.storage.local.get(LAST_CAT_BY_WS_KEY);
      const catMap = (stored[LAST_CAT_BY_WS_KEY] as Record<string, string>) ?? {};
      catMap[selectedWorkspaceId] = selectedCategoryId;
      await chrome.storage.local.set({
        [LAST_WS_KEY]: selectedWorkspaceId,
        [LAST_CAT_BY_WS_KEY]: catMap,
      });
      // Q1：保存成功 → 短反馈 → 自动关闭 popup
      setSaving(false);
      setSaved(true);
      setTimeout(() => window.close(), CLOSE_DELAY_MS);
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className={styles.saveView}>
      <SubPageHeader title="保存当前页面" onBack={onBack} />

      {loading ? (
        <div className={styles.loading}>加载中…</div>
      ) : (
        <>
          <Select
            value={selectedWorkspaceId}
            onValueChange={(v) => handleWorkspaceChange(String(v))}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择工作区" />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.icon} {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={selectedCategoryId}
            onValueChange={(v) => setSelectedCategoryId(String(v))}
            disabled={!selectedWorkspaceId || categories.length === 0}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择分类" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="URL"
          />
          <div className={styles.faviconRow}>
            <BookmarkFaviconPreview url={url} />
          </div>
          <Input
            placeholder="名称（留空使用域名）"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="名称"
          />
          <Textarea
            placeholder="描述（可选）"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
            aria-label="描述"
          />

          {duplicate && (
            <div className={styles.duplicateHint} role="alert">
              <span>该分类下已存在相同 URL（{duplicate.name}）</span>
              <Button size="sm" variant="default" onClick={() => handleSave(true)}>
                仍然保存
              </Button>
            </div>
          )}

          <Button
            variant="default"
            disabled={!isUrlValid(url) || saving || saved}
            onClick={() => handleSave(false)}
          >
            {saved ? '已保存 ✓' : saving ? '保存中…' : '保存'}
          </Button>
        </>
      )}
    </div>
  );
}
