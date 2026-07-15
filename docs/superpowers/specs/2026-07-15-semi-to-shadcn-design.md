# Semi Design → Shadcn/ui（Base UI 优先）迁移设计

> 状态：设计草案，待用户 review
> 日期：2026-07-15
> 分支：`feature/0.1.13.0`

## 1. 目标与范围

### 目标
将 Octane 浏览器扩展的 UI 组件库从 Semi Design（`@douyinfe/semi-ui` + `@douyinfe/semi-icons`）迁移到 shadcn/ui（Base UI 底座），逐步消除对 Semi 的依赖，同时：
- 保持现有功能正常运行
- 不替换 WXT 框架
- 遵循设计规范（DESIGN.md token 真源；Semi 专属规范除外）
- 交互体验尽量保持一致

### 本期范围（地基 + 易/中组件全量）
- ✅ Phase 0：Tailwind v4 + shadcn 初始化 + 主题 token 桥接 + 暗色策略 + lucide 图标 + `ui/*` 原语层
- ✅ Phase 1：原子组件（Button/Input/TextArea/Switch/Checkbox/Tooltip/Avatar/Skeleton/Empty/Card/Spin/Typography/Banner/Icon）
- ✅ Phase 2：容器交互组件（Modal/Tabs/Select/Collapse/Dropdown/Popover/Popconfirm/SideSheet/InputNumber/List）
- ✅ Phase 3：Toast shim（sonner 封装同签名）
- ⏸ **延后到下一阶段（单独评估）**：Form + useFieldState + FormApi（2 文件，react-hook-form 重写）、Tree（1 处，shadcn 无对应）

### 不在本期范围
- 不做 Semi→shadcn 的"功能升级"（保持交互等价，不新增特性）
- 不重构与 UI 无关的业务逻辑
- Form/Tree 不在本期迁移，仅记录交付决策

## 2. 现状盘点

- **技术栈**：WXT 0.20 + React 19.2 + TypeScript 6 + Vite 8 + pnpm；3 个 entrypoint（`home` / `popup` / `sidepanel`）+ background
- **Semi 依赖**：`@douyinfe/semi-ui` ^2.100 + `@douyinfe/semi-icons` ^2.101；**无 `@douyinfe/semi-foundation` 直接依赖**（迁移面更小）
- **路径别名**：`@/*` → `./src/*`（shadcn 友好，已就绪）
- **Token 体系**：项目已有独立 CSS 变量 token（`src/styles/global.css` 的 `:root`，如 `--primary #00B894`），单一真源为 `DESIGN.md`。Semi 的 `--semi-color-*` 是从项目 token **桥接进去**的（`semi-theme-override.css` 覆盖 Semi 默认蓝），不是反向依赖
- **暗色机制**：Semi 走 `.semi-always-dark` class scope（仅 sidebar 用）；`home/main.tsx` 引 `react19-adapter`
- **测试**：8 个测试文件 partial-mock 了 `@douyinfe/semi-ui`（主要 Toast）；遵循 `docs/standards/testing.md`（不整体 mock Semi，仅命中副作用边界）

### Semi 组件使用清单（27 种 + 14 图标）
| Semi 组件 | 频次 | shadcn(Base UI) 对应 | 难度 |
|---|---|---|---|
| Button | 23 | `ui/button` | 易 |
| Toast（命令式）| 20 | sonner + toast shim | 中 |
| Modal | 12 | `ui/dialog` | 中 |
| Input | 12 | `ui/input` | 易 |
| Typography | 7 | `ui/typography` 薄封装（Text/Title + variant）| 易 |
| Banner | 6 | `ui/alert` | 易 |
| Tabs / TabPane | 5 / 2 | `ui/tabs` | 中 |
| Spin | 4 | lucide Loader 旋转 | 易 |
| Select | 4 | `ui/select`（Base UI Select）| 中 |
| Popconfirm | 3 | `ui/alert-dialog` | 中 |
| List | 3 | 语义化 ul/li + token（无原生）| 中 |
| Checkbox | 3 | `ui/checkbox` | 易 |
| Tooltip | 2 | `ui/tooltip` | 易 |
| TextArea | 2 | `ui/textarea` | 易 |
| Switch | 2 | `ui/switch` | 易 |
| **Form / useFieldState / FormApi** | 2 / 1 | react-hook-form + zod | **难（延后）** |
| **Tree** | 1 | 无 shadcn 对应 | **难（延后/记录）** |
| Skeleton | 1 | `ui/skeleton` | 易 |
| SideSheet | 1 | `ui/sheet` | 中 |
| Popover | 1 | `ui/popover` | 易 |
| InputNumber | 1 | Base UI NumberField 封装 | 中 |
| Empty | 1 | 复用现有 `EmptyState` 组件 | 易 |
| Dropdown | 1 | `ui/dropdown-menu` | 中 |
| Collapse | 1 | `ui/accordion` | 中 |
| Card（SemiCard）| 1 | `ui/card` | 易 |
| Avatar | 1 | `ui/avatar` | 易 |

