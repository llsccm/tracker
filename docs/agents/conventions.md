# 代码约定与工程规范

> 当你需要编写、重构或审阅本项目的代码，了解模块设计约定、Style Guide、格式化工具配置，以及测试与提交规范时，请阅读本文档。

文档结构：

1. 代码约定：项目级事实与工具配置
2. Style Guide：新增与重构时的写法偏好
3. 测试与验证：提交前门槛摘要（详见 testing.md）
4. PR 与提交：标题、描述与合入约定

---

## 代码约定

- 项目使用 JavaScript/TypeScript ESM；`package.json` 中设置了 `type: module`。
- Vite 配置了 `@` 路径别名指向 `src/` 目录；`jsconfig.json` 同步配置了 IDE 路径映射。
- 代码会依赖目标页面提供的全局对象，例如 `Laya`、`JSZip`、`CtrUtil`、`SystemContext` 等。
- `globalConfig` 由 `src/tracker/state.ts` 中的配置列表和 Proxy 驱动，当前活跃配置项以 `ACTIVE_CONFIG_ENTRIES` 为准；修改配置项时需要同步考虑 localStorage 与 `xc:config-change` 事件分发。
- `src/tracker/index.ts` 仅作为共享运行时状态聚合入口；`Room`、`Card`、`Player`、`Zone`、`ConstraintGroup` 等底层对象请从 `src/tracker/` 对应子模块直接导入。
- 远端配置通过 `src/config/ConfigManager.js` 从 `Config_w.sgs` 加载并分发到各配置解析器，解析结果通过单例模式全局共享。
- 代码缩进遵循 2 空格；修改局部代码时保持邻近代码风格，不做无关格式化。
- 用户可见文本和注释主要使用中文；新增用户可见文案默认使用中文。
- Prettier 配置要点：单引号、无分号、无尾随逗号、2 空格、宽度 100。
- EditorConfig 要点：UTF-8、LF 换行、2 空格、文件末尾换行、去除尾随空白；Markdown 允许保留尾随空白。
- ESLint 使用 flat config 格式（`eslint.config.js`），继承 `@eslint/js` 与 `typescript-eslint` 推荐规则；`src/**/*` 使用浏览器与宿主页面全局变量，根目录配置脚本使用 Node 全局变量。
- ESLint 质量规则约束 `prefer-const`、允许空 `catch` 的 `no-empty`、TypeScript 类型导入与数组类型风格；格式排版主要交给 Prettier，但 TypeScript 额外保留少量 `@stylistic` 换行规则，作为刻意的对象/数组可读性约束。

---

## Style Guide

新增与重构代码时优先遵循本节；与邻近历史代码冲突时，局部修改可先贴合邻近风格，但不要把反模式扩散到新逻辑。

### Imports

- 不要使用别名导入。
- 禁止 `import { foo as bar } from '...'`。
- 禁止为消歧而重命名导入，例如 `import { resolve as pathResolve } from 'node:path'`。
- 若本地名冲突，优先调整本地变量名，或通过模块路径表达来源，而不是改写导入符号名。

```js
// Good
import { resolve } from 'node:path'
import { loadRoom } from '@/tracker/room'

// Bad
import { resolve as pathResolve } from 'node:path'
import { loadRoom as loadTrackerRoom } from '@/tracker/room'
```

说明：`import * as ns from '...'` 仅在第三方库或既有模块约定要求命名空间导入时使用；不要为了“换个名字”去包一层命名空间。

### Variables

优先 `const`，避免为了后续赋值而使用 `let`。能用三元或提前返回表达的值，不要先声明再分支赋值。

```js
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

- 真正需要在循环或多次更新中变化的绑定才用 `let`。
- 本仓库 ESLint 已启用 `prefer-const`；新增代码不要绕过该约束。

### Control Flow

避免 `else`。优先 early return，让主路径保持线性。

```js
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

- 校验失败、空值、不支持分支应尽早返回或抛出。
- 多层嵌套 `if/else` 出现时，优先拆 guard clause 或下沉 helper。
- `else if` 链仅在互斥状态机且早期返回会降低可读性时保留。

### Defensive Programming

