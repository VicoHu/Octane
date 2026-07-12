# 数据备份与同步 子 tab 拆分 设计

## 背景

`SettingsModal`(系统设置中心)的外层左 `Tabs(type=line)` 中,「数据备份和同步」pane 内纵向堆叠了 4 个 section:

| 区块 | 内容 | 体量 |
|------|------|------|
| `LocalBackupSection` | 本地导出 / 导入(覆盖式,破坏性确认 Modal) | 小 |
| `CloudBackupSection` | S3(阿里/腾讯)+ WebDAV(坚果云)配置表单、连通测试、保存/清除、上传/恢复(破坏性确认)。内部已有一层 s3/webdav tabs | **大,繁杂主因** |
| `FaviconCacheSection` | 清空 favicon 缓存 | 极小,且语义游离(非备份/同步) |
| `ShareSection` | 导出 / 导入分享包(合并式,不覆盖) | 小 |

纵向堆叠导致单屏过长、信息密度高,体量最大的 `CloudBackupSection` 进一步放大了繁杂感。

## 目标

1. 用 Semi `Tabs` 把「数据备份和同步」内部拆成子 tab,降低单屏信息密度,按"本地 / 云端 / 分享"的功能边界归类。
2. 将语义游离的 favicon 缓存移出备份区,归入新外层 tab「数据维护」。

## 非目标

- 不改 `LocalBackupSection` / `CloudBackupSection` / `ShareSection` / `FaviconCacheSection` 组件本身的逻辑。
- 不动 store(`useBackup` / `useShare` / `useCrypto`)与 service。
- 不重构 `CloudBackupSection` 内部已有的 s3/webdav tabs。
- 不引入新的状态管理;子 tabs 是纯布局容器。

## 结构

```
SettingsModal (左 line tabs, keepDOM=false)
├─ 快捷键            → ShortcutsSection
├─ 数据备份和同步     → BackupSyncTabs  [新建]
│      └─ 顶部 card tabs (keepDOM=true)
│           ├─ 本地备份 → LocalBackupSection
│           ├─ 云端同步 → CloudBackupSection (内部 s3/webdav line tabs 不动)
│           └─ 分享    → ShareSection
├─ 数据维护 (新)      → FaviconCacheSection  [从备份区移入]
└─ 主密码            → PasswordSection + EncryptionTtlSection
```

## 组件改动

### 1. 新建 `src/components/backup/BackupSyncTabs.tsx`

子 `Tabs` 容器,封装 3 个 `TabPane`:

- `type="card"`(顶部,默认 tabPosition)。
- `keepDOM={true}`。
- 3 个 `TabPane`:`本地备份`(itemKey=`local`)→ `<LocalBackupSection/>`;`云端同步`(itemKey=`cloud`)→ `<CloudBackupSection/>`;`分享`(itemKey=`share`)→ `<ShareSection/>`。
- 三个 section 均从 `@/components/backup` 引入,不做任何修改。

### 2. 改 `src/entrypoints/home/components/SettingsModal/index.tsx`

- backup pane 内容由
  ```tsx
  <LocalBackupSection />
  <CloudBackupSection />
  <FaviconCacheSection />
  <ShareSection />
  ```
  替换为
  ```tsx
  <BackupSyncTabs />
  ```
- 新增外层「数据维护」`TabPane`(itemKey=`maintenance`,tab=`数据维护`),内容为 `<FaviconCacheSection/>`。
- `FaviconCacheSection` 的 import 保留(改由「数据维护」pane 使用);移除 backup pane 对它的引用。

### 3. 不动

四个 section 组件、所有 store、service、`CloudBackupSection` 内部 s3/webdav tabs。纯布局重组。

## 关键决策

- **子 tab `type="card"`**:与外层左 `line` 形成 纵/横 区分;与 `CloudBackupSection` 内部 s3/webdav 的 `line` 形成 **层级区分**(子级功能切换 = card,服务商选择 = line),嵌套视觉清晰。card 视觉权重适中,3 个子 tab 适用。(用户拍板)
- **子 tab `keepDOM={true}`**:在 本地/云端/分享 间切换时保留 `CloudBackupSection` 的表单输入(未保存的输入不丢)。外层 `keepDOM` 保持 `false` 不动(切走备份区整体销毁,符合现状)。
- **容器独立 `BackupSyncTabs`**:`SettingsModal` 只管外层组装,子 tab 逻辑隔离,符合现有"外层 pane = section 组件"模式(`快捷键`→`ShortcutsSection` 等)。
- **favicon → 「数据维护」**:语义干净;新外层 tab 当前仅 favicon 一项,为后续维护类操作预留扩展位。`FaviconCacheSection` 仅被 `SettingsModal` 引用,移入新 pane 无波及面。

## 数据流 / 状态

无变化。子 tabs 是纯布局容器,不引入新 state;各 section 继续各自消费 `useBackup` / `useShare` / `useCrypto`。唯一注意点:`CloudBackupSection` 内部 s3/webdav tabs + 表单 state 靠子 tab 的 `keepDOM={true}` 在切换间保留。

## 测试

现有测试文件:`src/entrypoints/home/components/SettingsModal/__tests__/SettingsModal.test.tsx`。

- **测试 1**(「渲染...三 menu 项」):外层 tab 由 3 增至 4,更新为「四 menu 项」并新增 `expect(screen.getByText('数据维护')).toBeInTheDocument()`。
- **测试 3**(点「数据备份和同步」→ 见「导出数据」):子 tab 默认选中「本地备份」,`LocalBackupSection` 仍渲染「导出数据」按钮,预期仍 pass;实现时验证。
- **新增 1 个测试**:进入「数据备份和同步」后,3 个子 tab(本地备份/云端同步/分享)可见;切到「云端同步」后可见云端配置区(如「测试连接」按钮)。
- 规范遵循:真实渲染 Semi(不 mock `@douyinfe/semi-ui`),仅 mock 副作用边界(沿用现有 `cloud/providers`、`CloudStorageService`、`useCrypto` mock);交互用 `userEvent`,断言用 jest-dom matcher。
- `FaviconCacheSection` 独立测试(`sections/__tests__/FaviconCacheSection.test.tsx`)不受影响(组件 API 不变)。

## 改动范围

- 新增 1 文件:`src/components/backup/BackupSyncTabs.tsx`
- 改 1 文件:`src/entrypoints/home/components/SettingsModal/index.tsx`
- 改测试:`SettingsModal/__tests__/SettingsModal.test.tsx`(更新测试 1 + 新增 1 个)
- 零 store / service / section 组件逻辑改动