**图标（14）**：`@douyinfe/semi-icons` → `lucide-react`（shadcn 标准）。映射：IconPlus→Plus、IconLock→Lock、IconDelete→Trash2、IconAlertTriangle→AlertTriangle、IconSetting→Settings、IconSearch→Search、IconRefresh→RefreshCw、IconMapPin→MapPin、IconKey→Key、IconEdit→Pencil、IconComment→MessageSquare、IconClose→X、IconChevronLeft→ChevronLeft、IconBookmark→Bookmark。

## 3. 架构决策

### 3.1 样式基座：Tailwind v4 + shadcn/ui（Base UI 底座）
- **用户已选定**。Base UI 自 2026-01 起是 shadcn/ui 默认底层（registry 用 shadcn 样式包裹 Base UI），满足"Base UI优先"
- Tailwind v4 经 `@tailwindcss/vite` 插件接入，WXT 基于 Vite，兼容
- shadcn 组件落到 `src/components/ui/*`（封装复用层，调用方用我们的封装件）

### 3.2 Token 桥接：DESIGN.md 单一真源保留
DESIGN.md → tailwind `@theme` → shadcn CSS 变量，三段单向派生：

```
DESIGN.md (token 真源)
  └─ tailwind v4 @theme (src/styles/theme.css)
       --color-primary: #00B894
       --color-primary-foreground: #2D3436
       --radius: ... / --font-... / --shadow-...
       └─ shadcn 组件 CSS 变量 (同文件 :root/.dark)
            --background --foreground --primary --primary-foreground
            --border --input --ring --radius ...
            └─ shadcn 组件 className="bg-primary text-primary-foreground"
```

- shadcn 默认 token 用 oklch；本项目用 DESIGN.md 的 hex 值直接赋给 shadcn 变量（保留项目调色，不强行 oklch）
- 现有 `global.css` 的项目 token（`--primary` 等）保留，作为非 shadcn 业务样式的引用源；tailwind `@theme` 与之同名对齐，单一真源不破
- 迁移完成后 `semi-theme-override.css` 删除（不再需要桥接到 Semi）

### 3.3 暗色策略：采用 shadcn `.dark` class
- shadcn 暗色 = 在根元素加 `.dark` class（class 策略）
- 项目 sidebar 是唯一暗色区，当前用 `.semi-always-dark`。迁移后 sidebar 元素改加 `.dark`（或保留项目语义 class 同时加 `.dark`）
- `global.css` 里 `.semi-always-dark` scope 读 `--semi-color-*` 的部分，改为读 shadcn `.dark` 下的 token
- 不做全站暗色切换（项目无此需求），仅 sidebar scope 局部暗色

### 3.4 Toast shim：sonner + 同签名封装
- Semi 命令式 API：`Toast.info({ content, duration, ... })` / `.success` / `.error`，20 处调用点
- 方案：`src/components/ui/toast.tsx` 基于 sonner 封装一个 `Toast` 对象，暴露同签名 `info/success/error/warning/close`，内部转调 sonner
- 调用点零改或仅微改（content→message 适配在 shim 内部做），最大限度降低 churn
- 8 个 partial-mock Toast 的测试文件：迁移后改 mock 我们的 `toast` shim（仍是副作用边界 mock，符合测试规范）

### 3.5 图标：lucide-react
- `@douyinfe/semi-icons` 全量替换为 `lucide-react`（减少 Semi 依赖的一部分）
- 在 `ui/icon.tsx` 不做强制封装（lucide 直接用即可），仅提供一份映射参考

### 3.6 Form / Tree 延后
- **Form**（Content/index.tsx、BookmarkOpsPanel/index.tsx）：Semi Form + useFieldState + FormApi + 字段校验。迁移到 react-hook-form + zod 是架构级重写，风险高。本期这两个文件的**非 Form 组件**正常迁移，Form 本体留下阶段单独评估
- **Tree**（1 处）：shadcn/Base UI 无 Tree 组件。本期保留 Semi Tree，记录交付决策（下阶段可选：社区 tree 组件 / 自研 / 保留 Semi 仅此一处）

## 4. 迁移切片策略（方案 1：按组件族横向切片）

