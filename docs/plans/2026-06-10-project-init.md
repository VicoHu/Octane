# Octane — Chrome NewTab 书签 + 笔记管理插件

<!-- /autoplan restore point: /Users/vicohu/.gstack/projects/octane/master-autoplan-restore-20260610-182252.md -->

## 概述

Octane 是一个 Chrome NewTab 页面插件，核心价值是为每个书签提供可加密的笔记空间。书签是入口，笔记是价值。

定位：**书签 + 笔记 + 安全** — 不是另一个 Raindrop.io，而是浏览器里最方便的"带笔记的书签夹"。

## 技术决策

- **框架：** React + TypeScript + Vite + Semi Design
- **存储：** IndexedDB（主数据） + chrome.storage.local（仅设置项）
- **加密：** Web Crypto API，AES-GCM-256 加密笔记字段，主密码通过 PBKDF2（600K 迭代）派生密钥，每个用户唯一 salt（16 字节随机）
- **加密 UX：** 主密码输入一次，密钥缓存到 `chrome.storage.session`（MV3 会话存储，浏览器关闭自动清除）。NewTab 页面加载时检查 session storage 中是否有密钥，有则自动解密，无则弹解锁框
- **Chrome Extension：** Manifest V3，override newtab，CSP: `script-src 'self'; object-src 'none'`
- **Markdown 渲染：** `marked` v4+ + DOMPurify（防 XSS），需验证 MV3 CSP 兼容性
- **密钥管理架构：** CryptoService 独立层，对业务层只暴露明文接口，加密/IV/salt 是存储层实现细节

### 为什么选择 IndexedDB 而非 Chrome Storage？
Chrome Storage API 限制：`chrome.storage.local` 上限 10MB，`chrome.storage.sync` 上限 100KB。
多工作区 + 加密笔记 + 书签数据会很快触碰天花板。IndexedDB 配额更大（通常可用磁盘空间的 50-60%）。
需在 db 封装层监控配额（`navigator.storage.estimate()`），不足时提前警告用户。

### MV3 下密钥生命周期的完整设计
```
用户打开 NewTab
  → 检查 chrome.storage.session 中是否有派生密钥
    → 有：直接使用，无需输入密码
    → 无：弹出解锁框
      → 用户输入主密码
      → PBKDF2(password, salt, 600000) → 派生 AES-GCM 密钥
      → 密钥存入 chrome.storage.session
      → 页面可用

用户关闭浏览器
  → chrome.storage.session 自动清除
  → 下次启动需重新输入主密码

用户修改主密码
  → 重新加密所有已加密笔记
  → 更新 chrome.storage.session 中的密钥
```

### 为什么自建书签数据而非用 chrome.bookmarks API？
需要自定义字段（笔记、加密标记、工作区归属、富文本描述），与浏览器原生书签模型不兼容。

## 主页面布局描述

页面是一个经典的左右分栏布局，左侧是一个固定宽度的侧边栏，右侧是自适应的主内容区，两者撑满整个视口高度。

### 侧边栏（左侧固定宽度，约 260px）
从上到下依次是：
1. **标题栏** — Octane Logo + 收起按钮
2. **工作区下拉选择器** — 切换不同工作区（如：工作、个人、项目 A）
3. **分类书签列表** — 每项是图标 + 名称 + 右侧数字计数，当前选中项有高亮背景
4. **添加分类按钮** — 贴底

### 主内容区（右侧自适应）
纵向分为两部分：
1. **顶部横向操作栏**
   - 左侧：当前分类的大标题
   - 中间：搜索输入框
   - 右侧：视图切换、导出、导入三个图标按钮 + 视觉权重最高的添加书签按钮
2. **下方卡片网格** — 三列等分
   - 每张卡片横向排列：左侧网站 Logo，右侧纵向堆叠书签名称、URL 和描述三层文字
   - 点击卡片展开笔记查看/编辑（Modal 或侧滑面板）
   - 卡片上有加密标识（如笔记已加密则显示锁图标）

