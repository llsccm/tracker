# AmbiguousKnownIndex 单牌增量执行计划（Step 6）

> 承接 [`cards-incremental-index-and-fast-path-plan.md`](cards-incremental-index-and-fast-path-plan.md) §九 step 6。本文只规划 `AmbiguousKnownIndex` 单牌增量，不执行阶段 4 快路径，也不改变约束收敛语义。

## 摘要

- 将 `AmbiguousKnownIndex` 从每次 `resolveConstraints()` 尾部全量扫描 `Room.cards`，改为按 `Room.dirtyCardEvents` 消费本次变更牌并单牌更新。
- 约束组结构变化仍走全量 `rebuild()`，因为 description 会显示 `sourceEvent`，且组 membership / 期望槽位变更可能影响多张牌的描述。
- 装备容器候选有跨牌依赖：description 会把 container 候选解析成装备当前承载座位；装备本体移动时，带 container 候选的标记牌自身可能不脏，需用反向依赖集合一并重算。
- 不实现 `firstID` 监听或专门兜底；按主计划修订记录，`firstID` 只在牌局开始设定，模糊明牌产生时视角前缀已固定。

## 实现变更

- 在 `src/tracker/AmbiguousKnownIndex.ts` 新增增量入口：
  - `lastConsumedSeq: number`：记录已消费的 `Room.dirtyCardEvents` 游标；`rebuild()` 结束时对齐为 `room.dirtyCardSeq`。
  - `containerDependentCards: Set<Card>`：记录带 container location candidate 的牌，用于装备本体移动后的跨牌重算。
  - `applyDirtyCardEvents(groups)`：消费 `seq > lastConsumedSeq` 的事件；事件断档时回退 `rebuild(groups)` 并返回 `false`。
  - `applyCardChange(card, groups)`：单牌删除旧条目后按当前状态重新判断是否应写入 `items`，并同步维护 `containerDependentCards`。
  - `toComparable()`：供测试和 DEV 影子断言比较 `items` 的稳定结构。
- 抽出共享判定函数，保证增量与全量一致：
  - `isAmbiguousKnownCard(card)`：复用现有 `rebuild()` 条件，要求 `isKnown === true`，且存在多座位玩家候选、完整位置候选、子区候选或公共候选。
  - `getRelatedGroups(card, groups)`：保持现有 `groups.filter((group) => group.cards.has(card))` 语义。
  - `buildItem(card, relatedGroups)`：统一生成 `candidateSeats`、`groups`、`description`。
- 在 `Room` 增加约束组结构脏标记：
  - 新增 `constraintGroupsDirty: boolean`，初始为 `false`。
  - 新增 `markConstraintGroupsDirty(reason?: string)` 薄方法，只设置布尔值。
  - 所有会创建、合并、删除、移除组内牌、修改组期望槽位或切换 hidden mark groupID 的路径调用该方法。
- 在 `Room.resolveConstraints()` 尾部替换调用：
  - 若 `constraintGroupsDirty === true`：调用 `ambiguousKnownIndex.rebuild(Array.from(this.constraintGroups.values()))`，然后清空脏标记。
  - 否则：调用 `ambiguousKnownIndex.applyDirtyCardEvents(Array.from(this.constraintGroups.values()))`。
  - `CardLocationIndex`、`syncViewGroups()`、`CardCounter.update()` 的顺序不变；`AmbiguousKnownIndex` 继续放在 `syncViewGroups()` 之后、`counter.update()` 之前。
- 在 DEV 下新增一致性断言：
  - `Room.assertAmbiguousKnownIndexConsistency()` 创建影子 `AmbiguousKnownIndex`，用 `rebuild(groups, { record: false })` 生成预期，再比较 `toComparable()`。
  - `AmbiguousKnownIndex.rebuild()` 增加 `{ record?: boolean }` 参数，DEV 影子断言传 `false`，避免污染遍历基线。

## 装备容器候选依赖

- 缺口来源：`formatCardDescription()` 会通过 `resolveEquipmentContainerLocationCandidates()` 把 container 候选解析成座位前缀，该解析读取装备当前实时座位；装备换座时，带 container 候选的标记牌自身可能没有 dirty 事件，也可能不触发约束组结构 dirty。
- 实现要求：
  - 抽出 `hasContainerLocationCandidates(card)` 判定，供 `rebuild()` 与 `applyCardChange()` 共用。
  - `rebuild()` 清空并重建 `containerDependentCards`，同时把 `lastConsumedSeq` 设为 `room.dirtyCardSeq`。
  - `applyDirtyCardEvents(groups)` 先收集 dirty 事件牌，再遍历 `Array.from(containerDependentCards)`；集合中的牌若未在本批 dirty 事件中出现，也要调用 `applyCardChange(card, groups)` 重算 description。
  - `applyCardChange()` 结束时根据最新候选状态增删 `containerDependentCards`，避免候选收敛或清除后长期额外重算。
- 回归测试必须覆盖：木马类候选先收敛到单一 container 候选，账本删除后再次移动装备本体，且 `constraintGroupsDirty === false` 时，`describe()` 的座位前缀仍随装备当前座位更新。

## 约束组脏标记范围

