# Octane

**书签 + 上下文 + 安全** — 浏览器里最方便的"带上下文的书签夹"。

Octane 是一个浏览器 NewTab 页面扩展（支持 Chrome / Firefox / Edge），核心价值是为每个书签提供可加密的上下文空间（笔记、凭据等）。书签是入口，上下文是价值。

## 功能

- **书签管理** — CRUD 操作，支持分类、搜索、Favicon 自动抓取（Google Favicon API）
- **工具栏 Popup 采集** — 任何网页一键收藏当前页（Hub 首页：用户卡 + 功能列表；保存书签 / 设置子页面，主操作「保存当前页面」视觉强调）
- **Side Panel 联动** — 在任意 http(s) 页面左击扩展图标直达侧边栏，按当前页 hostname 自动匹配书签并展示其上下文（BroadcastChannel 跨上下文同步：在 NewTab 改动后 Side Panel 自动刷新）
- **上下文系统** — 每个书签可附加多个上下文条目（笔记、凭据等），支持 Markdown 实时预览 + 标题标记
- **端到端加密** — AES-GCM-256 加密上下文字段，主密码通过 PBKDF2（600K 迭代）派生密钥
- **会话级解锁** — 主密码输入一次，密钥缓存到 `chrome.storage.session`，浏览器关闭自动清除
- **多工作区** — 支持多工作区隔离（如：工作、个人、项目 A）
- **分类组织** — 书签按分类组织，支持增删改
- **全文搜索** — 搜索书签名称、URL、描述（加密上下文内容不参与搜索）
- **数据备份与同步** — 本地全量导入导出（JSON，覆盖式）+ 阿里云 OSS / 腾讯云 COS 云备份恢复（凭证经主密码加密存储，策略模式可扩展其他服务商）

## 技术栈

| 层 | 技术 |
|---|------|
| 框架 | React 19 + TypeScript 6 |
| 构建 | WXT（基于 Vite 8） |
| UI | Semi Design |
| 状态管理 | Zustand 5 |
| 存储 | IndexedDB（via idb） |
| 加密 | Web Crypto API（AES-GCM-256 + PBKDF2） |
| Markdown | marked + DOMPurify |
| 测试 | Vitest + Testing Library |
| 扩展规范 | Chrome MV3 / Firefox MV2（WXT 自动适配） |

## 架构

```
┌──────────────────────────────────────────────┐
│            NewTab Page (React SPA)           │
│  Sidebar │ Content │ ContextList │ UnlockModal│
├──────────────────────────────────────────────┤
│              Zustand Store                   │
│  useWorkspace | useBookmarks | useCrypto     │
├──────────────────────────────────────────────┤
│              Service Layer                   │
│  WorkspaceSvc | CategorySvc | BookmarkSvc    │
│  ContextSvc ─────→ CryptoService            │
├──────────────────────────────────────────────┤
│           Shared Infrastructure              │
│  DB (IndexedDB) │ Markdown │ Quota Monitor   │
└──────────────────────────────────────────────┘
```

**分层原则：** UI → Store → Service → DB，加密细节（encryptedData, iv, salt）对业务层不可见，ContextService 对上层只暴露明文接口。

## 项目结构

```
octane/
├── public/
│   └── icons/                  # 扩展图标 (16/48/128px + SVG)
├── src/
│   ├── entrypoints/
│   │   ├── newtab/             # WXT 入口（index.html + main.tsx）
│   │   ├── popup/              # 工具栏 Popup（Hub 首页 + 保存书签/设置子页面）
│   │   └── sidepanel/          # Side Panel（hostname 联动书签 + 上下文预览）
│   ├── newtab/                 # 新标签页
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Sidebar/        # 侧边栏（工作区 + 分类列表）
│   │   │   ├── Content/        # 主内容区（搜索栏 + 卡片网格）
│   │   │   ├── BookmarkCard/   # 书签卡片
│   │   │   ├── ContextList/    # 上下文列表（列表/编辑视图切换）
│   │   │   ├── ContextEditor/  # 上下文编辑器（Markdown + 预览 + 标题）
│   │   │   ├── UnlockModal/    # 主密码输入弹窗
│   │   │   └── EmptyState/     # 空状态组件
│   │   └── hooks/              # NewTab hooks（useOpenTabs：已打开 tab 监听）
│   ├── components/
│   │   └── backup/             # 共享备份组件（本地导入导出 + 云备份，popup/newtab 复用）
│   ├── services/               # 业务服务层
│   ├── store/                  # Zustand 状态管理
│   └── shared/
│       ├── db/                 # IndexedDB 封装（连接管理 + 级联删除 + 配额监控）
│       ├── tabs/               # Tab 操作（URL 匹配、聚焦、pinned home tab 唤起）
│       ├── types/              # TypeScript 类型定义
│       └── utils/              # 工具函数（Markdown 渲染）
├── tests/                      # 集成测试
├── wxt.config.ts               # WXT 配置（manifest、React 模块）
└── vitest.config.ts            # 测试配置（WxtVitest 插件）
```

## 开发

```bash
# 安装依赖
npm install

# Chrome 开发模式（HMR）
npm run dev

# Firefox 开发模式
npm run dev:firefox

# 构建生产版本
npm run build              # Chrome MV3
npm run build:firefox      # Firefox MV2

# 打包 zip
npm run zip                # Chrome
npm run zip:firefox        # Firefox

# 运行测试
npm test

# 监听模式运行测试
npm run test:watch
```

## 安装到浏览器

**Chrome / Edge：**
1. `npm run build`
2. 打开 `chrome://extensions/`（或 `edge://extensions/`）
3. 开启"开发者模式"
4. 点击"加载已解压的扩展程序"，选择 `.output/chrome-mv3/` 目录

**Firefox：**
1. `npm run build:firefox`
2. 打开 `about:debugging#/runtime/this-firefox`
3. 点击"临时载入附加组件"，选择 `.output/firefox-mv2/manifest.json`

## 安全设计

- **PBKDF2** 600,000 迭代（OWASP 2023 推荐最低值）+ 每用户唯一 16 字节 salt
- **AES-GCM-256** 每次加密生成随机 IV（12 字节），提供认证加密
- **会话密钥** 存储在 `chrome.storage.session`（MV3 会话存储，浏览器关闭自动清除）
- **Markdown XSS 防护** 使用 DOMPurify 白名单过滤 + CSP `script-src 'self'`
- **级联删除** 使用 IndexedDB 事务保证数据一致性

## 版本

当前版本：**0.1.4.3**（MVP 开发阶段）

## 许可

待定