### 笔记编辑体验（核心差异化 — 与书签网格同等重要）
- **编辑入口：** 点击书签卡片 → 展开笔记面板（右侧滑出或 Modal）
- **笔记格式：** Markdown，支持预览模式
- **加密笔记：** 标记为敏感的笔记自动 AES-GCM 加密存储
- **首次使用：** 需要设置主密码，用于加密/解密敏感笔记
- **会话解锁：** 每个浏览器会话只需输入一次主密码，后续自动解密
- **未加密笔记：** 普通流程记录/备注不需要加密，直接存储
- **搜索：** 支持搜索未加密笔记内容（加密笔记无法全文搜索，但可搜索标题/标签）
- **自动保存：** 笔记编辑 debounce 1s 后自动保存，显示"已保存"微反馈

### 笔记预览可见（设计原则：笔记是价值，不是附件）
- 书签卡片上默认显示笔记前 2 行预览（12px 常规字重，muted 颜色）
- 加密笔记预览显示为 `••••••••` + 锁图标
- 无笔记时卡片不显示笔记区域（避免空行）
- 用户打开新标签页第一眼就能看到笔记内容

### 首次使用引导
```
步骤 1: 欢迎 → "Octane 让你的每个书签都带着笔记"
步骤 2: 创建第一个工作区（默认建议：工作 / 个人）
步骤 3: 创建第一个分类（默认建议：常用工具）
步骤 4: 添加第一个书签（提供 URL 输入框）
步骤 5: 可选：设置主密码（解释加密用途）
步骤 6: 完成 → 展示主界面
```

### 交互状态矩阵
| 功能 | 加载中 | 空状态 | 正常 | 错误 | 部分 |
|---|---|---|---|---|---|
| 书签列表 | 骨架屏(3行) | "添加你的第一个书签"引导 | 卡片网格 | toast 错误 | 已加载部分 |
| 笔记编辑 | — | "点击开始记录"placeholder | Markdown 编辑器 | 保存失败 toast | — |
| 加密笔记 | 解密中 spinner | — | 明文内容 | "密码错误或数据损坏" | — |
| 搜索 | — | — | 结果列表 | — | "未搜索加密笔记"提示 |
| 导入 | 进度条 | — | 成功 toast | 格式错误 toast | 部分失败提示 |
| 工作区切换 | 加载中 spinner | — | 分类列表 | — | — |
| Favicon | 通用图标 | 通用图标 | 实际 Logo | 通用图标 | — |

### 响应式策略
| 断点 | 宽度 | 侧边栏 | 网格列数 |
|---|---|---|---|
| 窄屏 | <768px | 收起（汉堡菜单触发） | 1 |
| 标准 | 768-1200px | 240px | 2 |
| 宽屏 | 1200-1920px | 260px | 3 |
| 超宽 | >1920px | 260px，主内容区最大 1400px 居中 | 3-4 |

### 无障碍基础
- 键盘导航：Tab 遍历卡片，Enter 打开，Escape 关闭弹窗
- ARIA：卡片 role="listitem"，加密状态 aria-label="包含加密笔记"
- 对比度：所有文本满足 WCAG AA (4.5:1)
- 焦点管理：弹窗打开后焦点移入弹窗，关闭后焦点回触发元素

## 核心功能
1. **书签管理** — CRUD 操作，支持分类、搜索、Logo 自动抓取（Google Favicon API）
2. **笔记系统** — 每个书签可附加 Markdown 笔记，支持加密标记
3. **加密系统** — 主密码 + AES-GCM，会话级解锁，Web Crypto API
4. **工作区** — 多工作区支持，隔离不同场景的书签集合
5. **分类系统** — 书签按分类组织，分类可增删改、拖拽排序
6. **视图切换** — 网格视图 / 列表视图
7. **导入/导出** — JSON 格式导出完整数据（含加密笔记需主密码解密）
8. **搜索** — 全文搜索书签名称、URL、描述、未加密笔记

## 数据模型

