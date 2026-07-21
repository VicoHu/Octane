# Octane

![version](https://img.shields.io/github/v/release/VicoHu/Octane?label=版本&logo=github)
![license](https://img.shields.io/github/license/VicoHu/Octane?label=许可)
![chrome](https://img.shields.io/badge/Chrome-%E2%89%A5116-4285F4?logo=googlechrome&logoColor=white)
![stars](https://img.shields.io/github/stars/VicoHu/Octane?style=social)

**书签 + 上下文 + 安全** — 浏览器里最方便的"带上下文的书签夹"。

Octane 是一个浏览器 NewTab 页面扩展（支持 Chrome / Firefox / Edge），核心价值是为每个书签提供可加密的上下文空间（备忘、凭据等）。书签是入口，上下文是价值。

## 功能

- **书签管理** — CRUD 操作，支持分类、搜索、Favicon 自动获取（本地立即显示浏览器 favicon / 首字母，公网后台异步升级高清图标 via Icon Horse；localhost / 内网地址不请求第三方，保护隐私）
- **工具栏 Popup 采集** — 任何网页一键收藏当前页（Hub 首页：用户卡 + 功能列表；保存书签 / 设置子页面，主操作「保存当前页面」视觉强调）
- **Side Panel 联动** — 在任意 http(s) 页面左击扩展图标直达侧边栏，按当前页 hostname 自动匹配书签并展示其上下文（BroadcastChannel 跨上下文同步：在 NewTab 改动后 Side Panel 自动刷新）
- **响应式移动端** — home 页自适应窄屏（上下文面板抽屉化、工作区应用栏、移动端触摸目标与字号优化），小屏也能顺畅管理
- **上下文系统** — 每个书签可附加多个上下文条目（备忘、凭据等），支持 Markdown 实时预览 + 标题标记
- **端到端加密** — AES-GCM-256 加密上下文字段，主密码通过 PBKDF2（600K 迭代）派生密钥
- **会话级解锁** — 主密码输入一次，密钥缓存到 `chrome.storage.session`，浏览器关闭自动清除
- **多工作区** — 支持多工作区隔离（如：工作、个人、项目 A）
- **分类组织** — 书签按分类组织，支持增删改
- **打开的标签页视图** — home 页 Content 加卡片式 Tabs（书签 / 标签页，默认书签）；标签页视图列出当前窗口所有打开的 tab（顺序与浏览器 tab 栏一致），点击直达对应 tab，可一键保存为书签到当前分类并引导添加上下文（save→context 漏斗）；已收藏的 tab 跨分类去重标注「已收藏」
- **全文搜索** — 搜索书签名称、URL、描述（加密上下文内容不参与搜索）
- **数据备份与同步** — 本地全量导入导出（JSON，覆盖式）+ 云备份恢复：S3 兼容存储（阿里云 OSS / 腾讯云 COS）与坚果云 WebDAV（凭证经主密码加密存储，策略模式可扩展其他服务商）
- **系统设置中心** — Sidebar「设置」入口弹出统一设置 Modal（左 Nav 右详情：快捷键 / 数据备份和同步 / 数据维护 / 主密码 / 关于），收纳所有设置项
- **关于与更新提示** — 设置「关于」展示版本号、分发渠道（Chrome 商店 / Edge / 手动安装）、作者与开源仓库；sidebar 常驻版本号；检测到新版本时提示并按渠道引导更新（`onUpdateAvailable` 被动感知 + 按渠道跳转，零新增权限）
- **全局快捷键** — `Alt+Shift+H` 打开首页、`Alt+Shift+S` 打开侧边栏（所有标签页生效）；按键可在 `chrome://extensions/shortcuts` 自定义

## 技术栈

| 层 | 技术 |
|---|------|
| 框架 | React 19 + TypeScript 6 |
| 构建 | WXT（基于 Vite 8） |
| UI | shadcn/ui（Base UI）+ Tailwind v4 |
| 图标 | lucide-react |
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
│   │   ├── home/               # home 页 WXT 入口（index.html + main.tsx + 响应式布局）
│   │   │   ├── App.tsx
│   │   │   └── components/     # Sidebar / Content / BookmarkCard / ContextList /
│   │   │                       # ContextEditor / TabList / PinnedArea / ManagePanel /
│   │   │                       # AppRail（工作区栏）/ ContextPanelShell（响应式抽屉）/
│   │   │                       # SettingsModal / WorkspaceCreateButton 等
│   │   ├── popup/              # 工具栏 Popup（Hub 首页 + 保存书签/设置子页面）
│   │   ├── sidepanel/          # Side Panel（hostname 联动书签 + 上下文预览）
│   │   └── background.ts       # MV3 service worker（跨上下文消息路由）
│   ├── components/
│   │   ├── ui/                 # shadcn/ui 原语（Base UI 封装，全项目组件基座）
│   │   ├── backup/             # 共享备份组件（本地导入导出 + 云备份 + 分享包导入导出，popup/home 复用）
│   │   ├── IconPicker/         # 工作区/分类图标选择
│   │   ├── UnlockModal/        # 主密码解锁弹窗（home/popup 共享）
│   │   └── BookmarkFaviconPreview/
│   ├── hooks/                  # 通用 hooks（useMediaQuery 响应式等）
│   ├── lib/                    # cn 等工具函数
│   ├── styles/                 # 全局样式 + tailwind-theme.css（DESIGN.md token → shadcn 变量）
│   ├── services/               # 业务服务层
│   ├── store/                  # Zustand 状态管理
│   └── shared/
│       ├── db/                 # IndexedDB 封装（连接管理 + 级联删除 + 配额监控）
│       ├── tabs/               # Tab 操作（URL 匹配、聚焦、pinned home tab 唤起）
│       ├── types/              # TypeScript 类型定义
│       └── utils/              # 工具函数（Markdown 渲染）
├── wxt.config.ts               # WXT 配置（manifest、React + Tailwind vite 插件）
└── vitest.config.ts            # 测试配置（WxtVitest 插件）
```

## 开发

```bash
# 安装依赖
pnpm install

# Chrome 开发模式（HMR）
pnpm run dev

# Firefox 开发模式
pnpm run dev:firefox

# 构建生产版本
pnpm run build              # Chrome MV3
pnpm run build:firefox      # Firefox MV2

# 打包 zip
pnpm run zip                # Chrome
pnpm run zip:firefox        # Firefox

# 运行测试
pnpm test

# 监听模式运行测试
pnpm run test:watch
```

测试规范见 [docs/standards/testing.md](docs/standards/testing.md)（Testing Trophy + Don't Mock What You Don't Own，写测试前必读）；typecheck/lint/gate 见 [CLAUDE.md](CLAUDE.md) 测试规范节。

## 安装到浏览器

**Chrome / Edge：**
1. `pnpm run build`
2. 打开 `chrome://extensions/`（或 `edge://extensions/`）
3. 开启"开发者模式"
4. 点击"加载已解压的扩展程序"，选择 `.output/chrome-mv3/` 目录

**Firefox：**
1. `pnpm run build:firefox`
2. 打开 `about:debugging#/runtime/this-firefox`
3. 点击"临时载入附加组件"，选择 `.output/firefox-mv2/manifest.json`

## 安全设计

- **PBKDF2** 600,000 迭代（OWASP 2023 推荐最低值）+ 每用户唯一 16 字节 salt
- **AES-GCM-256** 每次加密生成随机 IV（12 字节），提供认证加密
- **会话密钥** 存储在 `chrome.storage.session`（MV3 会话存储，浏览器关闭自动清除）
- **Markdown XSS 防护** 使用 DOMPurify 白名单过滤 + CSP `script-src 'self'`
- **级联删除** 使用 IndexedDB 事务保证数据一致性

## 许可

待定
