import { Tree } from '@douyinfe/semi-ui';
import type { Bookmark, Category, ShareSelection, Workspace } from '@/shared/types';
import {
  treeValueToSelection,
  selectionToTreeValue,
  type SelectionTreeNode,
} from './shareSelection';

interface SelectionTreeProps {
  workspaces: Workspace[];
  categories: Category[];
  bookmarks: Bookmark[];
  value: ShareSelection;
  onChange: (sel: ShareSelection) => void;
}

function bookmarkCount(bookmarks: Bookmark[], categoryId: string): number {
  return bookmarks.filter((b) => b.categoryId === categoryId).length;
}

/**
 * 分享选择树：Workspace（父）→ Category（子），Semi Tree checkable。
 * multiple + checkRelation='related' 实现父子联动+半选；autoMergeValue 默认 true。
 * onChange 经 treeValueToSelection 转 ShareSelection。
 */
export function SelectionTree({ workspaces, categories, bookmarks, value, onChange }: SelectionTreeProps) {
  const treeData: SelectionTreeNode[] = workspaces.map((ws) => ({
    key: ws.id,
    label: `${ws.icon} ${ws.name}`,
    children: categories
      .filter((c) => c.workspaceId === ws.id)
      .map((c) => ({
        key: c.id,
        label: `${c.icon} ${c.name} (${bookmarkCount(bookmarks, c.id)})`,
      })),
  }));

  return (
    <Tree
      treeData={treeData}
      multiple
      checkRelation="related"
      defaultExpandAll
      value={selectionToTreeValue(value)}
      onChange={(v) => {
        const keys = (Array.isArray(v) ? v : [v]) as string[];
        onChange(treeValueToSelection(keys, treeData));
      }}
      aria-label="选择要分享的工作区和分类"
    />
  );
}
