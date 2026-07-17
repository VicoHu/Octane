# Semi Design → Shadcn/ui（Base UI）迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Octane 扩展的 Semi Design 组件全量迁移到 shadcn/ui（Base UI 底座），消除绝大多数 Semi 依赖，仅 Form/Tree 暂留。

**Architecture:** Tailwind v4（`@tailwindcss/vite`）接入 WXT；shadcn Base UI 组件落到 `src/components/ui/*` 作封装复用层；DESIGN.md token 经 tailwind `@theme` + shadcn CSS 变量单向桥接，单一真源保留；按组件族横向切片，每族一个 ui/* 封装 → 全局替换 → typecheck+test 双绿门控 → 提交。

**Tech Stack:** React 19.2 · WXT 0.20（Vite 8）· TypeScript 6 · pnpm · Tailwind v4 · shadcn/ui（Base UI）· lucide-react · sonner · class-variance-authority + clsx + tailwind-merge

## Global Constraints

- **包管理器：pnpm**（`pnpm add` / `pnpm dlx shadcn@latest`），非 npm
- **运行时：** React 19.2；WXT 构建，不得替换 WXT 框架
- **shadcn 底座：Base UI**（`-b base`），iconLibrary `lucide`
- **路径别名：** `@/*` → `./src/*`（已存在，不改）
- **token 单一真源：** DESIGN.md。色值用项目的 hex（不强行 oklch），改主题只动 token
- **样式纪律（shadcn skill critical rules）：** 用语义 token（`bg-primary` 等）非裸色值；`gap-*` 非 `space-y-*`；`size-*` 非 `w-*/h-*`；`cn()` 处理条件类；overlay 不手写 z-index；Dialog/Sheet 必须有 Title；Avatar 必须有 Fallback；Button 无 isLoading（用 Spinner 组合）；Base UI 用 `render` 非 Radix `asChild`
- **测试规范：** 遵循 `docs/standards/testing.md`——真实渲染 ui/*，仅 mock 副作用边界（chrome/DB/网络/Toast/lottie）；query 用 getByRole/getByText；交互用 userEvent；断言用 jest-dom matcher
- **门控：** 每个任务结束 `pnpm run typecheck` + `pnpm run test` 双绿才提交、才进下一任务
- **Form/Tree 边界：** `src/components/backup/SelectionTree.tsx`、`src/entrypoints/home/components/Content/index.tsx`、`src/entrypoints/home/components/BookmarkOpsPanel/index.tsx` 的 Form/Tree 本体**保留 Semi 不动**（仅迁其文件内其它组件）

## File Structure

**新建：**
- `components.json`（root）— shadcn 配置（aliases、tailwind css 路径、base color、iconLibrary）
- `src/lib/utils.ts` — `cn()` 工具（clsx + tailwind-merge）
- `src/components/ui/*` — shadcn 组件（CLI 生成）+ 自定义封装（toast/typography/loader）
- `src/styles/tailwind-theme.css` — `@import "tailwindcss"` + `@theme` + shadcn `:root`/`.dark` 变量

**修改：**
- `package.json` — 新依赖
- `wxt.config.ts` — 注册 `@tailwindcss/vite` 插件
- `src/styles/global.css` — 顶部 `@import './tailwind-theme.css'`（保留现有项目 token）
- `src/entrypoints/home/App.tsx` — sidebar 元素加 `.dark`；CSS import 调整
- 44 个含 Semi import 的源文件 — 换成 `@/components/ui/*` + `lucide-react`

---

## Phase 0：地基

### Task 0.1：安装 Tailwind v4 + Base UI 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1：安装 Tailwind v4 与 Vite 插件**

```bash
pnpm add tailwindcss @tailwindcss/vite
```

- [ ] **Step 2：安装 shadcn 运行时依赖**

```bash
pnpm add class-variance-authority clsx tailwind-merge lucide-react sonner @base-ui-components/react tw-animate-css
```

> `@base-ui-components/react` 是 Base UI 原语包；`tw-animate-css` 提供 shadcn 动画类。

- [ ] **Step 3：验证安装**

Run: `pnpm ls tailwindcss @tailwindcss/vite lucide-react sonner @base-ui-components/react class-variance-authority clsx tailwind-merge`
Expected: 全部列出，无 missing。

- [ ] **Step 4：提交**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: 安装 Tailwind v4 + shadcn(Base UI) 运行时依赖"
```

### Task 0.2：WXT 接入 Tailwind Vite 插件

**Files:**
- Modify: `wxt.config.ts`

**Interfaces:**
- Produces: WXT 构建管线注入 `@tailwindcss/vite`，所有 entrypoint 的 CSS 支持 `@import "tailwindcss"` 与 `@theme`。

- [ ] **Step 1：在 wxt.config.ts 注册插件**

在 `wxt.config.ts` 顶部加 import，并在 `defineConfig` 加 `vite` 字段：

```ts
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: {
    plugins: [tailwindcss()],
  },
  manifest: {
    // ... 保持原样不动
  },
});
```

- [ ] **Step 2：验证 dev 可启动（Tailwind 已接入但无入口）**

Run: `timeout 25 pnpm run dev`（或手动 `pnpm run dev` 后 Ctrl+C）
Expected: WXT 启动无 Tailwind/Vite 插件报错（看到 `WXT 0.20` 启动日志、扩展构建到 `.output/chrome-mv3-dev`）。

- [ ] **Step 3：提交**

```bash
git add wxt.config.ts
git commit -m "build: WXT 接入 @tailwindcss/vite 插件"
```

### Task 0.3：写 Tailwind 主题 CSS（DESIGN.md token 桥接）

**Files:**
- Create: `src/styles/tailwind-theme.css`
- Modify: `src/styles/global.css`（顶部加一行 import）

**Interfaces:**
- Produces: `--background/--foreground/--primary/--primary-foreground/--border/--ring/--radius-*` 等 shadcn 变量，值派生自 DESIGN.md；`.dark` scope 对应 sidebar 暗色。

- [ ] **Step 1：创建 `src/styles/tailwind-theme.css`**

```css
@import 'tailwindcss';
@import 'tw-animate-css';

@custom-variant dark (&:where(.dark, .dark *));

/* DESIGN.md token → tailwind @theme（供 tailwind 工具类引用，如 bg-primary） */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);

  --radius-sm: calc(var(--radius) - 0px);
  --radius-md: calc(var(--radius) + 4px);
  --radius-lg: calc(var(--radius) + 8px);
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC',
    'Microsoft YaHei', 'Noto Sans SC', 'Helvetica Neue', Arial, sans-serif;
}

