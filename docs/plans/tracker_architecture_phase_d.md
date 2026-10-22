# Phase D（P1-2）：升级公共空间建模与数量约束

> 导航：[总览](tracker_architecture_refactoring_plan.md) · [Phase C](tracker_architecture_phase_c.md) · [Phase E](tracker_architecture_phase_e.md)
>
> 状态：待执行；以下为阶段设计方案，实施前需按当前源码核对。

## 1. 根因剖析

1. **`Zone('exchange')` 与 `Card.location` 的不变量裂痕**：
   - `src/tracker/skill/HandExchange.ts` 顶部注释明确写道：“逻辑暂存的候选牌 `location` 记为 `'exchange'`，但刻意不加入 `zones.get('exchange')`；因此按 `Zone` 成员统计的口径不会计入它们，按 `card.location` 统计的口径才会。”
   - 同时 `GuanXu.ts` 为了区分“牌堆侧进交换区”和“手牌侧进交换区”，在 `skillState` 里手写了另一套数组桶。这是因为 `Zone('exchange')` 只是一个单层 `Card[]`，没有原生的子批次（Batch/Bucket）概念。
2. **`ConstraintGroup` 只能表达等式名额，无法利用区间上下界**：
   - `ConstraintGroup.expectedSlotsByLocation` 类型为 `Map<string, number>`。
   - 在 `src/tracker/room/movement/hiddenMarks.ts`（如 2 明 2 暗暗置 2 张进标记区，`knownMarkMin = 0, knownMarkMax = 2`）或 `TianHou.ts`（`knownOutMin < knownOutMax`）中，当 `min !== max` 时无法建立 `ConstraintGroup`，导致 `computeHandSlotAllocation()` 计算单座位候选明牌容量上界时丢失了 `max` 上界限制（例如 3 明 2 暗暗置 1 张进标记区，留在手牌的明牌数在 `[2, 3]` 之间，标记区最多只能占 1 张明牌）。
3. **无席位标记区尚未接入通用暗取收敛**：
   - `RoomMovementCandidates.markMarkToHandCandidates()` 与 `getVisibleMarkSpaceCards()` 目前针对绑定玩家座位的标记牌建立候选。巧织、椒遇的现有协议用例使用 `ToID=255` 的弹窗标记区，取牌时 `FromID` 是技能空间 ID，牌的 `seats` 为空，不能套用玩家标记区的位置约束。
   - `unassignedMarkSpaces` 只维护无席位标记暗占位实体，没有表达全明标记牌暗取后的“原空间 / 目标手牌”候选及双方数量关系，因此剩余牌明弃后也不会自动确认已取走的身份。
   - 2026-10-22 的六组最小序列对照确认：巧织停用专用补充后，另一张明弃仍留下 1 张未知手牌及滞留标记明牌；椒遇停用颜色补牌后，另一组明弃仍留下 5 张未知手牌。相同巧织流程改为玩家标记区后，现有精确数量约束可以正确收敛。这是位置建模缺口，不需要为这两个全明场景另写求解算法。

## 2. 具体重构方案

### 步骤 D1：为 `RoomPublicZones` / `Zone` 增加命名子批次视图

在不破坏普通公共区 `Zone.cards` 读写的前提下，为 `exchange` 区提供原生的命名批次管理（`room.publicZones.getExchangeBatch(batchKey)`），让 `GuanXu`、`TianHou`、`XingZuo`、`HandExchange` 统一通过 `batchKey`（如 `${spellID}:pile`、`${spellID}:seat:${seatID}:${seq}`）存取交换批次，消除各技能文件重复实现的桶切片与回填逻辑。

### 步骤 D2：将 `ConstraintGroup` 扩展为支持 `{ min, max }` 区间名额

向后兼容现有的单数字输入（传入 `number` 时自动规整为 `{ min: count, max: count }`）：

```ts
// src/tracker/constraint/ConstraintGroup.ts
export interface SlotCountRange {
  readonly min: number
  readonly max: number
}

export type SlotCountInput = number | string | SlotCountRange
```

在 `ConstraintGroup.resolve()` 中：

1. **上界满额剔除（Upper-Bound Elimination）**：当某个位置 `location` 的确定牌数量 `lockedCount >= range.max`（即 `remainingMax === 0`）时，从本组其余候选牌中剔除该 `location`；
2. **下界强锁（Lower-Bound Locking）**：当本组所有候选牌的候选全集都被本组覆盖，且某个位置的候选牌数量 `candidateCards.length <= remainingMin`（其中 `remainingMin = Math.max(0, range.min - lockedCount)`）时，将这些候选牌直接锁定到该 `location`；
3. **手牌容量上界收紧**：在 `src/tracker/constraint/handSlotUsage.ts` 的 `countCandidateHandSlots()` 中，使用 `slot.remainingMax` 作为 `HandSlotBudget.count`，即可天然支持“半明半暗暗置/换牌”对候选明牌上界的紧缩，无需在 `hiddenMarks.ts` 中写额外的特判。

