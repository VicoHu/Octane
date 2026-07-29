import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";
import { X } from "lucide-react";
import { usePinnedTabs } from "@/store/usePinnedTabs";
import { useFavicon } from "@/hooks/useFavicon";
import { GripButton } from "../dnd/GripButton";
import { SortableOverlay } from "../dnd/SortableOverlay";
import { restrictToVerticalAxis, toVerticalTransform } from "../dnd/modifiers";
import dndStyles from "../dnd/dnd.module.css";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PinnedTab } from "@/shared/types";
import { computeReorderIds } from "@/shared/utils/order";
import styles from "./index.module.css";

interface PinnedManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

/**
 * 常驻书签管理弹窗（issue #60）。
 *
 * chip 体积小，hover 出删除角标 + 拖拽手柄极易误触。把「删除/排序」收敛到本弹窗，
 * sidebar 的 chip 变成纯「点击打开」，不再有悬浮控件。拖拽 + 删除在弹窗内安全地做。
 *
 * - 列出当前工作区全部常驻项（favicon + 名称 + × 删除）。
 * - 删除：调 store.deletePinnedTab；失败 Toast，不静默。
 * - 排序：>1 项接 DndContext（垂直列表 + 常显 GripButton），drop 调 store.reorderPinnedTabs。
 * - 空列表显示空提示。
 */
export function PinnedManageDialog({ open, onOpenChange, workspaceId }: PinnedManageDialogProps) {
  const pinnedTabs = usePinnedTabs((s) => s.pinnedTabs);
  const deletePinnedTab = usePinnedTabs((s) => s.deletePinnedTab);
  const reorderPinnedTabs = usePinnedTabs((s) => s.reorderPinnedTabs);

  // 连发锁：删除/排序写入期间禁用交互，防重复操作与切片回滚竞态
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const handleDelete = (id: string) => {
    setBusyId(id);
    deletePinnedTab(id)
      .catch(() => Toast.error("删除失败，请重试"))
      .finally(() => setBusyId(null));
  };

  // === 拖拽排序（与 ManagePanel SortableWorkspace 同模式）===
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const activePin = activePinId ? pinnedTabs.find((p) => p.id === activePinId) ?? null : null;
  // 非法落区：拖出列表（over=null）→ overlay 降透明
  const [invalid, setInvalid] = useState(false);

  const handleDragStart = (e: DragStartEvent) => setActivePinId(String(e.active.id));
  const handleDragOver = (e: DragOverEvent) => {
    if (!e.over) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
  };
  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    setActivePinId(null);
    setInvalid(false);
    const orderedIds = over ? computeReorderIds(pinnedTabs, String(active.id), String(over.id)) : null;
    if (!orderedIds) return;
    setReordering(true);
    try {
      await reorderPinnedTabs(workspaceId, orderedIds);
    } catch {
      Toast.error("排序未保存，请重试");
    } finally {
      setReordering(false);
    }
  };

  const canSort = pinnedTabs.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>管理常驻书签</DialogTitle>
        </DialogHeader>
        {pinnedTabs.length === 0 ? (
          <div className={styles.emptyHint}>暂无常驻书签</div>
        ) : canSort ? (
          <DndContext
            sensors={sensors}
            modifiers={[restrictToVerticalAxis]}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={() => {
              setActivePinId(null);
              setInvalid(false);
            }}
          >
            <SortableContext items={pinnedTabs.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <ul className={styles.dialogList} role="list">
                {pinnedTabs.map((pin) => (
                  <SortablePinnedRow
                    key={pin.id}
                    pin={pin}
                    disabled={reordering || busyId !== null}
                    onDelete={() => handleDelete(pin.id)}
                  />
                ))}
              </ul>
            </SortableContext>
            <SortableOverlay tone="light" invalid={invalid}>
              {activePin && (
                <div className={styles.ghostRow}>
                  <div className={styles.favicon}>
                    <span className={styles.fallback}>{(activePin.name.charAt(0) || "?").toUpperCase()}</span>
                  </div>
                  <span className={styles.pinName}>{activePin.name}</span>
                </div>
              )}
            </SortableOverlay>
          </DndContext>
        ) : (
          <ul className={styles.dialogList} role="list">
            {pinnedTabs.map((pin) => (
              <PinnedManageRow
                key={pin.id}
                pin={pin}
                disabled={busyId !== null}
                onDelete={() => handleDelete(pin.id)}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 管理弹窗内的单行常驻项（静态，无 sortable wrapper）：grip 占位 + favicon + 名称 + × 删除。 */
function PinnedManageRow({ pin, disabled, onDelete }: { pin: PinnedTab; disabled: boolean; onDelete: () => void }) {
  return (
    <li className={styles.pinRow}>
      <span className={styles.gripSlot} aria-hidden />
      <PinnedRowContent pin={pin} disabled={disabled} onDelete={onDelete} />
    </li>
  );
}

/**
 * SortablePinnedRow —— 管理弹窗内可拖拽行。
 * D6:listeners 收敛到常显 GripButton（整理语境），删除与主操作保留。
 * 1D verticalListSortingStrategy：wrapper 承载 setNodeRef + translateY 让位。
 * isDragging 原位 visibility:hidden 保留行高，DragOverlay 副本浮于指针（portal by SortableOverlay）。
 */
const SortablePinnedRow: React.FC<{
  pin: PinnedTab;
  disabled?: boolean;
  onDelete: () => void;
}> = ({ pin, disabled, onDelete }) => {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: pin.id, disabled });
  return (
    <div
      ref={setNodeRef}
      role="presentation"
      className={`${styles.sortableRow}${isDragging ? ` ${dndStyles.placeholder}` : ""}`}
      style={{ transform: CSS.Transform.toString(toVerticalTransform(transform)), transition }}
    >
      <li className={`${styles.pinRow}${isDragging ? ` ${styles.dragGhost}` : ""}`}>
        <span className={styles.gripSlot}>
          <GripButton listeners={listeners} className={dndStyles.gripAlwaysVisible} />
        </span>
        <PinnedRowContent pin={pin} disabled={disabled} onDelete={onDelete} />
      </li>
    </div>
  );
};

/** 共用行内容（favicon + 名称 + × 删除），供静态行与 sortable 行复用。 */
const PinnedRowContent: React.FC<{
  pin: PinnedTab;
  disabled?: boolean;
  onDelete: () => void;
}> = ({ pin, disabled, onDelete }) => {
  const faviconSrc = useFavicon(pin.url);
  const src = faviconSrc?.src;
  const initial = (pin.name.charAt(0) || "?").toUpperCase();

  return (
    <>
      <div className={styles.favicon}>
        {src ? (
          <img src={src} alt="" className={styles.faviconImg} onError={faviconSrc.onError} />
        ) : (
          <span className={styles.fallback}>{initial}</span>
        )}
      </div>
      <span className={styles.pinName}>{pin.name}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={styles.deleteBtn}
        aria-label={`取消常驻 ${pin.name}`}
        disabled={disabled}
        data-no-dnd
        onClick={onDelete}
      >
        <X />
      </Button>
    </>
  );
};
