# 商店渠道更新入口重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 商店渠道(cws/edge)检测到新版时，「关于」面板把无用的「前往商店」按钮替换为「立即更新」(`requestUpdateCheck`→`reload`)，并常驻一个跳 `chrome://extensions` 的手动兜底链接。

**Architecture:** 纯 UI 层单文件改动。`AboutSection` 顶层构造 `triggerUpdate`（先 `requestUpdateCheck` 后 `reload`，检查结果忽略）传入 `UpdateStatus` 子组件；商店+pending 分支渲染主按钮 + 次要链接。更新闭环复用现有 `background.ts` 的 `onInstalled(update)→clearPendingUpdate`，零改动。

**Tech Stack:** React + TypeScript + shadcn/ui Button + Vitest + @testing-library/react + userEvent

## Global Constraints

- 语言：代码注释、日志、测试 `it()` 描述强制中文。
- 包管理器：`pnpm`（非 npm）。typecheck = `pnpm run typecheck`（不含 wxt prepare，`.wxt` 由 dev 生成）。测试 = `pnpm run test`（vitest）。
- 测试规范：不整体 mock UI 组件；仅 mock 副作用边界（此处为 `chrome.runtime`）。query 用 `getByRole`/`getByText`/`findBy*`，禁用私有 testid；交互用 `userEvent`；断言用 jest-dom matcher（`toBeInTheDocument()` 等）。
- 外科手术式：只动 `AboutSection.tsx` 与其测试；`background.ts`、`UpdateStore.ts`、`distribution.ts` 不动。

## File Structure

- **Modify** `src/entrypoints/home/components/SettingsModal/sections/AboutSection.tsx`
  - 职责：`UpdateStatus` 子组件渲染更新提示的三态（manual / 商店+pending / 商店无 pending）。本次改「商店+pending」分支。
  - 改动点：(a) `ChromeLike` 接口加 `requestUpdateCheck`/`reload`；(b) 顶层加常量 `EXTENSIONS_PAGE_URL` 与 `triggerUpdate`；(c) `UpdateStatus` 加 `onUpdate` prop；(d) 商店+pending 分支 JSX 改主按钮 + 次要链接。
- **Modify** `src/entrypoints/home/components/SettingsModal/sections/__tests__/AboutSection.test.tsx`
  - 职责：`AboutSection` 渲染与交互测试。本次改 `setupChrome` mock + 改写「CWS+pending」用例并新增。

不创建新文件。

---

### Task 1: TDD 改写商店渠道更新入口

**Files:**
- Modify: `src/entrypoints/home/components/SettingsModal/sections/__tests__/AboutSection.test.tsx`
- Modify: `src/entrypoints/home/components/SettingsModal/sections/AboutSection.tsx`

**Interfaces:**
- Consumes: 现有 `Channel`（`@/shared/distribution`）、`usePendingUpdate`（`@/entrypoints/home/hooks/usePendingUpdate`）、shadcn `Button`（`@/components/ui/button`）、`UPDATE_URL`（仅 `manual` 分支继续用 `UPDATE_URL.manual`）。
- Produces: 无新增导出符号（`triggerUpdate`/`EXTENSIONS_PAGE_URL` 为模块内部）。

- [ ] **Step 1: 扩展 `setupChrome` 加 `requestUpdateCheck`/`reload` mock**

在 `src/entrypoints/home/components/SettingsModal/sections/__tests__/AboutSection.test.tsx`，把 `setupChrome` 替换为下面这版（在 `chromeObj.runtime` 上补两个方法，返回值多返回这两个 fn）：

```tsx
function setupChrome(opts: { id?: string; version?: string; pending?: { version: string } }) {
  const tabsCreate = vi.fn();
  const requestUpdateCheck = vi.fn().mockResolvedValue({ status: 'update_available' });
  const reload = vi.fn();
  installChromeStorageLocal({
    initial: opts.pending ? { pendingUpdate: opts.pending } : {},
  });
  const chromeObj = (globalThis as { chrome?: Record<string, unknown> }).chrome!;
  chromeObj.runtime = {
    id: opts.id ?? 'unknownid',
    getManifest: () => ({ version: opts.version ?? '0.1.13.0' }),
    requestUpdateCheck,
    reload,
  };
  chromeObj.tabs = { create: tabsCreate };
  (chromeObj.storage as Record<string, unknown>).onChanged = {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  };
  return { tabsCreate, requestUpdateCheck, reload };
}
```

- [ ] **Step 2: 改写「CWS+pending」用例并新增三个用例**

删除现有的「CWS 渠道有 pending → 显示新版本提示 + 前往商店按钮」用例，替换为下面四个用例（插在 manual 两个用例之后、`describe` 闭合之前）：

