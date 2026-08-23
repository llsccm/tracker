# CLAUDE.md

本文件只记录 **Claude Code 专属** 的工作规则。

## 规则来源

项目通用规则（语言偏好、技术栈与保留范围、编码规范、换行符与格式、包管理器、检索顺序、核验命令、文档路由）一律以 [`AGENTS.md`](AGENTS.md) 为准，按需读取它路由到的 `docs/agents/` 文档：

- 项目结构与模块地图 → [`docs/agents/overview.md`](docs/agents/overview.md)
- 记牌器内部实现与风险清单 → [`docs/agents/card_tracker.md`](docs/agents/card_tracker.md)
- 消息分发链路、Room/View 挂载时序 → [`docs/agents/lifecycle.md`](docs/agents/lifecycle.md)
- 代码约定与 PR 约定 → [`docs/agents/conventions.md`](docs/agents/conventions.md)
- 命令与验证策略 → [`docs/agents/commands.md`](docs/agents/commands.md)、[`docs/agents/testing.md`](docs/agents/testing.md)

以上内容不在本文件重复；两者冲突时以 `AGENTS.md` 为准。

## Claude Code 专属规则

1. **后台任务隔离（Background Session Isolation Only）**
   - 仅当处于**后台非交互式 Session** 且**当前工作目录尚未处于隔离工作树**时，才在修改代码前调用 `EnterWorktree`，防止多 Job 冲突。
   - 正常交互式 Session 或已处于开发分支/工作树下时，直接在当前目录修改。
   - 创建工作树或执行 `git commit` 前先向用户确认。

2. **读取先于编辑（Read-Before-Edit）**
   - 修改或覆盖已有文件前，必须在当前 Session 中用 `Read`（或 Serena 检索工具）读过目标文件。
   - 对现有文件优先用 `Edit` 精准替换或 Serena `replace_content` / 符号编辑工具；仅在新建文件或彻底重写时用 `Write`。

3. **最小化 Diff**
   - 只改目标逻辑，不做无关的全文件格式化或顺带改动。