按信任边界决定防御强度。防御应针对真实可发生的输入和可恢复故障，不要为类型契约已经排除、
且上游明确保证不会产生的值堆叠转换、校验与静默兜底。

- 宿主游戏协议中的 `CardID` 可信为数字：`0` 表示未公开身份，正数表示真实身份。不要仅为假设的
  字符串、负数、小数、`NaN` 或无穷值反复添加 `Number(id)`、`typeof`、`Number.isFinite()`、
  `Number.isInteger()` 等转换或校验；`id > 0` 用于区分真实身份与 `0`，属于领域判断。
- 只归一化协议中真实存在的形态差异，例如 `CardIDs` 的单值/数组形式和可选字段缺省。不要把契约外
  的值静默转换成 `0`，否则会把程序错误伪装成“未知牌”。
- 已进入类型化内部 API 的数据默认满足其类型与入口契约，不在每层重复校验。用户输入、localStorage、
  远端配置和导入文件等真正的不可信边界，应在入口集中校验一次，再向内部传递收窄后的类型。
- 保留保护状态一致性的检查，例如实体是否存在、牌数是否一致、身份是否重复、操作时序是否合法；
  这类检查针对领域状态，不等同于对基础类型做重复防御。
- 若线上样例证明上游契约发生变化，应同步更新类型、入口解析和回归样例，而不是在消费热路径散落兼容
  分支。内部不可能状态需要诊断时，优先显式告警或失败，不要用默认值掩盖。
- 测试优先覆盖已知协议变体、领域哨兵值与状态不变量；不要只为覆盖防御分支而构造契约明确排除的
  CardID 类型或数值。

```ts
// Good：只处理协议已知的容器形态，并保留 0 的领域语义。
const ids = Array.isArray(cardIDs) ? [...cardIDs] : [cardIDs]
const knownIDs = ids.filter((id) => id > 0)

// Bad：把契约外输入静默伪装成未知牌。
const ids = (Array.isArray(cardIDs) ? cardIDs : [cardIDs])
  .map((id) => Number(id) || 0)
  .filter((id) => Number.isInteger(id))
```

### Complex Logic

当函数包含多段校验或支撑细节时，主函数应读起来像 happy path；把校验、解析、装配细节下沉到紧随其后的小 helper。

```js
// Good
export function loadThing(input) {
  const config = requireConfig(input)
  const metadata = readMetadata(input)
  return createThing({ config, metadata })
}

function requireConfig(input) {
  // ...
}

function readMetadata(input) {
  // ...
}
```

- helper 放在它所支撑的主导出附近，通常位于主函数下方。
- 只在 helper 能命名真实概念时提取，例如 `requireConfig`、`readMetadata`；不要把简单表达式拆成大量一次性函数。
- 同步的解析、校验、options 组装保持同步；不要仅为统一签名而把纯计算包装成异步或 effectful API。

### Comments

- 为非显而易见的约束、协议特例、收敛边界和意外行为写注释。
- 不为显而易见的赋值、循环或分支写叙述性注释。
- 用户可见文案与面向维护者的说明默认使用中文。

```js
// Good：说明协议特例或不变式
// 公共区候选不能被座位投影裁剪，否则回补后会丢非玩家 location。

// Bad：复述代码
// 把 config 赋给 result
const result = config
```

---

## 测试与验证说明

详细策略、现有测试布局、补测约定与手工验收清单见 [`testing.md`](testing.md)。本节只保留提交前门槛摘要。

