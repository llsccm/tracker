# 贡献指南

感谢你愿意参与 `tracker`。本项目仍处于持续整理和重构阶段，贡献时请尽量保持改动聚焦、可验证，并优先沿用现有模块边界与代码风格。

## 开始之前

- 使用 `pnpm` 管理依赖，不要混用 npm、Yarn 或 Bun。
- 安装依赖：

```sh
pnpm install
```

- 启动开发服务器：

```sh
pnpm dev
```

- 构建开发模式产物：

```sh
pnpm build
```

## 项目范围

当前保留并维护的能力主要包括：

- 记牌器：`src/tracker/` 是当前主动运行的记牌器核心。
- 山河图信息展示。
- 聊天基础过滤与本地设置。

已清理或隔离的历史能力不应重新接入普通运行路径，包括自动化等。

## 目录速览

- `src/index.js`：用户脚本主入口。
- `src/dom.js` 与 `src/ui/`：界面注入、窗口、拖拽、tooltip、山河图 UI 等。
- `src/logic.js`：游戏消息路由和核心编排。
- `src/handler/`：协议消息处理器。
- `src/tracker/`：当前记牌器运行时状态、推理模型和视图。
- `src/config/`：远端配置解析。
- `tests/tracker/`：记牌器 Vitest 回归测试。
- `tests/contracts/pile-identity/`：牌堆身份纯模型与长期可证伪契约。
- `html/iframe.html`：界面 HTML 源文件，运行时从外部 URL 加载。

更详细的模块说明见 `docs/agents/overview.md`；记牌器设计和风险清单见 `docs/agents/card_tracker.md`。

## 开发规范

- 项目使用 JavaScript/TypeScript ESM，`package.json` 中配置了 `"type": "module"`。
- 缩进使用 2 个空格。
- 所有文件使用 LF 换行。
- Prettier 规则：单引号、无分号、无尾随逗号、宽度 100。
- 修改局部代码时保持邻近代码风格，不做无关的全局格式化。
- Vite 别名 `@` 指向 `src/`。
- 目标页面会提供若干全局对象，例如 `Laya`、`JSZip`、`CtrUtil`、`SystemContext` 等；新增代码前请确认现有适配层是否已覆盖。

编码风格细节见 `docs/agents/conventions.md` 中的「Style Guide」，核心包括：

- 不要别名导入：禁止 `import { foo as bar }`。
- 优先 `const`，用三元或 early return 代替先声明再赋值。
- 避免 `else`，优先 early return。
- 复杂逻辑让主函数走 happy path，细节下沉到邻近 helper。
- 注释只写非显而易见的约束与意外行为。

## 变更边界

- 不提交构建产物，例如 `dist/`。
- 不提交 `node_modules/`。
- `pnpm-lock.yaml` 当前为跟踪文件；只有依赖、版本或安装解析变化相关任务才应修改它。
- 不要为了掩盖构建错误而忽略生成文件或扩大忽略规则。
- 修改 `html/iframe.html` 时，需要同步确认远端部署与运行时加载流程。

## 常用脚本

```sh
pnpm format
pnpm lint
pnpm build
pnpm build:prod
pnpm typecheck
pnpm typecheck:tracker
pnpm test:tracker
```

当前没有通用 `pnpm test` 脚本；记牌器相关测试使用 `pnpm test:tracker`。

## 验证要求

完整测试策略、补测约定与手工验收清单见 `docs/agents/testing.md`。

- 仅修改文档：无需运行构建或测试。
- 普通代码修改：运行 `pnpm lint` 与 `pnpm build`。
- 修改 `src/tracker/`、`tests/tracker/` 或 `tests/contracts/pile-identity/`：额外运行 `pnpm test:tracker`。
- 修改 TypeScript 类型契约、`tsconfig*`、ESLint TypeScript 覆盖范围或 tracker 类型迁移：运行 `pnpm typecheck:tracker`，必要时运行 `pnpm typecheck`。
- 修改发布配置、打包参数、用户脚本元信息、构建产物命名或记牌器核心高风险路径：额外运行 `pnpm build:prod`。
- 新增或修改生产推理逻辑时，优先补充 `tests/tracker/` 回归；不接生产状态的长期模型契约放在 `tests/contracts/`，外围工具逻辑可放 `tests/utils/`。

## 记牌器贡献提示

`src/tracker/` 是当前唯一主动运行的记牌器状态源。贡献记牌器相关能力前，请先阅读 `docs/agents/card_tracker.md`，尤其注意：

- `Room` 是单局状态容器。
- `CardLocationIndex` 负责区域投影。
- `ConstraintGroup` 只表达局部候选包约束，避免全局过度收敛。
- `subZoneCandidates` 表达完整位置候选，不能被 `seats` 或 `owner` 简化替代。
- `src/handler/legacyMoveCard.js` 与 `src/handler/old/` 是历史代码，不应作为新增运行路径依赖。

## 提交与 PR

提交与 PR 标题请遵循 Conventional Commits，完整约定见 `docs/agents/conventions.md` 中的「PR 与提交」。

### 标题速查

```text
<type>(optional-scope): <subject>
```

常用 type：`feat`、`fix`、`refactor`、`perf`、`test`、`docs`、`ci`、`build`、`chore`。

常用 scope：`tracker`、`ui`、`handler`、`config`、`ci`、`deps`。

示例：

- `feat: 新增裴秀地图路线助手`
- `fix(tracker): 修复特殊移动后手牌候选漂移`
- `ci: publish GitHub Releases from tags`
- `build(deps): bump actions/checkout from 4 to 7`

注意：

- 一个提交 / 一个 PR 一个主题；标题说结果，不说文件路径或 review 过程。
- 冒号后保留空格；标题不加句号，不手写 `#编号`。
- 中英文均可，同一 PR 内保持一致；用户可见与游戏语义优先中文。
- 默认 PR 目标分支为 `dev`；仅发布向 `dev -> main` 可指向 `main`。
- 若使用 squash merge，PR 标题即最终提交标题，开 PR 时写对。

### 提交前确认

- 改动范围聚焦，没有夹带无关格式化或生成文件。
- 已运行适用的验证命令，或在 PR 中说明未运行原因。
- 依赖、环境变量、用户脚本元信息、匹配地址、权限或更新地址如有变化，已在 PR 描述中明确说明影响范围。
- 修复类 PR 请说明复现路径、根因和验证方式。
- 功能类 PR 请说明用户可见变化、关键实现位置和风险点。

推荐 PR 描述结构：

```md
## 变更内容

## 验证

## 风险与备注
```

## 文档入口

贡献前如需更细的规则，请按任务类型阅读：

- `docs/agents/environment.md`：环境、脚本和构建说明。
- `docs/agents/conventions.md`：代码约定、Style Guide、验证门槛和 PR 要求。
- `docs/agents/testing.md`：测试策略、补测约定与手工验收清单。
- `docs/agents/overview.md`：项目结构与保留范围。
- `docs/agents/card_tracker.md`：记牌器当前实现、设计背景和风险清单。
- `docs/agents/lifecycle.md`：应用生命周期、页面注入和 Room/View 挂载时序。