/* 浅色内容区（DESIGN.md：content-bg #F8FAFC / card-bg #FFFFFF / primary #00B894 绿 accent） */
:root {
  --radius: 0.5rem; /* 8px = DESIGN.md rounded.sm */
  --background: #f8fafc; /* content-bg */
  --foreground: #0f172a; /* text-primary */
  --card: #ffffff; /* card-bg */
  --card-foreground: #0f172a;
  --popover: #ffffff;
  --popover-foreground: #0f172a;
  --primary: #00b894; /* 品牌绿 accent */
  --primary-foreground: #2d3436; /* 绿底之上的炭灰字，≈4.9:1 达 AA */
  --secondary: #f1f5f9; /* surface-secondary */
  --secondary-foreground: #475569; /* text-secondary */
  --muted: #f1f5f9;
  --muted-foreground: #64748b; /* muted */
  --accent: #f1f5f9; /* hover 中性 fill（不用绿） */
  --accent-foreground: #0f172a;
  --destructive: #ef4444; /* danger */
  --destructive-foreground: #ffffff;
  --border: #e2e8f0; /* border-color */
  --input: #e2e8f0;
  --ring: #00b894; /* focus ring */
  --sidebar: #202829;
  --sidebar-foreground: #ffffff;
}

/* 暗色：sidebar scope（DESIGN.md：sidebar-bg #202829 / surface #2D3436，禁 Semi 冷黑 #232429） */
.dark {
  --background: #202829; /* sidebar-bg */
  --foreground: #ffffff;
  --card: #2d3436; /* sidebar-surface */
  --card-foreground: #ffffff;
  --popover: #2d3436; /* Semi Modal/Popover elevated 同款 */
  --popover-foreground: #ffffff;
  --primary: #00b894; /* 暗底用鲜绿 */
  --primary-foreground: #042f2a; /* 深绿底白字达 AA（design-review 复核） */
  --secondary: #2d3436;
  --secondary-foreground: #ffffff;
  --muted: #2d3436;
  --muted-foreground: #9ca3af;
  --accent: #2d3436;
  --accent-foreground: #ffffff;
  --destructive: #ef4444;
  --destructive-foreground: #ffffff;
  --border: rgba(255, 255, 255, 0.08); /* sidebar-border */
  --input: rgba(255, 255, 255, 0.12);
  --ring: #00b894;
  --sidebar: #202829;
  --sidebar-foreground: #ffffff;
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

- [ ] **Step 2：在 `src/styles/global.css` 最顶部引入主题文件**

在 `global.css` 第 1 行前插入：

```css
@import './tailwind-theme.css';
```

> 原有 `:root` 项目 token（`--primary` 等）保留，供非 shadcn 业务样式继续引用；`tailwind-theme.css` 的 shadcn 变量与之同名共存不冲突（均为 CSS 变量，作用域/用途分离）。**不要删** `semi-theme-override.css`（Form/Tree 仍需）。

- [ ] **Step 3：验证构建**

Run: `pnpm run typecheck`
Expected: 绿（纯 CSS 改动，不影响类型）。

Run: `timeout 25 pnpm run dev`
Expected: WXT 启动，无 Tailwind 编译报错。

- [ ] **Step 4：提交**

```bash
git add src/styles/tailwind-theme.css src/styles/global.css
git commit -m "feat(style): Tailwind 主题 CSS(DESIGN.md token→shadcn 变量桥接)"
```

### Task 0.4：shadcn 初始化 + cn 工具

**Files:**
- Create: `components.json`
- Create: `src/lib/utils.ts`

**Interfaces:**
- Produces: `components.json`（aliases `@/components`/`@/lib/utils`/`@/components/ui`，baseColor neutral，iconLibrary lucide，css 指向 `src/styles/global.css`）；`cn(classes...)` 工具。

- [ ] **Step 1：尝试 CLI init（Base UI 底座）**

Run: `pnpm dlx shadcn@latest init -b base -y`
Expected: 生成 `components.json` 与 `src/lib/utils.ts`。若 CLI 因框架识别为 "Manual" 报错或写入 css 文件异常，转 Step 2 手动创建。

- [ ] **Step 2（CLI 失败时回退）：手动创建 `components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "base-nova",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/styles/global.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 3：确保 `src/lib/utils.ts` 存在**

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn 标准类合并工具：条件类 + tailwind 冲突去重 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4：验证 CLI 可用**

Run: `pnpm dlx shadcn@latest info`
Expected: 输出项目配置，`base: base`、`iconLibrary: lucide`、aliases 正确。

Run: `pnpm run typecheck`
Expected: 绿。

- [ ] **Step 5：提交**

```bash
git add components.json src/lib/utils.ts
git commit -m "feat(shadcn): 初始化 components.json(Base UI) + cn 工具"
```

### Task 0.5：sidebar 暗色 scope 切换到 `.dark`

**Files:**
- Modify: `src/entrypoints/home/App.tsx`（sidebar 元素）
- Modify: `src/styles/global.css`（`.semi-always-dark` token 块注释/桥接）

**Interfaces:**
- Consumes: Task 0.3 的 `.dark` 变量
- Produces: sidebar 渲染在 `.dark` scope，其内 shadcn 组件取暗色 token。

- [ ] **Step 1：定位 sidebar 元素并加 `.dark` class**

`src/entrypoints/home/App.tsx:83` 当前：
```tsx
<aside className="app-sidebar semi-always-dark" id="sidebar-container">
```
改为：
```tsx
<aside className="app-sidebar semi-always-dark dark" id="sidebar-container">
```

> **保留 `semi-always-dark`**：sidebar 内 Form/Tree 残留的 Semi 组件仍需它走 Semi 暗色；新增 `dark` 让 shadcn 组件走 `.dark` token。两者并存到 Form/Tree 彻底迁移后再移除 `semi-always-dark`。

- [ ] **Step 2：确认 `global.css` 的 `.semi-always-dark` token 块仍正常**

不改动该块（它读 `--semi-color-*` 供 sidebar 内 Semi 组件用）。shadcn 组件在 `.dark` scope 内自动取 Step 1 新增的暗色变量。

- [ ] **Step 3：验证 typecheck + dev**

Run: `pnpm run typecheck` → 绿
Run: `timeout 25 pnpm run dev` → sidebar 仍正常渲染（Semi 组件未动）。

- [ ] **Step 4：提交**

```bash
git add src/entrypoints/home/App.tsx
git commit -m "refactor(home): sidebar 加 .dark scope(shadcn 暗色 token)"
```

### Task 0.6：安装 Phase 1-2 全部 shadcn 组件

**Files:**
- Create: `src/components/ui/*.tsx`（CLI 生成）

- [ ] **Step 1：批量 add 原子组件**

```bash
pnpm dlx shadcn@latest add button input textarea label checkbox switch tooltip avatar skeleton card alert separator badge empty -y
```

- [ ] **Step 2：批量 add 容器交互组件**

```bash
pnpm dlx shadcn@latest add tabs select accordion dropdown-menu popover alert-dialog dialog sheet scroll-area spinner number-field -y
```

> `number-field` 对应 Semi InputNumber（Base UI NumberField）；`spinner` 对应 Semi Spin；`sheet` 对应 SideSheet；`alert-dialog` 对应 Popconfirm；`accordion` 对应 Collapse。

- [ ] **Step 3：逐文件审查生成的组件（shadcn skill 规则）**

对每个新增 `src/components/ui/*.tsx`：确认 import 路径用 `@/lib/utils`、icon 用 `lucide-react`、无遗留 Radix `asChild`（Base UI 应是 `render`）、Dialog/Sheet/AlertDialog 有 Title 子件、Avatar 有 Fallback。**逐个 Read 新增文件核对。**

- [ ] **Step 4：验证 typecheck + test（此时组件已生成但无调用方，应仍绿）**

Run: `pnpm run typecheck && pnpm run test`
Expected: 双绿。

- [ ] **Step 5：提交**

```bash
git add src/components/ui/ package.json pnpm-lock.yaml components.json
git commit -m "feat(ui): 安装 shadcn(Base UI) 组件原语集"
```

---

## Phase 1：原子组件迁移（按族，可并行）

> **通用迁移规则（每个族任务复用）：**
> 1. 对该族每个含 Semi import 的文件：Read → 把 `@douyinfe/semi-ui` 的该组件 import 删掉、改 `@/components/ui/<name>`；把 `@douyinfe/semi-icons` 改 `lucide-react`（按映射改名）。
> 2. 调整 props 差异（见各任务「API 映射」）。
> 3. 删除因迁移变得未使用的 import/变量（遵守 `noUnusedLocals`）。
> 4. 测试文件中 mock 了该 Semi 组件的，改为不 mock（真实渲染 ui/*）或 mock 我们的 ui 封装。
> 5. 验证 `pnpm run typecheck && pnpm run test` 双绿，再提交。

### Task 1.1：lucide 图标全量替换

**Files:**
- Modify: 全部 import `@douyinfe/semi-icons` 的文件（14 图标，散落 home/sidepanel/popup/backup）

**API 映射（精确改名）：**

| Semi | lucide-react |
|---|---|
| IconPlus | Plus |
| IconLock | Lock |
| IconDelete | Trash2 |
| IconAlertTriangle | TriangleAlert |
| IconSetting | Settings |
| IconSearch | Search |
| IconRefresh | RefreshCw |
| IconMapPin | MapPin |
| IconKey | Key |
| IconEdit | Pencil |
| IconComment | MessageSquare |
| IconClose | X |
| IconChevronLeft | ChevronLeft |
| IconBookmark | Bookmark |

- [ ] **Step 1：定位所有 semi-icons import**

Run: `grep -rl "@douyinfe/semi-icons" src`
Expected: 列出全部待改文件。

- [ ] **Step 2：逐文件替换** import 来源 `@douyinfe/semi-icons` → `lucide-react`，图标名按上表改名。

> 注意 lucide 图标尺寸用 `size` prop 或父组件 CSS（shadcn 组件内用 `data-icon`，不手写 size 类）。

- [ ] **Step 3：验证 grep 无残留**

Run: `grep -rn "@douyinfe/semi-icons" src`
Expected: 无输出（或仅 Form/Tree 相关注释——本任务不涉及 Form/Tree 的图标也全换，因图标无 Form 耦合）。

- [ ] **Step 4：双绿 + 提交**

```bash
pnpm run typecheck && pnpm run test
git add -A
git commit -m "refactor(icon): semi-icons → lucide-react 全量替换"
```

### Task 1.2：Button

**Files:**
- Modify: 23 处 `<Button>`（home/popup/sidepanel/backup 多文件）

**API 映射：**
- Semi `<Button type="primary">` → `<Button variant="default">`（绿底炭灰字，已由 token 保证）
- Semi `<Button type="tertiary"|"plain">` → `<Button variant="ghost">`
- Semi `<Button type="danger">` → `<Button variant="destructive">`
- Semi `loading` prop → 移除，改为 `<Button disabled><Spinner data-icon="inline-start" />…</Button>`（shadcn Button 无 loading）
- Semi `size="small"|"large"` → `size="sm"|"lg"`
- Semi `icon` prop（仅图标）→ 直接放 lucide 子元素 + `data-icon`

- [ ] **Step 1-5：通用规则执行（替换 import `@/components/ui/button` → 调 props → 删未用 import → 双绿 → 提交）**

```bash
git commit -m "refactor(ui): Button semi→shadcn(23 处)"
```

### Task 1.3：Input + TextArea

**Files:**
- Modify: Input 12 处、TextArea 2 处

**API 映射：**
- Semi `<Input />` → `<Input />`（API 基本一致：value/onChange/onKeyDown/prefix）
- Semi `prefix`/`suffix` → shadcn 用 `InputGroup` + `InputGroupAddon` 包裹（见 shadcn skill forms.md）
- Semi `<TextArea>` → `<Textarea>`（注意大小写改名）
- 受控 `value`/`onChange`/`onPressEnter` → `onKeyDown` 判 Enter

- [ ] **Step 1-5：通用规则执行 → 双绿 → 提交**

```bash
git commit -m "refactor(ui): Input/TextArea semi→shadcn"
```

### Task 1.4：Switch + Checkbox

**Files:**
- Modify: Switch 2 处、Checkbox 3 处

**API 映射：**
- Semi `<Switch checked onChange>` → `<Switch checked onCheckedChange>`（onChange(e)=>onCheckedChange(boolean)）
- Semi `<Checkbox checked onChange>` → `<Checkbox checked onCheckedChange>`

- [ ] **Step 1-5：通用规则 → 双绿 → 提交**

```bash
git commit -m "refactor(ui): Switch/Checkbox semi→shadcn"
```

### Task 1.5：Tooltip + Avatar + Skeleton + Card + Separator

**Files:**
- Modify: Tooltip 2、Avatar 1、Skeleton 1、Card(SemiCard) 1

**API 映射：**
- Semi `<Tooltip content>` → `<Tooltip><TooltipTrigger asChild><Button>…</TooltipTrigger><TooltipContent>…</TooltipContent></Tooltip>`（Base UI 用 `render` 替代 `asChild`——查 `shadcn docs tooltip` 确认）
- Semi `<Avatar src>` → `<Avatar><AvatarImage src><AvatarFallback>…</AvatarFallback></Avatar>`（**必须** Fallback）
- Semi `<Card>` → `<Card><CardHeader><CardTitle>…</CardTitle></CardHeader><CardContent>…</CardContent></Card>`（用完整组合，勿全塞 CardContent）
- `<hr>`/分隔 → `<Separator />`

- [ ] **Step 1：先查 Base UI Tooltip/Avatar 的 API（render vs asChild）**

Run: `pnpm dlx shadcn@latest docs tooltip avatar` → 取 URL → fetch 确认 prop 名。

- [ ] **Step 2-5：通用规则 → 双绿 → 提交**

```bash
git commit -m "refactor(ui): Tooltip/Avatar/Skeleton/Card/Separator semi→shadcn"
```

### Task 1.6：自定义 `ui/typography.tsx` + 迁 Typography（7 处）

**Files:**
- Create: `src/components/ui/typography.tsx`
- Modify: 7 处 `<Typography.Text>`

**Interfaces:**
- Produces: `<Typography variant="default|secondary|danger">` 与 `<Typography.Title level={1|2|3}>`

- [ ] **Step 1：写 `src/components/ui/typography.tsx`**

```tsx
import { cn } from '@/lib/utils';

type TextVariant = 'default' | 'secondary' | 'danger';

const variantClass: Record<TextVariant, string> = {
  default: 'text-foreground',
  secondary: 'text-muted-foreground',
  danger: 'text-destructive',
};

/** Semi Typography.Text 的薄封装：type→variant。语义 token 上色，非裸色值。 */
export function Typography({
  variant = 'default',
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: TextVariant }) {
  return (
    <span className={cn(variantClass[variant], className)} {...props}>
      {children}
    </span>
  );
}

const titleLevel = {
  1: 'text-2xl font-bold',
  2: 'text-xl font-semibold',
  3: 'text-lg font-semibold',
} as const;

/** Semi Typography.Title 的薄封装：heading→level。字号走 token 阶（DESIGN.md 24/20/…）。 */
export function Title({
  level = 2,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { level?: keyof typeof titleLevel }) {
  const Tag = (`h${level}` as 'h1' | 'h2' | 'h3');
  return (
    <Tag className={cn(titleLevel[level], className)} {...props}>
      {children}
    </Tag>
  );
}
```

- [ ] **Step 2：迁移 7 处 `Typography.Text type="danger|secondary"` → `Typography variant="danger|secondary"`**（保留 className/style/role）

- [ ] **Step 3：双绿 → 提交**

```bash
pnpm run typecheck && pnpm run test
git add src/components/ui/typography.tsx src -A
git commit -m "refactor(ui): Typography semi→薄封装 variant"
```

### Task 1.7：Banner → Alert + Spin → Spinner + Empty

**Files:**
- Modify: Banner 6、Spin 4、Empty 1

**API 映射：**
- Semi `<Banner type="info|warning|danger" description>` → `<Alert variant="default|destructive"><AlertTitle>…</AlertTitle><AlertDescription>…</AlertDescription></Alert>`（type→variant：info/warning→default，danger→destructive）
- Semi `<Spin />` → `<Spinner />`（shadcn）；`<Spin spinning>`包裹 → 条件渲染 `<Spinner>`
- Semi `<Empty>` → shadcn `<Empty>`（查 `shadcn docs empty` 确认 API）；或项目已有 `home/components/EmptyState` 复用——**优先复用 EmptyState**，避免双套

- [ ] **Step 1-5：通用规则 → 双绿 → 提交**

```bash
git commit -m "refactor(ui): Banner/Spin/Empty semi→shadcn"
```

---

## Phase 2：容器交互组件迁移（按族，可并行）

> 继续遵守 Phase 1 通用规则。容器组件 API 差异更大，每个任务**先 `shadcn docs <name>` 取 API 再改**。

### Task 2.1：Modal → Dialog（12 处）

**API 映射：**
- Semi `<Modal visible onOk onCancel title footer>` → `<Dialog open onOpenChange>` + `<DialogContent><DialogHeader><DialogTitle>…</DialogTitle></DialogHeader>…<DialogFooter>…</DialogFooter></DialogContent>`
- `visible` → `open`；`onCancel` → `onOpenChange={(o)=>!o && onClose()}`
- 自定义 footer 按钮 → 放 `<DialogFooter>`（用迁移后的 ui/Button）
- **必须**有 `<DialogTitle>`（无标题用 `className="sr-only"`）

- [ ] **Step 1-5：通用规则 → 双绿 → 提交**

```bash
git commit -m "refactor(ui): Modal semi→Dialog(12 处)"
```

### Task 2.2：Tabs / TabPane → Tabs（5+2 处）

**API 映射：**
- Semi `<Tabs><TabPane tab="x" item key="k">` → `<Tabs defaultValue><TabsList><TabsTrigger value="k">x</TabsTrigger></TabsList><TabsContent value="k">…</TabsContent></Tabs>`
- `TabPane` 拆为 `TabsTrigger` + `TabsContent`

- [ ] **Step 1-5：通用规则 → 双绿 → 提交**

```bash
git commit -m "refactor(ui): Tabs/TabPane semi→shadcn"
```

### Task 2.3：Select（4 处）

**API 映射：**
- Semi `<Select optionList=[{value,label}] value onChange>` → shadcn `<Select value onValueChange><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value>label</SelectItem></SelectContent></Select>`
- `optionList` 数组 → 渲染多个 `SelectItem`（map）
- `onChange(e)=>onValueChange(string)`

- [ ] **Step 1：查 Base UI Select 的 `render`/组合方式**

Run: `pnpm dlx shadcn@latest docs select` → fetch

- [ ] **Step 2-5：通用规则 → 双绿 → 提交**

```bash
git commit -m "refactor(ui): Select semi→shadcn(Base UI)"
```

### Task 2.4：Collapse → Accordion + Dropdown → DropdownMenu

**Files:** Collapse 1、Dropdown 1

**API 映射：**
- Semi `<Collapse>` → `<Accordion type="single|multiple"><AccordionItem value><AccordionTrigger>…</AccordionTrigger><AccordionContent>…</AccordionContent></AccordionItem></Accordion>`
- Semi `<Dropdown menu=[{node,onClick}] render>` → `<DropdownMenu><DropdownMenuTrigger asChild>…</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onClick>…</DropdownMenuItem></DropdownMenuContent></DropdownMenu>`（Base UI 用 `render`）

- [ ] **Step 1-5：通用规则 → 双绿 → 提交**

```bash
git commit -m "refactor(ui): Collapse/Dropdown semi→shadcn"
```

### Task 2.5：Popover + Popconfirm → Popover/AlertDialog + SideSheet → Sheet

**Files:** Popover 1、Popconfirm 3、SideSheet 1

**API 映射：**
- Semi `<Popover content>` → `<Popover><PopoverTrigger asChild>…</PopoverTrigger><PopoverContent>…</PopoverContent></Popover>`
- Semi `<Popconfirm title onConfirm onCancel>` → `<AlertDialog><AlertDialogTrigger asChild><Button>…</AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>…</AlertDialogTitle><AlertDialogDescription>…</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogAction onClick={onConfirm}>确认</AlertDialogAction><AlertDialogCancel>取消</AlertDialogCancel></AlertDialogFooter></AlertDialogContent></AlertDialog>`
- Semi `<SideSheet visible onCancel>` → `<Sheet open onOpenChange><SheetContent side="right">…</SheetContent></Sheet>`（必须有 `<SheetTitle>`）

- [ ] **Step 1-5：通用规则 → 双绿 → 提交**

```bash
git commit -m "refactor(ui): Popover/Popconfirm/SideSheet semi→shadcn"
```

### Task 2.6：InputNumber → NumberField + List → 语义化

**Files:** InputNumber 1、List 3

**API 映射：**
- Semi `<InputNumber value onChange min max>` → shadcn `<NumberField><NumberFieldContent><NumberFieldDecrement/><NumberFieldInput value onChange min max/><NumberFieldIncrement/></NumberFieldContent></NumberField>`（查 `shadcn docs number-field`）
- Semi `<List><List.Item>` → 语义化 `<ul className="flex flex-col gap-*"><li className="…">`（shadcn 无 List 原语，用 tailwind + token；`gap-*` 非 space-y）

- [ ] **Step 1-5：通用规则 → 双绿 → 提交**

```bash
git commit -m "refactor(ui): InputNumber/List semi→shadcn"
```

---

## Phase 3：Toast shim（sonner）

### Task 3.1：自定义 `ui/toast.tsx`（sonner 同签名 shim）

**Files:**
- Create: `src/components/ui/toast.tsx`
- Modify: 20 处 `Toast.info/success/error` 调用点
- Modify: 8 个 partial-mock Semi Toast 的测试文件

**Interfaces:**
- Produces: `Toast` 对象，签名 `Toast.info(opts)/success/error/warning/close`，opts 兼容 Semi `{ content, duration, id }`。

- [ ] **Step 1：写 `src/components/ui/toast.tsx`（sonner 封装 Semi 同签名）**

```tsx
import { toast as sonnerToast } from 'sonner';

/** Semi Toast 命令式 API 的 shim：内部转调 sonner，保留 content/duration 等参数。
 *  调用点零改：Toast.info({ content, duration }) 直接可用。 */
type ToastOptions = { content: React.ReactNode; duration?: number; id?: string | number };

function adapt(type: 'info' | 'success' | 'error' | 'warning') {
  return (opts: ToastOptions) => {
    const fn = type === 'info' ? sonnerToast : sonnerToast[type];
    return fn(opts.content, { duration: opts.duration, id: opts.id });
  };
}

export const Toast = {
  info: adapt('info'),
  success: adapt('success'),
  error: adapt('error'),
  warning: adapt('warning'),
  close: (id?: string | number) => sonnerToast.dismiss(id),
};
```

- [ ] **Step 2：在根挂载 `<Toaster/>`（每个 entrypoint 的 App 或 main）**

home/popup/sidepanel 三入口的根组件各加一次：

```tsx
import { Toaster } from '@/components/ui/sonner';
// …在组件树末尾：
<Toaster richColors position="top-center" />
```

> shadcn `sonner` 组件在 Task 0.6 未 add——本步先 `pnpm dlx shadcn@latest add sonner -y` 再挂载。

- [ ] **Step 3：替换 20 处 `Toast.xxx({content})` 调用的 import**

`import { Toast } from '@douyinfe/semi-ui'` → `import { Toast } from '@/components/ui/toast'`。调用签名不变（content→message 的适配在 shim 内部已兜底，调用点不改）。

- [ ] **Step 4：改 8 个测试文件的 Toast mock**

原 `vi.mock('@douyinfe/semi-ui', …)` 中 Toast 部分 → `vi.mock('@/components/ui/toast', () => ({ Toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), close: vi.fn() } }))`。仍为副作用边界 mock，符合测试规范。

- [ ] **Step 5：双绿 + 真机验证 Toast 弹出**

Run: `pnpm run typecheck && pnpm run test`
Expected: 双绿。

真机/jsdom 交互验证：触发一个 Toast.info（如 BookmarkOpsPanel 保存成功），确认弹层正确出现与消失。

- [ ] **Step 6：提交**

```bash
git add src/components/ui/toast.tsx src/components/ui/sonner.tsx -A
git commit -m "refactor(ui): Toast semi→sonner 同签名 shim(20 调用点+8 测试)"
```

---

## Phase 4：收尾与全量验证

### Task 4.1：Form/Tree 文件的非 Form/Tree 组件迁移

**Files:**
- Modify: `src/entrypoints/home/components/Content/index.tsx`（Form 本体保留，其余 Input/Button/Modal/Tabs/Toast/Skeleton 迁移）
- Modify: `src/entrypoints/home/components/BookmarkOpsPanel/index.tsx`（Form+useFieldState 保留，Banner 迁移；注意 `FormApi` 类型 import 来自 Semi，保留）
- **不动：** `src/components/backup/SelectionTree.tsx`（Tree）、`shareSelection.ts`

- [ ] **Step 1：Content/index.tsx 内：迁移 Input/Button/Modal/Tabs/TabPane/Toast/Skeleton/IconSearch，Form 区块保留 Semi import**

> 该文件 import 行会同时含 `@douyinfe/semi-ui`（仅 Form）与 `@/components/ui/*`——这是双轨期预期状态。

- [ ] **Step 2：BookmarkOpsPanel/index.tsx 内：迁移 Banner，保留 `Form, useFieldState` 与 `FormApi` 类型 import**

- [ ] **Step 3：双绿 → 提交**

```bash
git commit -m "refactor(ui): Content/BookmarkOpsPanel 非 Form 组件迁移(Form 本体保留 Semi)"
```

### Task 4.2：全量验证 + 残留盘点

- [ ] **Step 1：全量双绿**

Run: `pnpm run typecheck && pnpm run test`
Expected: 双绿。

- [ ] **Step 2：构建 + 产物检查**

Run: `pnpm run build`
Expected: WXT 构建成功，`.output/chrome-mv3` 产物存在（build 脚本含 process.exit(0)，不挂）。

- [ ] **Step 3：Semi 残留盘点**

Run: `grep -rn "@douyinfe/semi-ui" src | grep -v "Form\|useFieldState\|FormApi" | grep -v SelectionTree`
Expected: 仅 Form/Tree 相关残留（Content、BookmarkOpsPanel 的 Form import、SelectionTree）。

Run: `grep -rn "@douyinfe/semi-icons" src`
Expected: 无输出（图标已全换）。

- [ ] **Step 4：真机 QA 三入口**

`pnpm run dev` 加载扩展，验证 home/popup/sidepanel：
- Modal/Tabs/Select/Popover/Popconfirm/Sheet 交互正常
- Toast 正常弹出与消失
- sidebar 暗色配色正确（绿炭灰、无拼色）
- 各主按钮绿底炭灰字达 AA

- [ ] **Step 5：提交 + 写交付说明**

```bash
git add -A
git commit -m "chore(migrate): Semi→shadcn 迁移收尾全量验证"
```

### Task 4.3：记录"无法替换"清单（交付用户决策）

**Files:**
- Create or update: `docs/superpowers/specs/2026-07-15-semi-to-shadcn-design.md`（§8 已有，补"本期结论"）

- [ ] **Step 1：在设计文档 §8 补本期结论**

记录：本期迁移 25 种组件 + 14 图标 + Toast shim；**保留 Semi 仅 2 处**：
1. **Form / useFieldState / FormApi**（Content、BookmarkOpsPanel）——架构级重写，下阶段选项 A) react-hook-form+zod B) 保留 C) 自研
2. **Tree**（SelectionTree + shareSelection 耦合 Semi value[]）——下阶段选项 A) react-arborist/@base-ui tree B) 保留 C) 自研

- [ ] **Step 2：提交**

```bash
git add docs/superpowers/specs/2026-07-15-semi-to-shadcn-design.md
git commit -m "docs(spec): 补 Semi→shadcn 本期迁移结论与 Form/Tree 决策项"
```

---

## 风险与回滚

- 每族独立提交，任一批次 typecheck/test 红即可 `git revert <hash>` 回到 Semi。
- 双轨期 Semi 与 shadcn 并存（Phase 0-3），不互相破坏；Form/Tree 长期保留 Semi 是已知妥协。
- 暗色 sidebar 同时挂 `.semi-always-dark` + `.dark`，确保两种组件各自取正确 token。

## 自审记录

- **Spec 覆盖：** spec §1 范围→Phase 0-4 全覆盖；§3 架构决策→Task 0.1-0.6；§4 切片→Phase 1-2 按族；§3.4 Toast→Task 3.1；§6 测试→各任务 Step 双绿；§8 Form/Tree→Task 4.1/4.3。
- **占位符：** 无 TBD/TODO；每步含具体命令/代码。
- **类型一致：** `Toast.info/success/error/warning/close` 在 Task 3.1 定义后，Task 4.2 grep 沿用同名；`cn` 在 Task 0.4 定义，typography 等沿用。