- `package.json` 已配置 `format`（Prettier）、`lint`（ESLint）、`typecheck`、`typecheck:tracker` 与 `test:tracker`（Vitest 记牌器回归）脚本；当前尚未配置通用 `test` 脚本。默认 `typecheck` 与 Vitest 配置排除 `tests/replay/`，回放按需使用 `typecheck:replay`、`test:replay` 与 `replay:tracker`。
- 修改文档无需运行构建测试。
- 完成普通代码修改后运行：`pnpm lint` 与 `pnpm build`。
- 修改 TypeScript 类型契约、`tsconfig*`、ESLint TypeScript 覆盖范围或 tracker 类型迁移相关代码后运行：`pnpm typecheck:tracker`；需要确认全仓类型入口时运行 `pnpm typecheck`。
- 修改 `src/tracker/`、`tests/tracker/` 或 `tests/contracts/pile-identity/` 后额外运行：`pnpm test:tracker`。
- 修改发布配置、打包参数、用户脚本元信息或记牌器核心高风险路径后，额外运行：`pnpm build:prod`。
- 修改 `html/iframe.html` 后需确认远端部署与界面加载流程正常。
- 重构阶段（保守重构 + 细粒度重构）已完成至 F-lite；新版记牌器重构主动接入已完成，完全从影子模式切换为主动运行模式，旧版写路径已从普通运行链路移除；`src/tracker/` 是当前唯一主动记牌器状态源；`src/` 下 `autoBot`、`autoTask`、`secKill`、`CDK`、`skinPaper`、`effectBlock`、`generalAppearance`、`layaWindow` 无残留。
- 如果新增脚本或工具命令，请同步更新 `package.json` 与相关文档。
- 修复构建错误后再提交；不要用忽略生成文件的方式掩盖构建问题。

---

## PR 与提交

### 提交前确认

- 相关代码已按本文件「代码约定」与「Style Guide」调整。
- 已运行适用的构建验证命令。
- 未提交 `dist/`、`node_modules/` 等生成目录以及本地 `.env` 配置文件；`pnpm-lock.yaml` 当前已跟踪，仅在依赖或版本任务中改动并说明原因。
- 变更涉及用户脚本匹配地址、更新地址、权限、入口或构建产物命名时，在 PR 描述中明确说明影响范围。

### Commits 与 PR Titles 注意事项

本仓库默认采用 Conventional Commits 风格。近期合并提交与 PR 标题也基本遵循该格式；请保持一致，便于浏览历史、按类型筛选，以及依赖自动生成 release notes。

#### 基本格式

```text
<type>(optional-scope): <subject>
```

- `type` 必填，小写。
- `scope` 可选；有明确模块边界时建议填写。
- 冒号后必须有一个空格。
- `subject` 用一句话说明意图或结果，不要只罗列改了哪些文件。
- 标题整行尽量控制在约 72 个字符内；中文可按语义自然截断，避免硬塞多个主题。
- 不在标题末尾加句号。
- 不在标题中手写 issue 或 PR 编号（合并后 GitHub 会自动附带）。

#### 推荐 type

| type | 何时使用 | 示例 |
| --- | --- | --- |
| `feat` | 用户可见能力、新交互、新协议接入 | `feat: 新增裴秀地图路线助手` |
| `fix` | 缺陷修复、协议同步错误、渲染或布局错误 | `fix: 修复录像主视角识别与座位布局同步` |
| `refactor` | 不改变对外行为的结构调整 | `refactor: Tracker Lifecycle and Game State Reset Flow` |
| `perf` | 性能优化 | `perf: avoid redundant visibility updates` |
| `test` | 仅测试新增或调整 | `test(tracker): cover hidden hand convergence` |
| `docs` | 仅文档 | `docs: clarify Room lifecycle mount order` |
| `ci` | GitHub Actions 或自动化流水线 | `ci: publish GitHub Releases from tags` |
| `build` | 构建链路、打包配置、依赖升级 | `build(deps): bump actions/checkout from 4 to 7` |
| `chore` | 杂项维护，且不属于以上类型 | `chore: ignore local env samples` |
| `style` | 纯格式或命名，无逻辑变化 | 尽量少用；优先随相关功能提交 |

破坏性变更：在 type 或 scope 后加 `!`，并在正文写清迁移影响，例如 `feat(tracker)!: replace seat projection API`。

#### 推荐 scope

只在能帮助定位模块时使用，不要堆砌多个 scope。

| scope | 含义 |
| --- | --- |
| `tracker` | `src/tracker/` 记牌器运行时、推理、收敛、生命周期 |
| `ui` | 窗口、座位、tooltip、iframe 界面注入 |
| `handler` | 协议消息处理器 |
| `config` | 远端配置或本地设置项 |
| `ci` | workflow、Dependabot、发布脚本 |
| `deps` | 依赖版本 bump（常与 `build(deps)` 连用） |
| `docs` | `docs/`、`AGENTS.md`、贡献说明 |
| `test` | 测试基建或跨模块测试调整 |

示例：

