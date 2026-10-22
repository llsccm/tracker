# Phase E（P2-1）：清理死代码与开启 TypeScript 严格类型检查

> 导航：[总览](tracker_architecture_refactoring_plan.md) · [Phase D](tracker_architecture_phase_d.md) · [Phase F](tracker_architecture_phase_f.md)
>
> 状态：待执行；以下为阶段设计方案，实施前需按当前源码核对。

## 1. 根因剖析

1. **悬挂导入隐患**：`src/utils/generalTip.js` 第 1 行仍保留 `import { hasAdvancedFeature, notifyAdvancedFeatureTrial } from './trial.js'`，而 `src/utils/trial.js` 已被删除（`docs/agents/overview.md` 中也标注了“属待清理残留”）。
2. **`tsconfig` 未开启 `strict`**：`tsconfig.json` 中 `"strict": false`，导致 `src/tracker/` 内部虽然已全面 TS 化，但 `strictNullChecks`、`noImplicitAny` 未生效。例如 `Room.ts` 中 `const pile = this.zones.get('pile')` 后直接调用 `pile.replaceAll(...)`、以及协议入参 `SeatID` 在部分边界可能为 `undefined` 的情况未被编译器强制拦截。
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
2. **在 `tsconfig.tracker.json` 中率先启用严格模式**：
   保持根目录 `tsconfig.json` 兼容外围 JS，先在 `tsconfig.tracker.json` 中开启：
   ```json
   {
     "extends": "./tsconfig.json",
     "compilerOptions": {
       "allowJs": false,
       "checkJs": false,
       "noEmit": true,
       "strict": true,
       "noImplicitOverride": true
     }
   }
   ```
   修复 `src/tracker/` 下约十余处可空断言（如 `Room.getPublicZone()` 返回非空 `Zone`、收窄 `Record` 索引返回类型）。
3. **补齐 `package.json` 的 `test` 脚本**：
   增加 `"test": "vitest run"`（默认 `vitest.config.js` 已排除 `tests/replay`），同时覆盖 `tests/tracker`、`tests/contracts`、`tests/runtime` 与 `tests/utils`。

## 3. 提交拆分与验证命令

- **PR 1**：`chore: remove dead trial.js import in generalTip and add pnpm test script`
- **PR 2**：`refactor(tracker): enable TypeScript strict mode in tsconfig.tracker.json`
- **验证门槛**：`pnpm typecheck:tracker && pnpm typecheck && pnpm test:tracker && pnpm lint && pnpm build`
