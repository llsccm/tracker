# 环境指南与开发提示

> 💡 当你需要配置开发环境、执行脚本命令（如构建、格式化、代码检查）、理解文件系统结构以及与 HTML 资源交互时，请阅读本文档。具体操作系统、Shell、沙箱限制与检索工具回退属于本机环境差异，执行命令前先读取 Serena 记忆 `mem:local_environment` 与 `mem:suggested_commands`。

---

## 开发环境提示

- 使用 `pnpm` 作为包管理器。
- 安装依赖：`pnpm install`。
- 启动开发服务器：`pnpm dev`。
- 开发模式构建：`pnpm build`。
- 生产模式构建：`pnpm build:prod`。
- 预览构建结果：`pnpm preview`。
- 代码格式化：`pnpm format`。
- 代码检查：`pnpm lint`。
- 全量 TypeScript 类型检查：`pnpm typecheck`。
- 记牌器 TypeScript 类型检查：`pnpm typecheck:tracker`。
- 记牌器回归测试：`pnpm test:tracker`。
- 仓库文档不强制指定开发者操作系统或默认 Shell；优先使用 `pnpm` 脚本和可用 MCP 工具，外部命令按本机 Serena 记忆选择等价写法。
- 终端、Shell、沙箱/权限限制与检索工具回退属于本机环境差异；不要把当前开发者的本机环境假定写回仓库文档。
- 不要依赖或提交构建产物 `dist/` 与本地 `.env` 配置文件；`pnpm-lock.yaml` 当前为仓库跟踪文件，除依赖或版本任务外不要无关删除、重生成或格式化。
- 界面 HTML 已改为从外部 URL 加载（通过 `src/utils/htmlResource.js`），不再依赖构建时 HTML 转 JS 生成链。
- `html/iframe.html` 是界面 HTML 源文件，部署到远端后由脚本运行时加载。

- 测试策略、补测约定与手工验收见 [testing.md](testing.md)。
- 记牌器常用方法调用速查见 [tracker_api.md](tracker_api.md)。
- 协议回放文档与 `tests/replay/` 仅在任务明确涉及回放时读取，见 [replay.md](replay.md)。