```
Workspace
  ├── id: string (uuid)
  ├── name: string
  ├── icon: string (emoji or icon name)
  ├── createdAt: number (timestamp)
  └── order: number

Category
  ├── id: string (uuid)
  ├── workspaceId: string (FK → Workspace)
  ├── name: string
  ├── icon: string
  ├── order: number
  └── createdAt: number

Bookmark
  ├── id: string (uuid)
  ├── workspaceId: string (FK → Workspace)  # 冗余字段，保证数据完整性
  ├── categoryId: string (FK → Category)
  ├── name: string
  ├── url: string
  ├── description: string
  ├── faviconUrl: string
  ├── hasNote: boolean                        # 快速判断是否有笔记
  ├── isNoteEncrypted: boolean                # 快速判断笔记是否加密（卡片显示锁图标）
  ├── createdAt: number
  └── updatedAt: number                       # 乐观锁字段，防止并发覆盖

// 笔记存储 — 业务层通过 NoteService 访问，始终拿到明文
// 加密细节（encryptedData, iv, salt）对业务层不可见
Note (内部存储模型)
  ├── bookmarkId: string (PK, FK → Bookmark)
  ├── content: string (运行时明文，不持久化)
  ├── isEncrypted: boolean
  ├── encryptedData?: string (base64, AES-GCM-256 ciphertext)
  ├── iv?: string (每次加密随机生成)
  └── updatedAt: number

CryptoMetadata (全局，仅一条记录)
  ├── salt: string (base64, 16 字节随机盐)
  ├── iterations: number (600000)
  ├── algorithm: string ("AES-GCM-256")
  └── createdAt: number

// 级联删除策略：
// 删除 Workspace → 级联删除其下所有 Category + Bookmark + Note
// 删除 Category → 级联删除其下所有 Bookmark + Note
// 删除 Bookmark → 级联删除对应 Note
```

## 项目结构（规划）

