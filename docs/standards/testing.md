# 测试设计规范（Testing Standard）

> 适用技术栈：**Vitest 4 + @testing-library/react 16 + jsdom 29 + Semi Design + WXT (Chrome MV3)**。
> 本规范基于 [Kent C. Dodds 的 Testing Trophy](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications) 与 [“Don't Mock What You Don't Own”](https://hynek.me/articles/what-to-mock-in-5-mins/) 原则，针对本项目现状裁剪。
> 所有 PR 涉及测试代码时，以本规范为准绳。规范冲突时，以「核心原则」为准。

---

## 0. 谁该读 / 何时读

- **写新测试前**：先读 §2 核心原则 + §4 组件测试规范。
- **Review 测试 PR 时**：用 §12 速查表做 checklist。
- **重构 / 迁移组件库时**：读 §3 分层策略，确认测试是否仍有效。
- **新增依赖、改测试基建时**：读 §9 基建配置。

---

## 1. 本规范要解决的问题

项目当前 63 个测试文件，整体质量不错，但存在三类**会导致“测试假过”**的系统性隐患：

| 隐患 | 现状 | 后果 |
|---|---|---|
| **手写 mock 整个 Semi 组件库** | 4 个文件用 `vi.mock('@douyinfe/semi-ui', () => ({ Modal: ..., Input: ... }))` 手写无类型桩 | 测试断言的是 mock 的 props 契约，不是真实组件行为。同事改 Semi 组件用法、改 prop 名字，测试照过 → 假过 |
| **缺 jest-dom 语义断言** | `tests/setup.ts` 只 import RTL，未配 jest-dom；全项目 `toBeInTheDocument` 使用 0 次 | 只能用 `.toBeTruthy()` 这类弱断言，断言不到「可见性 / DOM 语义」 |
| **全项目用 fireEvent，未装 user-event** | 23 文件用 `fireEvent`，0 文件用 `userEvent` | `fireEvent` 是裸事件派发，跳过浏览器真实事件序列（focus/blur/键盘组合），交互断言不真实 |

此外 query 风格分裂（`getByRole` 11 文件 vs `fireEvent` 23 文件），无统一标准。本规范的目的就是把这三类隐患和风格分裂**用规则钉死**。

---

## 2. 核心原则（五条，按优先级）

### 原则 1：测用户行为，不测实现细节

> 测试应该回答「用户这样做，会发生什么」，而不是「代码内部调用了哪个函数」。

用户看不到 state、看不到内部函数、看不到 testid。测试也应尽量不看这些。**好的测试在重构后不需要改动**——只要用户可见的行为没变，测试就该继续过。如果一次纯重构（不改行为）让你的测试红了，说明测试耦合了实现，是测试的 bug。

### 原则 2：不 mock 你不拥有的东西

> 原则出处：[Don't Mock What You Don't Own](https://hynek.me/articles/what-to-mock-in-5-mins/)。

**`@douyinfe/semi-ui` 不许整体手写 mock。** Semi 是第三方组件库，它的契约（props、行为、a11y）由它自己定义。你手写的 mock 是你对它契约的**猜测**——一旦猜测与真实库脱节，测试就在测一个不存在的世界。

Semi 在 jsdom 下可以真实渲染，没有理由整体 mock 它。详见 §4。

### 原则 3：只 mock「副作用边界」，不 mock「纯计算」

mock 的唯一合法理由是**隔离副作用，让测试快、稳、确定**。本项目合法的 mock 边界（白名单）：

| 该 mock（副作用边界） | 不该 mock（被测对象 / 纯计算） |
|---|---|
| `chrome.*` 扩展 API（tabs / storage.session / runtime） | Semi 组件（`Modal/Input/Button/...`） |
| IndexedDB —— 用 `fake-indexeddb`（已采用） | 你自己的纯函数 service（`CryptoService` 的 `encrypt/decrypt` 等） |
| 网络（`fetch` / OSS / COS SDK） | 你自己的组件（除非满足 §4.3 浅渲染条件） |
| 全局副作用：`Toast`（portal + 动画）、`lottie-web`、`BroadcastChannel` | store / hook 的业务逻辑 |
| `Date.now()` / `Math.random()`（非确定性来源） | |

**判定标准**：被 mock 的东西必须是「与外部世界交互、且不可控或慢」的。纯函数、你自己写的组件，默认不 mock。

### 原则 4：query 用「用户感知语义」，禁用 mock 私有 testid

按 [Testing Library 查询优先级](https://testing-library.com/docs/queries/about/#priority) 从上到下选：

1. **`getByRole` / `getByLabelText` / `getByPlaceholderText`** —— 首选，反映用户与 a11y 树的交互
2. **`getByText` / `getByDisplayValue`** —— 次选，反映用户看到的内容
3. **`getByTestId`** —— **兜底**，仅当上面都不适用时用，且 testid 必须打在**生产代码**上（如 `data-testid="bookmark-card"`），**绝不打在 mock 桩上**

```ts
// ✅ 好：query 用户能看到的东西
await screen.findByPlaceholderText(/密码/)
await screen.findByRole('button', { name: /解锁|确认/ })
await screen.findByText('密码错误')

// ❌ 坏：query 的是 mock 桩里的私有 testid，真实组件根本没有
screen.getByTestId('pwd-input') // 这个 testid 只存在于手写 mock 里
```

### 原则 5：用 `user-event`，不用 `fireEvent`

`fireEvent` 是裸事件，跳过浏览器的真实事件链。`userEvent.type` 会真实模拟 keydown → keypress → input → keyup，触发组件内部的受控逻辑、校验、副作用。**本项目所有组件交互测试必须用 `user-event`。**

```ts
// ✅ 好
const user = userEvent.setup();
await user.type(screen.getByPlaceholderText(/密码/), 'right-pwd');
await user.click(screen.getByRole('button', { name: /确认/ }));

// ❌ 坏（除非有明确理由）
fireEvent.change(screen.getByTestId('pwd-input'), { target: { value: 'right-pwd' } });
fireEvent.click(screen.getByTestId('submit'));
```

> 例外：测试需要精确控制某个底层事件（如测 `onKeyDown` 的特定 `keyCode`）时，可保留 `fireEvent`，并在注释说明理由。

---

## 3. 测试分层策略

采用 Testing Trophy，**投资回报率：静态 > 集成 > 单元 > E2E**（集成层最厚）。

```
        ▲ E2E        —— 少量，关键链路（解锁 → 看密文、备份导入导出）
       ▲▲▲ 集成      —— 主力，组件 + store + service 真实协作
      ▲▲▲▲▲ 单元     —— 纯函数 / 工具 / service 核心算法（加密、匹配、分组）
   ▲▲▲▲▲▲▲▲ 静态    —— TypeScript + ESLint（CI 强制，0 成本）
```

### 本项目分层映射

| 层 | 测什么 | 现状标杆 | mock 用什么 |
|---|---|---|---|
| **单元** | `src/shared/utils`、`src/.../utils`（emoji、url、markdown、grouping）、service 纯函数 | `tests/utils/markdown.test.ts`、`src/services/__tests__/CryptoService.test.ts` | 仅 mock 非确定性（`Date`/`random`） |
| **集成（组件）** | React 组件 + 它调用的 hook / store / service | `src/newtab/components/ContextList/__tests__/ContextList.test.tsx`（mock 数据源 `ContextService`，渲染真实 `ContextList`） | mock 数据源 / chrome API / Toast / lottie；**不 mock Semi** |
| **集成（store/hook）** | zustand store、自定义 hook 的状态流转 | `src/store/__tests__/useCrypto.test.ts` | mock service 层副作用 |
| **E2E** | 用户真实路径 | 暂缺（后续 Playwright 引入时补） | 不 mock，真实扩展环境 |

**关键比例**：集成测试应占 60-70%，单元 20-30%，E2E < 10%。当前项目组件测试偏少且部分被 mock 化，目标是把组件集成层做厚。

---

## 4. 组件测试规范（重点）

问题集中在这里。下面是硬规则。

### 4.1 必须

1. **真实渲染被测组件**，不 mock 它。
2. **真实渲染 Semi 组件库**，不做整体 `vi.mock('@douyinfe/semi-ui')`。
3. query 用 `getByRole` / `getByText` / `getByPlaceholderText`（§2 原则 4）。
4. 交互用 `userEvent`（§2 原则 5）。
5. 异步用 `findBy*` / `waitFor`，不用裸 `getBy*` + 同步断言。
6. 断言用 jest-dom 语义 matcher（`toBeInTheDocument()` / `toBeVisible()` / `toBeDisabled()`），不用 `.toBeTruthy()`。

### 4.2 禁止

1. ❌ 手写 mock 整个 `@douyinfe/semi-ui`。
2. ❌ query 一个**只存在于 mock 里**的 `data-testid`。
3. ❌ 用 `fireEvent` 模拟用户输入/点击（除非有注释说明的例外）。
4. ❌ 在组件测试里断言「内部函数被调用」而非「用户看到的结果」（如 `expect(internalHandler).toHaveBeenCalled()`）——除非该函数就是被测契约本身（如调外部 service）。
5. ❌ 用快照测试（`toMatchSnapshot`）覆盖组件渲染——它脆且不验证行为，仅文本/数据结构场景可用。

### 4.3 何时允许 mock 自己的子组件（浅渲染）

默认不 mock 自己的组件。**仅当**同时满足以下两条时，可把子组件 mock 成 stub：

- 子组件**已有独立的测试覆盖**；
- 子组件带入了会污染当前测试的重依赖（动画、网络、复杂 portal）。

且 stub 必须是「占位」而非「假装实现了行为」：

```ts
// ✅ 可接受：子组件已独立测试，这里只隔离其重依赖
vi.mock('@/newtab/components/ContextEditor', () => ({ ContextEditor: () => null }));

// ❌ 不可接受：用 mock 假装子组件的交互行为（这是在编造契约）
vi.mock('@/components/Foo', () => ({ Foo: ({ onSubmit }) => (
  <button onClick={() => onSubmit({ id: 'fake' })}>fake</button>
) }));
```

### 4.4 Toast / portal 类副作用：用 partial mock

`Toast` 涉及 portal + 动画 + 全局副作用，是合法的边界 mock。但必须用 **partial mock（`importActual`）保留其余 Semi 组件真实**，且 mock 对象要保持类型：

```ts
// ✅ 正确：只替换 Toast，Modal/Input/Button 走真实 Semi
vi.mock('@douyinfe/semi-ui', async (importActual) => {
  const actual = await importActual<typeof import('@douyinfe/semi-ui')>();
  return {
    ...actual,
    Toast: { ...actual.Toast, success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  };
});
```

### 4.4.1 ⚠️ lottie-web：Semi barrel 的隐藏依赖（实测必读）

`@douyinfe/semi-ui` 的 barrel（`lib/es/index.js`）静态 `re-export ./lottie`，链路 foundation 顶层 `import lottie from 'lottie-web'`，而 lottie-web 模块求值时跑 `canvas.getContext('2d').fillStyle`——**jsdom 无 canvas，模块评估期直接崩**（`TypeError: Cannot set properties of null`）。

这意味着上面的 partial mock 用 `importActual()` 求值整个 barrel 时会触发 lottie-web 崩溃，**任何真实渲染 Semi 的测试都在 import 阶段炸**（0 test run）。

**实测纠正：** lottie-web **不能**用 `tests/setup.ts` 里的 `vi.mock` 全局处理——vi.mock 的 hoisting 不跨 setup→测试文件的 import 图，不拦截 barrel 求值（已实测失败）。必须用 **`vitest.config.ts` 的 `resolve.alias`** 把 `lottie-web` 全局指向一个 stub：

```ts
// vitest.config.ts
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    alias: { 'lottie-web': fileURLToPath(new URL('./tests/stubs/lottie-web.ts', import.meta.url)) },
  },
  // ...
});
```

```ts
// tests/stubs/lottie-web.ts —— 空实现；真实渲染 Semi 不触发 Lottie 播放，足够
export default {
  loadAnimation: () => ({ destroy() {}, play() {}, pause() {}, addEventListener() {}, removeEventListener() {} }),
  destroy() {},
  registerAnimation() {},
};
```

配好后，**测试文件里不需要也不应该再 `vi.mock('lottie-web')`**——全局已处理。`tests/spike-semi-jsdom.test.tsx` 实证此方案。

> 历史背景：旧的整体 mock 文件中，2 个（App.test / InlineContextEditor）的注释早已精确描述此根因——它们当初整体 mock Semi 正是为躲 lottie 崩。现在 alias 全局解决，整体 mock 不再需要。

### 4.5 正反例：`SidePanelUnlockModal`

**反例（当前现状，禁止）**：

```ts
// src/entrypoints/sidepanel/components/__tests__/SidePanelUnlockModal.test.tsx
// ❌ 整体手写 mock，query 耦合 mock 私有 testid，用 fireEvent
vi.mock('@douyinfe/semi-ui', () => ({
  Modal: ({ children, visible }) => (visible ? <div data-testid="modal">{children}</div> : null),
  Input: (props) => <input data-testid="pwd-input" value={props.value ?? ''} onChange={(e) => props.onChange(e.target.value)} />,
  Button: ({ children, onClick }) => <button data-testid="submit" onClick={onClick}>{children}</button>,
}));
// 测试里：screen.getByTestId('pwd-input') —— 真实 Semi 根本没这个 testid，假过温床
```

**正例（合规重写）**：

```tsx
// src/entrypoints/sidepanel/components/__tests__/SidePanelUnlockModal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// 只 mock 副作用边界：Toast（portal）+ unlock（派生/网络）
vi.mock('@douyinfe/semi-ui', async (importActual) => {
  const actual = await importActual<typeof import('@douyinfe/semi-ui')>();
  return { ...actual, Toast: { ...actual.Toast, success: vi.fn(), error: vi.fn() } };
});
vi.mock('@/services/UnlockSession', () => ({ unlock: vi.fn() }));

import { SidePanelUnlockModal } from '../SidePanelUnlockModal';
import { unlock } from '@/services/UnlockSession';
import { Toast } from '@douyinfe/semi-ui';

describe('SidePanelUnlockModal — sidepanel 解锁弹窗', () => {
  beforeEach(() => vi.clearAllMocks());

  it('正确密码 → 调 unlock + Toast 成功 + 关闭', async () => {
    const user = userEvent.setup();
    vi.mocked(unlock).mockResolvedValue(true);
    const onClose = vi.fn();
    render(<SidePanelUnlockModal open={true} onClose={onClose} />);

    await user.type(screen.getByPlaceholderText(/密码|输入/), 'right-pwd');
    await user.click(screen.getByRole('button', { name: /确|解锁|提交/ }));

    expect(unlock).toHaveBeenCalledWith('sidepanel', 'right-pwd');
    expect(Toast.success).toHaveBeenCalledWith('已解锁');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('错误密码 → 显示「密码错误」，不关闭', async () => {
    const user = userEvent.setup();
    vi.mocked(unlock).mockResolvedValue(false);
    const onClose = vi.fn();
    render(<SidePanelUnlockModal open={true} onClose={onClose} />);

    await user.type(screen.getByPlaceholderText(/密码|输入/), 'wrong');
    await user.click(screen.getByRole('button', { name: /确|解锁|提交/ }));

    expect(await screen.findByText('密码错误')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

**这版消灭了所有假过路径**：换 Semi 组件、改 prop 名、换交互路径，真实组件都会暴露问题。

---

## 5. Hook 测试规范

自定义 hook（`useCrypto`、`useEncryptedContexts` 等）用 `@testing-library/react` 的 `renderHook`：

```ts
import { renderHook, act } from '@testing-library/react';

const { result } = renderHook(() => useEncryptedContexts('host'));

// 触发状态变更必须包在 act 内
await act(async () => { await result.current.refresh(); });

expect(result.current.contexts).toHaveLength(2);
```

规则：
- hook 内部调用的 service 副作用可 mock；hook 自身的状态逻辑不 mock。
- 测「hook 返回值随输入/动作的变化」，不测 hook 内部实现。
- 涉及 `useEffect` 的异步，用 `waitFor` + `act`，不要靠 `setTimeout` 猜时序。

---

## 6. Service / 纯逻辑测试规范

这是项目当前**最健康**的层，标杆是 `src/services/__tests__/CryptoService.test.ts`：

- 用 `fake-indexeddb` 跑真实 DB 往返，不 mock 被测的加密逻辑。
- 每个 `it` 测**一个可观察行为**（加密后解密回原文、IV 每次不同、空输入抛错）。
- `beforeEach` 重置 DB 和 key，测试相互独立。

规则：
- 测纯函数：输入 → 输出 + 边界 + 错误路径，**不 mock 被测函数本身**。
- 测有副作用的 service（DB、网络）：mock 最底层边界（`fake-indexeddb` / `fetch`），上层逻辑真实跑。
- 加密 / 匹配 / 分组这类核心算法，必须有「正常值 + 边界值 + 对抗输入」三类用例。

---

## 7. 命名与结构约定

- **文件位置**：被测代码的 `__tests__/` 目录下，文件名 `<被测名>.test.ts(x)`。已统一，保持。
- **`describe` 标题**：中文，写「被测对象 + 场景」，如 `'SidePanelUnlockModal — sidepanel 解锁弹窗'`。
- **`it` 标题**：中文，写「条件 → 可观察结果」，如 `'错误密码 → 显示「密码错误」，不关闭'`。读 `it` 标题就该像一句需求。
- **一个 `it` 测一件事**。断言可以多个，但都服务于同一个行为。
- **AAA 结构**：Arrange（准备）→ Act（`user` 动作）→ Assert。用空行分隔，别堆成一坨。

---

## 8. 何时该写测试 / 何时不必

**必须写：**
- 核心算法（加密往返、URL 匹配、分组、导入导出）。
- 用户交互链路（解锁、创建/删除书签、加密上下文编辑）。
- 有分支的关键逻辑（错误处理、边界条件、权限/锁定态）。
- bug 修复 —— 先写复现测试，再修（TDD）。

**不必写 / 慎写：**
- 纯展示组件且无交互（一个只渲染 props 的 `<Card>`）——价值低。
- 第三方组件的包装层，若无自定义逻辑 ——交给组件库自己的测试。
- 常量、类型定义、纯配置。
- 不要为「覆盖率数字」写无意义测试。覆盖率是副产品，不是目标。

> Kent C. Dodds：**“Write tests. Not too many. Mostly integration.”** 宁可少而精，覆盖关键路径，也不要多而脆。

---

## 9. 测试基建配置（落地要求）

### 9.1 `tests/setup.ts`（必须补全）

实际内容（已落地）：jest-dom + cleanup + jsdom 缺失 API 的 polyfill。

```ts
// tests/setup.ts
import '@testing-library/react';
import '@testing-library/jest-dom/vitest'; // 启用 toBeInTheDocument / toBeVisible / toBeDisabled ...
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom 缺 ResizeObserver / IntersectionObserver，Semi 的 TextArea(autosize)/Collapse 等
// 组件在 layout effect 里调用它们。补全为空操作 polyfill，让真实渲染在 jsdom 下不崩。
// 这是环境补全，不是 mock 任何被测组件或 Semi 行为。
class ResizeObserverPolyfill { observe() {} unobserve() {} disconnect() {} }
class IntersectionObserverPolyfill {
  observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
}
if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverPolyfill;
}
if (!('IntersectionObserver' in globalThis)) {
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IntersectionObserverPolyfill;
}

afterEach(() => cleanup());
```

> 依赖：`@testing-library/jest-dom`（devDependency）。

### 9.1.1 lottie-web 全局 alias（必读，见 §4.4.1）

Semi barrel 静态依赖 lottie-web，jsdom 模块评估期崩。**不**在 setup.ts 用 vi.mock（实测无效），而在 `vitest.config.ts` 用 `resolve.alias` 指向 `tests/stubs/lottie-web.ts`。详见 §4.4.1。

### 9.2 `user-event`（必须安装）

```bash
pnpm add -D @testing-library/user-event
```

### 9.3 ESLint 强制（推荐）

装 `eslint-plugin-testing-library` + `eslint-plugin-vitest`，启用推荐规则。关键规则：

- `testing-library/no-container` —— 禁止直接操作 container
- `testing-library/no-node-access` —— 禁止 `querySelector`
- `testing-library/prefer-screen-queries` —— 强制用 `screen`
- `testing-library/no-wait-for-side-effects` —— `waitFor` 内不放副作用
- `testing-library/prefer-user-event` —— **强制 user-event 替代 fireEvent**（钉死原则 5）

### 9.4 CI 强制 typecheck（必须）

`vi.mock` 工厂是无类型的，是类型保护的最大漏洞。CI 必须在跑测试前先过类型：

```jsonc
// package.json scripts
"typecheck": "tsc --noEmit"
```

CI workflow：`pnpm run typecheck && pnpm run test`。这一条独立于其他所有规则，**零争议纯收益**，必须先落地。

---

## 10. 落地路线图

按优先级执行，每步独立可交付：

1. **【基建，立刻】** 补 `tests/setup.ts`（jest-dom + cleanup）+ 安装 `user-event` + 加 `typecheck` script 与 CI gate。
2. **【消除假过，本周】** 按 §4.5 正例，重写 4 个手写 mock 文件：
   - `src/entrypoints/sidepanel/components/__tests__/SidePanelUnlockModal.test.tsx`
   - `src/entrypoints/sidepanel/components/__tests__/InlineContextEditor.test.tsx`
   - `src/entrypoints/sidepanel/__tests__/App.test.tsx`
   - `src/newtab/components/SettingsModal/sections/__tests__/EncryptionTtlSection.test.tsx`
3. **【防回潮，本周】** 接入 `eslint-plugin-testing-library`，开启 `prefer-user-event` 等规则，CI 强制。
4. **【迁移存量，渐进】** 后续修改任何用 `fireEvent` / `.toBeTruthy()` 的旧测试时，顺手改为 `userEvent` / jest-dom matcher（外科手术，不集中重构）。
5. **【可选，金标准】** 对核心安全模块（`CryptoService`、`UnlockSession`、加密上下文编辑）引入 Stryker mutation testing，量化测试有效性。低于 60% mutation score 的模块优先补强。

---

## 11. 常见反模式速查

| 反模式 | 为什么坏 | 正确做法 |
|---|---|---|
| 手写 mock 整个 Semi | 测的是猜的契约，真实组件漂移 → 假过 | 真实渲染；仅 Toast 等副作用用 partial mock |
| `getByTestId` 打在 mock 桩上 | testid 真实组件里不存在 | 打在生产代码上，或改用 `getByRole/getByText` |
| `fireEvent.click/change` | 跳过真实事件链 | `userEvent.click/type` |
| `.toBeTruthy()` / `.toBeFalsy()` | 弱断言，`0`/`""` 也会挂 | jest-dom：`toBeInTheDocument()` / `toBeVisible()` |
| `toMatchSnapshot`（组件） | 脆，任何格式改动都红，不验证行为 | 行为断言 |
| 测试里 `querySelector` | 绕过语义层，耦合 DOM 结构 | 用 RTL query |
| mock 被测函数自己 | 等于没测 | mock 只在副作用边界（§2 原则 3） |
| 用 `setTimeout` 等异步 | flaky，时序靠猜 | `waitFor` / `findBy*` |

---

## 12. Review 速查表（PR checklist）

提测 / Review 测试代码时逐条对照：

- [ ] 被测组件**真实渲染**，未整体 mock Semi。
- [ ] mock 只命中副作用边界（chrome API / DB / 网络 / Toast / lottie）。
- [ ] query 用 `getByRole/getByText/getByPlaceholderText`，无 mock 私有 testid。
- [ ] 交互用 `userEvent`，无 `fireEvent`（或有注释例外）。
- [ ] 断言用 jest-dom matcher，无 `.toBeTruthy()`。
- [ ] 异步用 `findBy*` / `waitFor`，无裸 `getBy*` + 同步断言、无 `setTimeout`。
- [ ] `it` 标题读起来像一句需求（条件 → 结果）。
- [ ] 一个 `it` 测一件事。
- [ ] 改动是纯重构时，测试不需要改（验证未耦合实现）。

---

## 参考资料

- [The Testing Trophy and Testing Classifications — Kent C. Dodds](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications)
- [Write tests. Not too many. Mostly integration. — Kent C. Dodds](https://kentcdodds.com/blog/write-tests)
- [Common mistakes with React Testing Library — Kent C. Dodds](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
- [Don't Mock What You Don't Own — Hynek Schlawack](https://hynek.me/articles/what-to-mock-in-5-mins/)
- [Testing Library · Queries Priority](https://testing-library.com/docs/queries/about/#priority)
