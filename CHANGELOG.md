# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/).

## [0.1.10.0] - 2026-07-03

### Changed

- **云存储统一 S3 协议**：用 `aws4fetch`（~3KB SigV4 签名器）+ 原生 `fetch` 替换原 `ali-oss` + `cos-js-sdk-v5` 两套 SDK，枚举锁阿里云/腾讯云（endpoint 由 preset+region 推导，vhost 风格）。签名走 service=s3 + `x-amz-content-sha256: UNSIGNED-PAYLOAD`（大文件不在主线程算 hash）。移除两套重型 SDK，bundle 净瘦身、无 Node polyfill。原 `OssProvider`/`CosProvider` 与 `ali-oss`/`cos-js-sdk-v5`/`@types/ali-oss` 依赖整体删除。
- **主机权限收窄为编译期固定**：枚举锁 provider 后所有云 origin 已知且固定，删除原计划的运行时主机权限申请整套机制，回退 `host_permissions` 三固定域（`*.aliyuncs.com` / `*.myqcloud.com` / `dav.jianguoyun.com`）。
- **云备份设置 UI 重写**：`CloudBackupSection` Tab 列表改从注册表动态生成（去硬编码 `['oss','cos']`）；新增 preset 下拉渲染（S3 服务商/坚果云），region 占位按 s3Preset 联动；`handleSave` 从 `configFields` 通用收集（不再硬编码 5 字段）；连接/上传/恢复错误文案透传 provider 消息（桶不存在/凭证错区分）。
- **`CloudStorageConfig` schema 重构**：字段改可选 + 按 provider 按需填，新增 `s3Preset`/`webdavPreset`/`username`/`password`；新增 `getRequired(cfg, keys)` helper（必填缺失明确抛错，替代静默空串）。

### Added

- **WebDAV 兼容（坚果云）**：新增 `WebdavProvider`（原生 `fetch` + Basic Auth），枚举锁首支持坚果云（`dav.jianguoyun.com/dav/`，账号邮箱 + 应用密码），preset 下拉结构为后续扩展其他 WebDAV 保留。备份落 `dav/octane/octane-backup.json`，MKCOL 幂等建目录。
- **S3/WebDAV/坚果云 e2e 前置 spike 工具**：`scripts/spike-s3.mjs`（S3_PRESET=aliyun|tencent 验证 aws4fetch 直连两家 vhost 端点）、`scripts/spike-jianguoyun.mjs`（坚果云 WebDAV PROPFIND/MKCOL/PUT/GET 链路）。Node 跑验网络/签名/协议，e2e 前置。
- 单测：`S3Provider`（25 例，SigV4 结构断言）、`WebdavProvider`（12 例）、`getRequired`（4 例）；`CloudBackupSection` 测试迁 `userEvent`、补 preset 下拉/通用收集/Toast 透传断言。

### Fixed

- **保存+刷新后云配置不回填**（e2e 发现）：`CloudBackupSection` 表单挂载时未从 `getCloudConfig` 回填已存凭证（加密配置可读、测试连接成功，但 UI 空）；解锁后按 tab 回填 `configFields`，仅在该 tab 无本地输入时回填避免覆盖编辑。对 S3/WebDAV 两 tab 均生效。

### 备注

- 旧版 `oss`/`cos` 配置不自动迁移到新 `s3`/`webdav`（凭证加密分键、endpoint 推断不可靠）；升级后需在 preset 下拉重配一次。

## [0.1.9.0] - 2026-07-03

### Changed

- **测试设计规范落地**：建立 `docs/standards/testing.md`（Testing Trophy + Don't Mock What You Don't Own），重写 4 个手写整体 mock `@douyinfe/semi-ui` 的测试文件为真实渲染 Semi + 仅 partial mock Toast，消除「测试假过」风险。`SidePanelUnlockModal` 补 catch 分支用例；mutation 验证（surface + 分支反转）两个都被测试抓住。
- **测试基建补全**：`tests/setup.ts` 加 jest-dom + cleanup + ResizeObserver/IntersectionObserver polyfill；装 `@testing-library/user-event`；`tsconfig.test.json`（关 noUnusedLocals）+ `typecheck` script；`src/types/globals.d.ts` 桥接 chrome 全局。
- **ESLint flat config**（testing-library + vitest 插件，高冲突规则 warn 不 error，存量渐进）+ **husky gate**（pre-commit=lint / pre-push=typecheck+test）。
- **包管理器统一 pnpm**：`packageManager: pnpm@10.11.0`，删 `package-lock.json`，README/husky/CLAUDE/规范 命令迁移。

