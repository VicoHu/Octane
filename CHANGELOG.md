# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/).

## [0.1.4.3] - 2026-06-23

### Added

- **NewTab 书签「已打开」状态标识与一键跳转**：BookmarkCard 左侧竖线标识当前窗口已打开的书签站点；点击已打开书签直接聚焦对应 Tab（取最近活跃），未打开则新建标签
  - 新增 `src/shared/tabs/matchUrl.ts`（URL 规范化与匹配）、`useOpenTabs` hook（监听当前窗口 tab、按最近活跃降序）、`focusTab`（聚焦指定 tab）
  - Phase 3：跳转时竖线脉冲动效，强化「即将聚焦该 Tab」的视觉反馈
  - BookmarkCard 新增上下文徽章

### Changed

- **品牌视觉升级**：Sidebar logo 改用 `icon-128.png`（替换渐变字母占位）；扩展图标资产升级为更高清版本（带圆角，icon-128 由 307B 提升至 13KB）

### Fixed

- **书签竖线在 tab 页内导航后失配**：原 host+pathname 精确匹配导致书签打开后导航到子路径（如 `vicohu.com` → `/archives/hello-halo`）时竖线消失。改为段边界前缀匹配（host 相等 + tab 路径等于书签路径或在其整段之下），导航子路径后竖线仍亮，同时消除 `/blog` 误匹配 `/blogger` 的隐患

## [0.1.4.2] - 2026-06-22

### Changed

- **NewTab 改为 pinned logo tab（放弃 `chrome_url_overrides.newtab`）**：参考 Workona，改为在 tab 栏最左常驻一个 pinned home tab 作为书签主页入口，不再劫持每个新标签页
  - 入口改名 `src/entrypoints/newtab/` → `home/`（wxt Unlisted Page，移除 `chrome_url_overrides`），Ctrl+T 恢复 Chrome 默认新标签页
  - pinned tab Chrome 原生无关闭按钮（仅 Ctrl+W 可关），favicon 显示 Octane logo
  - 新增 `src/shared/tabs/focusOrCreateHomeTab.ts`：当前窗口已有 pinned home tab 则聚焦，否则创建（sidepanel「在 Octane 管理」、popup「打开书签主页」、background 事件共用去重唤起）
  - background `onInstalled` / `onStartup` / `windows.onCreated` 保证每窗口常驻；尊重用户意图不做 `onRemoved` 强制重建
  - 与 Side Panel 互补：Side Panel 给当前页上下文，logo tab 给全局书签管理

### Fixed

- `home/index.html` 补 favicon `<link>`（pinned tab 图标显示）

### Known Issues

- popup 不可达（`openPanelOnActionClick:true` 覆盖 `default_popup`，左击只开 Side Panel）——独立 issue #13 跟进；不影响 logo tab 功能（唤起靠 pinned tab + Side Panel）

## [0.1.4.1] - 2026-06-20

### Changed

- **newtab 展示组件迁移 Semi Design**：书签卡片（`Card` + 操作 `Button`）、骨架屏（`Skeleton`）、上下文列表（`List` + `Popconfirm`）、侧边栏设置菜单（`Dropdown`）与分类列表（`List`）统一改用 Semi 组件，提升视觉一致性与无障碍
  - 书签卡片 favicon 加载失败回退首字母占位
  - 侧边栏分类 active 态用 Semi primary-light，空分类显示提示
  - Dropdown/Popconfirm 弹层锚定 sidebar 容器，防止跳出暗色区变亮
- 侧边栏视觉统一 Semi dark 主题色（`--sidebar-*` 引用 Semi token，定义在 `.semi-always-dark` 作用域——Semi 语义 token 声明在 body 而非 :root，作用域错位会致背景透明白）

### Fixed

- 主密码弹窗「解锁/设置」按钮整体右偏 12px（Semi Modal footer 默认给按钮 `margin-left:12px`，单个 block 按钮清零复位）
- 书签卡片 hover 效果不自然（去掉自定义位移，回归 Semi Card 标准阴影）