```
Phase 0  地基
  ├─ 装 @tailwindcss/vite + tailwindcss v4，接入 wxt.config / vite
  ├─ shadcn init（Base UI 底座）→ components.json（aliases: @/components, @/lib）
  ├─ 写 src/styles/theme.css：DESIGN.md → @theme + shadcn :root/.dark 变量
  ├─ 全局 import theme.css；保留 global.css 业务 token
  ├─ 装 lucide-react、sonner、react-hook-form(留用)、@base-ui-components/react
  ├─ sidebar 暗色 scope 改 .dark
  └─ 验证：dev 启动 + typecheck + test 全绿（此时 Semi 仍在，双轨可并存）
  → 门控：typecheck + test 双绿 + dev 可渲染

Phase 1  原子族（每族 = 一个 ui/* 封装 → 全局替换 → 双绿 → 提交）
  Button → Input/TextArea → Switch/Checkbox → Tooltip → Avatar/Skeleton/Card
  → Spin/Typography/Banner/Empty → lucide 图标全量替换
  → 门控：每族 typecheck + test 双绿

Phase 2  容器交互族
  Modal(dialog) → Tabs → Select → Collapse(accordion) → Dropdown(menu)
  → Popover → Popconfirm(alert-dialog) → SideSheet(sheet) → InputNumber → List
  → 门控：每族 typecheck + test 双绿 + 真机/视觉抽查关键交互

Phase 3  Toast shim
  建 ui/toast.tsx（sonner 封装）→ 替换 20 处 Toast 调用 → 改 8 个测试 mock
  → 门控：typecheck + test 双绿 + Toast 真机验证

Phase 4  收尾（本期）
  ├─ Form/Tree 文件的非 Form/Tree 组件迁移（Form/Tree 本体保留 Semi）
  ├─ ⚠️ react19-adapter import **保留**（3 个 main.tsx）：Form/Tree 仍用 Semi，adapter 必需
  ├─ ⚠️ semi-theme-override.css **保留**：Form/Tree 残留的 Semi 组件仍需品牌色桥接
  │     （仅当 Form/Tree 在后续阶段彻底迁移后才可删除 adapter + override）
  ├─ 记录"无法替换"清单（Form/Tree）交付用户决策
  └─ 全量验证：typecheck + test + build(wxt) + zip 产物检查
```

**封装复用原则**（用户要求）：所有 shadcn 组件经 `src/components/ui/*` 封装后暴露，调用方一律 import 我们的封装件；封装件内统一对齐 DESIGN.md（主按钮绿底炭灰字、圆角 8/12/16、品牌色预算等），业务侧不再直连 shadcn 原件。

## 5. 组件 API 映射要点（迁移易错点）

| Semi 用法 | shadcn(Base UI) 写法 | 注意 |
|---|---|---|
| `<Modal visible onOk onCancel footer>` | `<Dialog open onOpenChange>` + `DialogContent/Footer` | visible→open 受控；footer 自组合按钮 |
| `<Tabs><TabPane tab item>` | `<Tabs><TabsTrigger/TabsContent>` | 子项结构变 |
| `<Select optionList value onChange>` | `<Select value onChange>` + items | optionList→children/props |
| `<Popconfirm title onConfirm onCancel>` | `<AlertDialog>` | 拆 AlertDialog/Action/Cancel |
| `<SideSheet visible onCancel>` | `<Sheet open onOpenChange>` | 同 Modal 受控化 |
| `<Collapse>` | `<Accordion>` | item 结构变 |
| `<Toast.info({content})>` | `toast shim` 内部 `sonner toast()` | 同签名封装 |
| `<Spin>` | `<Loader2 className="animate-spin">` | lucide 旋转 |
| `<Banner type description>` | `<Alert variant>` | type→variant 映射 |
| `<Typography.Text type>` | `<Typography variant>`（`ui/typography` 薄封装）| type→variant(danger/secondary/default)；用 token 上色 |
| `<List><List.Item>` | `<ul><li>` + tailwind | 语义化 |

## 6. 测试策略

