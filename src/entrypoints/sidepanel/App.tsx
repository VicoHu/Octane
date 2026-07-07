import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Collapse, Modal, Select, Toast } from '@douyinfe/semi-ui';
import { useCurrentTabContext } from './hooks/useCurrentTabContext';
import { useHostBookmarks } from './hooks/useHostBookmarks';
import { useSourceMap } from './hooks/useSourceMap';
import { useSidePanelUnlockLifecycle } from './hooks/useSidePanelUnlockLifecycle';
import { groupBookmarksByWorkspace, defaultExpandedIds, groupHitCount } from './utils/grouping';
import type { WorkspaceGroup } from './utils/grouping';
import { StickyHeader } from './components/StickyHeader';
import { BookmarkGroup } from './components/BookmarkGroup';
import { SidePanelUnlockModal } from './components/SidePanelUnlockModal';
import { UnlockContext } from './unlockContext';
import { getUnlockPrerequisite } from '@/services/UnlockSession';
import { listWorkspaces } from '@/services/WorkspaceService';
import { usePinnedTabs } from '@/store/usePinnedTabs';
import { focusOrCreateHomeTab } from '@/shared/tabs/focusOrCreateHomeTab';
import type { Workspace } from '@/shared/types';
import styles from './App.module.css';

/** 唤起 logo tab：当前窗口已有 pinned home tab → 聚焦，否则创建 pinned。 */
function openHomeTab() {
  void focusOrCreateHomeTab();
}

/**
 * Side Panel 顶部「Pin 当前 Tab」按钮（Codex #4 根级位置）。
 *
 * 点击拿当前 active tab（chrome.tabs.query 直接取 url+title，不走 useCurrentTabContext
 * —— 后者只给 hostname），按 groups.length 分支：
 * - 1 → 直接 pin 到该命中工作区
 * - >1 → 弹 Select 列命中工作区
 * - 0 → 弹 Select 列全量工作区（listWorkspaces service，Issue 2A：不用 useWorkspace.categories）
 *
 * URL 校验：new URL 解析失败 / 非 http(s) → Toast 拒绝，不创建。
 * 成功 → Toast.success；cap/dedup 失败 → Toast.warning（错误 message 含「上限」/「URL」）。
 * 加密 gate 不阻断：Pin 是 URL 入口，不涉及加密上下文。
 */
/**
 * 「Pin 当前 Tab」逻辑：取当前 tab → 校验 http(s) → groups 三分支
 * （=1 直接 pin / >1 命中 ws 选择器 / =0 listWorkspaces 全量选择器，Issue 2A）。
 *
 * 重构（真机反馈）：原根级 solid「Pin 当前 Tab」按钮太突兀；改为图标按钮，由调用方决定
 * 挂载位置——empty 状态放「在 Octane 管理」旁，matched 状态放 StickyHeader addBtn 旁。
 * picker Modal 由本 hook 暴露 pickerModal，调用方渲染一次。
 */
