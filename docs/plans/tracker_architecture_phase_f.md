# Phase F（P2-2）：拆分 `src/logic.js` 消息路由与支持断线重连降级建局

> 导航：[总览](tracker_architecture_refactoring_plan.md) · [Phase E](tracker_architecture_phase_e.md)
>
> 状态：待执行；以下为阶段设计方案，实施前需按当前源码核对。

## 1. 根因剖析

1. **`src/logic.js` 职责过载与开局主视角识别分散**：
   - `src/logic.js` 承担了消息白名单过滤、录制器调用、登录 UUID 提取、皮肤/击杀特效屏蔽、弹窗自动关闭、心愿池提示、山河图同步以及全部记牌器协议分发。
   - 主视角 `mySeatID` 的识别散落在 4 个不同地方：`Room.registerPlayers`（匹配 `user.userID`）、`logic.js` 的 `GsCUpdateRoleDataNtf (StateID === 58)`、`logic.js` 的 `SmsgGameSetCharacter`（斗地主/山河图单人选将）、以及 `src/handler/gameFlowState.js`（录像首次摸明牌）。
2. **断线重连（`MsgReconnectGame`）完全放弃当局记牌**：
   - 收到 `MsgReconnectGame` 后，`Game.isDuanXian = true`，`TrackerController.isTrackerReady()` 直接返回 `false` 并 `unmount()` 视图，导致玩家在断线重连后整局失去记牌辅助（连场面已知装备、后续弃牌堆和各角色明牌都无法查看）。

## 2. 具体重构方案

### 步骤 F1：按领域拆分 `src/logic.js` 并收口 `PerspectiveResolver`

将 `src/logic.js` 瘦身为不到 80 行的顶层调度器，按职责拆分为三个子路由模块：

- `src/handler/trackerRouter.ts`：专门处理记牌器生命周期、选将、回合阶段与卡牌移动消息；
- `src/handler/clientEnhancementRouter.js`：处理皮肤屏蔽、击杀特效、开包弹窗、心愿池、聊天与广播；
- `src/tracker/runtime/perspectiveResolver.ts`：集中管理“主视角座位判定策略”（UUID 匹配 $\rightarrow$ 2v2 阵营语音 `StateID=58` $\rightarrow$ 斗地主/山河图选将 $\rightarrow$ 录像首摸明牌），消除多处散落的 `if (Game.isRecord && Game.myID === undefined)`。

### 步骤 F2：实现断线重连的“残局降级追踪模式（Degraded Mode）”

将 `Game.isDuanXian` 从“彻底禁用记牌器”改为 `Room.trackingMode: 'full' | 'degraded'`：

- 当收到 `MsgReconnectGame` 时，不卸载视图，而是将当前 `Room` 切换为 `'degraded'` 模式（UI 顶部状态栏提示“断线重连：残局受限追踪”）；
- 在 `'degraded'` 模式下：
  - 关闭依赖完整开局牌堆守恒的强收敛（如 `assertPileIdentityLedgerConsistency` 和未知牌堆容量告警）；
  - 继续正常记录重连之后的所有明牌移动、弃牌堆新增、装备/判定/标记区变动以及玩家手牌差量；
  - 当后续发生洗牌（`2 -> 9`）且协议给出明确的 `CardCount` 时，以该 `CardCount` 重新锚定牌堆物理槽数量，逐步恢复牌堆数量追踪。

## 3. 提交拆分与验证命令

- **PR 1**：`refactor(handler): split logic.js into domain routers and unify perspective resolver`
- **PR 2**：`feat(tracker): support degraded tracking mode after MsgReconnectGame`
- **验证门槛**：`pnpm test:tracker && pnpm typecheck && pnpm lint && pnpm build && pnpm build:prod`
