# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/).

## [0.1.3.2] - 2026-06-14

### Added

- **工具栏 Popup「添加书签」**：在任何网页点击工具栏图标即可一键收藏当前页 —— Popup 作为「采集面」补齐 NewTab「管理面」的缺口
  - 自动抓取当前页 URL 与标题（均可编辑），选择工作区与分类（联动），可选描述
  - 重复 URL 检测：同一工作区同一分类下已存在相同 URL 时提示，可「仍然保存」（允许同一工作区不同分类重复）
  - 记忆上次工作区与分类，下次打开默认选中
  - 保存成功后短暂反馈并自动关闭 Popup（适配 Chrome Popup 失焦即关约束）

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