function usePinCurrentTab(groups: WorkspaceGroup[]) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [candidates, setCandidates] = useState<Workspace[]>([]);
  const [pendingTab, setPendingTab] = useState<{ url: string; name: string } | null>(null);
  const [selectedWs, setSelectedWs] = useState<string>('');

  const doPin = useCallback(async (wsId: string, wsName: string, data: { name: string; url: string }) => {
    try {
      await usePinnedTabs.getState().createPinnedTab(wsId, data);
      Toast.success(`已常驻到 ${wsName}`);
    } catch (e) {
      Toast.warning((e as Error).message);
    }
  }, []);

  const openPin = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      Toast.error('无法获取当前标签');
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(tab.url);
    } catch {
      Toast.warning('当前页面 URL 无效');
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      Toast.warning('仅支持 http/https 页面');
      return;
    }

    const name = tab.title ?? tab.url;

    // groups === 1 → 直接 pin（TS 严格模式需 g 判空，length===1 运行时必 defined）
    if (groups.length === 1) {
      const g = groups[0];
      if (g) {
        await doPin(g.workspaceId, g.workspace?.name ?? '工作区', { name, url: tab.url });
        return;
      }
    }

    // groups > 1 → 命中工作区选择器；groups === 0 → listWorkspaces 全量选择器（Issue 2A）
    let list: Workspace[];
    if (groups.length > 1) {
      list = groups.map((g) => ({
        id: g.workspaceId,
        name: g.workspace?.name ?? '未知工作区',
        icon: g.workspace?.icon ?? '❓',
        createdAt: 0,
        order: 0,
      }));
    } else {
      list = await listWorkspaces();
    }
    if (list.length === 0) {
      Toast.warning('请先在 Octane 创建工作区');
      return;
    }

    setCandidates(list);
    setPendingTab({ url: tab.url, name });
    setSelectedWs(list[0]?.id ?? '');
    setPickerOpen(true);
  }, [groups, doPin]);

  const confirmPicker = useCallback(async () => {
    if (!pendingTab || !selectedWs) return;
    const ws = candidates.find((w) => w.id === selectedWs);
    setPickerOpen(false);
    await doPin(selectedWs, ws?.name ?? '工作区', pendingTab);
  }, [pendingTab, selectedWs, candidates, doPin]);

  const pickerModal = (
    <Modal
      title="选择目标工作区"
      visible={pickerOpen}
      onOk={confirmPicker}
      onCancel={() => setPickerOpen(false)}
      okButtonProps={{ disabled: !selectedWs }}
      // side panel 视口窄（Chrome side panel 最小 ~300px），用 calc(100vw - 32px) 自适应，
      // 避免默认 460px 横向溢出（与 SidePanelUnlockModal 同处理）
      width="calc(100vw - 32px)"
    >
      <Select
        value={selectedWs}
        onChange={(v) => setSelectedWs((Array.isArray(v) ? v[0] : v) ?? '')}
        style={{ width: '100%' }}
      >
        {candidates.map((w) => (
          <Select.Option key={w.id} value={w.id}>
            {w.icon} {w.name}
          </Select.Option>
        ))}
      </Select>
    </Modal>
  );

  return { openPin, pickerModal };
}

/** Pin 图标按钮（📌）—— empty 状态与 StickyHeader 复用同一形态 */
function PinIconButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className={styles.pinBtn}
      onClick={onClick}
      aria-label="Pin 当前 Tab"
      title="Pin 当前 Tab"
    >
      📌
    </button>
  );
}

/**
 * Side Panel 根组件：四状态编排 + 按工作区/分类分组渲染（来源辨识）。
 *
 * 状态机：
 * - tab loading → 加载中
 * - hostname null（非 http(s)）→ 此页面不支持联动
 * - useHostBookmarks loading → 匹配中
 * - matched 空 → 空状态
 * - matched 有 → StickyHeader + 按工作区→分类分组（sourceMap 就绪后）
 *
 * 来源辨识：sourceMap 未就绪时退化为平铺（不渲染来源名，避免闪烁 undefined）；
 * 就绪后渲染工作区段头 + 分类段头 + 书签卡（卡上常驻分类 chip，R1）。
 *
 * Collapse（≥2 工作区才包）：
 * - 默认展开：T2（总命中≤6 全展开 / >6 仅展开命中最多者），按 hostname 初始化一次
 * - activeKeys 用 useMemo 派生（保留与当前 groups 的交集），避免刷新闪烁/编辑后跳段（R4）
 * - 单工作区免 Collapse 包裹（R8）
 */