```tsx
  it('CWS 渠道有 pending → 显示立即更新按钮 + 扩展管理页兜底链接', async () => {
    setupChrome({
      id: CWS_EXTENSION_ID,
      pending: { version: '0.1.14.0' },
    });
    render(<AboutSection />);
    expect(await screen.findByText(/新版本 v0\.1\.14\.0 可用/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即更新' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /扩展管理页/ })).toBeInTheDocument();
  });

  it('CWS 渠道点立即更新 → requestUpdateCheck 后 reload', async () => {
    const user = userEvent.setup();
    const { requestUpdateCheck, reload } = setupChrome({
      id: CWS_EXTENSION_ID,
      pending: { version: '0.1.14.0' },
    });
    render(<AboutSection />);
    await user.click(await screen.findByRole('button', { name: '立即更新' }));
    expect(requestUpdateCheck).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    // 先 check 后 reload
    expect(requestUpdateCheck.mock.invocationCallOrder[0]).toBeLessThan(
      reload.mock.invocationCallOrder[0],
    );
  });

  it('requestUpdateCheck 抛异常仍 reload（pendingUpdate 已证明有更新）', async () => {
    const user = userEvent.setup();
    const { requestUpdateCheck, reload } = setupChrome({
      id: CWS_EXTENSION_ID,
      pending: { version: '0.1.14.0' },
    });
    requestUpdateCheck.mockRejectedValueOnce(new Error('boom'));
    render(<AboutSection />);
    await user.click(await screen.findByRole('button', { name: '立即更新' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('CWS 渠道点扩展管理页链接 → tabs.create(chrome://extensions)', async () => {
    const user = userEvent.setup();
    const { tabsCreate } = setupChrome({
      id: CWS_EXTENSION_ID,
      pending: { version: '0.1.14.0' },
    });
    render(<AboutSection />);
    await user.click(await screen.findByRole('button', { name: /扩展管理页/ }));
    expect(tabsCreate).toHaveBeenCalledWith({ url: 'chrome://extensions' });
  });
```

> 注意：原文件 `import { CWS_EXTENSION_ID, UPDATE_URL } from '@/shared/distribution';` 中 `UPDATE_URL` 仍被 manual 分支用例 `tabs.create({ url: UPDATE_URL.manual })` 引用，保留 import 不动。

- [ ] **Step 3: 运行测试，验证全部失败（红）**

Run: `pnpm run test -- AboutSection`
Expected: 4 个用例失败——找不到 `立即更新` 按钮（现仍是「前往商店」）、`requestUpdateCheck`/`reload` 未被调用、找不到 `扩展管理页` 链接。其余既有用例（版本号、渠道标签、manual）应仍通过。

- [ ] **Step 4: 实现 `AboutSection.tsx` 改动（4 处）**

在 `src/entrypoints/home/components/SettingsModal/sections/AboutSection.tsx`：

(a) `ChromeLike` 接口加两个方法（替换现有 interface 块）：

```tsx
interface ChromeLike {
  runtime: {
    id: string;
    getManifest(): { version: string };
    requestUpdateCheck(): Promise<unknown>;
    reload(): void;
  };
  tabs: { create(opts: { url: string }): unknown };
}
```

(b) 常量区（`DISCUSS_URL` 之后）加一行：

```tsx
/** 商店更新兜底：手动到扩展管理页点「更新」。 */
const EXTENSIONS_PAGE_URL = 'chrome://extensions';
```

(c) `AboutSection` 函数体内，`const open = ...` 之后、`return` 之前，加 `triggerUpdate`，并把 `UpdateStatus` 调用补 `onUpdate`：

```tsx
  const open = (url: string) => c.tabs.create({ url });

  // pendingUpdate 存在即证明有更新；requestUpdateCheck 结果（throttled/异常）一律忽略。
  const triggerUpdate = async () => {
    try {
      await c.runtime.requestUpdateCheck();
    } catch {
      // 忽略：不依赖检查结果
    }
    c.runtime.reload();
  };

  return (
    <div className="space-y-4">
      {/* ... 版本/渠道/链接行不变 ... */}
      <UpdateStatus
        channel={channel}
        pendingVersion={pendingVersion}
        onOpen={open}
        onUpdate={triggerUpdate}
      />
    </div>
  );
```

(d) `UpdateStatus` 子组件：签名加 `onUpdate`，把「商店+pending」分支替换为主按钮 + 次要链接（manual 分支与「已是最新」分支保持不变）：

