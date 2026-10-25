# Phase E（P2-1）：清理死代码与开启 TypeScript 严格类型检查

> 导航：[总览](tracker_architecture_refactoring_plan.md) · [Phase D](tracker_architecture_phase_d.md) · [Phase F](tracker_architecture_phase_f.md)
>
> 状态：第 2 项严格模式已完成；其余项目独立推进，实施前按当前源码核对。

## 1. 根因剖析

1. **悬挂导入隐患**：`src/utils/generalTip.js` 第 1 行仍保留 `import { hasAdvancedFeature, notifyAdvancedFeatureTrial } from './trial.js'`，而 `src/utils/trial.js` 已被删除（`docs/agents/overview.md` 中也标注了“属待清理残留”）。
2. **严格类型检查缺失**：原先 `tsconfig.tracker.json` 继承根配置的 `"strict": false`，内部可空状态、查询结果和回调参数没有受到完整检查。现已在 tracker 生产 TypeScript 范围启用严格检查，根配置继续兼容外围 JS 与现有测试。
3. **缺少统一的 `pnpm test` 脚本**：`package.json` 只有 `test:tracker`，未将 `tests/runtime/` 与 `tests/utils/` 纳入统一测试入口。

## 2. 具体重构方案

1. **清理 `src/utils/generalTip.js`**：
   移除对 `./trial.js` 的导入与调用（或若 `generalTip.js` 仅服务于已注释的 `hpColor`，直接移除 `trial.js` 判断并保留纯 Laya 文本绘制能力）：
   ```js
   // src/utils/generalTip.js
   export function setGeneralTip({
     key,
     seatUis = [],
     seat = null,
     avatar = null,
     text = '',
     getText = null
   } = {}) {
     if (!key) return
     const list = avatar ? [{ seat: avatar.seat, seatAvatar: avatar }] : seatUis
     list.forEach((ui) => {
       if (seat && ui?.seat != seat) return
       const card = ui?.seatAvatar
       if (!card) return
       const value = typeof getText == 'function' ? getText(ui) : text
       const content = value ? String(value) : ''
       // ...保留后续 Laya.Text 渲染逻辑
     })
   }
   ```
2. **在 `tsconfig.tracker.json` 中率先启用严格模式（已完成）**：
   根目录 `tsconfig.json` 保持非严格检查；`tsconfig.tracker.json` 开启：
   ```json
   {
     "extends": "./tsconfig.json",
     "compilerOptions": {
       "allowJs": true,
       "checkJs": false,
       "noEmit": true,
       "strict": true,
       "noImplicitOverride": true
     }
   }
   ```
   - 严格检查入口保留 `src/tracker/**/*.ts`、`src/handler/skills/**/*.ts` 与全局声明；移除测试入口。测试继续由根配置 `pnpm typecheck` 检查，并运行 `pnpm test:tracker`，严格迁移单独安排。
   - `allowJs: true` 让 tracker 导入的外围 JS 提供类型推导，`checkJs: false` 保持 JS 自身不参与诊断，避免给这些模块添加空泛的 `any` 声明。
   - 修复可空位置候选、Map 查询、协议映射返回类型和回调收窄；为骋烈临时状态补充具体类型。
   - 原始协议 `SpellID` 仍是必填数字，`0` 表示与技能无关；真实玩家座位为 `0–7`。内部未确定视角、非玩家端点、无标记空间等可空状态由各字段明确表达，不把缺失座位转换成 `0`。
   - CI 增加 `pnpm typecheck:tracker`，使生产严格检查与根配置检查同时执行。
3. **补齐 `package.json` 的 `test` 脚本**：
   增加 `"test": "vitest run"`（默认 `vitest.config.js` 已排除 `tests/replay`），同时覆盖 `tests/tracker`、`tests/contracts`、`tests/runtime` 与 `tests/utils`。

## 3. 提交拆分与验证命令

- **PR 1**：`chore: remove dead trial.js import in generalTip and add pnpm test script`
- **PR 2**：`refactor(tracker): enable TypeScript strict mode in tsconfig.tracker.json`
- **验证门槛**：`pnpm typecheck:tracker && pnpm typecheck && pnpm test:tracker && pnpm lint && pnpm build`