```
octane/
├── public/
│   └── manifest.json          # Manifest V3 配置
├── src/
│   ├── newtab/                # 新标签页（主页面）
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Sidebar/       # 侧边栏（工作区 + 分类列表）
│   │   │   ├── Content/       # 主内容区（搜索栏 + 卡片网格）
│   │   │   ├── BookmarkCard/  # 书签卡片
│   │   │   ├── NoteEditor/    # 笔记编辑器（Markdown + 预览）
│   │   │   ├── UnlockModal/   # 主密码输入弹窗
│   │   │   ├── EmptyStates/   # 各种空状态组件
│   │   │   └── Modals/        # 各种弹窗（添加书签、添加分类、导入导出等）
│   │   └── index.tsx
│   ├── services/              # 业务服务层（对 UI 层暴露明文接口）
│   │   ├── NoteService.ts     # 笔记 CRUD（内部处理加密/解密）
│   │   ├── BookmarkService.ts # 书签 CRUD + 级联删除
│   │   ├── CategoryService.ts # 分类 CRUD
│   │   ├── WorkspaceService.ts# 工作区 CRUD
│   │   ├── CryptoService.ts   # 加密/解密/密钥派生/主密码管理
│   │   ├── ExportService.ts   # 导出（加密笔记默认保持加密，明文导出需二次确认）
│   │   └── ImportService.ts   # 导入（版本校验 + URL sanitization）
│   ├── shared/
│   │   ├── db/                # IndexedDB 封装层
│   │   │   ├── database.ts    # 连接管理 + 版本迁移（onupgradeneeded）
│   │   │   ├── migrations/    # 按版本号的迁移脚本
│   │   │   └── quota.ts       # 配额监控（navigator.storage.estimate）
│   │   ├── hooks/             # 自定义 hooks
│   │   ├── types/             # TypeScript 类型定义
│   │   └── utils/             # 工具函数（Markdown 渲染 + DOMPurify）
│   ├── store/                 # Zustand 状态管理
│   │   ├── useWorkspace.ts
│   │   ├── useBookmarks.ts
│   │   ├── useCrypto.ts       # 加密状态（是否解锁、密钥等）
│   │   └── useSearch.ts
│   └── styles/                # 全局样式
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## NOT in scope（推迟到后续版本）
- 云同步 / 跨设备同步
- 浏览器原生书签集成
- 团队协作 / 分享
- Firefox / Edge 适配
- 浏览器标签页管理（只做书签）
- 图片/附件上传到笔记
- 快捷键支持
- 拖拽排序（V1.1）
- 浏览器标签页快速收藏
- 暗色模式（V1.1）
- 标签/Tag 系统

## 安全设计

### Markdown XSS 防护
- Markdown 渲染使用 `marked` v4+ 配合 DOMPurify sanitization
- manifest.json CSP: `script-src 'self'; object-src 'none'; style-src 'self' 'unsafe-inline'`
- 笔记中的链接点击通过 `chrome.tabs.create` 打开，不直接导航
- 需验证 `marked` + DOMPurify 在 MV3 CSP 下的兼容性（优先打包测试）

### 加密安全
- PBKDF2 迭代次数 600,000（OWASP 2023 推荐最低值）
- 每用户唯一 salt（16 字节随机），明文存储在 IndexedDB（标准做法）
- AES-GCM-256 每次加密生成新 IV（12 字节随机）
- 主密码设置时强制最低 12 字符 + 强度校验

### 导出安全
- 加密笔记默认保持加密导出
- 选择"导出明文"时弹二次确认弹窗，明确警告风险
- 导出文件包含版本号，便于未来导入兼容

### IndexedDB 隔离
- 所有数据操作在 extension context（newtab page）中完成
- 不使用 content script 访问 IndexedDB
- MV3 下每个扩展有独立 origin，其他扩展无法访问

## 错误处理策略

### 加密操作
- 所有加密/解密操作 try-catch
- 写入模式：write-then-verify-then-delete（先写加密数据，验证可解密，再删旧数据）
- 加密失败时保留原始数据，向用户显示错误信息

### IndexedDB
- 配额监控：`navigator.storage.estimate()` 定期检查
- 写入前检查剩余空间
- QuotaExceededError → 提示用户清理数据
- 版本迁移：`onupgradeneeded` 中按 version 区间执行迁移脚本

### 并发控制
- 使用 `updatedAt` 乐观锁：写入前检查 updatedAt 是否变化
- 冲突时提示用户选择版本

### 空状态设计
- 新用户首次使用 → 引导创建第一个工作区和分类
- 无书签分类 → 显示"添加你的第一个书签"引导
- 搜索无结果 → 显示搜索建议
- Favicon 加载失败 → 显示通用图标 fallback

## AUTONOMOUS DECISION LOG
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|-----------|-----------|----------|----------|
| 1 | CEO-0A | 加密是 MVP 必须 | Premise | P1(完整性) | 笔记含密码，安全是底线 | 不加密 |
| 2 | CEO-0A | 工作区是 MVP 核心 | Premise | 用户判断 | 用户明确需要多场景隔离 | 推迟工作区 |
| 3 | CEO-0A | React + TS + Semi Design | Premise | 用户判断 | 用户选定技术栈 | 原生/Vue |
| 4 | CEO-0C-bis | 方案 B（分层架构） | Mechanical | P1+P5 | 安全+可扩展，非过度设计 | 最小可行/全功能 |
| 5 | CEO-0D | SELECTIVE EXPANSION 模式 | Mechanical | P6 | 新项目+用户需求明确 | EXPANSION/REDUCTION |
| 6 | CEO-0E | 笔记格式用 Markdown | Mechanical | P1 | 流程业务需要格式化 | 纯文本 |
| 7 | CEO-0E | Logo 用 Google Favicon API | Mechanical | P5+P3 | 最简单可靠 | 截图方案 |
| 8 | CEO-Step0.5 | 存储用 IndexedDB | Mechanical | P1 | Chrome Storage 10MB 不够 | Chrome Storage |
| 9 | CEO-Step0.5 | 加密 UX: 会话级解锁 | Taste | P1+P5 | 每次输密码不可行 | 每次输入 |
| 10 | CEO-Step0.5 | 自建书签数据 | Mechanical | P3 | 自定义字段与原生不兼容 | chrome.bookmarks |
| 11 | CEO-S1 | CryptoService 独立层 | Mechanical | P1+P5 | 加密逻辑与业务解耦 | 散落各组件 |
| 12 | CEO-S1 | 密钥存 chrome.storage.session | Taste | P1 | MV3 SW 非常驻，需要持久会话存储 | 纯内存缓存 |
| 13 | CEO-S2 | Bookmark 加 workspaceId | Mechanical | P1 | 冗余字段保证数据完整性 | 隐式 join |
| 14 | CEO-S2 | DOMPurify 防 XSS | Mechanical | P1 | Markdown 渲染必须 sanitization | 不处理 |
| 15 | CEO-S2 | PBKDF2 600K 迭代 + 唯一 salt | Mechanical | P1 | OWASP 标准最低安全要求 | 低迭代 |
| 16 | CEO-S2 | 导出加密笔记默认保持加密 | Taste | P1 | 防止明文泄露到文件系统 | 自动解密 |
| 17 | CEO-S2 | 级联删除策略 | Mechanical | P1 | 防止孤儿数据 | 无策略 |
| 18 | CEO-S2 | 乐观锁防并发 | Mechanical | P3 | 多标签页编辑冲突 | 无防护 |
| 19 | CEO-S2 | 空状态设计 | Mechanical | P1 | 用户体验完整性 | 无设计 |
| 20 | CEO-S5 | marked + DOMPurify | Mechanical | P5+P1 | 成熟方案+安全渲染 | 其他库 |
| 21 | CEO-S5 | Zustand 状态管理 | Mechanical | P5 | 轻量、TypeScript 友好 | Context |
| 22 | CEO-S10 | 扩展候选推迟(暗色/拖拽/Tag等) | Mechanical | P3 | V1 先做核心功能 | 全部加入 |

## 系统架构图

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Browser                        │
│  ┌───────────────────────────────────────────────────┐  │
│  │              NewTab Page (React SPA)               │  │
│  │  ┌──────────┐  ┌──────────┐  ┌─────────────────┐ │  │
│  │  │ Sidebar  │  │ Content  │  │  NoteEditor     │ │  │
│  │  │(工作区   │  │(搜索栏   │  │ (Markdown编辑   │ │  │
│  │  │ +分类)   │  │ +卡片)   │  │  +预览+加密)    │ │  │
│  │  └────┬─────┘  └────┬─────┘  └───────┬─────────┘ │  │
│  │       │             │                │            │  │
│  │  ┌────┴─────────────┴────────────────┴─────────┐ │  │
│  │  │              Zustand Store                    │ │  │
│  │  │  useWorkspace | useBookmarks | useCrypto      │ │  │
│  │  └────────────────────┬─────────────────────────┘ │  │
│  │                       │                            │  │
│  │  ┌────────────────────┴─────────────────────────┐ │  │
│  │  │           Services Layer                      │ │  │
│  │  │  WorkspaceSvc | CategorySvc | BookmarkSvc     │ │  │
│  │  │  NoteSvc ─────────→ CryptoService             │ │  │
│  │  │  ExportSvc | ImportSvc                        │ │  │
│  │  └────────────────────┬─────────────────────────┘ │  │
│  │                       │                            │  │
│  │  ┌────────────────────┴─────────────────────────┐ │  │
│  │  │           Shared Infrastructure               │ │  │
│  │  │  DB Layer (IndexedDB) | Markdown (marked+DOMPurify) │ │  │
│  │  └────────────────────┬─────────────────────────┘ │  │
│  └───────────────────────┼───────────────────────────┘  │
│                          │                               │
│  ┌───────────────────────┴───────────────────────────┐  │
│  │           Chrome Extension APIs                    │  │
│  │  chrome.storage.session (密钥缓存)                 │  │
│  │  chrome.storage.local (设置项)                     │  │
│  │  chrome.tabs (链接打开)                            │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## 数据流图

### 书签创建流程
```
用户点击"添加书签"
  → 填写 URL/名称/描述
  → BookmarkService.create(data)
    → DB: 写入 Bookmark 记录（含 workspaceId, categoryId）
    → 异步: 抓取 Favicon URL → 更新 Bookmark.faviconUrl
    → 确认 workspaceId === category.workspaceId（完整性校验）
  → UI: 更新卡片网格

  Shadow paths:
    nil:   URL 为空 → 表单校验拦截
    empty: 名称空 → 使用 URL 域名作为默认名称
    error: IndexedDB 写入失败 → toast 提示"保存失败，请重试"