export default function App() {
  const { hostname, loading: tabLoading } = useCurrentTabContext();
  const { matched, loading: matching } = useHostBookmarks(hostname);
  const { workspaces, categories, ready } = useSourceMap();

  // sidepanel 解锁生命周期：setInterval hardCap tick + visibilitychange/blur/focus grace 感知
  useSidePanelUnlockLifecycle();

  // sidepanel 加密上下文解锁弹窗（点 locked 卡触发）
  const [unlockOpen, setUnlockOpen] = useState(false);
  const requestUnlock = useCallback(async () => {
    const pre = await getUnlockPrerequisite('sidepanel');
    if (pre === 'no-password') {
      Toast.warning('请先在 home 页设置主密码');
      return;
    }
    if (pre === 'needs-reset') {
      Toast.warning('检测到旧版加密数据，请先在 home 页重设主密码');
      return;
    }
    setUnlockOpen(true);
  }, []);
  const unlockApi = useMemo(() => ({ requestUnlock }), [requestUnlock]);

  const groups = useMemo(
    () => (ready ? groupBookmarksByWorkspace(matched, workspaces, categories) : []),
    [matched, workspaces, categories, ready],
  );

  // Collapse 展开态：用户手动 toggle 后由 expandedIds 接管；activeKeys 派生时与当前 groups 取交集
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const initedHostRef = useRef<string | null>(null);

  // 默认展开初始化（每个 hostname 一次）：sourceMap 就绪、groups 非空时按 T2 设默认
  useEffect(() => {
    if (groups.length === 0) return;
    if (initedHostRef.current === hostname) return;
    initedHostRef.current = hostname;
    setExpandedIds(new Set(defaultExpandedIds(groups)));
  }, [groups, hostname]);

  const activeKeys = useMemo(
    () => groups.filter((g) => expandedIds.has(g.workspaceId)).map((g) => g.workspaceId),
    [groups, expandedIds],
  );

  // Pin 当前 Tab 逻辑（hook 暴露 openPin + picker Modal）
  const { openPin, pickerModal } = usePinCurrentTab(groups);

  /** 渲染一个工作区内的分类段 + 书签卡（Collapse / 平铺共用） */
  const renderBookmarkList = (ws: WorkspaceGroup) =>
    ws.categories.map((cat) => (
      <div key={cat.categoryId} className={styles.catSection} data-testid="cat-section">
        {cat.bookmarks.map((b) => (
          <BookmarkGroup
            key={b.id}
            bookmark={b}
            categoryName={cat.category?.name}
            categoryIcon={cat.category?.icon}
          />
        ))}
      </div>
    ));

  /** 工作区段头（icon + 名 + 命中数） */
  const wsHeader = (ws: WorkspaceGroup) => (
    <div className={styles.wsHeader}>
      <span className={styles.wsIcon}>{ws.workspace?.icon ?? '❓'}</span>
      <span className={styles.wsName}>{ws.workspace?.name ?? '未知工作区'}</span>
      <span className={styles.wsCount}>{groupHitCount(ws)} 个书签</span>
    </div>
  );

  // 状态分支收敛为 body：Pin 按钮只在 empty（管理旁）+ matched（StickyHeader 内）两态显示；
  // loading/no-hostname/matching 瞬态不挂（用户不可操作）
  const body = tabLoading ? (
    <div className={styles.state}>加载中…</div>
  ) : !hostname ? (
    <div className={styles.state}>此页面不支持联动</div>
  ) : matching ? (
    <div className={styles.state}>匹配中…</div>
  ) : matched.length === 0 ? (
    <div className={styles.empty}>
      <div className={styles.emptyText}>该页面暂无匹配书签</div>
      <div className={styles.emptyActions}>
        <button className={styles.manageBtn} onClick={openHomeTab}>在 Octane 管理</button>
        <PinIconButton onClick={openPin} />
      </div>
    </div>
  ) : (
    <>
      <StickyHeader hostname={hostname} matchCount={matched.length} onAdd={openHomeTab} onPin={openPin} />
      <div className={styles.list} role="list">
        {groups.length >= 2 ? (
          <Collapse
            activeKey={activeKeys}
            motion={false}
            onChange={(keys) => setExpandedIds(new Set(keys as string[]))}
          >
            {groups.map((ws) => (
              <Collapse.Panel header={wsHeader(ws)} itemKey={ws.workspaceId} key={ws.workspaceId}>
                {renderBookmarkList(ws)}
              </Collapse.Panel>
            ))}
          </Collapse>
        ) : (
          groups.map((ws) => (
            <section key={ws.workspaceId} className={styles.wsSection}>
              {wsHeader(ws)}
              {renderBookmarkList(ws)}
            </section>
          ))
        )}
      </div>
    </>
  );

  return (
    <UnlockContext.Provider value={unlockApi}>
      <div className={styles.app}>
        {body}
        {pickerModal}
      </div>
      <SidePanelUnlockModal open={unlockOpen} onClose={() => setUnlockOpen(false)} />
    </UnlockContext.Provider>
  );
}
