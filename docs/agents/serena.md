# Serena 记忆管理与对齐

> 💡 当你需要检查或同步 Serena 记忆库、检查对齐重构进度、或管理记忆一致性时，请阅读本文档。

---

## Serena 记忆

- 项目已完成 Serena onboarding。
- 当前记忆状态需与项目实际进展同步：
  - `mem:core`：应反映保守重构与细粒度重构已完成至 F-lite，保留范围为记牌器、山河图信息展示、斗地主记牌（`src/handler/doudizhu.js`）、聊天基础过滤与本地设置；当前主动记牌器与运行时状态核心为 `src/tracker/`，且 `Room` 已包含 `CardLocationIndex` 区域投影；界面 HTML 为 `html/iframe.html`。
  - `mem:tech_stack`：应反映 JavaScript/TypeScript ESM、ESLint flat config（`eslint.config.js`）、`@` 路径别名、`src/config/` 配置系统、`src/tracker/` 当前状态与记牌器核心、`pnpm-lock.yaml` 当前为仓库跟踪文件、`typecheck` / `typecheck:tracker` / `test:tracker` 脚本，以及界面 HTML（`html/iframe.html`）通过运行时加载且无转译逻辑，本地 `.env` 不再跟踪。
  - `mem:conventions`：应反映默认中文、LF、pnpm、MCP 优先、已跟踪 `pnpm-lock.yaml` 不要无关改动，本地 `.env` 不再跟踪；同时保持 `globalConfig` 位于 `src/tracker/state.ts`，活跃配置项以 `src/tracker/state.ts` 的 `ACTIVE_CONFIG_ENTRIES` 为准，`src/tracker/index.ts` 仅聚合共享状态入口、界面 HTML 为 `html/iframe.html` 且由外部加载、配置通过 `ConfigManager` 单例分发。
  - `mem:local_environment`：应反映当前开发者本机的操作系统、默认 Shell、沙箱/权限限制、编码设置与检索工具回退；这些环境差异不写入仓库通用文档。
  - `mem:suggested_commands`：应包含 `pnpm format`、`pnpm lint`、`pnpm typecheck`、`pnpm typecheck:tracker`、`pnpm test:tracker` 等项目脚本；具体本机 Shell 等价命令可引用 `mem:local_environment`。
  - `mem:task_completion`：应反映阶段 E、F-lite 已完成，`src/tracker/` 与 `src/config/` 重构已完成；文档-only 修改无需构建，代码修改需运行适用的 lint/build，TypeScript 类型相关变更需运行适用的 typecheck，tracker 变更需运行 `pnpm test:tracker` 与 `pnpm typecheck:tracker`。
  - `mem:card_tracker`：应与 [`card_tracker.md`](card_tracker.md) 对齐，反映新版记牌器重构主动接入已完成，完全从影子模式切换为主动运行，`src/refactor/` 已更名并归并为 `src/tracker/`，`src/context/` 主动实现已不存在；同时列出 `CardLocationIndex`、`locationCandidates`、`publicCandidates`、洗牌协议张数与 id=0 暗占位补齐、暗置标记候选与占位账本迁移、玩家来源明牌残留公共区回补、暂停追踪、脏变更缓存、仍未补齐的边缘推断、遗留文件清理与自动化回归测试缺口。
- 未来代理应优先阅读 `mem:core`，再根据任务读取 `mem:tech_stack`、`mem:conventions`、`mem:local_environment`、`mem:suggested_commands`、`mem:task_completion`、`mem:card_tracker`。
- `.serena` 目录已加入 `.gitignore`，记忆文件不会被提交到版本控制。