### Fixed

- **Semi barrel 经 lottie-web 在 jsdom 崩**：`@douyinfe/semi-ui` barrel 静态 import lottie-web，jsdom 无 canvas 模块评估期崩；用 `vitest.config.ts` 的 `resolve.alias` 全局指向 stub（实测 setup.ts `vi.mock` 无效）。
- **清理 70 个历史类型债**：装 `@types/chrome` + `globals.d.ts` 桥接、TS6 `ArrayBuffer` 标注、`noUncheckedIndexedAccess` 守卫；`typecheck` 从无到有且双 tsconfig 全绿。

### Added

- `tests/spike-semi-jsdom.test.tsx` 永久 smoke test（Semi/jsdom 升级预警）。
- `CLAUDE.md` 加测试规范节，AI session 强制遵循。
- `docs/plans/2026-07-03-testing-standard-rollout.md`（autoplan 四轮双模型 review 的落地计划与评审报告）。

## [0.1.8.0] - 2026-07-02

### Added

- **书签上下文加密分层解锁**：home 与 side panel 解锁状态物理隔离——home 解锁不再联动 side panel 自动解锁，堵住「进 home 输一次密码 → side panel 所有加密上下文全开、永不超时」的安全漏洞。新增 `UnlockSession` service 按 surface（home/sidepanel）独立管理解锁标记。
- **side panel 空闲时长锁 + 硬上限（TTL）**：side panel 失焦超 grace（默认 5min）自动锁回（短暂切窗不打扰），解锁后满 hardCap（默认 30min）必锁（防一直盯着永不锁）。免 `chrome.alarms` 权限，用 `visibilitychange` + `setInterval`（仅在 side panel 常驻页面注册，避开 MV3 service worker 休眠）。
- **TTL 用户可配**：设置中心「主密码 → 加密上下文自动锁定」按秒配置 grace（1–3600s）/ hardCap（30–86400s），即时生效。
- **side panel 解锁交互（上下文级粒度）**：加密上下文未解锁时单独渲染可点击锁占位（明文上下文始终可见），点击/键盘 Enter 触发 sidepanel 专属解锁弹窗，每次走完整 PBKDF2 + verifier（防偷看，不复用 home 已派生 key）。
- **home lockSession 连带锁 side panel**：home 主动锁定清共享派生密钥时，side panel 解密能力一并失效。
- 解锁并发幂等（多个书签同时触发解锁只派生一次）、解锁前置条件引导（未设密码/旧版数据 Toast 引导去 home）。

### Fixed

- **home 解锁泄露 side panel 密文**（自查回归）：上下文级粒度初版去掉 isUnlocked gate 后 `getContexts` 直接用共享 key 解密，home 解锁导致 side panel 密文泄露；改为未解锁走 `getContextsRaw`（永不解密）。
- **side panel 失焦/聚焦闪烁**：`hiddenAt` 拆到独立 `octane-unlock-visibility-sidepanel` key，`markHidden`/`markVisible` 不再触发 `useEncryptedContexts` 重渲染。
- **加密创建绕过 side panel gate**（pre-landing review P1）：`InlineContextEditor` 加密 Switch 改读 sidepanel surface 标记（非共享 key），home 解锁后未解锁 side panel 不能再创建加密上下文。
- **hardCap 短值形同虚设**（pre-landing review P1）：hardCap 下限对齐 30s tick 间隔，避免 hardCap<30s 因 tick 触发不及时失效。
- **解锁弹窗横向溢出 + 按钮贴底**：宽度 `calc(100vw - 32px)` 自适应 side panel 窄视口，按钮移入 Modal footer。

## [0.1.7.1] - 2026-07-01