- `constraintGroupsDirty` 的精确性是 step 6 性能收益的硬约束：只能在约束组结构确实变化时置脏，不能因为相关函数被调用就置脏。
- 特别注意 `RoomConstraints.removeCardsFromConstraintGroups()` 位于高频移动路径，例如 `roomMovement.ts` 中对 `movedUnknownCards` 的无条件调用；若这里按调用置脏，会让普通移动持续回退全量 `rebuild()`。
- `RoomConstraints.createConstraintGroup()`：
  - 新建 group 后标记 dirty。
  - 复用已有 group 且执行 `addCards`、合并 `candidateSeats`、替换 `expectedSlotsBySeat/SubZone/Location`、更新 `known/sourceEvent` 后标记 dirty。
- `RoomConstraints.removeCardsFromConstraintGroups()`：
  - 将返回值改为 `boolean` 或等价的结构变更信号，调用方只在本次确实删除 group 内 card、扣减 expected slot、或删除空 group 时标记 dirty。
  - 无匹配牌、无槽位扣减、无空组删除时必须保持 `constraintGroupsDirty === false`。
- `roomMovement/hiddenMarks.ts`：
  - 所有直接 `this.room.constraintGroups.delete(...)` 的位置后标记 dirty。
  - 投影 hidden mark record 并创建或替换约束组的路径依赖 `createConstraintGroup()` 标记即可，不重复标记。
- `ConstraintGroup.resolve()` 不额外标记 dirty：
  - 它通过 `Card` 的候选 / 席位变更触发 `notifyCardChanged()`，由增量索引消费脏牌。
  - 它不改变 group membership 或 `sourceEvent`；若未来改变，应在改变处显式标记。

## 测试计划

- 新增 `tests/tracker/ambiguousKnownIndexIncremental.test.ts`：
  - 多座位候选明牌收敛为确定手牌：`applyDirtyCardEvents()` 删除该牌条目，且不触发 `ambiguousKnownIndex:rebuild`。
  - 确定明牌变成多位置候选：单牌增量新增条目，description 与全量 rebuild 一致。
  - 公共候选明牌变化：单牌增量更新或删除公共候选描述。
  - 装备容器候选跨牌依赖：container 候选标记牌自身不脏、约束组不脏时，移动装备本体仍会更新 description 座位前缀。
  - dirty 游标断档：`applyDirtyCardEvents()` 回退全量 rebuild，返回 `false`。
  - 约束组 source label 变化或 group 删除：通过 `constraintGroupsDirty` 走全量 rebuild，description 不陈旧。
- 新增测试辅助：
  - `tests/tracker/helpers/ambiguousKnownIndex.ts` 提供 `expectAmbiguousKnownIndexMatchesRebuild(room)`。
- 扩展 `tests/tracker/resolveConstraintsIncrementalIndex.test.ts`：
  - 真实 `moveCards()` 路径下，多座位候选、排他收敛、约束组移除后，活索引与全量 rebuild 一致。
  - 确认普通确定明牌摸牌 / 弃牌场景中 `ambiguousKnownIndex:rebuild` 不再出现，改为 `ambiguousKnownIndex:applyDirty`。
- 刷新 `tests/tracker/traversalBaseline.test.ts` 内联快照：
  - step 6 后常规摸牌、暗牌分配、约束三排他触发、洗牌中的 `ambiguousKnownIndex:rebuild visited=40` 应下降为 `ambiguousKnownIndex:applyDirty visited=<dirty cards>`。
  - 若约束组结构变化测试场景仍出现 rebuild，必须在快照旁注释说明这是预期回退。

## 验收标准

- `resolveConstraints()` 尾部在无约束组结构变化时不再全量扫描 `Room.cards` 重建 `AmbiguousKnownIndex`。
- 增量结果与全量 `rebuild()` 在多座位候选、完整位置候选、子区候选、公共候选、装备容器候选场景中一致。
- 装备本体移动、但带 container 候选的标记牌自身不脏且约束组不脏时，description 座位前缀不陈旧。
- 约束组结构变化、dirty 事件断档时稳定回退全量 rebuild，不产生陈旧 description。
- 遍历基线中 `ambiguousKnownIndex:rebuild` 对普通高频移动下降为 0。
- 执行并通过：`pnpm test:tracker`、`pnpm typecheck:tracker`、`pnpm lint`、`pnpm build`。

## 假设与默认选择

- `firstID` 不纳入 step 6 脏依赖；沿用主计划修订后的 C4 结论。
- 不为 `ConstraintGroup` 建 `card -> groups` 反向索引；step 6 的单牌更新继续用 `groups.filter(...)`，因为 group 数量远小于 `Room.cards`，且结构变化已回退全量。
- 公共候选不需要 `dirtyPublicZones`：公共候选描述依赖的 `count/position` 已在 candidate 创建时烘焙进牌本地候选，后续变化会通过 `setLocationCandidates()` 产生 dirty card 事件。因此 `applyDirtyCardEvents(groups)` 不保留 `options?` 扩展口。
- 生命周期对齐 `CardLocationIndex`：`destroy()` 不额外重置新游标或 `containerDependentCards`，但 `rebuild()` 必须清空依赖集合并把 `lastConsumedSeq` 对齐到 `room.dirtyCardSeq`，保证同一实例复用时也稳定。
- 不改变 `AmbiguousKnownIndex.items` 的公开读面；视图侧 `publicFieldCandidates` 继续读取同一个 `items` Map。
- 不实现阶段 4 快路径；本计划只落地 step 6。
