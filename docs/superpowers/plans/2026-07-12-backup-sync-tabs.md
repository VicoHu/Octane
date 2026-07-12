# 数据备份与同步 子 tab 拆分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 SettingsModal「数据备份和同步」pane 内纵向堆叠的 4 个 section 拆成 Semi `Tabs(type=card)` 的 3 个子 tab(本地备份/云端同步/分享),并把语义游离的 favicon 缓存移到新增外层 tab「数据维护」。

**Architecture:** 新建纯布局容器 `BackupSyncTabs`(顶部 card tabs + 3 个 TabPane 分别渲染现有三个 backup section,section 组件零改动);`SettingsModal` 的 backup pane 改为引用该容器,新增「数据维护」外层 TabPane 容纳 `FaviconCacheSection`。不引入新状态,纯布局重组。

**Tech Stack:** React + TypeScript + Semi Design(`@douyinfe/semi-ui` Tabs)+ Vitest + @testing-library/react + @testing-library/user-event。

## Global Constraints

- **语言:** 强制中文,包括代码注释、文案、测试 `describe`/`it` 描述。
- **包管理器:** pnpm(非 npm)。
- **测试规范(见 docs/standards/testing.md):** 真实渲染 Semi,**禁止整体 mock `@douyinfe/semi-ui`**;mock 只命中副作用边界(本任务复用现有 SettingsModal 测试已配的 `cloud/providers`、`CloudStorageService`、`useCrypto`、`ChangePasswordModal`、`lottie-web`、`chrome` mock);**禁止 `vi.mock('lottie-web')`**(由 vitest.config.ts 全局 alias 处理);query 用 `getByRole`/`getByText`;交互用 `userEvent`(非 `fireEvent`);断言用 jest-dom matcher(`toBeInTheDocument`/`toHaveAttribute`)。
- **外科手术:** 不改 `LocalBackupSection`/`CloudBackupSection`/`ShareSection`/`FaviconCacheSection` 组件逻辑、不动 store(`useBackup`/`useShare`/`useCrypto`)与 service、不重构 `CloudBackupSection` 内部 s3/webdav tabs。
- **提交门:** `pnpm run typecheck` + `pnpm run test` 双绿。
- **当前分支:** `feature/0.1.11.3`(无需新建,直接在此分支提交)。

---

### Task 1: 数据备份与同步 card 子 tab 拆分 + 数据维护外层 tab

**Files:**
- Create: `src/components/backup/BackupSyncTabs.tsx`
- Modify: `src/entrypoints/home/components/SettingsModal/index.tsx`
- Test: `src/entrypoints/home/components/SettingsModal/__tests__/SettingsModal.test.tsx`

**Interfaces:**
- Consumes(签名均不变,直接引用):`LocalBackupSection()`、`CloudBackupSection()`、`ShareSection()` —— 均来自 `src/components/backup/*`,`@/components/backup/*` 别名导入。
- Produces:`BackupSyncTabs()` —— 无 props,渲染 `<Tabs type="card" keepDOM>` + 3 个 `Tabs.TabPane`(itemKey: `local`/`cloud`/`share`),供 `SettingsModal` 的 backup pane 引用。

- [ ] **Step 1: 更新测试 — 测试 1 改「四 menu 项」+ 新增子 tab 集成测试**

在 `src/entrypoints/home/components/SettingsModal/__tests__/SettingsModal.test.tsx`:

(a) import 行(`import { render, screen, fireEvent } from '@testing-library/react';` 上方)新增 userEvent:

```tsx
import userEvent from '@testing-library/user-event';
```

(b) 把测试 1 整段替换(标题由「三 menu 项」改「四 menu 项」,断言统一为 jest-dom matcher 并加「数据维护」):

```tsx
  it('渲染「系统设置」标题 + 四 menu 项', () => {
    render(<SettingsModal visible={true} onCancel={() => {}} />);
    expect(screen.getByText('系统设置')).toBeInTheDocument();
    expect(screen.getByText('快捷键')).toBeInTheDocument();
    expect(screen.getByText('数据备份和同步')).toBeInTheDocument();
    expect(screen.getByText('数据维护')).toBeInTheDocument();
    expect(screen.getByText('主密码')).toBeInTheDocument();
  });
```

(c) 在 describe 块末尾(`主密码`分区测试之后、闭合 `});` 之前)新增子 tab 集成测试:

```tsx
  it('「数据备份和同步」内含 3 个 card 子 tab,默认本地备份,可切到云端同步', async () => {
    const user = userEvent.setup();
    render(<SettingsModal visible={true} onCancel={() => {}} />);
    // 等快捷键分区渲染完（chrome.commands.getAll 异步）
    await screen.findByRole('button', { name: /前往自定义/ });
    // 进入「数据备份和同步」外层 tab
    await user.click(screen.getByRole('tab', { name: '数据备份和同步' }));

    // 3 个子 tab 存在
    const localTab = screen.getByRole('tab', { name: '本地备份' });
    const cloudTab = screen.getByRole('tab', { name: '云端同步' });
    const shareTab = screen.getByRole('tab', { name: '分享' });
    expect(localTab).toBeInTheDocument();
    expect(cloudTab).toBeInTheDocument();
    expect(shareTab).toBeInTheDocument();
    // 默认激活「本地备份」
    expect(localTab).toHaveAttribute('aria-selected', 'true');
    // 本地备份区内容渲染（导出数据按钮）
    expect(screen.getByRole('button', { name: '导出数据' })).toBeInTheDocument();

    // 切到「云端同步」
    await user.click(cloudTab);
    expect(cloudTab).toHaveAttribute('aria-selected', 'true');
    expect(localTab).toHaveAttribute('aria-selected', 'false');
  });
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `pnpm run test src/entrypoints/home/components/SettingsModal/__tests__/SettingsModal.test.tsx`
Expected: FAIL —— 测试 1 因找不到「数据维护」失败;新测试因「本地备份/云端同步/分享」子 tab 不存在(当前 backup pane 仍纵向堆 section)失败。

- [ ] **Step 3: 新建 BackupSyncTabs 组件**

Create `src/components/backup/BackupSyncTabs.tsx`:

```tsx
import { Tabs } from '@douyinfe/semi-ui';
import { LocalBackupSection } from './LocalBackupSection';
import { CloudBackupSection } from './CloudBackupSection';
import { ShareSection } from './ShareSection';