### Added

- **书签移动工作区/分类**：编辑书签弹窗新增「归属位置」级联选择（先选目标工作区、再选该工作区下分类），可把书签重新归到任意工作区/分类；改名/URL/描述可同时修改。换工作区异步加载目标分类（loading 态、防残留），目标工作区无分类时禁用保存并提示，防孤儿书签。
- **书签删除**：书签卡操作区新增删除按钮（Popconfirm 二次确认），文案按上下文计数分支显示；级联删除其下所有上下文。
- **工作区/分类选中态持久化**：切换工作区/分类后记忆，重开 newtab 自动恢复（工作区全局记忆 + 分类 per-workspace 记忆）。

### Fixed

- **React 19 下 Semi Toast/Modal/Notification 静态方法失效**（项目级遗留 bug）：React 19 移除了 `react-dom` 的 `createRoot` 导出，导致 Toast.success 等静态方法无法自建 portal、静默不显示（控制台报 `createRoot is not available`）。三入口（newtab/popup/sidepanel）注入 `@douyinfe/semi-ui/react19-adapter` 修复，此前所有 Toast 静态调用（备份/云配置/删除等）一并恢复。
- **`useBookmarks` 双切片同步遗漏**（历史 bug）：`deleteBookmark`、`refreshBookmark` 此前只同步当前分类切片（`bookmarks`），漏同步跨分类去重切片（`allBookmarks`），导致删除/编辑后「打开的标签页」视图跨分类去重用到陈旧数据。新增独立 `moveBookmark` action 按移动方向（跨工作区 / 同工作区跨分类）正确同步双切片。
- **移动书签 + 改名组合时 name 陈旧**：移动后切片持旧数据，补充 `refreshBookmark` 重读 DB 最新，避免 `allBookmarks` 的 name/url 陈旧。
- **删除书签后 Toast 不显示**：Popconfirm `onConfirm` 此前返回 Promise 触发 Semi 异步 loading 模式遮挡 Toast，改 body block 不返回 Promise。

## [0.1.7.0] - 2026-06-30

### Added

- **Side Panel 来源辨识**：同 hostname 跨多工作区/分类命中时，按工作区段 → 分类段 → 书签卡分组渲染，零点击可辨来源（此前同 host 多书签 header 几乎相同，分不清属哪个工作区/分类）。`groupBookmarksByWorkspace` 纯函数按 `Workspace.order → Category.order → Bookmark.createdAt` 排序，孤儿引用归入「未知」段。
- **Side Panel 折叠收纳**：≥2 个工作区命中时包成 Semi Collapse（默认 ≤6 全展开 / >6 仅展开命中最多者；单工作区免 Collapse）。展开态按工作区记忆，刷新/编辑后不跳段。
- **Side Panel 就地创建上下文**：每个书签 header 「+」内联展开编辑器（标题 + Markdown 正文 + 加密 Switch），免去跳 newtab 往返。加密走 `isUnlocked()` gate（未解锁 Toast 提示、输入保留）；idle/saving/saved/error 四态，防双击重复创建；创建后新卡经既有 `BroadcastChannel` 闭环即时出现。
- 书签卡 header 增加分类 chip（来源辨识常驻）。

### Fixed

- **未加密上下文创建后不出现**（预存 bug）：`useEncryptedContexts` 依赖数组缺 `contextCount`，创建未加密上下文时 effect 不重跑、新卡不渲染。现已加入依赖，就地创建闭环生效。

### Changed

- Side Panel 顶栏布局紧凑化：工作区段头去自身 padding（依赖 Collapse 内边距），修内容垂直未居中 + 省空间。

## [0.1.6.0] - 2026-06-29

### Added

- **home 页「打开的标签页」视图**：Content 工具栏加卡片式 Tabs（书签 / 标签页），默认书签（100% 向后兼容）；标签页视图列出当前窗口所有打开的 tab（紧凑列表，顺序与浏览器 tab 栏一致），点击直达对应 tab，可从 tab 一键保存为书签到当前分类
- **tab↔书签联动（护城河漏斗）**：tab 列表带「已收藏」角标（跨分类去重判定）；保存 tab 时带分类选择器（默认当前，防存错桶），保存成功后引导添加上下文笔记（save→context 漏斗，把 tab 视图变成引流进 Octane 加密上下文护城河的入口）
- **跨分类去重数据源**：`useBookmarks` 新增 `allBookmarks` slice（`loadAllByWorkspace`），TabList 跨分类去重不再因仅加载当前分类而静默失效