- 遵循 `docs/standards/testing.md`：真实渲染组件（不整体 mock ui/*），仅 mock 副作用边界（chrome API / DB / 网络 / Toast / lottie）
- Toast shim 的 8 个测试：mock 我们的 `ui/toast`（仍边界 mock）
- 每个批次结束 `pnpm run typecheck` + `pnpm run test` 双绿才进下一批（与 husky pre-push gate 一致）
- 关键交互（Modal 开关 / Tabs 切换 / Select 选择 / Popconfirm 确认 / Toast 弹出）在 Phase 2/3 做真机/jsdom 交互验证

## 7. 风险与回滚

| 风险 | 缓解 |
|---|---|
| Tailwind v4 接入 WXT 构建异常 | Phase 0 先验证 dev+build 可跑，Semi 双轨并存降低风险 |
| shadcn CSS 变量与项目 token 对不齐导致配色漂移 | theme.css 以 DESIGN.md hex 为准逐项核对；design-review 抽查 |
| Toast shim 行为不等价（duration/关闭/堆叠）| shim 内对齐 Semi 行为；真机验证；保留 close API |
| 双轨期 Semi 残留导致包体增大 | 本期收尾统一清理；Form/Tree 保留是已知妥协 |
| 某组件迁移后交互回归 | 每批双绿门控 + 真机抽查；按族小步提交便于 git revert |

**回滚**：按族小步提交，任一批次出问题可 `git revert` 该批次回到 Semi。

## 8. "无法替换"组件记录（交付用户决策）

| 组件 | 位置 | 无法替换原因 | 下阶段选项 |
|---|---|---|---|
| Form / useFieldState / FormApi | `home/components/Content/index.tsx`、`home/components/BookmarkOpsPanel/index.tsx` | Semi Form 是声明式字段+校验状态管理，迁移到 react-hook-form+zod 是架构级重写，风险高 | A) react-hook-form+zod 重写；B) 保留 Semi 仅此 2 处；C) 自研轻量表单 |
| Tree | `src/components/backup/SelectionTree.tsx`（+ `shareSelection.ts` 逻辑助手 + 2 测试）| shadcn/Base UI 无 Tree 原语；且 `shareSelection.ts` 与 Semi Tree 的 value[] 格式（checkRelation='related'、autoMergeValue）深度耦合，迁移需同步重写转换逻辑 | A) 社区 react-arborist / @base-ui tree；B) 保留 Semi 仅此 1 处；C) 自研 |

> 本期这两个（类）组件**保留 Semi 不动**，其余 25 种组件 + 14 图标全量迁移。最终是否清理这 2 处交用户决策。

### 执行期发现的次要行为变化（已处理，记录备查）

| 项 | 原 Semi | 迁移后 | 处理 |
|---|---|---|---|
| InputNumber | 带步进器 + `suffix="秒"` | `<Input type="number">`（无步进器、无 suffix） | 步进器移除（EncryptionTtl 一处）；单位文本可在 Row label 补；`onChange` 还原 blur-clamp 语义（setGrace 原始值、仅持久化 clamp） |
| Tabs `type="card"` | 卡片样式 | 默认 line 变体（shadcn 无 card） | 视觉从卡片降为线条，功能不变（BackupSyncTabs、Content、SettingsModal） |
| Modal `maskClosable={false}` | 点遮罩不关 | `disablePointerDismissal`（Base UI Dialog.Root） | 多数 Dialog 已对齐；个别（sidebar 删分类）默认改为可点遮罩关闭（行为微调，不影响数据） |
| Empty `description` prop | Semi Empty | shadcn `<Empty>` + `<EmptyDescription>` 子组件 | ContextList 已用 |
| semi-icons 字体图标 | font-size 控制大小 | lucide SVG，size prop / 父组件 CSS 控制 | 徽章内 `<Lock size={10}>` 显式尺寸匹配原 10px |
| sonner 体积 | Semi Toast 较轻 | sonner chunk ~425KB | 已知代价，后续可懒加载或换轻量 toast 优化 |

## 9. 验证标准（done criteria）

- [x] `pnpm run typecheck` 绿
- [x] `pnpm run test` 绿（97 文件 / 791 测试全过）
- [x] `pnpm run build`（wxt）成功，产物 2.23MB
- [ ] dev 模式 home/popup/sidepanel 三入口真机渲染与交互验证（需用户真机 QA）
- [x] Semi 依赖仅在 Form/Tree 残留处出现（`grep` 核验：仅 SelectionTree/Content/BookmarkOpsPanel）
- [x] Form/Tree 决策清单交付用户（见 §8）

## 10. 本期执行结论（2026-07-15 完成）

**已完成**：Tailwind v4 + shadcn(Base UI) 地基 + 25 种组件 + 14 图标 + Toast(sonner) shim 全量迁移。三绿验证通过（typecheck / 791 测试 / build）。

**残留 Semi（交用户决策是否下阶段清理）**：
1. **Form / useFieldState / FormApi**（Content 添加书签表单 + BookmarkOpsPanel 编辑表单）——选项 A) react-hook-form+zod 重写 / B) 保留 / C) 自研轻量。
2. **Tree**（SelectionTree + shareSelection 耦合 Semi value[]）——选项 A) react-arborist/@base-ui tree / B) 保留 / C) 自研。

**仍需**：用户真机 QA 三入口交互（Modal/Tabs/Select/Toast/拖拽），确认视觉与交互无回归。CLAUDE.md/DESIGN.md 中"使用 Semi Design"的治理条款需用户决定是否更新（本期已不依赖 Semi 作主组件库）。
