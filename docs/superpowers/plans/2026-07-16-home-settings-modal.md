# Home Settings Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Home 页设置弹窗改为与主页视觉一致、可读性更高的宽幅双栏布局，同时保持全部设置行为不变。

**Architecture:** 继续由 `SettingsModal` 组合现有 shadcn/ui `Dialog` 与 vertical `Tabs`，只在弹窗外壳中增加标题说明和各分区的视觉标题。尺寸、滚动、导航选中态和响应式规则集中在现有 CSS Module；业务 section、共享 UI 封装和全局 token 均不修改。

**Tech Stack:** React 19、TypeScript、shadcn/ui（Base UI）、CSS Modules、Vitest、Testing Library、user-event

---

## 文件结构

- Modify: `src/entrypoints/home/components/SettingsModal/index.tsx` — 设置弹窗语义结构、标题说明和四个分区标题。
- Modify: `src/entrypoints/home/components/SettingsModal/index.module.css` — 宽幅尺寸、双栏布局、导航选中态、内容滚动和桌面窄视口适配。
- Modify: `src/entrypoints/home/components/SettingsModal/__tests__/SettingsModal.test.tsx` — 标题层级、说明、四个分类和默认分区的用户可见行为。

### Task 1: 以测试锁定弹窗的信息层级

**Files:**
- Modify: `src/entrypoints/home/components/SettingsModal/__tests__/SettingsModal.test.tsx`
- Test: `src/entrypoints/home/components/SettingsModal/__tests__/SettingsModal.test.tsx`

- [ ] **Step 1: 将首个渲染测试改为语义查询，并加入新层级断言**

把现有 `it('渲染「系统设置」标题 + 四 menu 项'...)` 替换为：

```tsx
it('打开弹窗 → 显示设置说明、四个分类和默认分区标题', async () => {
  render(<SettingsModal visible={true} onCancel={() => {}} />);
  await screen.findByRole('button', { name: /前往自定义/ });

  expect(screen.getByRole('heading', { name: '系统设置' })).toBeInTheDocument();
  expect(screen.getByText('管理快捷键、数据与安全选项')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '快捷键' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '数据备份和同步' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '数据维护' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: '主密码' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '快捷键', level: 2 })).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行定向测试，确认因说明和默认分区标题缺失而失败**

Run:

```bash
pnpm exec vitest run src/entrypoints/home/components/SettingsModal/__tests__/SettingsModal.test.tsx
```

Expected: FAIL，报告找不到文本 `管理快捷键、数据与安全选项` 或标题 `快捷键`；不得因测试环境、mock 或类型错误失败。

### Task 2: 实现宽幅双栏设置弹窗

**Files:**
- Modify: `src/entrypoints/home/components/SettingsModal/index.tsx`
- Modify: `src/entrypoints/home/components/SettingsModal/index.module.css`
- Test: `src/entrypoints/home/components/SettingsModal/__tests__/SettingsModal.test.tsx`

- [ ] **Step 1: 增加 Dialog 说明和四个分区标题**

将 `src/entrypoints/home/components/SettingsModal/index.tsx` 更新为：

```tsx
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BackupSyncTabs } from '@/components/backup/BackupSyncTabs';
import { ShortcutsSection } from './sections/ShortcutsSection';
import { PasswordSection } from './sections/PasswordSection';
import { EncryptionTtlSection } from './sections/EncryptionTtlSection';
import { FaviconCacheSection } from './sections/FaviconCacheSection';
import styles from './index.module.css';

interface SettingsModalProps {
  visible: boolean;
  onCancel: () => void;
}

/**
 * 系统设置中心：左侧分类导航 + 右侧设置详情。
 * 四分区：快捷键 / 数据备份和同步 / 数据维护 / 主密码。
 */
