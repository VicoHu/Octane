# Shadcn 迁移后视觉一致性修复设计

> 状态：待用户最终 review
> 日期：2026-07-15
> 分支：`feature/0.1.13.0`

## 1. 背景与目标

Semi Design 迁移到 shadcn/ui（Base UI）后，业务功能仍可运行，但部分页面丢失了原组件库提供的视觉层和交互语义。主要表现为：

- 书签卡片从横向信息行变为纵向堆叠，信息密度明显下降；
- Settings 的纵向一级导航退化为顶部胶囊 Tabs，两级导航失去区分；
- 旧项目 token 与 shadcn token 同名冲突，圆角、弱化色和暗色来源漂移；
- Dialog 遮罩过浅且模糊过强，Alert 呈现得像输入框；
- Home、popup、sidepanel 仍存在可见原生按钮、伪按钮和手写 dialog。

本次目标是依据 `DESIGN.md` 和迁移前交互，恢复统一的信息密度、视觉层级与键盘交互。无需像素级复刻 Semi，也不改变业务功能。

## 2. 范围

### 2.1 本期范围

1. 修复共享 token 与 shadcn 原语的语义映射。
2. 修复 Home 主界面、Sidebar、BookmarkCard、SettingsModal 的视觉回归。
3. 收口 Home、popup、sidepanel 中用户可见的原生按钮、伪按钮和手写 dialog。
4. 保持已有数据流、store、持久化和业务回调不变。
5. 完成类型检查、测试、构建和多视口浏览器视觉验收。

### 2.2 不在本期范围

- 不迁移残留 Semi Form / Tree；
- 不重构书签、工作区、分类、备份或加密业务逻辑；
- 不新增功能、入口或配置项；
- 不对 Home、popup、sidepanel 做整体 redesign；
- 不要求迁移前后像素级一致。

## 3. 根因与设计原则

### 3.1 根因

1. shadcn `Card` 默认使用纵向 flex，BookmarkCard 没有明确覆盖 `flex-direction`。
2. Settings 外层 Tabs 没有声明纵向 orientation 与 line 变体。
3. `tailwind-theme.css` 与 `global.css` 对同名 `--muted`、圆角和字号 token 给出不同语义和值。
4. 部分业务样式仍从 Semi token 反向派生，形成两套暗色来源。
5. 迁移时只替换了组件标签，未完整恢复原组件的布局、焦点和键盘行为。

### 3.2 原则

- `DESIGN.md` 是 token 单一真源；shadcn 与残留 Semi 只能从项目语义 token 派生。
- 共享规则在 `src/components/ui/*` 解决，页面只定义专属布局。
- 绿色保持为焦点色，每个功能区最多一个绿色焦点。
- 视觉层级以边框、留白和轻微色差为主，不增加重阴影。
- 组件替换必须保持交互等价，不以“全量 shadcn”为由破坏拖拽或复杂列表语义。

## 4. Token 与共享原语

### 4.1 Token

- 拆分文本弱化色与 shadcn `muted` 表面色，禁止同名双义。
- 圆角统一为：按钮/输入/标签 8px，卡片/浮层 12px，Dialog 16px。
- 字号使用 12/14/16/20/24/32，移除 13px 半档。
- 字体栈补充 `PingFang SC`、`Microsoft YaHei`、`Noto Sans SC`。
- Sidebar 业务 token 直接派生项目暗色 token；残留 Semi override 只服务 Form / Tree。

### 4.2 共享原语

- `Button`：默认、hover、active、link、ghost、focus 统一使用项目语义 token；文本按钮和图标按钮采用稳定尺寸。
- `Input` / `Textarea` / `SelectTrigger`：8px 圆角、统一高度、可见 focus ring。
- `Card`：保持通用容器语义，不为 BookmarkCard 全局改成横向布局。
- `Dialog`：16px 圆角，遮罩约 30%–40% 黑色，不使用强背景模糊；保留 Base UI 焦点管理。
- `Tabs`：提供明确的 line、segmented 与 orientation 组合，避免业务侧重复实现状态样式。
- `Alert`：支持图标、柔和信息底色、自然换行和 12–16px 内边距。

## 5. 页面设计

### 5.1 Home 与 Sidebar

