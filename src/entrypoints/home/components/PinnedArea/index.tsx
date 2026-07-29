import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";
import { Plus } from "lucide-react";
import { usePinnedTabs } from "@/store/usePinnedTabs";
import { useFavicon } from "@/hooks/useFavicon";
import { PINNED_TAB_CAP } from "@/services/PinnedTabService";
import { AddPinnedTabDialog } from "../AddPinnedTabDialog";
import { PinnedManageDialog } from "../PinnedManageDialog";
import { openUrlInNewTab } from "@/shared/tabs/openTab";
import type { PinnedTab } from "@/shared/types";
import type { OpenTab } from "../../hooks/useOpenTabs";
import { pickMostRecentMatchingTab } from "@/shared/tabs/matchUrl";
import styles from "./index.module.css";

interface PinnedAreaProps {
  workspaceId: string;
  openTabs: OpenTab[];
}

/**
 * 常驻标签区（per-workspace 跨分类）。挂在 Sidebar 工作区切换下方、分类列表上方。
 *
 * - 数据：mount/workspaceId 变更时 loadPinnedTabs；跨 context 实时刷新由 home App 订阅 BroadcastChannel（T6）
 * - 空状态（D4=B）：始终渲染「常驻书签」标题 + 空提示
 * - chip：方向 A 方形（图标上/名称下），中性炭灰抬升面，纯点击打开（issue #60：移除 hover 删除/拖拽，收敛进管理弹窗）
 * - 布局：列数 = min(数量,4)，1fr 等宽填满；≤4 个馂满一行，>4 个固定 4 列换行
 * - 入口：标题行「+」添加 + 「管理」文字按钮（从 chipRow 脱离，避免污染 chip 布局）
 * - 上限：PINNED_TAB_CAP=8，满则「+」disabled + Toast
 */
export function PinnedArea({ workspaceId, openTabs }: PinnedAreaProps) {
  const pinnedTabs = usePinnedTabs((s) => s.pinnedTabs);
  const loadPinnedTabs = usePinnedTabs((s) => s.loadPinnedTabs);

  useEffect(() => {
    loadPinnedTabs(workspaceId);
  }, [workspaceId, loadPinnedTabs]);

  const [addOpen, setAddOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const atCap = pinnedTabs.length >= PINNED_TAB_CAP;
  // 列数：≤4 个按数量铺满（1→1列/2→2列/3→3列），>4 个固定 4 列（第二行与第一行等宽对齐）
  const colCount = Math.min(pinnedTabs.length, 4);

  const handleAddClick = () => {
    if (atCap) {
      Toast.warning(`该工作区常驻标签已满 (${PINNED_TAB_CAP}/${PINNED_TAB_CAP})`);
      return;
    }
    setAddOpen(true);
  };

  return (
    <div className={styles.area}>
      <div className={styles.sectionLabelRow}>
        <div className={styles.sectionLabel}>常驻书签</div>
        <div className={styles.titleActions}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={styles.addBtn}
            aria-label="添加常驻标签"
            disabled={atCap}
            onClick={handleAddClick}
          >
            <Plus />
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            className={styles.manageBtn}
            aria-label="管理常驻书签"
            onClick={() => setManageOpen(true)}
          >
            管理
          </Button>
        </div>
      </div>
      {pinnedTabs.length === 0 ? (
        <div className={styles.emptyHint}>点 + 添加常驻标签</div>
      ) : (
        <div
          className={styles.chipRow}
          data-testid="pinned-chip-row"
          style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}
        >
          {pinnedTabs.map((pin) => {
            const matchedTab = pickMostRecentMatchingTab(openTabs, pin.url);
            return <PinChip key={pin.id} pin={pin} runtimeFavIconUrl={matchedTab?.favIconUrl} />;
          })}
        </div>
      )}

      <AddPinnedTabDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        workspaceId={workspaceId}
        initialUrl=""
        initialName=""
      />
      <PinnedManageDialog open={manageOpen} onOpenChange={setManageOpen} workspaceId={workspaceId} />
    </div>
  );
}

/** 单个常驻 chip:favicon 上 / 名称下,纯点击打开（issue #60：删除/排序收敛进管理弹窗）。 */
function PinChip({ pin, runtimeFavIconUrl }: { pin: PinnedTab; runtimeFavIconUrl?: string }) {
  const faviconSrc = useFavicon(pin.url, runtimeFavIconUrl);
  const src = faviconSrc?.src;
  const initial = (pin.name.charAt(0) || "?").toUpperCase();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={styles.chip}
      aria-label={`打开 ${pin.name}`}
      title={pin.name}
      onClick={(event) =>
        void openUrlInNewTab(pin.url, !(event.metaKey || event.ctrlKey)).catch(() => Toast.error("打开失败"))
      }
    >
      <div className={styles.favicon}>
        {src ? (
          <img src={src} alt="" className={styles.faviconImg} onError={faviconSrc.onError} />
        ) : (
          <span className={styles.fallback}>{initial}</span>
        )}
      </div>
      <span className={styles.chipName}>{pin.name}</span>
    </Button>
  );
}
