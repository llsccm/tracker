# 三国杀打小抄记牌器（`src/tracker/`）按优先级架构重构方案

> **适用范围**：本方案严格遵循仓库现有代码规范（2 空格缩进、单引号、无分号、优先 `const` 与 early return、禁止 `import as` 别名、不新增 UI 自动化测试、遵循防御式编程信任边界与 Conventional Commits 规范），可直接作为 `plans/` 下的架构演进蓝图分 PR 落地。

## 优先级路线图总览

| 优先级   | 阶段代号                                       | 核心重构目标                                          | 解决的架构痛点                                                                                                          | 涉及主要文件                                                                                                                                                                                                | 建议 PR 拆分 |
| :------- | :--------------------------------------------- | :---------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------- |
| **P0-1** | [**Phase A**](tracker_architecture_phase_a.md) | **内聚 `Room` 与 `PileIdentityLedger` 事务边界**      | 普通移动由 Controller 后置拼装账本事件、直接调 `Room.moveCards()` 导致账本失步、`revealPublicCandidate` 虚增场外实体    | `src/tracker/Room.ts`<br>`src/tracker/runtime/trackerController.ts`<br>`src/tracker/room/identity.ts`                                                                                                       | 2 个 PR      |
| **P0-2** | [**Phase B**](tracker_architecture_phase_b.md) | **统一“三轨分裂”的技能扩展管线**                      | 技能分散在 `handler/skills/*`、`RoomMoveEvents`、`TrackerController` 硬编码钩子三处；混用 `spell` 与 `tracker` 状态空间 | `src/tracker/room/moveEvents.ts`<br>`src/tracker/skill/registerHandlers.ts`<br>`src/handler/PubGsCMoveCard.js`<br>`src/handler/skills/*`                                                                    | 3 个 PR      |
| **P1-1** | [**Phase C**](tracker_architecture_phase_c.md) | **抽象跨消息协议序列协调器（`ProtocolSequence`）**    | 诡伏、观虚、诫厉、天候、下书等跨协议技能各自手写散装状态，缺乏被其他技能/判定打断时的自动失效与诊断机制                 | `src/tracker/skill/protocolSequence.ts`<br>`src/tracker/skill/GuiFu.ts`<br>`src/tracker/skill/GuanXu.ts`<br>`src/tracker/skill/JieLi.ts`                                                                    | 2 个 PR      |
| **P1-2** | [**Phase D**](tracker_architecture_phase_d.md) | **区分玩家标记与弹窗，升级交换批次及数量约束**        | 区域 `4/8` 混用玩家 mark；动作技能与空间 ID 混淆；exchange 缺少批次、候选缺少区间名额                                   | `src/tracker/protocol/protocolZones.ts`<br>`src/tracker/model/Card.ts`<br>`src/tracker/model/ExchangeBatch.ts`<br>`src/tracker/constraint/ConstraintGroup.ts`<br>`src/tracker/room/movement/popupSpaces.ts` | 4 个 PR      |
| **P2-1** | [**Phase E**](tracker_architecture_phase_e.md) | **清理死代码与开启 `tsconfig.tracker.json` 严格模式** | `src/utils/generalTip.js` 悬挂导入已删除的 `./trial.js`；`strict: false` 掩盖 `SeatID` / `null` 边界隐患                | `src/utils/generalTip.js`<br>`tsconfig.tracker.json`<br>`package.json`                                                                                                                                      | 2 个 PR      |
| **P2-2** | [**Phase F**](tracker_architecture_phase_f.md) | **拆分 `logic.js` 消息路由与支持断线重连降级建局**    | `logic.js` 400 行巨型 `switch` 耦合所有外围功能；`MsgReconnectGame` 直接令记牌器整局停摆                                | `src/logic.js`<br>`src/tracker/runtime/trackerController.ts`<br>`src/tracker/Room.ts`                                                                                                                       | 2 个 PR      |

## 执行进度与阅读方式

- Phase A、Phase B 已完成；阶段执行记录、分支策略与验证结果分别保存在对应文档中。
- 当前按任务跳过 [Phase C](tracker_architecture_phase_c.md)，[Phase D](tracker_architecture_phase_d.md) 已完成；C、E、F 保持待执行。
- Phase D 已落地区间名额、命名交换批次及独立 `popup` 弹窗区；区域 `4` 保留玩家标记存储，区域 `8` 使用空间端点，`414/3389` 不再作为空间别名。巧织/椒遇暗取复用通用数量约束，巧织明确身份通知保留在默认技能协议入口。
- 技能 `35` 匿名暂存与分批回堆、集运跨技能转交及 `414` 整区返回已纳入回归；木牛迁座与骋烈近似策略保持既有边界，详情见 Phase D 的协议分类及验证记录。
- 本文件保留路线图和统一规范，各阶段文档独立维护根因、设计、提交拆分和验证记录。
- 按阶段顺序推进；后续阶段须在包含前置阶段结果的分支上开发，避免遗漏尚未合入的本地提交。
- 已完成阶段中的初版示例作为历史设计背景保留；执行记录与当前源码优先。
