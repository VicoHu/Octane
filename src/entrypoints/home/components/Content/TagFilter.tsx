/**
 * 分类内 Tag 多选筛选器（Issue #52）。
 *
 * 在主页书签 Tab 摘要行提供可搜索的多选 Tag 筛选 Popover：
 * - 每个选项显示 Tag 名称及其在当前 Category 内的使用数量
 * - 多个 Tag 使用 AND 语义
 * - 提供「清除全部」操作
 * - 摘要行旁展示最多 3 个可单独移除的已选 Badge，更多显示 +N
 *
 * 筛选只作用于当前 Category 的书签，不影响浏览器标签页 Tab。
 */

import React, { useMemo, useState } from 'react';
import { Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import type { Bookmark } from '@/shared/types';

interface TagFilterProps {
  /** 当前 Category 的全部书签（用于统计 Tag 使用数量） */
  bookmarks: Bookmark[];
  /** 已选 Tag 集合 */
  selectedTags: string[];
  /** Tag 选择变更回调 */
  onChange: (tags: string[]) => void;
}

/** 选项行：Tag 名称 + 当前 Category 内使用数量 */
interface TagOption {
  tag: string;
  count: number;
}

/** 从书签列表构建 Tag → 使用数量的映射（大小写不敏感去重，保留首次展示形式） */
function buildTagOptions(bookmarks: readonly Bookmark[]): TagOption[] {
  const countMap = new Map<string, number>();
  const displayMap = new Map<string, string>();

  for (const bookmark of bookmarks) {
    if (!bookmark.tags) continue;
    for (const tag of bookmark.tags) {
      const lower = tag.toLowerCase();
      countMap.set(lower, (countMap.get(lower) ?? 0) + 1);
      if (!displayMap.has(lower)) displayMap.set(lower, tag);
    }
  }

  return Array.from(countMap.entries())
    .map(([lower, count]) => ({ tag: displayMap.get(lower)!, count }))
    .sort((a, b) => {
      // 使用次数降序 → 名称升序
      if (b.count !== a.count) return b.count - a.count;
      return a.tag.toLowerCase().localeCompare(b.tag.toLowerCase());
    });
}

export const TagFilter: React.FC<TagFilterProps> = ({
  bookmarks,
  selectedTags,
  onChange,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const tagOptions = useMemo(() => buildTagOptions(bookmarks), [bookmarks]);

  // 筛选选项：按搜索文本过滤（大小写不敏感）
  const filteredOptions = useMemo(() => {
    if (!search.trim()) return tagOptions;
    const q = search.toLowerCase();
    return tagOptions.filter((opt) => opt.tag.toLowerCase().includes(q));
  }, [tagOptions, search]);

  const toggleTag = (tag: string) => {
    const lower = tag.toLowerCase();
    const exists = selectedTags.some((t) => t.toLowerCase() === lower);
    if (exists) {
      onChange(selectedTags.filter((t) => t.toLowerCase() !== lower));
    } else {
      onChange([...selectedTags, tag]);
    }
  };

  const removeTag = (tag: string) => {
    onChange(selectedTags.filter((t) => t !== tag));
  };

  const clearAll = () => {
    onChange([]);
  };

  // 摘要行 Badge：最多 3 个，超过显示 +N
  const visibleBadges = selectedTags.slice(0, 3);
  const overflowCount = selectedTags.length - visibleBadges.length;

  // 当前分类无任何 Tag 时禁用筛选按钮，但保留布局占位（#53）
  const noTags = tagOptions.length === 0;

  // 筛选按钮（禁用态：Tooltip 说明「当前分类暂无 Tag」）
  const filterButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={noTags}
      aria-label={selectedTags.length > 0 ? `筛选 Tag（已选 ${selectedTags.length} 个）` : '筛选 Tag'}
    >
      <Tag data-icon="inline-start" />
      筛选 Tag
      {selectedTags.length > 0 && (
        <Badge variant="secondary" className="ml-0.5">
          {selectedTags.length}
        </Badge>
      )}
    </Button>
  );

  return (
    <div className="flex items-center gap-1.5">
      {/* 筛选按钮：无 Tag 时禁用 + Tooltip；有 Tag 时 Popover */}
      {noTags ? (
        <Tooltip>
          {/* 用 span 包裹禁用按钮：disabled 按钮禁用 pointer-events，
              span 承接 hover 以触发 Tooltip（#53） */}
          <TooltipTrigger render={<span className="inline-flex" />}>
            {filterButton}
          </TooltipTrigger>
          <TooltipContent>当前分类暂无 Tag</TooltipContent>
        </Tooltip>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={filterButton} />
          <PopoverContent align="start" className="w-64 p-0">
            {/* 搜索框 */}
            <div className="border-b p-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索 Tag"
                className="h-8"
              />
            </div>

            {/* 选项列表 */}
            {filteredOptions.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-xs">
                {search.trim() ? '未找到匹配的 Tag' : '当前分类暂无 Tag'}
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto">
                <div className="flex flex-col p-1">
                  {filteredOptions.map((option) => {
                    const lower = option.tag.toLowerCase();
                    const checked = selectedTags.some((t) => t.toLowerCase() === lower);
                    return (
                      <label
                        key={option.tag}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleTag(option.tag)}
                        />
                        <span className="flex-1 truncate">{option.tag}</span>
                        <span className="text-muted-foreground text-xs">{option.count}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 清除全部 */}
            {selectedTags.length > 0 && (
              <div className="border-t p-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={clearAll}
                >
                  清除全部
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}

      {/* 已选 Badge：最多 3 个 + N */}
      {visibleBadges.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-0.5">
          {tag}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0"
            aria-label={`移除 ${tag}`}
            onClick={() => removeTag(tag)}
          >
            <X />
          </Button>
        </Badge>
      ))}
      {overflowCount > 0 && (
        <Badge variant="secondary">+{overflowCount}</Badge>
      )}
    </div>
  );
};