- 桌面内容区在约 1200px 宽度恢复三列书签卡；1024px 可降为两列，1440px 保持稳定密度。
- BookmarkCard 明确横向排列，高度约 68–72px，favicon 约 32–40px，标题使用 16px，URL 使用 12px。
- 卡片打开态继续使用左侧 3px 绿色指示，不增加大面积绿色背景。
- Content 顶部保持标题、搜索框、唯一主按钮；视图切换使用横向 segmented tabs。
- Sidebar 保持 260px 设计宽度、炭灰暗色体系和 3px 选中指示。
- 分类删除图标使用明确 SVG 尺寸，默认隐藏，在 hover / focus 时显示；触屏环境常显。

### 5.2 Settings

- Dialog 桌面宽度约 720px，最大高度适配视口。
- 一级导航使用左侧纵向 line tabs，宽度约 124–140px，右侧内容自适应。
- 二级“本地备份 / 云端同步 / 分享”使用横向 segmented tabs，与一级导航形成清晰层级。
- 本地备份说明恢复为带 Info 图标的信息提示块，不呈现为输入框。
- TTL 单位恢复为可见“秒”，移除裸写 Semi token 和 13px 字号。

### 5.3 Popup 与 Sidepanel

- 可见原生按钮改用 `Button` 的 ghost、link、icon 或完整宽度变体。
- 可点击列表项拆成“主操作区域 + 独立次操作按钮”，不得创建嵌套 button。
- `UnlockModal` 改用共享 Dialog，但强制重设等不可取消状态继续禁止关闭。
- 隐藏文件 input 保留原生实现，由 shadcn Button 触发。

## 6. 交互与错误边界

- Dialog、Select、Tabs 保持受控状态，业务数据流不变。
- Dialog 恢复焦点圈定、Escape 和背景 inert；不可取消流程显式禁用关闭路径。
- 伪链接、`div role=button` 和点击式 `li` 必须具备真实按钮或链接语义。
- 拖拽 Grip 在替换前验证 Base UI 与 dnd-kit listeners/ref 兼容性；若不兼容，保留语义正确的原生 button 并使用统一 token 样式。
- 删除、导入、备份、解锁等错误处理继续使用现有业务边界与 Toast，不新增异常吞噬或恢复逻辑。

## 7. 测试策略

实施前先阅读 `docs/standards/testing.md`，遵循真实渲染 shadcn/Base UI、只 mock 副作用边界的项目规则。

### 7.1 自动化测试

- 共享原语：Button/Input/Dialog/Tabs 的变体、状态和键盘行为。
- Home：BookmarkCard 横向结构、操作按钮语义、Content Tabs 与搜索清除按钮。
- Settings：纵向一级 Tabs、横向二级 Tabs、Dialog 关闭规则、TTL 单位和 Alert 内容。
- Popup/sidepanel：入口按钮、返回按钮、Pin/添加按钮的键盘交互。
- UnlockModal：可关闭与强制不可关闭两类路径。

### 7.2 浏览器验收

- Home：1024、1200、1440 宽度无横向滚动、重叠和文字截断异常。
- Settings：遮罩、弹窗尺寸、两级导航、滚动区域与关闭行为正常。
- Popup / sidepanel：紧凑尺寸下按钮不溢出，图标与文本对齐。
- 检查 hover、focus-visible、active、disabled 和 reduced-motion。

## 8. 实施顺序

1. 先修 token 冲突与共享原语映射。
2. 修 BookmarkCard 横向布局、Home 网格和 Sidebar 细节。
3. 恢复 Settings 两级导航、Dialog 遮罩和 Alert。
4. 收口 Home、popup、sidepanel 的可见原生控件与交互语义。
5. 运行全量验证并进行多视口视觉检查。

## 9. 完成标准

- `pnpm run typecheck` 通过；
- `pnpm run test` 通过；
- `pnpm run build` 通过；
- Home、Settings、popup、sidepanel 在目标视口无明显视觉突兀、重叠或横滚；
- 可见交互控件使用共享 shadcn 原语，或有明确的兼容性理由保留原生语义元素；
- Semi 仅保留在既定 Form / Tree 范围；
- 本次所有代码改动均可追溯到上述目标，不包含无关重构。