## [0.1.3.5] - 2026-06-18

### Added

- **数据可移植性（P2/P3）云存储备份**：阿里云 OSS / 腾讯云 COS 手动上传与覆盖恢复
  - 策略模式架构（`CloudStorageProvider` 接口 + OSS/COS 实现 + 注册表），便于扩展新服务商
  - 凭证经主密码 AES-GCM 加密，按 provider 分键存 `chrome.storage.local`（用前需解锁主密码）
  - 配置 UI：双 Tab（OSS/COS）+ 连通性测试 + 清除配置 + 上次备份时间
  - 上传 = 轻提示（非破坏性）；从云恢复 = 破坏性强确认（Modal + Checkbox + danger）
  - 从云恢复复用 P1 导入事务（`parseBackupFile` + `octane:apply-import` 覆盖事务）
  - 备份对象 key 固定 `octane/backup/octane-backup.json`（覆盖式单文件）
  - wxt `host_permissions` 放行 `*.aliyuncs.com` / `*.myqcloud.com`
  - 用户侧配置指南 `docs/cloud-backup-setup.md`（桶 CORS + 最小权限子账号）
  - newtab「设置」前置选项入口：设置主密码 / 数据备份和同步（内联菜单，主密码项随状态自适应：设置/解锁/锁定）

### Fixed

- 修复主密码首次设置入口缺失：`UnlockModal` 原仅在「已设密码但未解锁」时显示，导致首次使用无从设置主密码（加密笔记与云备份均不可达）。改为可手动触发，并接入 newtab/popup 两入口
- popup 接入主密码解锁流程（挂载 `UnlockModal` + `checkStatus`）

### Changed

- 导出与云上传共用 `buildBackupBlob`；上传为轻提示（反转伞形 spec Open Question #4，仅恢复需强确认）

## [0.1.3.4] - 2026-06-17

### Added

- **数据可移植性（P1）**：本地全量数据导入导出（覆盖式），支持书签/分类/工作区/上下文/加密数据完整迁移
  - 导出：5 表存储态 JSON（contexts 密文不解密）；50MB 文件阈值；schema/version/字段级/cryptoMetadata 一致性校验
  - 导入：background service worker 执行覆盖式单事务（4 表 clear+put，cryptoMetadata 条件 put）→ 重算冗余字段 → lock session → 广播
  - 加密数据密文迁移：导出 salt + 密文，导入方用相同主密码即可解密，文件不含密钥/明文
  - UI：newtab Sidebar「设置」入口（SideSheet）显示本地备份区；破坏性导入三重确认（Modal + Checkbox + danger 按钮）
  - newtab 订阅 `octane-import` 广播事件，导入后整体 reload

### Fixed

- 修复 v0.1.3.3 `openPanelOnActionClick` 后 popup 失去左击入口：newtab Sidebar 新增设置入口（SideSheet）补备份可达性
- 修复导入覆盖确认 Modal 按钮紧贴下沿（确认按钮移至 footer prop）
- 修复 MV3 service worker 唤醒时序致导入 `sendMessage` "Receiving end does not exist"（onMessage listener 顶层注册）
- 修复 newtab 自备份自恢复时书签列表陈旧（import 后兜底 loadBookmarks）
- 修复 `applyImport` 中 syncContextMeta 失败致 session 半死态（非致命 + lock 必执行）

## [0.1.3.3] - 2026-06-16

### Added

- **Side Panel（chrome.sidePanel）**：在任意 http(s) 页面左击扩展图标直达侧边栏，按当前页 hostname 联动展示匹配书签及其上下文
  - 四状态编排：加载中 / 页面不支持联动（非 http）/ 无匹配书签 / 匹配列表（按书签分组）
  - `useHostBookmarks` 全局 hostname 严格匹配（跨所有 workspace，www.google.com ≠ google.com）
  - `useCurrentTabContext` 监听活动标签 + 导航完成，快速切标签时丢弃过期结果
  - 加密上下文按解锁状态 gate 解密渲染（错误密码不泄露明文）
  - **BroadcastChannel 跨上下文同步**：在 NewTab 改动书签或上下文后，Side Panel 自动刷新匹配结果（数据库写入单一收口广播）
  - ContextCard 支持 Markdown 预览（marked + DOMPurify 净化）
