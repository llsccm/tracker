# 命令行执行指南

> 💡 当你需要执行终端命令、处理 Shell 差异、解决字符编码或特殊字符转义问题时，请阅读本文档。具体本机操作系统、默认 Shell、沙箱/权限限制与工具回退方案应读取 Serena 记忆 `mem:local_environment`；项目常用脚本读取 `mem:suggested_commands`。

---

## 终端与 Shell 规范

- **不指定本机环境**：仓库文档不强制声明开发者操作系统、默认 Shell 或终端实现；这些信息属于本机环境记忆。
- **MCP 优先**：如果可用 MCP 工具能满足需求，优先使用 MCP 工具；确需终端时，再按本机 Shell 语法执行。
- **识别 Shell**：先识别当前终端类型；识别为 PowerShell 时直接执行 PowerShell 命令，不要额外嵌套 `pwsh -NoLogo -NoProfile -Command`。当前终端不是 PowerShell 时，如需执行 PowerShell 命令，再使用 `pwsh -NoLogo -NoProfile -Command`。
- **错误处理**：PowerShell 命令开头包含 `$ErrorActionPreference = 'Stop';`。
- **文件编码**：读写文件时显式指定 `-Encoding UTF8`。
- **编码设定**：优先确保控制台输出为 UTF-8；若某个本机 Shell 需要额外设置，把具体写法维护在 Serena 记忆中。
- **换行符约束**：创建或修改本工作区的所有文件（包括此文档）时，必须严格使用 **LF (\n)** 作为换行符，避免重新引入 CRLF。
- **命令拆分**：执行检索、构建、校验等任务时，优先使用单一、可读、可复现的命令；避免为了省事拼接复杂命令。

---

## 通用项目脚本

- 安装依赖：`pnpm install`
- 启动开发服务器：`pnpm dev`
- 开发模式构建：`pnpm build`
- 生产模式构建：`pnpm build:prod`
- 预览构建产物：`pnpm preview`
- 格式化源码：`pnpm format`
- 代码检查：`pnpm lint`
- 全量 TypeScript 类型检查：`pnpm typecheck`
- 记牌器 TypeScript 类型检查：`pnpm typecheck:tracker`
- 记牌器回归测试：`pnpm test:tracker`

---

## 检索与文件查看

- 文件与文本检索优先使用可用 MCP 工具；需要终端检索时，可用环境中优先使用 `rg --files` 与 `rg "关键词"`。
- 若 `rg` 或其他外部检索工具不可用、被系统拦截或输出异常，读取 `mem:local_environment` 中记录的本机等价命令，不要把该回退写法固化进仓库文档。
- 查看文件时优先使用 MCP 或编辑器能力；需要终端读取时，同样按本机 Shell 的等价命令执行。

---

## 构建与校验指令

在修改代码后，按影响范围执行以下校验：

- **依赖管理**：严格使用 `pnpm install` 安装依赖，避免产生其他包管理器锁文件。
- **静态检查**：普通代码修改后运行 `pnpm lint`。
- **构建测试**：普通代码修改后运行 `pnpm build`。
- **类型检查**：修改 TypeScript 类型契约、`tsconfig*`、ESLint TypeScript 覆盖范围或 tracker 类型迁移相关代码后运行 `pnpm typecheck:tracker`；需要确认全仓类型入口时运行 `pnpm typecheck`。
- **记牌器测试**：修改 `src/tracker/`、`tests/tracker/` 或 `tests/contracts/pile-identity/` 后运行 `pnpm test:tracker`。
- **生产构建**：修改打包配置、核心协议、用户脚本元信息或准备发布时运行 `pnpm build:prod`。

---

## 常见避坑指南

- **避免复杂串联**：不要用多个 Shell 运算符拼接过多步骤；跨 Shell 语法差异容易造成失败，也会让输出难以解析。
- **路径分隔符**：涉及外部原生 CLI 时，确保路径写法与当前本机环境一致。
- **本机回退留在记忆中**：沙箱限制、终端权限、检索工具失败回退等环境细节只维护在 Serena 记忆，不写成项目通用规则。
- **绝对路径校验**：执行删除或移动操作前，必须显式核对绝对路径，避免误删工作区外或系统关键目录。