/**
 * 数据备份和同步 子 tabs（SettingsModal 的 backup pane 内）。
 *
 * 顶部 card 类型：与外层左 line 形成 纵/横 区分；与 CloudBackupSection 内部 s3/webdav
 * 的 line 形成层级区分（子级功能=card，服务商=line）。
 * keepDOM（默认 true，显式表意）：本地/云端/分享间切换保留各自状态（如云端表单输入）。
 */
export function BackupSyncTabs() {
  return (
    <Tabs type="card" keepDOM>
      <Tabs.TabPane tab="本地备份" itemKey="local">
        <LocalBackupSection />
      </Tabs.TabPane>
      <Tabs.TabPane tab="云端同步" itemKey="cloud">
        <CloudBackupSection />
      </Tabs.TabPane>
      <Tabs.TabPane tab="分享" itemKey="share">
        <ShareSection />
      </Tabs.TabPane>
    </Tabs>
  );
}
```

- [ ] **Step 4: 改 SettingsModal — backup pane 引用容器 + 新增数据维护 tab**

整文件替换 `src/entrypoints/home/components/SettingsModal/index.tsx`:

```tsx
import { Modal, Tabs } from '@douyinfe/semi-ui';
import { ShortcutsSection } from './sections/ShortcutsSection';
import { BackupSyncTabs } from '@/components/backup/BackupSyncTabs';
import { FaviconCacheSection } from './sections/FaviconCacheSection';
import { PasswordSection } from './sections/PasswordSection';
import { EncryptionTtlSection } from './sections/EncryptionTtlSection';

interface SettingsModalProps {
  visible: boolean;
  onCancel: () => void;
}

/**
 * 系统设置中心：左 Semi Tabs(type=line) 分类 + 右详情。
 * 四分区：快捷键 / 数据备份和同步（子 card tabs：本地·云端·分享）/ 数据维护（favicon）/ 主密码。
 *
 * Modal 浅色（Portal 到 body，与 home 浅色主体一致；design review dark scope 决议）。
 */
export function SettingsModal({ visible, onCancel }: SettingsModalProps) {
  return (
    <Modal
      title="系统设置"
      visible={visible}
      onCancel={onCancel}
      footer={null}
      width={720}
      bodyStyle={{
        maxHeight: '70vh',
        overflow: 'auto',
        // Semi Modal body 默认 padding:0，垂直间距靠各区域 marginY(24)；footer=null 时
        // 底部仅 body-wrapper marginBottom 撑开，内容易贴 Modal 底。显式补 paddingBottom（token）。
        paddingBottom: 'var(--space-xl)',
      }}
    >
      <Tabs type="line" tabPosition="left" keepDOM={false}>
        <Tabs.TabPane tab="快捷键" itemKey="shortcuts">
          <ShortcutsSection />
        </Tabs.TabPane>
        <Tabs.TabPane tab="数据备份和同步" itemKey="backup">
          <BackupSyncTabs />
        </Tabs.TabPane>
        <Tabs.TabPane tab="数据维护" itemKey="maintenance">
          <FaviconCacheSection />
        </Tabs.TabPane>
        <Tabs.TabPane tab="主密码" itemKey="password">
          <PasswordSection />
          <EncryptionTtlSection />
        </Tabs.TabPane>
      </Tabs>
    </Modal>
  );
}
```

注意:移除了原先直接 import 的 `LocalBackupSection`/`CloudBackupSection`/`ShareSection`(改由 `BackupSyncTabs` 引入);`FaviconCacheSection` 的 import 保留(改由「数据维护」pane 使用)。

- [ ] **Step 5: 运行测试,确认通过**

Run: `pnpm run test src/entrypoints/home/components/SettingsModal/__tests__/SettingsModal.test.tsx`
Expected: PASS —— 5 个测试全绿(原 4 个含更新后的测试 1 + 新增子 tab 测试)。

- [ ] **Step 6: typecheck + 全量测试双绿**

Run: `pnpm run typecheck`
Expected: 无错误退出。

Run: `pnpm run test`
Expected: 全部测试通过(确认未波及 backup section / store 的其他测试)。

- [ ] **Step 7: 提交**

```bash
git add src/components/backup/BackupSyncTabs.tsx src/entrypoints/home/components/SettingsModal/index.tsx src/entrypoints/home/components/SettingsModal/__tests__/SettingsModal.test.tsx
git commit -m "refactor(settings): 数据备份和同步拆为 card 子 tabs,favicon 移至数据维护 tab"
```
