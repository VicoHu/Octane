<!-- /autoplan restore point: /Users/vicohu/.gstack/projects/octane/feature-testing-standard-rollout-autoplan-restore-20260703-011140.md -->
# 测试规范落地执行计划（Testing Standard Rollout）

> 计划日期：2026-07-03 | 分支：`feature/testing-standard-rollout` | base：`master`
> 关联文档：`docs/standards/testing.md`（测试设计规范，已起草）
> 规范方法论：[Kent C. Dodds Testing Trophy](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications) + [Don't Mock What You Don't Own](https://hynek.me/articles/what-to-mock-in-5-mins/)
> 计划性质：**工程基建改进**（非功能 release，不绑语义版本号）

---

## 1. 背景与动机

测试设计规范 `docs/standards/testing.md` 已起草完成（方案 B，Testing Trophy）。本计划是**规范的落地执行**——把规范里的规则变成可运行的基建 + 迁移存量代码。

**为什么现在做：** 前序 office-hours 诊断出三类会导致"测试假过"的系统性隐患，且即将有新同事加入（规范价值在于在他们动手前固化模式）。越晚做，存量 23 个 `fireEvent` 文件越大。

**为什么不是功能开发：** 这是测试基建改进，不改产品行为，不进语义版本号，独立分支、独立 PR。

---

## 2. 现状诊断（数据，非主观）

| 维度 | 现状 | 来源 |
|---|---|---|
| 测试文件总数 | 63 | `find src tests -name "*.test.ts(x)"` |
| 手写 mock 整个 `@douyinfe/semi-ui` | 4 文件 | `grep vi.mock('@douyinfe/semi-ui'` |
| `tests/setup.ts` 内容 | 仅 1 行 `import '@testing-library/react'` | 实读 |
| jest-dom matcher 使用（`toBeInTheDocument` 等） | **0 次** | 全项目 grep |
| `@testing-library/user-event` | **未安装**，0 文件使用 | package.json + grep |
| `fireEvent` 使用 | 23 文件 | grep |
| `getByRole` 使用 | 11 文件 | grep |
| `getByTestId` 使用 | 4 文件（与手写 mock 文件重合） | grep |
| TypeScript 配置 | `tsconfig.json` extends `.wxt/tsconfig.json`，`include` 仅 `["src", ".wxt/wxt.d.ts"]`，**不含 `tests/`** | 实读 |
| ESLint | **项目无 eslint 配置**（无 `eslint.config.*` / `.eslintrc.*`） | 实查 |
| CI | **无任何 CI**（无 `.github/workflows`、无 husky/lefthook、无其他 CI 配置） | 实查 |
| `tsc --noEmit` typecheck script | 不存在 | package.json scripts |

**核心结论：** 项目测试层质量参差但可救——`CryptoService.test.ts`（fake-indexeddb 真往返）、`ContextList.test.tsx`（mock 数据源 + `findByText`）已是规范要求的标杆模式；问题集中在 4 个手写 mock 文件 + 三项基建缺口。**规范不是推翻重来，是固化好模式 + 消除坏模式 + 补基建。**

---

## 3. 目标与成功标准

### 强成功标准（必须全部达成）
1. **消除假过：** 4 个手写 mock 文件全部按规范重写，无 mock 私有 testid、无整体 mock Semi。
2. **基建补全：** `setup.ts` 接 jest-dom + cleanup；`@testing-library/user-event` 安装并可用。
3. **不破坏存量：** 全量 `npm run test` 通过（63 个测试文件迁移后仍绿）。
4. **可遵循：** 规范 + 正例模板入库，新同事可直接照做。
5. **验证假过已消除：** 对重写后的 `SidePanelUnlockModal`，手动做一次 mutation test（把 `unlock('sidepanel', pwd)` 改成 `unlock('sidepanel', '')`），确认测试会红。

### 弱成功标准（争取）
6. CI 或本地 hook 跑 typecheck，阻断类型回归。
7. eslint-plugin-testing-library 接入，开核心规则。

---

## 4. 决策点（autoplan 重点评审这些）

这些是规范没拍死、需要 review 博弈的真实工程决策：

### D1. typecheck 范围：tsconfig 不含 `tests/`
现状 `tsconfig.json` 的 `include` 只有 `src`。意味着 `tsc --noEmit` **不会检查测试文件**——而测试文件正是 `vi.mock` 类型漏洞的聚集地。选项：
- (a) 新增 `tsconfig.test.json` 继承主 config 并 include `tests` + `src/**/*.test.tsx`，`typecheck` script 跑两个 config
- (b) 直接把 `tests` 加进主 tsconfig 的 include（但可能拖慢 IDE / 影响构建边界）
- (c) 只跑主 typecheck，测试文件类型靠 IDE 兜底（最弱）

### D2. CI gate 落地方式：项目无任何 CI
项目既无 GitHub Actions 也无 git hook。"typecheck + test 作为 gate" 在当前项目是空命题。选项：
- (a) 引入 GitHub Actions（新建 `.github/workflows/ci.yml`，跑 typecheck + test）——最强但需要仓库 owner 在 GitHub 侧启用
- (b) 引入 husky + lint-staged pre-commit hook（本地 gate，不依赖 CI）——务实，开源项目常见
- (c) 纯本地 script（`npm run typecheck && npm run test`），靠团队自律——最弱
- (d) 本期不做 gate，只把 script 备好，gate 留后续

### D3. ESLint：项目当前无 eslint
规范 §9.3 假设有 eslint，但项目**从零没有**。从零搭 eslint + plugins 是不小工程（配置 flat config、与 WXT/React/TS 集成、处理存量 23 个 fireEvent 的规则冲突）。选项：
- (a) 本期从零搭 eslint + eslint-plugin-testing-library + eslint-plugin-vitest（完整但大）
- (b) 本期只搭最小 eslint + 仅开 testing-library 的 `prefer-user-event` / `no-container` 等几条核心规则
- (c) 本期不搭 eslint，规范靠 review checklist（§12）人工把关，eslint 留独立后续
- (d) 用 typescript-eslint 的 type-aware 规则替代部分 testing-library 规则

### D4. 存量 23 个 fireEvent 文件的迁移策略
- (a) 本期一次性全改 fireEvent → userEvent（彻底但大改动、PR 大）
- (b) 渐进：本期只重写 4 个手写 mock 文件，其余 19 个遇改顺手（外科手术，符合 CLAUDE.md「外科手术式修改」）
- (c) 本期改 4 个 mock 文件 + 标记剩余 19 个，加 eslint 规则后让规则驱动渐进迁移

### D5. 是否引入 Stryker mutation testing（金标准）
- (a) 本期对核心安全模块（CryptoService / UnlockSession）试跑 Stryker，量化测试有效性
- (b) 本期不做，留作规范落地稳定后的独立评估
- 成本：Stryker 配置 + 首跑对加密模块（PBKDF2 慢）可能很慢

### D6. CLAUDE.md 是否加测试规范引用
- (a) 加一节「## 测试规范」指向 `docs/standards/testing.md`，让 AI session 也强制遵循
- (b) 不加，规范只对人、不对 AI

### D7. Semi Toast 在 jsdom 的 portal 真实行为（技术风险，需实测）
重写 4 个文件时，真实 Semi `Toast` / `Modal` 在 jsdom 下是否需要额外 portal polyfill / setup？这是规范 §4.4 partial mock 方案能否落地的关键前提。`ContextList.test.tsx` 已 mock lottie 但**没**真实渲染 Semi 重 portal 组件，所以项目里**没有现成的"Semi 重组件在 jsdom 真实渲染"先例**。需在第一个文件（`SidePanelUnlockModal`）重写时实测验证，可能反推规范 §4.4 调整。

---

## 5. 执行步骤（分步，每步带验证）

> 顺序遵循「先基建、再模板、再扩散、最后加固」。

### Step 1: commit 规范文档（先行）
- 把已起草的 `docs/standards/testing.md` 在本分支 commit（当前 untracked）。
- 验证：`git log --oneline -1` 见规范 commit。

### Step 2: 补 `tests/setup.ts`（D7 实测点）
- 改造为：`import '@testing-library/react'` + `import '@testing-library/jest-dom/vitest'` + `afterEach(cleanup)`。
- 装依赖：`@testing-library/jest-dom`（devDep）。
- 验证：`npm run test` 全量仍绿（jest-dom 是纯增量，不该破现有）。

### Step 3: 安装 `@testing-library/user-event`
- `pnpm add -D @testing-library/user-event`。
- 验证：在一个简单组件测试里 `userEvent.setup()` 可用。

### Step 4: 加 typecheck script（D1）
- 按 D1 选项实施（推荐 a：独立 `tsconfig.test.json`）。
- `package.json` 加 `"typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json --noEmit"`。
- 验证：`npm run typecheck` 通过；故意改坏一个类型，确认报错。

### Step 5: 重写 4 个手写 mock 文件（核心，D7 实测）
- **5a. `SidePanelUnlockModal.test.tsx`**（先做，当模板）→ 用规范 §4.5 正例。**此处实测 D7**：真实 Semi Modal/Input/Button/Toast 在 jsdom 是否正常。若 portal 报错，停下来调整方案（可能需 `@testing-library/react` 的 portal 处理或 jsdom 升级）。
- **5b. `InlineContextEditor.test.tsx`**
- **5c. `src/entrypoints/sidepanel/__tests__/App.test.tsx`**（注意：这是集成测试，复杂度最高，mock 边界要重新厘清）
- **5d. `EncryptionTtlSection.test.tsx`**
- 验证：每个文件重写后单独跑绿；4 个全绿；全量 63 文件仍绿。
- **关键验证（成功标准 5）：** 重写后对 `SidePanelUnlockModal` 做 mutation（改 `unlock` 入参），确认测试红。

### Step 6: eslint 决策落地（D3）
- 按 D3 选项实施（取决于 review 结论）。
- 验证：所选规则能跑通；存量冲突有明确处理（白名单 or 修复）。

### Step 7: CI/hook gate（D2）
- 按 D2 选项实施。
- 验证：gate 真的能拦住一个 typecheck 失败 / 测试失败的提交。

### Step 8: 存量迁移策略落地（D4）
- 按 D4 选项实施。
- 验证：策略文档化（写进规范 §10 或独立 CHANGELOG）。

### Step 9: CLAUDE.md（D6）
- 按 D6 选项实施。

### Step 10:（可选，D5）Stryker 试跑
- 若 D5 选 a：配置 Stryker，对 `CryptoService` / `UnlockSession` 跑一次，记录 mutation score。
- 验证：拿到 score 报告。

### Step 11: 全量回归 + 收尾
- `npm run test` + `npm run typecheck` 全绿。
- 更新 memory（`testing-standard.md`）状态为"已落地"。
- 准备 PR 描述（含规范链接 + 重写前后对比 + mutation 验证证据）。

---

## 6. 风险与未决

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| D7：Semi Toast/Modal 在 jsdom portal 行为异常，规范 §4.4 partial mock 方案不可行 | 中 | 高（动摇核心方案） | Step 5a 先验证；若不行，退化为"mock Toast 单点 + 真实 Modal/Input"，或引入 `@jsdom/testing-library` portal 增强 |
| 现有 4 文件重写后集成测试覆盖度下降（mock 删了，真实组件暴露原本被 mock 掩盖的问题） | 中 | 中 | 重写时逐个对比断言，不删断言只换 mock 边界 |
| eslint 从零搭与 WXT/TS 集成冲突 | 中 | 中 | D3 选 b（最小集）降风险 |
| Stryker 对 PBKDF2 加密模块跑极慢 | 高 | 低（可选步骤） | D5 可选；首跑限制到单文件 |
| typecheck 双 config（D1-a）增加 CI/本地耗时 | 低 | 低 | 监控 |

**未决（需 review 拍板）：** D1–D6 全部。本期范围大小强依赖于 D2/D3/D4 的取值。

---

## 7. 不在范围

- **Playwright / e2e** —— 独立后续（规范 §3 已列为缺口，但本期不引入）。
- **全量 19 个存量 fireEvent 文件的迁移** —— 若 D4 选 b/c，则不在本期范围（遇改顺手）。
- **性能测试 / 视觉回归** —— 与测试规范无关。
- **改产品代码** —— 本期只动测试 + 基建 + 文档，不改任何产品行为。
- **CI 平台选型大讨论** —— D2 只在 husky vs GitHub Actions 间务实选择，不引入更复杂平台。

---

## 8. 验证计划（Verification）

- 每个 Step 完成跑 `npm run test`，全绿才进下一步。
- Step 5 完成后，执行**成功标准 5 的 mutation 验证**并保留证据（临时改坏代码 → 跑测试 → 见红 → 还原）。
- Step 11 收尾跑全量 typecheck + test，附输出到 PR。
- 若 D5 选 a，Stryker 报告附 PR。

---

## 附录：相关文件清单

- 规范：`docs/standards/testing.md`
- 待重写：`src/entrypoints/sidepanel/components/__tests__/SidePanelUnlockModal.test.tsx`、`src/entrypoints/sidepanel/components/__tests__/InlineContextEditor.test.tsx`、`src/entrypoints/sidepanel/__tests__/App.test.tsx`、`src/newtab/components/SettingsModal/sections/__tests__/EncryptionTtlSection.test.tsx`
- 待改造基建：`tests/setup.ts`、`package.json`、`tsconfig.json`（+ 可能新增 `tsconfig.test.json`）、`CLAUDE.md`（D6）
- 标杆参考（不改）：`src/services/__tests__/CryptoService.test.ts`、`src/newtab/components/ContextList/__tests__/ContextList.test.tsx`

---

## GSTACK CEO REVIEW REPORT（Phase 1，autoplan）

> 双模型独立评审：Claude subagent + Codex（cold read）。两模型未互相喂结论。

### CEO 双模型共识表

| 维度 | Claude subagent | Codex | 共识 |
|---|---|---|---|
| 1. 前提成立？ | 技术前提成立；"系统性隐患"措辞夸大 | 技术前提成立；**"新同事加入"动机前提未验证** | DISAGREE（codex 质疑动机前提，待用户证实） |
| 2. 对的问题？ | 是，但范围膨胀 | 是，核心工作半天能搞定 | CONFIRMED |
| 3. 范围对？ | 膨胀，砍到 5 步 | 膨胀，砍到 4-5 步 | CONFIRMED |
| 4. 替代方案够？ | MVP 5 步版 | MVP 5 步版（独立给出，高度重合） | CONFIRMED |
| 5. 竞品/市场风险 | N/A（内部基建） | N/A | N/A |
| 6. 6 个月轨迹 | Stryker/双tsconfig 多余；gate 缺失会后悔 | 同；spike 没做会后悔 | CONFIRMED（gate 严重度分歧 → D2 taste） |

**收敛度：5/6 CONFIRMED，1 DISAGREE（动机前提），1 跨模型 taste（D2）。**

### 两模型独立 converge 的关键发现（高置信）

1. **[CRITICAL] D7 是阻断性前置 spike，不是决策点。** Semi Toast/Modal 在 jsdom 能否真实渲染 = 规范 §4.4 方案能否成立。必须在写一行代码前验证。两模型独立标 CRITICAL。
2. **[HIGH] 范围膨胀。** ESLint 从零搭（D3）、Stryker（D5）是独立项目，不该混进本 PR。
3. **[HIGH] D1 双 tsconfig 过度设计。** WXT 构建走自己 pipeline，`tsc --noEmit` 不产构建物，主 tsconfig 加 `tests` 即可（一行）。
4. **[MEDIUM] 19 个 fireEvent 存量文件"不优但没坏"**，不是隐患，遇改顺手即可（D4-b）。
5. **11 步砍到 5 步**：spike → 基建（setup.ts + jest-dom + user-event + tsconfig加tests + typecheck script）→ 重写4文件 → 手动mutation验证 → CLAUDE.md引用 + PR。

### 分歧 → taste decision（交最终 gate）

**D2 CI gate：**
- Claude subagent → **(b) husky pre-push**：「项目完全无 gate 是真 P0；规范不自我执行，下周就有人能手写 mock 入库。开源 fork PR 跑不了 secret，本地 hook 更可靠。」
- Codex → **(d) 只备 script，gate 留后续**：「单人 OSS v0.1.8，搭 GH Actions 或 husky 是过度工程；脚本备好即可，有第二贡献者再加 gate。」

→ 两模型对"单人项目要不要 gate"判断相反，属真实 taste 决策，不自动决，交用户。

### Codex 独有发现（subagent 未提）

- **动机前提诚实度：** plan §1「即将有新同事加入」若不属实（git log 226 commit 全 VicoHu 一人），则"越晚做存量越大"的紧迫性论据塌缩为"有空就做"。需用户给真相。

### Decision Audit Trail（Phase 1）

| 决策 | 分类 | 原则 | 裁决 | 依据 |
|---|---|---|---|---|
| D1 typecheck 范围 | Mechanical | P5 explicit | **(b) 主 tsconfig 加 tests** | 双模型一致；一行改动；WXT 构建不受影响 |
| D3 ESLint | **User override**（用户保留） | 用户决定 | **(a) 本期从零搭最小集** | 双模型建议砍(c)；**用户选择保留**（owner 最终决定权）；缓解见下 |
| D4 存量迁移 | Mechanical | P5 explicit | **(b) 渐进，删陷阱选项 a** | 双模型一致；fireEvent 不假过 |
| D5 Stryker | Mechanical | P3 pragmatic | **(b) 不做** | 双模型一致；教科书过度工程 |
| D6 CLAUDE.md | Mechanical | P1 completeness | **(a) 加引用（必做）** | 双模型一致；零成本；AI 是执行主体 |
| D7 Semi portal | Mechanical | P3 | **前置 spike（非决策）** | 双模型一致 CRITICAL |
| D2 CI gate | **Taste** | — | **待用户** | subagent=b / codex=d，分歧 |
| 动机前提 | **Premise gate** | — | **待用户** | codex 质疑"新同事"真实性 |

### Phase 1 后的 MVP 修订版（待 premise gate 确认后定稿）

```
Step 0: D7 spike（15-30 分钟）——真实渲染 Semi Modal+Input+Button+Toast 验证 jsdom 可行性
Step 1: 基建——setup.ts(jest-dom+cleanup) + 装 user-event + 主 tsconfig 加 tests + typecheck script
Step 2: 重写 4 个手写 mock 文件（SidePanelUnlockModal 当模板，逐个跑通 + 全量回归）
Step 3: 手动 mutation 验证（改 unlock 入参，确认测试红）
Step 4: CLAUDE.md 加测试规范引用
Step 5: PR
[砍掉：ESLint(D3)、Stryker(D5)、CI gate 大讨论(D2→taste)、存量19文件迁移(D4-a)]
```

> ⚠️ **注意：** 上面的 Phase 1 MVP 修订版已被 Phase 3 Eng 评审**再次修订**（见下方 v2）。D1 由 (b) 改 (a)、新增 lottie-web 全局 mock、新增 vitest include tsx 修复。

---

## GSTACK ENG REVIEW REPORT（Phase 3，autoplan）

> 双模型独立评审：Claude subagent（实跑 spike）+ Codex（cold read，喂 CEO 共识）。两模型在关键 CRITICAL 上独立 converge。

### ENG 双模型共识表

| 维度 | Claude subagent | Codex | 共识 |
|---|---|---|---|
| 1. 架构 sound？ | D1 必须改 (a)；setup.ts 加 lottie 全局 | D1 必须改 (a)；lottie 放 setup.ts 全局 | **CONFIRMED**（双模型独立推翻 CEO 的 D1-b） |
| 2. 测试覆盖足够？ | mutation 太弱、catch 漏、加 surface mutation | mutation 方法待强化、catch 漏 | **CONFIRMED** |
| 3. 性能风险 | husky pre-push 只跑 typecheck（test 太慢） | 同 | **CONFIRMED** |
| 4. 安全威胁 | N/A（测试基建） | N/A | N/A |
| 5. 错误路径？ | catch 分支零覆盖（F12） | 同 | **CONFIRMED** |
| 6. 部署/基建风险 | vitest include 漏 tsx（F16）、.wxt 前置（F5） | vitest include、jsdom canvas、wxt prepare | **CONFIRMED** |

**收敛度：5/5 完全 CONFIRMED。无 DISAGREE。这是本次 autoplan 最高置信结论。**

### 跨阶段主题（Cross-Phase Theme）—— 高置信信号

**主题：lottie-web 是规范落地的隐藏地雷。** CEO 阶段两模型都没看到（未读 node_modules），Eng 阶段两模型**独立挖出**同一根因：`@douyinfe/semi-ui` barrel 静态 re-export `./lottie` → `semi-foundation/lottie/foundation.js` 顶层 `import lottie from 'lottie-web'` → jsdom 无 canvas → 模块评估期崩。规范 §4.4/§4.5 正例照抄会在 import 阶段全红。

**意义：** 这把 D7 的风险性质从"portal 行为"（CEO 猜测）纠正为"lottie-web barrel 求值崩"（实证）。现有 4 个手写 mock 文件中 2 个（App.test / InlineContextEditor）的注释**已经精确描述了这个根因**——作者当初整体 mock Semi 正是为了躲它。

### 两模型 converge 的 CRITICAL 技术修正

1. **[CRITICAL] 规范 §4.4/§4.5 必须补 lottie-web mock。** 双模型独立确认。Codex 提出更优方案：放 `tests/setup.ts` 全局 `vi.mock('lottie-web', () => ({ default: {} }))`，DRY + 防未来新测试遗忘。**采纳 codex 方案。** 这意味着规范 §4.4 要新增"全局前置"说明，4 文件重写不必各写 lottie mock。
2. **[CRITICAL] D1 裁决从 (b) 改 (a)。** 主 tsconfig 开着 `noUnusedLocals/noUnusedParameters`，加 tests 会引爆大量报错。双模型独立推翻 CEO 的"一行改动"。改用独立 `tsconfig.test.json`（extends 主 config，关 unused）。

### Eng 阶段新发现（subagent 主导，codex 印证）

| # | 发现 | 严重度 | 处置 |
|---|---|---|---|
| F16 | `vitest.config.ts` include 漏 `tests/**/*.test.tsx`——静默假过温床（测试存在但没跑） | HIGH | Step 1 基建补 include |
| F9 | App.test 现状 mock 8 项，重写只需动 1 处（Semi Collapse→真实+lottie），其余 7 合法 mock 保留 | HIGH | Step 2c 明确边界 |
| F3 | EncryptionTtlSection 用 InputNumber（非 Input），onChange 签名/blur 时序不同，spike 需覆盖 | HIGH | spike 扩 InputNumber |
| F10 | InlineContextEditor 的 Switch onChange(checked,e) 签名需验 | MEDIUM | spike 加 Switch |
| F5 | typecheck 前置 `wxt prepare`（否则 `.wxt/tsconfig.json` 不存在） | MEDIUM | script 加 `wxt prepare` 或 postinstall |
| F11 | mutation 验证升级：≥2 个，含 surface 维度（锁 sidepanel 不复用 home 解锁硬约束） | MEDIUM | 成功标准 5 升级 |
| F12 | catch 分支零覆盖（unlock 抛异常） | MEDIUM | 补 rejectedValue 用例 |
| F17 | spike 留作回归 smoke test（Semi/jsdom 升级预警） | MEDIUM | spike 不删 |

### Decision Audit Trail（Phase 3 增补）

| 决策 | 分类 | 原则 | 裁决 | 依据 |
|---|---|---|---|---|
| D1（修订） | Mechanical（eng 推翻 ceo） | P5 + 实证 | **(a) 独立 tsconfig.test.json，关 unused** | **双模型独立确认** noUnusedLocals 会爆；CEO "一行改动"事实错误 |
| D2（修订） | Taste→趋近 mechanical | P1（用户确认新人要来） | **(b) husky pre-push，仅跑 typecheck** | 双 eng 模型一致；test 放 push 太慢（PBKDF2+fake-indexeddb），typecheck 足够挡 vi.mock 类型漏洞 |
| D8（新增） | Mechanical | P4 DRY | **lottie-web mock 放 tests/setup.ts 全局** | 双模型一致；codex 方案优于 subagent 每文件重复；防未来遗忘 |
| D7（方向修正） | Mechanical | 实证 | **spike 验证内容修正：barrel 评估安全 + lottie neutralization + query 命中** | 风险是 lottie 不是 portal |

### MVP 修订版 v2（Eng 后，最终执行版）

```
Step 0: D7 spike（验 lottie 全局 mock + InputNumber/Switch 签名 + query 命中）→ 修订规范 §4.4 补"setup.ts 全局 lottie mock"
Step 1: 基建
  1a. setup.ts: import jest-dom/vitest + afterEach(cleanup) + 全局 vi.mock('lottie-web', () => ({ default: {} }))
  1b. 装 @testing-library/jest-dom + @testing-library/user-event
  1c. 新建 tsconfig.test.json（extends 主 config，关 noUnusedLocals/noUnusedParameters，include tests + src/**/*.test.tsx）
  1d. package.json: "typecheck": "wxt prepare && tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json --noEmit"
  1e. vitest.config.ts include 加 "tests/**/*.test.tsx"（堵静默假过）
Step 2: 重写 4 文件（lottie 已全局处理，每个文件只 partial mock Toast + 真实渲染其余 Semi）
  2a. SidePanelUnlockModal（模板；补 catch 分支用例 F12；mutation 含 surface F11）
  2b. InlineContextEditor（spike 验过 Switch 签名 F10）
  2c. App.test（只换 Semi Collapse 整体 mock → 真实渲染，其余 7 个合法 mock 保留 F9）
  2d. EncryptionTtlSection（spike 验过 InputNumber F3）
Step 3: 手动 mutation 验证（≥2 个，含 surface 维度）+ spike 转永久 smoke test 留库（F17）
Step 4: husky pre-push（仅 typecheck）+ CLAUDE.md 加测试规范引用
Step 5: ESLint 从零搭最小集（用户保留项，见下风险缓解）
Step 6: PR（spike 证据 + 重写前后对比 + mutation 证据 + 规范 §4.4 lottie 修订）
```

### ESLint 从零搭的风险缓解（用户保留项配套，eng review 要求）

用户选择保留 ESLint（推翻双模型建议）。eng review 点出两个真实风险，落地时必须缓解：

1. **flat config + WXT/React/TS 集成** —— 用最小 `eslint.config.js`（flat config）+ `typescript-eslint` recommended + `eslint-plugin-testing-library` + `eslint-plugin-vitest`。先跑通，不追求完整规则集。
2. **23 个存量 fireEvent 文件会让 `prefer-user-event` 全报错** —— **关键缓解：** `testing-library/prefer-user-event` 等高冲突规则在本期设为 `"warn"` 而非 `"error"`，或用 `eslint-config` 的 overrides 只对新增文件 enforce。**不一次性改 23 文件**（违背外科手术原则）。规则就位后，随 D4 渐进迁移自然消除 warning。

> ESLint step 若在落地时遇到与 WXT 集成的硬阻塞（eng review F-ESLint 风险），可降级回 (c) 不阻塞本期 PR——由执行时判断，不在此预先承诺。

**两模型一致结论：APPROVE WITH CHANGES。** 补 lottie 全局 mock（D8）+ D1 改 a + vitest include 补 tsx（F16）三项后可执行。规范 §4.4/§4.5 需配套修订（补 setup.ts 全局 lottie mock 说明）。

---

## GSTACK REVIEW REPORT — 终评

- **CEO Phase**：APPROVE WITH CHANGES（5/6 confirmed；D2 taste；动机前提经用户证实成立——确有新人）
- **Design Phase**：skipped（无 UI scope，纯测试基建）
- **Eng Phase**：APPROVE WITH CHANGES（5/5 confirmed，最高置信；eng 推翻 ceo 的 D1-b；新挖 lottie 地雷）
- **DX Phase**：skipped（内部测试基建，非开发者产品 DX）

**最终裁决建议：APPROVE。** 经双模型四轮（实含 2 phase × 2 模型 = 4 次独立评审），方向、范围、技术细节都已收敛。唯一需用户拍板：D2 gate 形态 + 想保留哪项 + 最终批准。
