# Phase F（P2-2）：拆分 `src/logic.js` 消息路由与支持断线重连降级建局

> 导航：[总览](tracker_architecture_refactoring_plan.md) · [Phase E](tracker_architecture_phase_e.md)
>
> 状态：F1 已按收窄范围提取客户端增强与用户会话处理模块；F2 待执行，实施前需按当前源码核对。

## 1. 根因剖析

1. **`src/logic.js` 职责过载与开局主视角识别分散**：
   - 拆分前，`src/logic.js` 承担了消息白名单过滤、录制器调用、登录 UUID 提取、皮肤/击杀特效屏蔽、弹窗自动关闭、心愿池提示、山河图同步以及全部记牌器协议分发；本次提取其中的客户端增强与用户会话职责。
   - 主视角 `mySeatID` 的识别散落在 4 个不同地方：`Room.registerPlayers`（匹配 `user.userID`）、`logic.js` 的 `GsCUpdateRoleDataNtf (StateID === 58)`、`logic.js` 的 `SmsgGameSetCharacter`（斗地主/山河图单人选将）、以及 `src/handler/gameFlowState.js`（录像首次摸明牌）。
2. **断线重连（`MsgReconnectGame`）完全放弃当局记牌**：
   - 收到 `MsgReconnectGame` 后，`Game.isDuanXian = true`，`TrackerController.isTrackerReady()` 直接返回 `false` 并 `unmount()` 视图，导致玩家在断线重连后整局失去记牌辅助（连场面已知装备、后续弃牌堆和各角色明牌都无法查看）。

## 2. 具体重构方案

### 步骤 F1：提取客户端增强与用户会话处理（已完成）

保留 `src/logic.js` 的单一 `switch`，仅提取两个处理模块，不以入口行数为目标：

- `src/handler/clientEnhancements.js`：按功能导出普通处理函数，负责皮肤/击杀特效屏蔽、广告/开包弹窗关闭、房间口号处理及心愿池提示；内部不再按协议名分发。
- `src/handler/userSession.js`：负责首次用户 ID 与昵称同步、调用 `initFrame()` 及面板用户信息展示；模块内维护可提供用户身份的消息集合。

入口顺序保持为消息预检与连续结束消息去重、协议录制、功能白名单、用户会话处理、`switch` 分发。
皮肤与特效处理同步修改原消息对象，等待窗口和面板初始化的异步操作由处理函数自行捕获错误。

本次不新增 tracker 子路由或 `PerspectiveResolver`；对局生命周期、主视角判定、聊天与山河图继续使用现有路径。

### 步骤 F2：实现断线重连的“残局降级追踪模式（Degraded Mode）”

将 `Game.isDuanXian` 从“彻底禁用记牌器”改为 `Room.trackingMode: 'full' | 'degraded'`：

- 当收到 `MsgReconnectGame` 时，不卸载视图，而是将当前 `Room` 切换为 `'degraded'` 模式（UI 顶部状态栏提示“断线重连：残局受限追踪”）；
- 在 `'degraded'` 模式下：
  - 关闭依赖完整开局牌堆守恒的强收敛（如 `assertPileIdentityLedgerConsistency` 和未知牌堆容量告警）；
  - 继续正常记录重连之后的所有明牌移动、弃牌堆新增、装备/判定/标记区变动以及玩家手牌差量；
  - 当后续发生洗牌（`2 -> 9`）且协议给出明确的 `CardCount` 时，以该 `CardCount` 重新锚定牌堆物理槽数量，逐步恢复牌堆数量追踪。

## 3. 提交拆分与验证命令

- **PR 1**：`refactor(handler): extract client enhancements and user session handling`
- **PR 2**：`feat(tracker): support degraded tracking mode after MsgReconnectGame`
- **F1 验证门槛**：`pnpm lint`、`pnpm build` 与已有协议路由回归 `pnpm exec vitest run tests/tracker/gameRecordInitRoutes.test.ts`；客户端与用户信息展示通过手工验收，不新增 UI 自动化测试。
- **F2 验证门槛**：`pnpm test:tracker`、`pnpm typecheck`、`pnpm lint`、`pnpm build` 与 `pnpm build:prod`。