- Background service worker：`setPanelBehavior({ openPanelOnActionClick: true })`，左击图标直达 Side Panel（不再先开 Popup）

### Fixed

- 修复 Side Panel 在 `BroadcastChannel` 不可用的环境下崩溃的问题（监听加 null 守卫）

### Changed

- 本版本专注 Chrome，暂不做 Firefox `sidebar_action` 适配

## [0.1.3.2] - 2026-06-14

### Added

- **工具栏 Popup「添加书签」**：在任何网页点击工具栏图标即可一键收藏当前页 —— Popup 作为「采集面」补齐 NewTab「管理面」的缺口
  - 自动抓取当前页 URL 与标题（均可编辑），选择工作区与分类（联动），可选描述
  - 重复 URL 检测：同一工作区同一分类下已存在相同 URL 时提示，可「仍然保存」（允许同一工作区不同分类重复）
  - 记忆上次工作区与分类，下次打开默认选中
  - 保存成功后短暂反馈并自动关闭 Popup（适配 Chrome Popup 失焦即关约束）

### Changed

- **Popup 重构为 Hub 架构**：从「打开即书签表单」改为「首页 Hub + 子页面」，为后续多功能扩展（笔记/搜索/工作区）打基础
  - 首页：用户卡（头像 + 名称/邮箱 + 右上角账户下拉）+ 功能列表，主操作「保存当前页面」在首行视觉强调（indigo 左边框 + 浅底）
  - 子页面：保存书签（原表单逻辑迁入，行为不变）、设置（占位，等账户/偏好系统接入）
  - 子页面通用返回头（SubPageHeader），轻量视图路由（useState，不引入 router）
  - guest 态预留：useUser 占位 hook 返回 null，UI 降级为品牌名 + 登录引导，未来接入鉴权只改 hook

## [0.1.3.1] - 2026-06-12

### Changed

- **笔记系统重构为 1:N 上下文模型**：一个书签可拥有多个上下文条目（Note → Context），支持独立标题、类型标记
- `NoteService` → `ContextService`：新建 CRUD + `syncContextMeta` 冗余字段同步
- IndexedDB schema 升级 v1→v2：`notes` store → `contexts` store（新主键 `id` + `by-bookmarkId` 索引），级联删除适配 1:N
- `Bookmark` 冗余字段 `hasNote`/`isNoteEncrypted` → `contextCount`/`hasEncryptedContext`
- 新增 `ContextList` 组件（列表视图 + 编辑视图切换、loading/error/empty 状态、Popconfirm 删除确认）
- 新增 `ContextEditor` 组件（标题编辑、加密切换、自动保存 debounce）
- `BookmarkCard` 预览逻辑改为 `contextPreview`，`useBookmarks` 批量加载上下文预览
- 添加/编辑书签 Modal 改用 Semi 内置 footer，按钮间距与新建工作区一致

### Removed

- 删除 `NoteService.ts`、`NoteEditor` 组件

## [0.1.3.0] - 2026-06-12

### Changed

- 书签卡片点击行为变更：点击卡片主体现在在新标签页打开书签 URL（原行为为打开笔记编辑器）
- 卡片右侧新增操作按钮区：左侧按钮打开笔记编辑器，右侧按钮打开书签信息编辑弹窗
- 书签信息编辑弹窗支持修改 URL、名称、描述

## [0.1.2.0] - 2026-06-11

### Changed

