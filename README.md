# Octane

**书签 + 笔记 + 安全** — 浏览器里最方便的"带笔记的书签夹"。

Octane 是一个 Chrome NewTab 页面插件，核心价值是为每个书签提供可加密的 Markdown 笔记空间。书签是入口，笔记是价值。

## 功能

- **书签管理** — CRUD 操作，支持分类、搜索、Favicon 自动抓取（Google Favicon API）
- **Markdown 笔记** — 每个书签可附加 Markdown 笔记，支持实时预览（marked + DOMPurify）
- **端到端加密** — AES-GCM-256 加密笔记字段，主密码通过 PBKDF2（600K 迭代）派生密钥
- **会话级解锁** — 主密码输入一次，密钥缓存到 `chrome.storage.session`，浏览器关闭自动清除
- **多工作区** — 支持多工作区隔离（如：工作、个人、项目 A）
- **分类组织** — 书签按分类组织，支持增删改
- **全文搜索** — 搜索书签名称、URL、描述（加密笔记内容不参与搜索）

## 技术栈

| 层 | 技术 |
|---|------|
| 框架 | React 19 + TypeScript 6 |
| 构建 | Vite 8 |
| UI | Semi Design |
| 状态管理 | Zustand 5 |
| 存储 | IndexedDB（via idb） |
| 加密 | Web Crypto API（AES-GCM-256 + PBKDF2） |
| Markdown | marked + DOMPurify |
| 测试 | Vitest + Testing Library |
| 扩展规范 | Chrome Extension Manifest V3 |

## 架构

```
┌──────────────────────────────────────────────┐
│            NewTab Page (React SPA)           │
│  Sidebar │ Content │ NoteEditor │ UnlockModal│
├──────────────────────────────────────────────┤
│              Zustand Store                   │
│  useWorkspace | useBookmarks | useCrypto     │
├──────────────────────────────────────────────┤
│              Service Layer                   │
│  WorkspaceSvc | CategorySvc | BookmarkSvc    │
│  NoteSvc ─────────→ CryptoService            │
├──────────────────────────────────────────────┤
│           Shared Infrastructure              │
│  DB (IndexedDB) │ Markdown │ Quota Monitor   │
└──────────────────────────────────────────────┘
```

**分层原则：** UI → Store → Service → DB，加密细节（encryptedData, iv, salt）对业务层不可见，NoteService 对上层只暴露明文接口。

## 项目结构

```
octane/
├── public/
│   ├── manifest.json           # Manifest V3 配置
│   └── icons/                  # 扩展图标 (16/48/128px)
├── src/
│   ├── newtab/                 # 新标签页
│   │   ├── App.tsx
│   │   └── components/
│   │       ├── Sidebar/        # 侧边栏（工作区 + 分类列表）
│   │       ├── Content/        # 主内容区（搜索栏 + 卡片网格）
│   │       ├── BookmarkCard/   # 书签卡片
│   │       ├── NoteEditor/     # 笔记编辑器（Markdown + 预览）
│   │       ├── UnlockModal/    # 主密码输入弹窗
│   │       └── EmptyState/     # 空状态组件
│   ├── services/               # 业务服务层
│   ├── store/                  # Zustand 状态管理
│   └── shared/
│       ├── db/                 # IndexedDB 封装（连接管理 + 级联删除 + 配额监控）
│       ├── types/              # TypeScript 类型定义
│       └── utils/              # 工具函数（Markdown 渲染）
├── tests/                      # 集成测试
└── docs/                       # 设计文档
```

## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 运行测试
npm test

# 监听模式运行测试
npm run test:watch
```

## 安装到 Chrome

1. `npm run build`
2. 打开 `chrome://extensions/`
3. 开启"开发者模式"
4. 点击"加载已解压的扩展程序"，选择 `dist/` 目录

## 安全设计

- **PBKDF2** 600,000 迭代（OWASP 2023 推荐最低值）+ 每用户唯一 16 字节 salt
- **AES-GCM-256** 每次加密生成随机 IV（12 字节），提供认证加密
- **会话密钥** 存储在 `chrome.storage.session`（MV3 会话存储，浏览器关闭自动清除）
- **Markdown XSS 防护** 使用 DOMPurify 白名单过滤 + CSP `script-src 'self'`
- **级联删除** 使用 IndexedDB 事务保证数据一致性

## 版本

当前版本：**0.1.0**（MVP 开发阶段）

## 许可

待定