### Changed

- **`useOpenTabs` 数据源改按浏览器位置（index）排序**：tab 列表与浏览器 tab 栏顺序一致，修复「多个相同 tab 点击跳转随机」（原按 `lastAccessed` 排序，聚焦会刷新其值致列表重排）；`lastAccessed` 降级为字段，书签点击跳转改用新增的 `pickMostRecentMatchingTab` 显式取最近活跃
- **`useOpenTabs` 默认过滤浏览器内部页**：`chrome://` `edge://` `about:` `chrome-extension://` 不进列表；新增 `title` / `favIconUrl` / `pinned` / `index` 字段投影（为 0.2.x 会话保存做数据前置）

### Fixed

- **`focusTab` stale tabId**：tab 在列表渲染与点击跳转之间被关闭时不再产生未捕获的 promise rejection，改用 url 回退 `window.open`

## [0.1.5.1] - 2026-06-29

### Fixed

- **书签备注清空不生效**：编辑书签弹窗清空「描述」字段后保存，备注仍显示旧值——Semi Form 清空字段提交值为 `undefined`，原代码误用 `??` 回退原值。改为允许清空为空串
- **本机/内网地址 favicon 失败**：`localhost`、IP（`127.0.0.1`、`192.168.x`、`10.x` 等）、`*.local` 不再走 Google Favicon API（其无法索引这些地址必然返回占位图），改为回退源站 `${origin}/favicon.ico`（如 `http://localhost:8648/favicon.ico`），加载失败仍由 UI 层回退书签首字母；已存在的旧内网书签在打开对应分类时自动收敛到新策略

## [0.1.5.0] - 2026-06-28

### Added

- **系统设置中心**：Sidebar「设置」入口改为弹出 Semi Modal 统一设置中心，左侧分类（快捷键 / 数据备份和同步 / 主密码）右侧详情，收纳原本散落的设置项
- **全局快捷键**：`Alt+Shift+H` 打开 Octane 首页、`Alt+Shift+S` 打开侧边栏（浏览器所有标签页生效）；按键可在 `chrome://extensions/shortcuts` 自定义
- **快捷键设置页**：只读展示当前绑定 + 跳转浏览器快捷键设置页（Chrome 不允许扩展运行时改键）
- **分类删除二次确认**：删除分类改为弹窗二次确认，明确提示将级联删除该分类下所有书签及其上下文且不可恢复，需输入完整短语「我确认删除{分类名} 分类」才解锁删除按钮，防止误触清空数据

### Fixed

- **UnlockModal 层级**：解锁/重设主密码弹窗 z-index 提升至 1100，嵌套在设置 Modal 内触发时正确置顶（原 1000 与 Semi Modal 同层被压下）

## [0.1.4.4] - 2026-06-27

### Added

- **`octane-release` 发版 skill**：项目无 CI release pipeline，新增 `.claude/skills/octane-release/` 手动发版流程——打包 chrome MV3 扩展（`.output/octane-<version>-chrome.zip`）并发布到 GitHub Release，附该版本 CHANGELOG 说明

### Changed

- **依赖 patch 升级**：`vite` 8.0.16 → 8.1.0、`wxt` 0.20.26 → 0.20.27

### Fixed

- **`wxt build` 完成后进程挂起不退出**：Vite 8 的 worker pool（MessagePort）在 build 完成后不会关闭，导致 `wxt build` 产物落盘后进程一直挂着（CI / 脚本化构建卡死）。新增 `wxt.config.ts` 的 `build:done` hook，在所有产物写入 `.output/chrome-mv3/` 后 `process.exit(0)`；`wxt zip` 内部也会先 build，通过 `process.argv` 检测放行以免打断后续打包

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
