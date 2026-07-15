import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Semi Typography.Text 的薄封装：保留 type/size prop 以最小化调用点改动。
 *  type→语义 token 上色（非裸色值）：danger→destructive，secondary/tertiary→muted-foreground。 */
type TextType = 'default' | 'secondary' | 'tertiary' | 'danger' | 'warning' | 'success';
type TextSize = 'small' | 'normal';

const textTypeClass: Record<TextType, string> = {
  default: 'text-foreground',
  secondary: 'text-muted-foreground',
  tertiary: 'text-muted-foreground',
  danger: 'text-destructive',
  warning: 'text-muted-foreground',
  success: 'text-primary',
};

function Text({
  type = 'default',
  size = 'normal',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { type?: TextType; size?: TextSize }) {
  return (
    <span
      className={cn('text-sm', size === 'small' && 'text-xs', textTypeClass[type], className)}
      {...props}
    />
  );
}

/** Semi Typography.Title 的薄封装：heading(1-6)→对应标签 + 字号阶（DESIGN.md 32/24/20/…）。 */
const headingClass: Record<number, string> = {
  1: 'text-3xl',
  2: 'text-2xl',
  3: 'text-xl',
  4: 'text-lg',
  5: 'text-base',
  6: 'text-sm',
};

function Title({
  heading = 5,
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { heading?: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const Tag = `h${heading}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  return <Tag className={cn(headingClass[heading], 'font-semibold', className)} {...props} />;
}

/** 与 Semi 同名的命名空间封装，调用点仅改 import 路径即可。 */
export const Typography = { Text, Title };