```

### 笔记加密流程
```
用户编辑笔记 → 标记为"敏感"
  → NoteService.save(bookmarkId, content, sensitive=true)
    → sensitive=true?
      → CryptoService.encrypt(content)
        → 检查 chrome.storage.session 是否有密钥
          → 无密钥: 弹 UnlockModal → PBKDF2(password, salt, 600K) → 密钥
        → crypto.subtle.encrypt(AES-GCM-256, key, iv, content)
        → 写入加密数据到 IndexedDB (write-then-verify)
        → 验证解密成功后确认
      → 更新 Bookmark.isNoteEncrypted = true
    → sensitive=false?
      → 直接明文写入 IndexedDB
      → 更新 Bookmark.isNoteEncrypted = false
  → UI: 卡片显示/隐藏锁图标

  Shadow paths:
    nil:   content 为空 → 删除笔记记录
    empty: content 为空字符串 → 正常存储
    error: 加密失败 → 保留旧数据 + toast 错误信息
    quota: IndexedDB 满额 → QuotaExceededError → 提示清理
```

### 加密笔记读取流程
```
用户点击加密书签卡片
  → NoteService.get(bookmarkId)
    → Bookmark.isNoteEncrypted === true?
      → CryptoService.decrypt(encryptedData, iv)
        → 从 chrome.storage.session 获取密钥
          → 无密钥 → 弹 UnlockModal
        → crypto.subtle.decrypt(AES-GCM-256, key, iv, data)
        → 返回明文
      → 返回明文给 UI
    → isNoteEncrypted === false?
      → 直接从 IndexedDB 读取明文
  → UI: NoteEditor 渲染 Markdown (marked + DOMPurify)

  Shadow paths:
    error: 解密失败（密钥错误/数据损坏）→ 提示"密码错误或数据损坏"
    tampered: GCM 认证标签校验失败 → 提示"数据可能被篡改"