```tsx
function UpdateStatus({
  channel,
  pendingVersion,
  onOpen,
  onUpdate,
}: {
  channel: Channel;
  pendingVersion: string | null;
  onOpen: (url: string) => void;
  onUpdate: () => void;
}) {
  // 手动安装：无自动更新（onUpdateAvailable 不触发），引导 Releases（优先级最高）
  if (channel === 'manual') {
    return (
      <div className="rounded-md border border-border p-3 text-sm">
        <div className="text-muted-foreground">
          手动安装不会收到自动更新提示，请定期查看新版本。
        </div>
        <Button className="mt-2" size="sm" onClick={() => onOpen(UPDATE_URL.manual)}>
          前往 GitHub Releases
        </Button>
      </div>
    );
  }
  // 商店用户收到 Chrome 推送的待装版本
  if (pendingVersion) {
    return (
      <div className="rounded-md border border-border p-3 text-sm">
        <div>新版本 v{pendingVersion} 可用</div>
        <div className="mt-1 text-muted-foreground">
          新版本将通过商店自动更新（审核可能有延迟）。
        </div>
        <Button className="mt-2" size="sm" onClick={onUpdate}>
          立即更新
        </Button>
        <div className="mt-1 text-muted-foreground">
          未生效？在
          <Button
            variant="link"
            className="h-auto px-1 py-0 align-baseline text-muted-foreground"
            onClick={() => onOpen(EXTENSIONS_PAGE_URL)}
          >
            扩展管理页
          </Button>
          手动更新（开发者模式 → 更新）
        </div>
      </div>
    );
  }
  // 商店用户无待装版本：已是最新（商店自动更新）
  return <div className="text-sm text-muted-foreground">已是最新版本（商店自动更新）。</div>;
}
```

- [ ] **Step 5: 运行测试，验证全部通过（绿）**

Run: `pnpm run test -- AboutSection`
Expected: 8 个用例全部 PASS（版本号、CWS 渠道标签、manual 标签、manual→Releases、CWS+pending 渲染、立即更新→check+reload、check 异常仍 reload、扩展管理页链接）。

- [ ] **Step 6: typecheck**

Run: `pnpm run typecheck`
Expected: 无错误（`ChromeLike` 扩展后 `requestUpdateCheck`/`reload` 类型齐全；`onUpdate` prop 传递类型匹配）。

- [ ] **Step 7: 提交**

```bash
git add src/entrypoints/home/components/SettingsModal/sections/AboutSection.tsx \
        src/entrypoints/home/components/SettingsModal/sections/__tests__/AboutSection.test.tsx
git commit -m "feat: 商店渠道更新入口改为立即更新(reload)+扩展管理页兜底"
```

---

## 真机 QA（实现与单测通过后，手动）

非编码步骤，供发布前人工验证（不阻塞 commit）：

1. 构造商店更新提示：装一个略旧版本（或 dev 下用 `onUpdateAvailable` 触发并存 `pendingUpdate`），使 home「关于」面板显示「新版本 vX 可用」。
2. 确认主按钮文案为「立即更新」，下方有「未生效？在扩展管理页手动更新」链接。
3. 点「立即更新」→ 扩展 reload → 重开「关于」面板：若更新已应用，应显示「已是最新版本」；版本号应更新。
4. 点「扩展管理页」链接 → 新标签打开 `chrome://extensions`（验证 chrome:// 可被扩展打开）。

## Self-Review

**1. Spec coverage:**
- 商店+pending 主按钮 `requestUpdateCheck`+`reload` → Task 1 Step 4(c)(d)，测试 Step 2 用例 2、3。✓
- 常驻次要链接跳 `chrome://extensions` → Task 1 Step 4(d)，测试 Step 2 用例 4。✓
- 保留说明文「将通过商店自动更新」→ Step 4(d)。✓
- `manual` 渠道不动 → Step 4(d) 注释 + 测试用例保留。✓
- 「已是最新」不动 → Step 4(d)。✓
- `UPDATE_URL` 不动 → Step 2 注释保留 import；manual 用例继续用。✓
- `background.ts`/`UpdateStore` 零改动 → Global Constraints + Architecture 声明，无对应 task（本就零改动）。✓
- 错误处理（throttled/异常忽略后仍 reload）→ Step 2 用例 3 + Step 4(c) try/catch。✓

**2. Placeholder scan:** 无 TBD/TODO；每个代码 step 含完整代码；测试含完整断言。✓

**3. Type consistency:** `ChromeLike.runtime.requestUpdateCheck(): Promise<unknown>` / `reload(): void` 与测试 mock（`mockResolvedValue`/`vi.fn()`）一致；`onUpdate: () => void` 在父 `triggerUpdate`（async 但调用方不 await，兼容 `() => void`）与子组件签名一致；`EXTENSIONS_PAGE_URL` 常量名在实现与文档引用一致。✓
