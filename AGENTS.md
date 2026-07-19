# Agent Instructions

> Scope: This file is the entrypoint. It keeps only always-on rules; task details live in docs/agents/.

## Core Principles

- **语言偏好**：始终使用 "简体中文" (zh-CN) 进行思考与交流。
- **本机环境差异**：仓库文档只记录跨环境通用规则；终端 Shell、沙箱/权限限制、检索工具回退等开发者本机差异写入 Serena 记忆，执行命令前按需读取 `mem:local_environment` 与 `mem:suggested_commands`。
- **依赖最小化**：使用 pnpm 作为包管理器，不依赖或提交构建产物（如 `dist/`）；`pnpm-lock.yaml` 当前为仓库跟踪文件，除依赖或版本任务外不要无关改动。本地环境配置 `.env` 现已不再被 Git 跟踪。
- **渐进披露**：本文件是一个轻量级规则路由，复杂的具体指导应在使用时按需读取 `docs/agents/` 下对应的文档。

## Read-On-Demand Index

| 任务类型 / 关注方向 | 需优先阅读的文档 | 触发场景 |
| --- | --- | --- |
| 项目结构、核心模块划分、废弃能力清单、重构历史 | [`docs/agents/overview.md`](docs/agents/overview.md) | 需要检索某一模块的代码位置、定位核心协议处理器、或确认某一特定模块是否已被废弃。 |
| 环境配置、构建指令、命令行工具使用、本机环境记忆路由 | [`docs/agents/environment.md`](docs/agents/environment.md) | 需要执行 `pnpm build`、启动开发服务器、执行文件检索、或对 HTML 资源部署流程进行修改。 |
| 代码约定、Style Guide、Prettier/ESLint/EditorConfig、Vite 别名、模块边界、Commits/PR 约定 | [`docs/agents/conventions.md`](docs/agents/conventions.md) | 修改或新增 JS/HTML/TS 代码、调整全局 Proxy 配置项、执行 Lint、撰写 commit/PR 标题、或准备 PR 提交；详细测试策略见 testing.md。 |
| Serena 记忆库、同步状态与引用对齐检查 | [`docs/agents/serena.md`](docs/agents/serena.md) | 需要操作 `serena` 工具链、管理或修改 `mem:*` 格式的记忆文件。 |
| 测试策略、回归命令、补测约定、手工验收清单 | [`docs/agents/testing.md`](docs/agents/testing.md) | 选择验证命令、补充 Vitest 回归、更新遍历基线、撰写 PR 验证说明，或做浏览器手工验收时。 |
| 记牌器当前实现、历史设计、重构方案与领域验证清单 | [`docs/agents/card_tracker.md`](docs/agents/card_tracker.md) | 继续推进记牌器能力演进、排查协议同步异常、理解旧链表/Seats 方案或完善领域单测时。 |
| 协议样例与适配说明索引 | [`docs/protocols/README.md`](docs/protocols/README.md) | 按 className / SpellID / 通用模式定位 `docs/protocols/` 专页时。 |
| 应用全局生命周期、页面与 UI 框架注入流程、记牌器 Room/View 挂载与对局运行周期 | [`docs/agents/lifecycle.md`](docs/agents/lifecycle.md) | 需要理清小抄初始化与销毁时序、了解 Room 创建与 View 挂载机制、或排查消息分发链路时。 |
| 终端执行、跨 Shell 命令与避坑指南 | [`docs/agents/commands.md`](docs/agents/commands.md) | 需要执行构建、校验、文本检索或文件操作命令时。 |

## Project Core Specifications

- **保留功能范围**：记牌器（`src/tracker/` 已从影子模式切换为主动运行）、山河图信息展示、斗地主记牌、聊天基础过滤、本地设置。已彻底清理或隔离非保留能力（如旧 Laya 自动化、后端网络集成等）。
- **技术栈**：JavaScript/TypeScript ESM + Vite + vite-plugin-monkey + pnpm；运行时状态与记牌器核心位于 `src/tracker/`，不再存在 `src/context/` 主动实现；不提交构建产物与本地 `.env` 文件，不要无关删除或重生成已跟踪的 `pnpm-lock.yaml`。
- **编码规范**：EditorConfig（UTF-8, 2空格, LF换行符）/ Prettier（单引号, 无分号, 无尾随逗号）/ ESLint flat config (`eslint.config.js`，包含项目特定全局变量如 Laya、JSZip 等）。
- **任务完成核验流程**：代码修改后运行 `pnpm lint` 与 `pnpm build`；涉及 TypeScript 类型契约、`tsconfig*` 或 tracker 类型迁移时运行 `pnpm typecheck:tracker`，必要时运行 `pnpm typecheck`；涉及 `src/tracker/` 或 `tests/tracker/` 时额外运行 `pnpm test:tracker`；涉及发布、打包配置或记牌器核心风险变更时额外运行 `pnpm build:prod`；仅修改文档无需构建；修改记忆后运行 `serena memories check` 确认引用对齐。

## Always-On Rules

- **换行符规范**：当前工作区中所有文件的换行符均为 **LF (`\n`)**。在生成代码修改参数或编辑现有文件时，必须严格使用 `\n` 作为换行符，避免重新引入 CRLF。
- **包管理器**：必须严格使用 `pnpm` 进行依赖的安装和管理。
- **代码修改约束**：修改局部代码时保持 2 空格缩进，除非有明确命令，否则不做无关的全局格式化。
- **本机环境记忆**：涉及终端、Shell、沙箱限制或检索工具回退时，先读取 Serena 记忆；不要把当前开发者的本机环境假定写入仓库文档。
- **MCP 优先**：如果可用的工具能够满足需求，优先调用 MCP 工具而不是运行终端命令。
- **文档不绑行号**：`docs/agents/` 与项目说明只引用文件路径与符号名，禁止绑定源码行号（markdown 链接 hash 中的 L 行号或 `路径:行号` 文案），避免代码移动后失效。

## Priority

1. 用户当前的显式指令。
2. 邻近的项目说明文件（如本文件）。
3. 本文件。
4. 路由到的 `docs/agents/` 详细规则。