export function SettingsModal({ visible, onCancel }: SettingsModalProps) {
  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className={styles.dialogContent}>
        <DialogHeader className={styles.dialogHeader}>
          <DialogTitle className={styles.dialogTitle}>系统设置</DialogTitle>
          <DialogDescription className={styles.dialogDescription}>
            管理快捷键、数据与安全选项
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="shortcuts" orientation="vertical" className={styles.settingsTabs}>
          <TabsList variant="line" aria-label="设置分类" className={styles.settingsNav}>
            <TabsTrigger value="shortcuts">快捷键</TabsTrigger>
            <TabsTrigger value="backup">数据备份和同步</TabsTrigger>
            <TabsTrigger value="maintenance">数据维护</TabsTrigger>
            <TabsTrigger value="password">主密码</TabsTrigger>
          </TabsList>
          <TabsContent value="shortcuts" className={styles.settingsContent}>
            <header className={styles.sectionHeader}>
              <h2>快捷键</h2>
              <p>查看并管理浏览器扩展快捷键。</p>
            </header>
            <ShortcutsSection />
          </TabsContent>
          <TabsContent value="backup" className={styles.settingsContent}>
            <header className={styles.sectionHeader}>
              <h2>数据备份和同步</h2>
              <p>导出本地数据，或配置云端同步与分享。</p>
            </header>
            <BackupSyncTabs />
          </TabsContent>
          <TabsContent value="maintenance" className={styles.settingsContent}>
            <header className={styles.sectionHeader}>
              <h2>数据维护</h2>
              <p>清理并维护书签图标缓存。</p>
            </header>
            <FaviconCacheSection />
          </TabsContent>
          <TabsContent value="password" className={styles.settingsContent}>
            <header className={styles.sectionHeader}>
              <h2>主密码</h2>
              <p>管理主密码和加密内容的自动锁定策略。</p>
            </header>
            <PasswordSection />
            <EncryptionTtlSection />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: 用设计 token 落地尺寸、留白和 Home 式导航选中态**

将 `src/entrypoints/home/components/SettingsModal/index.module.css` 更新为：

```css
.dialogContent {
  width: min(920px, calc(100vw - 64px));
  max-width: 920px;
  height: min(640px, calc(100vh - 64px));
  max-height: 640px;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 0;
  overflow: hidden;
  padding: 0;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-elevated);
}

.dialogHeader {
  min-height: 88px;
  justify-content: center;
  gap: var(--space-xs);
  padding: var(--space-xl) var(--space-2xl);
  border-bottom: 1px solid var(--border);
}

.dialogTitle {
  font-size: var(--font-xl);
  font-weight: 600;
  line-height: 1.3;
}

.dialogDescription {
  color: var(--muted-foreground);
  font-size: var(--font-md);
  line-height: 1.5;
}

.settingsTabs {
  min-height: 0;
  height: 100%;
  gap: 0;
  overflow: hidden;
}

.settingsNav {
  width: 200px;
  flex: 0 0 200px;
  height: 100%;
  align-self: stretch;
  align-items: stretch;
  justify-content: flex-start;
  gap: var(--space-xs);
  padding: var(--space-xl) var(--space-lg);
  border-right: 1px solid var(--border);
  background: var(--background);
}

.settingsNav [data-slot='tabs-trigger'] {
  flex: none;
  height: 40px;
  justify-content: flex-start;
  padding: 0 var(--space-lg);
  border-radius: var(--radius-sm);
  color: var(--muted-foreground);
  font-size: var(--font-md);
}

.settingsNav [data-slot='tabs-trigger']:hover {
  color: var(--foreground);
  background: var(--muted);
}

.settingsNav [data-slot='tabs-trigger'][data-active] {
  color: var(--foreground);
  background: var(--muted);
  font-weight: 600;
}

.settingsNav [data-slot='tabs-trigger']::after {
  inset: var(--space-sm) auto var(--space-sm) 0;
  width: 3px;
  height: auto;
  border-radius: var(--radius-sm);
  background: var(--primary);
}

.settingsContent {
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: var(--space-xl) var(--space-2xl) var(--space-2xl);
  font-size: var(--font-lg);
  scrollbar-gutter: stable;
}

.sectionHeader {
  margin-bottom: var(--space-xl);
}

.sectionHeader h2 {
  margin: 0 0 var(--space-xs);
  font-size: var(--font-xl);
  font-weight: 600;
  line-height: 1.3;
}

.sectionHeader p {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-md);
  line-height: 1.5;
}

@media (max-width: 800px) {
  .dialogContent {
    width: calc(100vw - 32px);
    height: calc(100vh - 32px);
  }

  .dialogHeader {
    padding-inline: var(--space-xl);
  }

  .settingsNav {
    width: 176px;
    flex-basis: 176px;
    padding-inline: var(--space-md);
  }

  .settingsContent {
    padding-inline: var(--space-xl);
  }
}
```

- [ ] **Step 3: 运行定向测试，确认新旧行为全部通过**

Run:

```bash
pnpm exec vitest run src/entrypoints/home/components/SettingsModal/__tests__/SettingsModal.test.tsx
```

Expected: PASS，`SettingsModal.test.tsx` 全部测试通过，无新增 warning 或未处理 Promise。

- [ ] **Step 4: 提交结构与视觉实现**

```bash
git add src/entrypoints/home/components/SettingsModal/index.tsx src/entrypoints/home/components/SettingsModal/index.module.css src/entrypoints/home/components/SettingsModal/__tests__/SettingsModal.test.tsx
git commit -m "style(home): align settings modal with home"
```

### Task 3: 浏览器视觉验证与完整回归

**Files:**
- Verify: `src/entrypoints/home/components/SettingsModal/index.tsx`
- Verify: `src/entrypoints/home/components/SettingsModal/index.module.css`

- [ ] **Step 1: 启动 Home 开发环境并打开设置弹窗**

Run:

```bash
pnpm dev
```

Expected: WXT 开发服务器启动，Home 页面可访问；打开左侧底部“设置”后显示新的宽幅双栏弹窗。

- [ ] **Step 2: 在两个桌面视口执行视觉检查**

使用真实浏览器分别检查 `1440 × 900` 和 `1024 × 768`：

- 弹窗在视口内完整显示，页面无横向滚动。
- 标题区、左侧导航和右侧内容边界清晰，文字无重叠或截断。
- 左侧当前分类使用 3px 品牌绿竖条、中性底和加重文字。
- 切换四个分类时弹窗外壳不跳动，只有右侧内容区按需滚动。
- 备份子 Tabs、按钮、输入和说明内容保持可用。

若任一检查失败，只调整 `index.module.css` 中对应布局规则；每次调整后重新运行 Task 2 Step 3 的定向测试。

- [ ] **Step 3: 执行完整类型和测试验证**

Run:

```bash
pnpm run typecheck
pnpm run test
pnpm run lint
```

Expected: 三条命令均以 exit code 0 结束；不得新增 lint warning。

- [ ] **Step 4: 检查最终改动范围**

Run:

```bash
git status --short
git diff --check
git diff HEAD~1 -- src/entrypoints/home/components/SettingsModal
```

Expected: 生产代码改动仅限 `SettingsModal/index.tsx` 与 `index.module.css`，测试改动仅限 `SettingsModal.test.tsx`；无空白错误和无关格式化。
