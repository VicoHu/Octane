/**
 * Tag 多选输入组件（Issue #48）。
 *
 * 两个主页保存入口（添加书签 / 从标签页保存）共用的 Tag 录入控件：
 * - 支持自由输入创建新 Tag（Enter / 逗号提交）
 * - 下方展示当前 Workspace 已有 Tag 建议（点击复用）
 * - 输入与已有 Tag 仅大小写不同时复用已有展示形式
 * - 非法输入（空值、内部空白、超长、超量）在控件附近显示明确错误
 *
 * 规则复用 src/shared/utils/tagRules.ts，不重复实现校验/去重/大小写逻辑。
 */

import { useState, useCallback, useRef, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { validateTag, normalizeTags, MAX_TAG_LENGTH, MAX_TAG_COUNT } from '@/shared/utils/tagRules';

export interface TagInputProps {
  /** 已选 Tag 数组 */
  value: string[];
  /** Tag 变更回调 */
  onChange: (tags: string[]) => void;
  /** 建议源：当前 Workspace 全部 Bookmark 聚合后的 Tag（已按使用次数降序、名称排序） */
  suggestions: string[];
}

/** 校验失败的错误文案 */
function tagError(raw: string, currentCount: number): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null; // 空值不报错（用户可能还在输入）
  if (/\s/.test(trimmed)) return 'Tag 不能包含空白字符';
  if (trimmed.length > MAX_TAG_LENGTH) return `Tag 长度不能超过 ${MAX_TAG_LENGTH} 个字符`;
  if (currentCount >= MAX_TAG_COUNT) return `每个书签最多 ${MAX_TAG_COUNT} 个 Tag`;
  return null;
}

export function TagInput({ value, onChange, suggestions }: TagInputProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** 尝试添加一个 Tag：校验 + 大小写不敏感去重 + 复用已有展示形式 */
  const tryAdd = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed === '') {
        setError(null);
        return;
      }

      // 超量检查
      if (value.length >= MAX_TAG_COUNT) {
        setError(`每个书签最多 ${MAX_TAG_COUNT} 个 Tag`);
        return;
      }

      // 校验
      const validated = validateTag(trimmed);
      if (validated === null) {
        // 区分错误类型给出明确提示
        if (/\s/.test(trimmed)) {
          setError('Tag 不能包含空白字符');
        } else if (trimmed.length > MAX_TAG_LENGTH) {
          setError(`Tag 长度不能超过 ${MAX_TAG_LENGTH} 个字符`);
        } else {
          setError('Tag 无效');
        }
        return;
      }

      // 大小写不敏感去重：已有 → 复用已有展示形式，不新增
      const lower = validated.toLowerCase();
      const existing = value.find((t) => t.toLowerCase() === lower);
      if (existing) {
        setError(null);
        setInput('');
        return;
      }

      onChange([...value, validated]);
      setInput('');
      setError(null);
    },
    [value, onChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        tryAdd(input);
        return;
      }
      // Backspace 在空输入时删除最后一个 Tag
      if (e.key === 'Backspace' && input === '' && value.length > 0) {
        onChange(value.slice(0, -1));
      }
    },
    [input, value, onChange, tryAdd],
  );

  const handleRemove = useCallback(
    (tag: string) => {
      onChange(value.filter((t) => t !== tag));
    },
    [value, onChange],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInput(e.target.value);
      // 输入变化时清除上一个错误（仅当当前输入合法或为空时）
      if (error) {
        const next = tagError(e.target.value, value.length);
        if (next === null) setError(null);
      }
    },
    [error, value.length],
  );

  // 过滤建议：去掉已选中的（大小写不敏感）
  const selectedLower = new Set(value.map((t) => t.toLowerCase()));
  const filteredSuggestions = suggestions.filter(
    (s) => !selectedLower.has(s.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-2">
      {/* 已选 Tag 列表 */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1">
              {tag}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="shrink-0"
                aria-label={`移除 ${tag}`}
                onClick={() => handleRemove(tag)}
              >
                <X />
              </Button>
            </Badge>
          ))}
        </div>
      )}

      {/* 输入框 */}
      <Input
        ref={inputRef}
        value={input}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder="输入 Tag 后按回车添加"
        aria-label="Tag 输入"
        aria-invalid={error ? true : undefined}
      />

      {/* 错误提示 */}
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}

      {/* 建议列表 */}
      {filteredSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {filteredSuggestions.map((tag) => (
            <Button
              key={tag}
              type="button"
              variant="outline"
              size="xs"
              onClick={() => tryAdd(tag)}
            >
              {tag}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export { normalizeTags };
