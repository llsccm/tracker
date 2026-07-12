# 代码约定与工程规范

> 💡 当你需要编写、重构或审阅本项目的代码，了解模块设计约定、全局上下文配置代理、代码风格、格式化工具配置，以及测试与提交规范时，请阅读本文档。

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

## 测试与验证说明

- `package.json` 已配置 `format`（Prettier）、`lint`（ESLint）、`typecheck`、`typecheck:tracker` 与 `test:tracker`（Vitest 记牌器回归）脚本；当前尚未配置通用 `test` 脚本。
- 修改文档无需运行构建测试。
- 完成普通代码修改后运行：`pnpm lint` 与 `pnpm build`。
- 修改 TypeScript 类型契约、`tsconfig*`、ESLint TypeScript 覆盖范围或 tracker 类型迁移相关代码后运行：`pnpm typecheck:tracker`；需要确认全仓类型入口时运行 `pnpm typecheck`。
- 修改 `src/tracker/` 或 `tests/tracker/` 后额外运行：`pnpm test:tracker`。
- 修改发布配置、打包参数、用户脚本元信息或记牌器核心高风险路径后，额外运行：`pnpm build:prod`。
- 修改 `html/iframe.html` 后需确认远端部署与界面加载流程正常。
- 重构阶段（保守重构 + 细粒度重构）已完成至 F-lite；新版记牌器重构主动接入已完成，完全从影子模式切换为主动运行模式，旧版写路径已从普通运行链路移除；`src/tracker/` 是当前唯一主动记牌器状态源；`src/` 下 `autoBot`、`autoTask`、`secKill`、`CDK`、`skinPaper`、`effectBlock`、`generalAppearance`、`layaWindow` 无残留。
- 如果新增脚本或工具命令，请同步更新 `package.json` 与相关文档。
- 修复构建错误后再提交；不要用忽略生成文件的方式掩盖构建问题。

---

## PR 与提交要求

- 提交前确认：
  - 相关代码已按本文件约定调整。
  - 已运行适用的构建验证命令。
  - 未提交 `dist/`、`node_modules/` 等生成目录以及本地 `.env` 配置文件；`pnpm-lock.yaml` 当前已跟踪，仅在依赖或版本任务中改动并说明原因。
- 变更涉及用户脚本匹配地址、更新地址、权限、入口或构建产物命名时，在 PR 描述中明确说明影响范围。