- `fix(tracker): converge hidden hand cards after target slots fill`
- `feat(ui): add tracker visibility shortcut`
- `ci: add GitHub automation workflows`

#### Subject 写法

- 说结果，不说过程：优先“修复 X / 支持 Y / 收敛 Z”，而不是“修改 A 文件、调整 B 函数”。
- 一个提交一个主题：无关重构、格式化、锁文件变更不要夹带。
- 中英文均可，同一 PR 内保持一致；面向游戏语义、协议或用户可见行为时优先中文，纯工程、依赖、CI 变更可用英文。
- 中文动词建议：`修复`、`新增`、`统一`、`收敛`、`接入`、`移除`。
- 英文使用祈使句现在时，如 `fix`、`add`、`avoid`、`preserve`、`retarget`。
- 避免含糊标题：`update`、`misc`、`wip`、`fix bug`、`review feedback`、`Apply suggestions from code review`。
- 避免把验证过程写进标题：`fix lint`、`make tests pass` 应改写成真正修复的问题。

#### Commit body（可选）

复杂改动可在标题下空一行写正文，建议覆盖：

- 为什么改（根因或背景）
- 关键行为变化
- 风险点与未覆盖场景
- 关联 issue（正文可用 `Fixes #12`）

```text
fix(tracker): preserve non-player location candidates

公共区与牌堆候选在座位投影时被错误裁剪，导致回补后身份漂移。
保留非玩家 location candidate，并补充回归测试。
```

#### PR Title 注意事项

PR 标题与最终 squash 或 merge commit 标题同级重要，默认按一条 Conventional Commit 来写。

- 推荐：`feat: 增加裴秀预设路线与手牌花色统计`
- 推荐：`fix(tracker): 修复记牌器特殊移动协议同步`
- 推荐：`refactor: Tracker Lifecycle and Game State Reset Flow`
- 不推荐：`Update src/logic.js`
- 不推荐：`fix tracker stuff`
- 不推荐：`Apply suggestions from code review`

补充约定：

1. 一个 PR 一个主题。若同时包含功能与无关重构，拆 PR 或至少在描述中分区说明；标题只表达主主题。
2. 标题描述用户或系统可感知结果，细节放 PR 描述。
3. 默认合入 `dev`。指向 `main` 的功能 PR 会被 workflow 自动改目标到 `dev`；仅 `dev -> main` 发布向 PR 可指向 `main`。
4. 分支名可辅助主题，但不替代标题。如 `fix/seat/ui` 对应标题仍应是完整句。
5. 依赖升级 PR 沿用 Dependabot 风格：`build(deps): bump <pkg> from X to Y`。
6. 若使用 squash merge，以 PR 标题作为最终提交标题，因此开 PR 时就把标题写对。
7. 不要在标题堆叠多个 type，例如 `feat/fix: ...`；选一个主 type，次要变更写入描述。

#### PR 描述最低要求

```md
## 变更内容

## 验证

## 风险与备注
```

- 修复类：复现路径、根因、验证方式。
- 功能类：用户可见变化、关键实现位置、风险点。
- 涉及匹配地址、更新地址、权限、入口、产物命名、`pnpm-lock.yaml` 时，必须写明影响范围。
- 已运行的验证命令写进「验证」；若跳过某项，说明原因。

#### 快速对照

| 场景 | 建议标题 |
| --- | --- |
| 记牌器协议同步 bug | `fix(tracker): 修复特殊移动后手牌候选漂移` |
| 新快捷键 | `feat: 新增记牌器显隐快捷键` |
| 仅文档 | `docs: 补充 Commits 与 PR 标题约定` |
| 仅 CI | `ci: retarget feature PRs from main to dev` |
| 依赖升级 | `build(deps): bump vitest from 3 to 4` |
| 生命周期重构 | `refactor: 统一对局重置与 Room 销毁时序` |

#### 明确避免

- 无 type 的自由标题：`fix tracker convergence and route start validation`
- 过程性标题：`Apply suggestions from code review`、`fix: review feedback`
- 文件路径当标题：`Update src/logic.js`
- 一次提交混入格式化全仓、无关锁文件、生成产物
- 用 PR 标题承诺未做的验证，或把临时调试日志当作功能提交
