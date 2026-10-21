# Serena 记忆管理与对齐

> 💡 当你需要检查或同步 Serena 记忆库、检查对齐重构进度、或管理记忆一致性时，请阅读本文档。

---

## 接入方式（REPL）

- 本项目 Serena 以单一 REPL 工具接入；记忆、符号检索与编辑都通过 `s` 的 facade 调用，没有独立 MCP 工具。
- 记忆：`s.mem.list_memories` / `read_memory` / `write_memory` / `edit_memory` / `rename_memory` / `delete_memory`；改写记忆优先使用这些工具，不直接编辑 `.serena/memories/*.md`。
- 代码：`s.lsp.get_symbols_overview` / `s.lsp.find_symbol` / `s.lsp.find_referencing_symbols` / `s.lsp.rename_symbol`；文本与文件搜索用 `s.fs.search_for_pattern` / `s.fs.find_file` / `s.fs.read_file`；内容编辑用 `s.edit.*`。
- 不确定签名时先调用 `s.info("<facade>")` 或 `s.info("<facade>.<method>")`；REPL 只返回最后一个表达式的值。

---

## Serena 记忆

- 项目已完成 Serena onboarding。
- 当前记忆状态需与项目实际进展同步：
  - `mem:core`：应反映保留范围为记牌器、山河图信息展示、斗地主记牌（`src/handler/doudizhu.js`）、聊天基础过滤、本地设置与裴秀路线/地图辅助；主动记牌器与运行时状态核心为 `src/tracker/`，`Room` 含 `CardLocationIndex` 区域投影；界面 HTML 为 `html/iframe.html`。记忆只写当前事实，不写已完成里程碑、已删除模块或改名历史。
  - `mem:tech_stack`：应反映 JavaScript/TypeScript ESM、ESLint flat config（`eslint.config.js`）、`@` 路径别名、`src/config/` 配置系统、`src/tracker/` 当前状态与记牌器核心、`pnpm-lock.yaml` 是仓库跟踪文件、`typecheck` / `typecheck:tracker` / `test:tracker` 脚本，以及界面 HTML（`html/iframe.html`）通过运行时加载且无转译逻辑，`.env` 不在版本控制内。
  - `mem:conventions`：应反映默认中文、LF、pnpm、工具优先级（自带工具 → MCP → Shell）、Serena REPL facade 用法（`s.mem` / `s.lsp` / `s.fs` / `s.edit`）、`pnpm-lock.yaml` 为仓库跟踪文件且不要无关改动，`.env` 不在版本控制内；同时保持 `globalConfig` 位于 `src/tracker/state.ts`，活跃配置项以 `src/tracker/state.ts` 的 `ACTIVE_CONFIG_ENTRIES` 为准，`src/tracker/index.ts` 仅聚合共享状态入口、界面 HTML 为 `html/iframe.html` 且由外部加载、配置通过 `ConfigManager` 单例分发。
  - `mem:local_environment`：只负责要求执行命令前识别当前 Shell，并将 PowerShell 路由到 `mem:commands/powershell`、将 Bash 路由到 `mem:commands/bash`、将 Command Prompt（`cmd.exe`）路由到 `mem:commands/cmd`；不得按操作系统、默认配置或历史会话推断当前终端。
  - `mem:commands/powershell`：应保存 PowerShell 专用的执行、编码和原生命令回退规范，以及 `apply_patch`、Serena REPL 编辑工具（`s.edit.*` / `s.lsp.*`）、其他方式依次降级的编辑优先级。
  - `mem:commands/bash`：应保存 Bash 专用的执行与原生命令回退规范。
  - `mem:commands/cmd`：应保存 Command Prompt 专用的执行、编码和原生命令回退规范。
  - `mem:suggested_commands`：应包含 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm typecheck:tracker`、`pnpm test:tracker` 等跨 Shell 项目脚本，并通过 `mem:local_environment` 路由终端专用命令。
  - `mem:task_completion`：应反映文档-only 修改无需构建，代码修改需运行适用的 lint/build，TypeScript 类型相关变更需运行适用的 typecheck，tracker 变更（含 `tests/contracts/pile-identity/`）需运行 `pnpm test:tracker` 与 `pnpm typecheck:tracker`。
  - `mem:card_tracker`：应与 [`card_tracker.md`](card_tracker.md) 对齐，列出 `CardLocationIndex`、`locationCandidates`、`publicCandidates`、匿名实体与随机手牌转移的全实体候选、完整位置约束、洗牌协议张数与稳定负 ID 匿名占位、暗置标记候选与占位账本、玩家来源明牌残留公共区回补、暂停追踪、脏变更缓存、全牌池扫描的 `traversalBaseline` 插桩要求、视图脏渲染与 `trackerVisibility`，以及 `PileIdentityLedger` 为唯一生产身份权威；细节以 `docs/agents/` 下对应分册为准，只留指针与不可推导的不变量，不写迁移过程与验证历史。
  - `mem:memory_maintenance`：应反映 Serena 通过 REPL `s.mem.*` 维护记忆、重命名用 `s.mem.rename_memory` 自动更新 `mem:` 引用，并用 CLI `serena memories check` 校验引用对齐。
- 未来代理应优先阅读 `mem:core`，再根据任务读取 `mem:tech_stack`、`mem:conventions`、`mem:local_environment`、`mem:suggested_commands`、`mem:task_completion`、`mem:card_tracker`、`mem:memory_maintenance`；需要执行终端命令时，由 `mem:local_environment` 继续路由到对应的 Shell 命令记忆。
- `.serena` 目录已加入 `.gitignore`，记忆文件不会被提交到版本控制。