```

## 加密状态机

```
                    ┌─────────┐
                    │  首次   │
                    │  使用   │
                    └────┬────┘
                         │ 设置主密码
                         ▼
                    ┌─────────┐
          ┌────────│  已锁定  │◄───────┐
          │        └────┬────┘         │
          │             │ 输入密码      │
          │             ▼              │
          │        ┌─────────┐         │
          │        │  解锁中  │         │
          │        └────┬────┘         │
          │             │ PBKDF2 派生   │
          │             ▼              │
          │        ┌─────────┐  浏览器  │
          │        │  已解锁  │──关闭───┘
          │        └────┬────┘
          │             │
          │    ┌────────┴────────┐
          │    ▼                 ▼
          │  加密笔记          读取笔记
          │  (AES-GCM)        (解密+渲染)
          │    │                 │
          │    ▼                 ▼
          │  ┌──────┐        ┌──────┐
          └─│ 加密  │        │ 明文  │
  修改密码 │  失败  │        │ 渲染  │
  (重加密  └──────┘        └──────┘
   所有笔记)
```

## Error & Rescue Registry

| METHOD/CODEPATH | WHAT CAN GO WRONG | EXCEPTION | RESCUED? | RESCUE ACTION | USER SEES |
|---|---|---|---|---|---|
| CryptoService.encrypt() | 密钥不在 session storage | KeyNotAvailableError | Y | 弹 UnlockModal | 主密码输入框 |
| CryptoService.encrypt() | Web Crypto API 失败 | OperationError | Y | 保留旧数据 + toast | "加密失败，请重试" |
| CryptoService.decrypt() | 密钥错误 | DecryptionError | Y | toast | "密码错误或数据损坏" |
| CryptoService.decrypt() | GCM 认证失败（数据被篡改） | DataError | Y | toast + log | "数据可能被篡改" |
| CryptoService.changePassword() | 重加密某条笔记失败 | OperationError | Y | 跳过 + 记录失败列表 | "N 条笔记重新加密失败" |
| DB.put() | 存储配额不足 | QuotaExceededError | Y | 提示清理 | "存储空间不足，请清理数据" |
| DB.put() | 版本冲突（乐观锁） | VersionConflictError | Y | 提示选择版本 | "数据已被修改，是否覆盖？" |
| DB.open() | 数据库版本升级 | VersionChangeEvent | Y | 执行迁移脚本 | 静默（首次） |
| ImportService.import() | JSON 格式错误 | SyntaxError | Y | toast | "导入文件格式错误" |
| ImportService.import() | 版本不兼容 | VersionMismatchError | Y | toast | "不支持的导入版本" |
| ImportService.import() | URL 含 javascript: 协议 | — | Y | sanitization | 自动过滤 |
| FaviconService.fetch() | 网络不可用 | TypeError | Y | 使用默认图标 | 通用图标 fallback |
| marked.parse() | Markdown 解析异常 | — | Y | 显示原始文本 | 原始 Markdown 文本 |

## Failure Modes Registry

| CODEPATH | FAILURE MODE | RESCUED? | TEST? | USER SEES | LOGGED? |
|---|---|---|---|---|---|
| 加密笔记写入 | 加密后写入失败，旧数据已删 | Y (write-then-verify) | 必测 | toast + 保留旧数据 | console.error |
| 加密笔记读取 | 解密失败 | Y | 必测 | "密码错误或数据损坏" | console.error |
| 工作区删除 | 级联删除大量数据时中途失败 | Y (事务) | 必测 | toast + 回滚 | console.error |
| IndexedDB 版本升级 | 迁移脚本出错 | Y | 必测 | 降级提示 | console.error |
| 导入数据 | 重复 ID 冲突 | Y | 应测 | 跳过或覆盖（用户选择） | console.warn |
| 并发编辑 | 乐观锁冲突 | Y | 应测 | 选择版本提示 | console.warn |
| 配额耗尽 | 写入失败 | Y | 应测 | 清理提示 | console.warn |
| Favicon 加载 | 网络超时 | Y | 应测 | 默认图标 | 静默 |

**CRITICAL GAPS: 0** — 所有已知失败路径均已设计救援方案。

## What already exists

本项目是全新空仓库。无现有代码可复用。

可复用的外部资源：
- **Chrome Extension React + Vite Boilerplate**: https://github.com/Jonghakseo/chrome-extension-boilerplate-react-vite
- **Semi Design React**: 字节跳动 UI 组件库
- **marked + DOMPurify**: Markdown 渲染 + XSS 防护
- **Zustand**: 轻量 React 状态管理
- **Web Crypto API**: 浏览器原生加密 API
- **idb**: IndexedDB Promise 封装库（推荐使用）

## Dream State Delta

```
CURRENT STATE              THIS PLAN                 12-MONTH IDEAL
─────────────              ──────────                 ──────────────
空仓库           --->      Chrome NewTab 插件  --->   全平台书签+笔记中心
                          React + Semi Design        Chrome/Firefox/Safari
                          IndexedDB + AES-GCM        端到端加密云同步
                          多工作区 + 分类             团队协作
                          Markdown 笔记              富媒体附件
                                                     AI 智能标签
```

本计划完成后：核心体验可用（书签+笔记+加密+多工作区），为云同步和跨平台预留了架构空间。

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | ISSUES_OPEN (via /autoplan) | 8 proposals, 3 accepted, 5 deferred |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | ISSUES_OPEN (via /autoplan) | score: 2.6/10 → 6.5/10, 6 decisions |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES_OPEN (via /autoplan) | 16 issues, 0 critical gaps remaining |
| DX Review | `/plan-devex-review` | Developer experience | 0 | SKIPPED | no developer-facing scope |
| Outside Voice | Claude subagent | Independent 2nd opinion | 3 | ISSUES_OPEN | CEO+Design+Eng independent reviews ran |

**VERDICT:** CEO + DESIGN + ENG CLEARED — plan approved by user. Ready to implement.

NO UNRESOLVED DECISIONS