- Sidebar 升级为暗色主题（Semi Design `semi-always-dark`），品牌标识使用渐变 Logo + 品牌色
- 6 个组件的 40+ 处 inline style 迁移到 CSS modules，提升样式可维护性
- 建立全局设计 Token 体系（slate 色板、indigo 品牌色、统一圆角/阴影/过渡动画）
- BookmarkCard 的 favicon fallback 改为品牌色渐变背景 + 白色首字母
- 卡片网格改为响应式布局，适配不同屏幕宽度
- Sidebar 分类项的删除图标改为 hover 才显示，减少视觉噪音
- skeleton 加载动画添加 `prefers-reduced-motion` 无障碍保护

### Fixed

- NoteEditor SideSheet 首次点击书签不弹出（改为始终挂载）

### Added

- 添加 ui-ux-pro-max skill 用于 AI 辅助 UI 设计决策
- 添加 CodeGraph MCP 配置用于代码图谱索引

## [0.1.1] - 2026-06-11

### Changed

- 迁移构建框架从原生 Vite + Chrome Extension MV3 到 WXT，一键支持 Chrome / Firefox / Edge 多浏览器开发
- 入口文件移至 WXT 标准目录 `src/entrypoints/newtab/`，业务代码（services/store/components）保持不变
- vitest 配置切换到 `WxtVitest()` 插件，自动处理路径别名和浏览器 API polyfill
- tsconfig.json 继承 `.wxt/tsconfig.json`，由 WXT 管理 TypeScript 编译配置

### Removed

- 移除 `vite.config.ts`（构建配置由 `wxt.config.ts` 接管）
- 移除 `public/manifest.json`（manifest 由 WXT 从 `wxt.config.ts` 生成）
- 移除根目录 `index.html`（入口移至 `src/entrypoints/newtab/index.html`）
- 移除 `src/vite-env.d.ts`（类型声明由 WXT 自动生成）

## [0.1.0] - 2026-06-11

### Added

**项目初始化**
- 初始化项目骨架（Vite + React 19 + TypeScript 6 + Chrome Extension MV3）
- 添加 Prettier、.gitignore、MCP 配置

**基础设施层（P1）**
- 添加数据模型类型定义（Workspace, Category, Bookmark, Note, CryptoMetadata）
- 实现 IndexedDB 封装层：连接管理（单例模式）、5 张表、索引、级联删除（Workspace→Category→Bookmark→Note）、配额监控
- 实现 CryptoService：PBKDF2 密钥派生（600K 迭代）、AES-GCM-256 加密/解密、chrome.storage.session 会话密钥管理、主密码设置/解锁/修改

**Service 层**
- WorkspaceService：工作区 CRUD + 级联删除
- CategoryService：分类 CRUD + 级联删除
- BookmarkService：书签 CRUD + Google Favicon API
- NoteService：笔记 CRUD，自动处理加密/解密，对业务层只暴露明文接口
- Markdown 渲染工具：marked + DOMPurify 安全过滤

**Store 层（Zustand）**
- useWorkspace：工作区/分类状态管理
- useBookmarks：书签列表、CRUD、Favicon 自动补充
- useCrypto：加密状态（是否设置密码、是否解锁）
- useSearch：搜索查询状态

**UI 层（Semi Design）**
- Sidebar：工作区选择器 + 分类列表 + 创建/删除操作
- Content：搜索栏 + 三列卡片网格 + 添加书签弹窗 + 空状态
- BookmarkCard：Favicon + 名称 + URL + 描述 + 加密锁图标
- NoteEditor：侧滑面板、Markdown 编辑/预览切换、加密开关、自动保存
- UnlockModal：主密码设置/解锁弹窗
- EmptyState：统一空状态组件

**测试**
- IndexedDB CRUD + 级联删除测试（fake-indexeddb）
- CryptoService 加密/解密往返测试
- Service 层集成测试
- Markdown 渲染工具测试

**其他**
- 添加扩展图标资源（16/48/128px + SVG）
- vite.config.ts 配置 `base: './'` 相对路径
- 添加开发文档（P1 基础设施计划、P2 UI 组件计划）
