# Semi Design 设计规范（DSM Token 参考手册）

> 本文档从 Semi DSM 使用教程提炼，专为 AI Agent 统一设计与编码使用。
> 来源：[Semi DSM 使用教程](https://bytedance.larkoffice.com/wiki/M9uJwBYc9i9u7ik7e5BcKzgOnSd)
> 官网：外网 https://semi.design/
> DSM 入口：https://semi.design/dsm/landing

---

## 0. 核心理念

Semi 是字节跳动出品的组件库，面向 web/B 端复杂场景。**DSM（Design System Management）** 是它的设计系统管理工具，可在 Figma 和前端代码之间保持同步。

设计系统的整体逻辑是「两层」结构：

1. **先配置全局 token**（颜色、字体、圆角、间距、阴影、动效）
2. **再在组件中引用这些 token**，实现 token 化管理、一键迭代

> 编码铁律：**组件样式一律引用全局 token，不要写死值。** 修改主题时只动 token，不动组件。

---

## 1. 颜色体系（最重要）

颜色体系分两层：**基础色阶（Palette）→ 色盘（Color Usage）**。

### 1.1 基础色阶 Palette

- 由 **品牌色（brand color）** 生成，是所有颜色最底层的来源。
- 色阶共 **0–10 号**（11 档），默认生成 **16 个色相**（amber、blue、cyan、green、grey、indigo、light-blue 等）。
- **5 号色 = 基准色**（默认等于 brand color）。
- 编号约定：
  - `5` 号 → 默认色
  - `6` 号 → hover 色
  - `7` 号 → press / active 色
  - `2` 号 → disabled 色
  - `0` 号 → light 默认色（配合品牌色做浅色背景）
  - `1` 号 → light hover 色
  - `2` 号 → light press 色

> ⚠️ 修改 brand color 会联动改变**所有颜色**（包括手动调过的）。非必要不修改。

### 1.2 色盘 Color Usage（语义化 token）

色盘引用色阶颜色，每个颜色都有功能含义。**编码时必须用语义 token，禁止直接用色号。**

#### 1.2.1 Brand color（品牌色组）

| token | 默认色相 | 生成逻辑 | 用途 |
|---|---|---|---|
| `--semi-color-primary` | blue | 5 号色 | 主按钮、Radio 等突出品牌感的主组件 |
| `--semi-color-primary-active` | blue | 7 号色 | press 态 |
| `--semi-color-primary-hover` | blue | 6 号色 | hover 态 |
| `--semi-color-primary-disabled` | blue | 2 号色 | disabled 态 |
| `--semi-color-secondary` | light-blue | 同上规则 | 次级组件，配合品牌色搭配 |
| `--semi-color-tertiary` | grey | 同上规则 | 第三级组件（button / anchor / dropdown 等） |

#### 1.2.2 Feedback color（反馈色组）

语义即体验：绿=成功、蓝=信息、橙=警告、红=危险。常用于 toast / banner / switch / spin / popconfirm。

| token | 默认色相 | 含义 |
|---|---|---|
| `--semi-color-success` (+active/hover/disabled) | green | 成功 |
| `--semi-color-info` (+active/hover/disabled) | blue | 信息 |
| `--semi-color-warning` (+active/hover) | orange | 警告 |
| `--semi-color-danger` (+active/hover) | red | 危险 |

#### 1.2.3 Light color（浅色背景组）

`0` 号为 default，`1` 号 hover，`2` 号 active。用于卡片型组件背景。

| token | 默认色相 | 用途 |
|---|---|---|
| `--semi-color-primary-light-default/active/hover` | brand | 卡片型 checkbox 背景等 |
| `--semi-color-secondary-light-default/active/hover` | light-blue | 配合 secondary 使用 |
| `--semi-color-tertiary-light-default/active/hover` | grey | 配合 tertiary 使用 |
| `--semi-color-success-light-*` | green | 反馈组件背景（banner 等） |
| `--semi-color-info-light-*` | blue | 同上 |
| `--semi-color-warning-light-*` | orange | 同上 |
| `--semi-color-danger-light-*` | red | 同上 |

#### 1.2.4 文本 / 背景 / 结构色

| token | 默认 | 用途 |
|---|---|---|
| `--semi-color-text-0` ~ `--semi-color-text-3` | 黑→浅灰 4 档 | 文本层级 |
| `--semi-color-fill-0/1/2` | grey8 + 透明度 | 交互组件填充（input/select 等） |
| `--semi-color-bg-0` ~ `--semi-color-bg-4` | white | 分层背景（通常白色，少用） |
| `--semi-color-overlay-bg` | rgba(22,22,26,0.6) | 蒙层背景（Modal 等） |
| `--semi-color-border` | 8% grey9 | 卡片边框、分割线 |
| `--semi-color-focus-border` | brand5 | 边框激活态 |
| `--semi-color-highlight` | black | 高亮文本 |
| `--semi-color-highlight-bg` | yellow4 | 高亮背景 |
| `--semi-color-disabled-bg/border` | grey1 | 禁用态背景/边框 |
| `--semi-color-disabled-fill` | 4% grey8 | 禁用态填充 |
| `--semi-color-disabled-text` | 35% grey9 | 禁用态文字 |
| `--semi-color-shadow` | 4% black | 表格滚动阴影 |
| `--semi-color-default/active/hover` | grey | 极少用（仅 tag 头像标签背景） |
| `--semi-color-black` / `--semi-color-white` | - | 黑/白 |

> 🗑 `--semi-color-data-*`（16 色）后续会删除，不要在新代码中使用。

### 1.3 颜色使用原则（给 AI Agent）

1. **语义优先**：根据"主操作/成功/警告/危险"语义选 token，而不是凭喜好选色。
2. **状态齐全**：凡有交互的组件，default / hover / active / disabled 四态都要配。
3. **浅背景配深字**：使用 `*-light-*` 做背景时，前景用对应的正常色或深色文本。
4. **brand color 慎改**：它会联动全站颜色。

---

## 2. 字体排版 Typography

Semi 默认提供 **6 档标题 + 2 档正文**。

| 字体名 | 默认值 | 应用组件 |
|---|---|---|
| Header-1 | 32px | 暂无（页面标题用） |
| Header-2 | 28px | 暂无 |
| Header-3 | 24px | 暂无 |
| Header-4 | 20px | Description |
| Header-5 | 18px | Modal、SideSheet |
| Header-6 | 16px | Notification、Popconfirm、Steps、Card |
| Regular | 14px | **大部分组件正文** |
| Small | 12px | 辅助文本 |

**关键配置项：**
- 字号倍数（基准 14px，可改 12/16 等）
- 行高倍数（默认 1.4，默认排版下不可改）
- 字体回退链（特殊字体不可用时自动降级）

> 编码建议：正文一律 14px / 辅助 12px；改字号务必同步调行高。Semi 大部分组件用的是 Regular(14px) 和 Small(12px)。

---

## 3. 圆角 Border Radius

默认 5 档，圆角基数 `n` 默认 4px，其余按倍数递增。

| token | 默认值 | 应用组件 |
|---|---|---|
| `--semi-border-radius-extra-small` | n（≈3px） | checkbox、checkbox card |
| `--semi-border-radius-small` | 2n（≈6px） | Button、input、select、datepicker、tag、upload、banner、pagination、tabs、skeleton |
| `--semi-border-radius-medium` | 6px | Dropdown、card、popover、tooltip、notification、popconfirm、toast |
| `--semi-border-radius-large` | 12px | Modal |
| `--semi-border-radius-full` | 9999px | close icon button（圆形） |

> 规则：不同类型的圆角不应相同大小；卡片/弹层用 medium，大弹窗用 large。

---

## 4. 间距 Spacing

默认 10 档，按 4 的倍数节奏。

| token | 默认值 |
|---|---|
| `--semi-spacing-none` | 0 |
| `--semi-spacing-super-tight` | 2px |
| `--semi-spacing-extra-tight` | 4px |
| `--semi-spacing-tight` | 8px |
| `--semi-spacing-base-tight` | 12px |
| `--semi-spacing-base` | 16px |
| `--semi-spacing-base-loose` | 20px |
| `--semi-spacing-loose` | 24px |
| `--semi-spacing-extra-loose` | 32px |
| `--semi-spacing-super-loose` | 40px |

> 编码建议：优先使用 8 的倍数（tight=8、base=16、loose=24）；微调用 4/12。

---

## 5. 阴影 Shadow

默认 5 档。阴影可叠加多层以增加真实感。

| token | 默认值 | 应用组件 |
|---|---|---|
| `shadow-0` | none | avatar、banner、button、checkbox、input、select、navigation、radio、rating、sidesheet、steps、table、tabs、tag、timeline、tooltip、transfer、tree |
| `shadow-1` | none | （暂无） |
| `shadow-2` | `0 2px 4px 0 rgba(0,0,0,0.14)` + `0 0 1px 0 rgba(0,0,0,0.16)` | （暂无） |
| `shadow-knob` | `0 4px 6px 0 rgba(0,0,0,0.10)` + `0 0 1px 0 rgba(0,0,0,0.30)` | Switch、Slider |
| `shadow-elevated` | `0 4px 14px 0 rgba(0,0,0,0.10)` + `0 0 1px 0 rgba(0,0,0,0.30)` | card、dropdown、modal、notification、popover、sidesheet、toast |

> 规则：浮层类组件（dropdown/popover/modal/toast）统一用 `shadow-elevated`；滑块/开关用 `shadow-knob`。

---

## 6. 动效 Animation

每个动效由 **持续时长 + 延迟 + 过渡曲线** 组成。

### 6.1 Duration / Delay 档位

两档表完全一致：

| 档位 | 时长 |
|---|---|
| None | 0ms |
| Fastest | 90ms |
| Faster | 120ms |
| Fast | 180ms |
| Normal | 600ms |
| Slow | 1000ms |
| Slower | 1200ms |
| Slowest | 1800ms |

> 现状：token 层目前只用到 `none`，个别组件（如 collapse）直接写死值，没走 token。

### 6.2 过渡曲线 Function

| 曲线 | 应用组件 |
|---|---|
| EaseIn | Tree、Tabs、Radio 背景、Steps 背景、Button 背景、Select 背景/边框、Rating、Switch 等 |
| Linear | （暂无） |
| EaseOut | Table 背景、Dropdown 背景、滚动列表背景 |
| EaseInOut | （暂无） |

> 规则：**进入/展开用 EaseOut，退出/收起用 EaseIn**；状态切换（开关/勾选）用 EaseIn。

---

## 7. 组件样式定制规则

除插画、ColorPicker 等少数组件外，**Semi 全部组件都已与 token 绑定，支持自定义**。

### 7.1 两种编辑方式

| 方式 | 说明 | 适用 |
|---|---|---|
| **GUI 属性编辑**（设计师视角） | 通过设计 token 点选编辑，hover 可看应用到的具体组件 | 快速调整、批量改（Cmd/Ctrl + 点击多选） |
| **SCSS 代码编辑**（开发视角） | 在「All tokens」找 token 名，复制后在 SCSS 写值 | 精细控制、字体/阴影等 GUI 未覆盖项 |

### 7.2 已知限制（编码时要绕开）

| 类别 | 限制 |
|---|---|
| 间距 | 无法引用 token，只能改取值 |
| 圆角 | 无法引用 token，只能改取值 |
| 字体 | 大部分组件不能改字号；字重只能在 SCSS 模式改 |
| 阴影 | 部分组件不能改阴影；阴影只能在 SCSS 模式改 |

### 7.3 默认 token 无法删改

色阶、色盘、圆角、间距、阴影、动效的**默认项都不能删除或重命名**，只有用户新增的项支持删除/重命名。

---

## 8. 发布与同步

### 8.1 发布 DSM → npm 主题包

- 点击【Publish】发布；发布后研发侧 `pnpm add` 主题包即可应用。
- npm 包名统一以 **`@semi-bot/semi-theme`** 前缀开头，**首次提交后不可修改**。
- 后续发布只需填版本号 + release note。

### 8.2 分享 DSM

- 点【Share】输入邮箱，选编辑/阅读权限。
- **必须走分享流程**：若 DSM 设为「不显示在主题市场」，单纯复制 URL 无法分享。

### 8.3 同步到 Figma

1. 在 Semi 官网下载 Figma 组件库文件并打开。
2. Figma 插件搜「Semi」→【Design to Code - 设计稿转代码】→【Design System Management】→ 登录飞书 → 选 DSM →【应用主题】。
3. 注意：插件刷完主题后仍可能有未同步项，需手动调整。

### 8.4 Icon 管理

用 [Semi Icon](https://semi.design/zh-CN/basic/icon) 统一管理，**避免直接引用 SVG**。

---

## 9. AI Agent 编码速查清单

写 Semi 组件 / 页面时，按以下顺序决策：

1. **颜色**：先定语义（primary/success/info/warning/danger/text/fill/bg/border），再用 token；交互组件配齐 4 态。
2. **字号**：正文 `Regular(14px)`，辅助 `Small(12px)`，标题按层级用 Header-4~6（20/18/16）。
3. **圆角**：按钮/输入 `small`，卡片/浮层 `medium`，弹窗 `large`，图标按钮 `full`。
4. **间距**：以 8 为基准（tight=8 / base=16 / loose=24），微调 4/12。
5. **阴影**：浮层统一 `shadow-elevated`，开关滑块 `shadow-knob`。
6. **动效**：展开 EaseOut / 收起 EaseIn / 状态切换 EaseIn；时长优先 90/120/180ms 档。
7. **铁律**：一律引用 token，禁止裸写色值/尺寸；改主题只动 token 不动组件。
