# 三国杀打小抄记牌器（`src/tracker/`）按优先级架构重构方案

> **适用范围**：本方案严格遵循仓库现有代码规范（2 空格缩进、单引号、无分号、优先 `const` 与 early return、禁止 `import as` 别名、不新增 UI 自动化测试、遵循防御式编程信任边界与 Conventional Commits 规范），可直接作为 `plans/` 下的架构演进蓝图分 PR 落地。

## 优先级路线图总览

| 优先级   | 阶段代号                                       | 核心重构目标                                          | 解决的架构痛点                                                                                                          | 涉及主要文件                                                                                                                                                                                                          | 建议 PR 拆分 |
| :------- | :--------------------------------------------- | :---------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------- |
| **P0-1** | [**Phase A**](tracker_architecture_phase_a.md) | **内聚 `Room` 与 `PileIdentityLedger` 事务边界**      | 普通移动由 Controller 后置拼装账本事件、直接调 `Room.moveCards()` 导致账本失步、`revealPublicCandidate` 虚增场外实体    | `src/tracker/Room.ts`<br>`src/tracker/runtime/trackerController.ts`<br>`src/tracker/room/identity.ts`                                                                                                                 | 2 个 PR      |
| **P0-2** | [**Phase B**](tracker_architecture_phase_b.md) | **统一“三轨分裂”的技能扩展管线**                      | 技能分散在 `handler/skills/*`、`RoomMoveEvents`、`TrackerController` 硬编码钩子三处；混用 `spell` 与 `tracker` 状态空间 | `src/tracker/room/moveEvents.ts`<br>`src/tracker/skill/registerHandlers.ts`<br>`src/handler/PubGsCMoveCard.js`<br>`src/handler/skills/*`                                                                              | 3 个 PR      |
| **P1-1** | [**Phase C**](tracker_architecture_phase_c.md) | **抽象跨消息协议序列协调器（`ProtocolSequence`）**    | 诡伏、观虚、诫厉、天候、下书等跨协议技能各自手写散装状态，缺乏被其他技能/判定打断时的自动失效与诊断机制                 | `src/tracker/skill/protocolSequence.ts`<br>`src/tracker/skill/GuiFu.ts`<br>`src/tracker/skill/GuanXu.ts`<br>`src/tracker/skill/JieLi.ts`                                                                              | 2 个 PR      |
| **P1-2** | [**Phase D**](tracker_architecture_phase_d.md) | **升级公共空间建模、命名批次与数量约束**              | `exchange` 逻辑桶与区域成员分叉；缺少区间名额；无席位标记区无法通过通用收敛替代巧织/椒遇特例                            | `src/tracker/model/Zone.ts`<br>`src/tracker/skill/HandExchange.ts`<br>`src/tracker/constraint/ConstraintGroup.ts`<br>`src/tracker/room/movement/candidates.ts`<br>`src/tracker/room/movement/unassignedMarkSpaces.ts` | 4 个 PR      |
| **P2-1** | [**Phase E**](tracker_architecture_phase_e.md) | **清理死代码与开启 `tsconfig.tracker.json` 严格模式** | `src/utils/generalTip.js` 悬挂导入已删除的 `./trial.js`；`strict: false` 掩盖 `SeatID` / `null` 边界隐患                | `src/utils/generalTip.js`<br>`tsconfig.tracker.json`<br>`package.json`                                                                                                                                                | 2 个 PR      |
| **P2-2** | [**Phase F**](tracker_architecture_phase_f.md) | **拆分 `logic.js` 消息路由与支持断线重连降级建局**    | `logic.js` 400 行巨型 `switch` 耦合所有外围功能；`MsgReconnectGame` 直接令记牌器整局停摆                                | `src/logic.js`<br>`src/tracker/runtime/trackerController.ts`<br>`src/tracker/Room.ts`                                                                                                                                 | 2 个 PR      |

## 执行进度与阅读方式

- Phase A、Phase B 已完成；阶段执行记录、分支策略与验证结果分别保存在对应文档中。
- 下一阶段为 [Phase C](tracker_architecture_phase_c.md)；Phase C–F 仍为待执行方案。
- [Phase D](tracker_architecture_phase_d.md) 的 D3 待办补齐无席位标记区收敛后清理巧织/椒遇推断特例；全明场景复用现有精确名额约束，可独立于 D1/D2 落地，巧织明确身份通知继续保留。
- 本文件保留路线图和统一规范，各阶段文档独立维护根因、设计、提交拆分和验证记录。
- 按阶段顺序推进；后续阶段须在包含前置阶段结果的分支上开发，避免遗漏尚未合入的本地提交。
- 已完成阶段中的初版示例作为历史设计背景保留；执行记录与当前源码优先。