### 步骤 D3：补齐无席位标记区收敛，收拢巧织与椒遇特例（待完成）

本项归入空间与数量约束重构。全明 `N` 张中暗取 `K` 张只需现有精确名额约束，实施不依赖
D2 的区间扩展，也不必等待 D1 的 exchange 批次容器；可作为独立变更先落地。

#### 通用模型与移动流程

- [ ] 定义可参与 `locationCandidates` 和 `ConstraintGroup` 的无席位标记空间位置，按协议技能空间区分；同步位置 key、候选归一化、索引及物化/来源匹配。不得将 `255` 或技能 ID 伪装为玩家座位，也不能把不同技能的标记空间合并。
- [ ] 扩展标记区到手牌的通用暗取流程：全明 `N` 张暗取 `K` 张后，所有参与身份保留“原标记空间 / 目标手牌”候选，建立原空间 `N-K`、目标手牌 `K` 的数量约束。只更新一次手牌数量，不确定性由候选表达，不提前挑选具体明牌。
- [ ] 剩余牌明弃、获得牌直接揭示或后续已知移动时，按实际来源扣减旧名额并触发通用收敛。同步维护 `unassignedMarkSpaces` 的实体引用，回收多余匿名占位，保留其他既有候选和有效约束。
- [ ] 明暗混合、可见 ID 不完整或空间归属不明时保留保守语义，不套用全明精确分配；多个技能空间、连续批次及新 Room 之间不得串用状态。

#### 技能清理边界

- [ ] 清理 `src/tracker/skill/QiaoZhi.ts` 的旧差集装饰器及 `qiaozhiSelection` 状态说明。该装饰器已不在默认注册表中，仅由旧测试显式注册；将有价值的回归迁移到默认管线，覆盖通用收敛。
- [ ] 保留 `GsCUpdateRoleDataExNtf(DataID=3544)` 给出的明确身份事实，将 `src/handler/skills/QiaoZhi.ts` 的薄揭示逻辑收口到通用技能协议入口。继续使用零手牌增量揭示，避免重复计数；不再建立巧织私有差集状态。
- [ ] 通用收敛回归通过后，移除 `src/tracker/skill/JiaoYu.ts` 的颜色暂存、标记牌扫描及 `CardIDs` 回填，并清理 `registerHandlers.ts` 中相应插件和状态测试。
- [ ] 椒遇接受“剩余组明弃后才确定获得组”的确认时机；此前显示候选。若后续另有需求要求按颜色选择立即确认，应将选择事实作为通用约束输入单独设计，不恢复技能专属补牌扫描。
- [ ] 同步 `docs/agents/skill_state.md`、`card_tracker_skills.md`、相关协议说明与 API 文档，删除失效入口引用，明确玩家标记区与无席位标记空间的边界。

#### 验收条件

- 巧织：两张明牌进入无席位标记区，暗取一张、另一张明弃；不依赖旧差集装饰器或角色数据通知也能确认入手身份，且标记区结算后无残留。
- 巧织直接身份通知：分别覆盖在剩余牌明弃前、后到达，以及主视角移动已带正 ID；手牌数不重复增加，揭示后不遗留多余匿名标记占位。
- 椒遇：明牌进入处理区后进入无席位标记区，暗取一组、剩余组明弃；关闭颜色补牌后仍正确确认获得组。覆盖不同组大小、弃牌分批到达以及选取消息已带正 ID。
- 保护现有玩家标记区暗交回归（如 `3658`）、多个技能空间隔离、后续手牌移动及木牛流马暗置；已确认手牌不得残留原技能标记字段或描述。
- 通过默认 Controller 管线验证实体数量、手牌观测数、候选名额、匿名占位清理与 Room/ledger 一致性；不以仅账本断言通过代替位置与身份断言。

## 3. 提交拆分与验证命令

- **PR 1**：`feat(tracker): support [min, max] slot range constraints in ConstraintGroup`
- **PR 2**：`refactor(tracker): unify exchange batch buckets across GuanXu, TianHou, and HandExchange`
- **PR 3**：`feat(tracker): converge hidden gains from unassigned mark spaces`
- **PR 4**：`refactor(tracker): retire QiaoZhi and JiaoYu inference patches`
  - PR 4 依赖 PR 3 的默认管线回归通过；巧织明确身份通知继续作为协议输入保留。
- **验证门槛**：
  - 运行 `pnpm test:tracker`、`pnpm typecheck:tracker`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm build:prod` 与 `git diff --check`。
  - 重点检查 `tests/tracker/traversalBaseline.test.ts` 的遍历计数快照；新增全牌池扫描需按仓库规则插桩并解释变化。
  - 不新增 UI 自动化测试；浏览器手工验收确认候选到确定手牌的展示时机，未执行时明确记录。
