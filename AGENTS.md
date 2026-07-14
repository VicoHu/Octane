# AGENTS.md

用于减少 LLM 编码中常见错误的行为指南。可按需与项目特定说明合并使用。

**权衡：** 这些指南更偏向谨慎而非速度。对于非常简单的任务，可自行判断。

## 1. 编码前先思考

**不要想当然。不要掩饰困惑。要明确说明权衡。**

在实现之前：
- 明确说出你的假设。如果不确定，就提问。
- 如果存在多种理解方式，把它们列出来——不要默默自行选一种。
- 如果有更简单的方法，要指出来。必要时应提出不同意见。
- 如果某些地方不清楚，就先停下来。说明困惑点，然后提问。

## 2. 简单优先

**用最少的代码解决问题。不要做任何猜测性的扩展。**

- 不要添加任何超出需求的功能。
- 不要为一次性代码做抽象。
- 不要加入未被要求的“灵活性”或“可配置性”。
- 不要为不可能发生的情况编写错误处理。
- 如果你写了 200 行，但其实 50 行就能解决，那就重写到更简洁。

问问自己：“一个资深工程师会觉得这实现过度复杂吗？” 如果会，就继续简化。

## 3. 外科手术式修改

**只改必须改的部分。只清理你自己造成的问题。**

编辑现有代码时：
- 不要“顺手优化”相邻的代码、注释或格式。
- 不要重构没坏的东西。
- 遵循现有风格，即使你个人会写得不一样。
- 如果你发现了无关的死代码，可以提一句——但不要直接删掉。

当你的修改造成遗留问题时：
- 删除**因你的修改而变得未使用**的 import / 变量 / 函数。
- 不要删除原本就存在的死代码，除非有人明确要求。

判断标准：每一行改动都应该能直接追溯到用户的请求。

## 4. 以目标驱动执行

**先定义成功标准，再循环验证直到达成。**

把任务转化为可验证的目标：
- “添加校验” → “先为非法输入编写测试，然后让测试通过”
- “修复 bug” → “先写出能复现问题的测试，然后让它通过”
- “重构 X” → “确保重构前后测试都通过”

对于多步骤任务，先给出一个简短计划：

```text
1. [步骤] → 验证：[检查项]
2. [步骤] → 验证：[检查项]
3. [步骤] → 验证：[检查项]
```

强成功标准能让你独立完成闭环。弱成功标准（例如“让它能工作”）则会迫使你不断来回确认。

## 5. 交互协议
- 语言：强制中文，包括代码注释、日志、测试描述
- 风格：专业直接，禁止废话
- 代码块：必须包含完整的文件路径
- 效率：禁止冗长解释，优先展示代码和关键结论

## Superpowers 使用规则
在开始任何任务前，不要直接行动。先检查是否有适用的 `superpowers` skill。
如果存在适用或可能适用的 skill：
1. 列出适用的 skill 名称，并简要说明原因。
2. 明确输出：`Using [skill] to [purpose]`。
3. 在采取其他行动前，先遵循该 skill 的说明执行。
4. 优先使用流程型 skill，再使用实现型 skill。
5. 在完成 verification 之前，不要宣布任务完成。

### 补充规则
- 即使只是“可能适用”，也应先检查 skill。
- 不要因为任务看起来简单就跳过 skill 检查。
- 不要凭记忆使用 skill，应以当前版本的 skill 文档为准。
- 如果多个 skill 同时适用，先选流程型，再选执行型。

## 代码搜索策略
当任务涉及架构、调用流程、符号关系、影响范围，或某个行为来源于哪里时：
1. 优先使用 CodeGraph MCP 工具。
2. 优先基于图谱的答案，而不是 grep / glob / Read。
3. 只有在 CodeGraph 无法解析路径或符号时，才回退到 grep 或读取文件。
4. 除非仍然缺少某个特定文件细节，否则应将 CodeGraph 返回的源码/上下文视为足够信息。
对于简单的字面量字符串匹配，可以使用 grep。

## 页面 UI/UX 优化
涉及前端 UI/UX 工作时，按场景选工具，避免无依据地手写样式：

1. **Semi 组件选用与用法** → `semi-ui-skills` skill。本项目以 Semi Design 为组件基座，先查组件再动手。
2. **单点 / 通用设计决策**（挑风格 / 配色 / 字体配对 / 图表选型，或任意页面的 UI/UX 优化）→ `ui-ux-pro-max` skill。基于数据库检索给推荐 + 配套 UX 规则，跨栈、不限页面类型。系统性代码 review 另用 `design-review` skill，不是它。
3. **落地页 / 作品集 / 营销页 / 现有页面 redesign 的端到端设计落地** → `taste-skill`（install name `design-taste-frontend`，Anti-slop，读 brief 推断整体设计语言、调 VARIANCE / MOTION / DENSITY 三旋钮，产出连贯界面）。它偏整体方向落地（不是 `ui-ux-pro-max` 那种单点推荐）；默认栈 React + Tailwind v4，而本项目是 React + Semi Design（无 Tailwind），引入时样式需改用 Semi token；**明确不适用**于仪表盘、数据表格、多步产品 UI。

判断原则：
- 产品型 UI（newtab / sidepanel / 设置等）默认走 Semi + `semi-ui-skills`；需要设计决策时叠加 `ui-ux-pro-max`。
- 落地页 / 作品集类页面才用 `taste-skill` 做整体设计落地（其 Tailwind 默认栈需替换为本项目 Semi token）；扩展内功能型 UI 不要用 `taste-skill`，挑配色 / 字体等单点决策用 `ui-ux-pro-max`。
- 极简微调（改间距 / 颜色 token 等）可直接手动（以 `DESIGN.md` 为 token 真源），无需调用 skill（需要使用Semi Design 组件时，优先使用 `semi-ui-skills` skill）。

### 设计规范文档

| 文档 | 角色 |
|------|------|
| `DESIGN.md` | 设计规范（token 单一真源，遵循 Google DESIGN.md alpha spec）。做任何视觉/UI 决策前必读；改主题只动 token |
| `docs/design-guidelines.md` | 设计规范补充：完整理由、现状审视、设计债务清单、交付检查清单 |
| `docs/semi-design-spec.md` | Semi-design DSM Token 参考手册：Semi 组件 token 机制（机制层，非项目决策） |

## 测试规范
写测试或改测试时，**必须**先读 [测试设计规范](docs/standards/testing.md)。核心：
- 不整体 mock `@douyinfe/semi-ui`（真实渲染 Semi，仅 partial mock Toast）；lottie-web 由 `vitest.config.ts` 全局 alias 处理（见规范 §4.4.1），测试文件**不要**再 `vi.mock('lottie-web')`。
- query 用 `getByRole` / `getByText` / `getByPlaceholderText`，禁用只存在于 mock 里的私有 testid。
- 交互用 `userEvent`（不用 `fireEvent`）；断言用 jest-dom matcher（`toBeInTheDocument()` 等，不用 `.toBeTruthy()`）。
- mock 只命中副作用边界（chrome API / DB / 网络 / Toast / lottie），不 mock 被测对象。
- 提交前 `pnpm run typecheck`（husky pre-push 自动跑）+ `pnpm run test` 必须双绿。
- 写新组件测试前，参考 `tests/spike-semi-jsdom.test.tsx`（Semi 在 jsdom 真实渲染范本）和 `src/services/__tests__/CryptoService.test.ts`（逻辑层标杆）。