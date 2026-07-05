# A2 player 快照增量执行计划（Step 7）

> 承接 [`cards-incremental-index-and-fast-path-plan.md`](cards-incremental-index-and-fast-path-plan.md) §六·5「阶段 3.5（A2）」与 §九 step 7。本文只规划 `resolveConstraints()` 的 player 快照增量，**不绕收敛**、不改变约束语义，也不实现阶段 4 快路径。

## 摘要

- 将 `resolveConstraints()` 入口与轮末两处 `this.cards.filter((card) => card.location === 'player')` 全量过滤，改为按 `Room.dirtyCardEvents` 游标增量维护的 player 快照。
- 收敛流程、三类约束、E1/E2 跳过逻辑全部不变；正确性 **by construction**（快照成员定义严格等于 `location === 'player'`，收敛照跑）。
- player 快照成员是 `CardLocationIndex` 已用同一 `dirtyCardEvents` 事件流追踪的**严格子集**，因此复用其顺序键（`orderOf` / `spliceOrdered`）与游标断档回退范式，正确性由既有增量护栏同理保证。
- 沿用主计划 §六·5：复用现有 `Room.assertPlayerSnapshotConsistency()` 作 DEV 等价断言，增量快照必须与全量 `filter` 顺序一致。

## 背景与定位

在 step 3 后的遍历基线里，两个区域索引已增量化（`locationIndex:applyDirty`、`ambiguousKnownIndex:applyDirty`），`resolveConstraints:playerSnapshot` 成为唯一仍全量扫描 `Room.cards` 的热点：常规摸牌 205 中占 80（`calls=2 visited=80`，入口一次 + 轮末一次）。

A2 是评审新增的**中间档**：不绕收敛，只消除每次重建 player 快照的 O(N) 过滤成本。若 A2 已把成本压到可接受范围，阶段 4（绕收敛快路径）可能整体不必做。

## 实现变更（全部集中在 `src/tracker/Room.ts`）

### 新增字段

- `playerCardsSnapshot: Card[]`：增量维护的 player 快照（有序数组），保持 `room.cards` 顺序。
- `playerCardsSnapshotSet: Set<Card>`：成员集合，O(1) 判断某牌是否已在快照中，避免重复插入并支持删除。
- `playerSnapshotSeq: number`：已消费到的 `dirtyCardSeq` 游标；`< 0` 表示未初始化，断档时回退全量重建。
- `playerSnapshotOrder: Map<Card, number>`：排序键（= `room.cards` 下标）。`rebuild` 时按下标写入；`rebuild` 后新建、首次进入 player 的牌（仅 `createExternalCards`，罕见）用 `this.cards.indexOf(card)` 兜底取真实下标作键，严格对齐全量 filter 顺序。在构造器与 `destroy()` 初始化/重置。

### 新增方法

- `rebuildPlayerSnapshot(): Card[]`：全量重建（`initDeck` seed / 游标断档回退）。按 `room.cards` 顺序遍历一次，写入顺序键与快照，`playerSnapshotSeq = dirtyCardSeq`。记 `recordTraversal('resolveConstraints:playerSnapshot', room.cards.length)`。
- `refreshPlayerSnapshot(): Card[]`：按 `dirtyCardEvents` 游标增量刷新。
  - `playerSnapshotSeq < 0` 或游标断档（`events[0].seq > seq + 1`）→ 回退 `rebuildPlayerSnapshot()`。
  - 逆序遍历 `dirtyCardEvents`、遇 `seq <= playerSnapshotSeq` 即 `break`（新事件为升序连续后缀，故 O(新事件数)，避免全量扫描 500 条缓冲），收集事件牌；对每张按当前 `location === 'player'` 与 `playerCardsSnapshotSet` 成员判断增删。
  - 记 `recordTraversal('resolveConstraints:playerSnapshotIncremental', affectedCards.size)`，`playerSnapshotSeq = dirtyCardSeq`。
- `orderOfPlayerCard(card)`（private）：顺序键查询，缺失时用 `this.cards.indexOf(card)` 兜底取真实下标（比 `CardLocationIndex.orderOf` 的单调兜底更严格，避免同批多张新牌乱序；仅罕见新建牌触发一次 O(N)，常见牌走 O(1) map 命中）。
- `insertPlayerCardOrdered(card)`（private）：按顺序键把新进入 player 的牌插入快照，与 `CardLocationIndex.spliceOrdered` 同构。

### 接入点

- `initDeck()`：在 `locationIndex.rebuild` / `ambiguousKnownIndex.rebuild` 之后 seed `rebuildPlayerSnapshot()`（此时全部牌在 `pile`，seed 得空快照）。使后续 `resolveConstraints()` 一律走增量刷新，而非首次 seed。
- `resolveConstraints()` 入口：`let playerCards = this.refreshPlayerSnapshot()` 替代全量 filter。
- `resolveConstraints()` 轮末 `if (changed)`：`playerCards = this.refreshPlayerSnapshot()` 替代全量 filter，消费本轮内 location 漂移事件（候选落定→player、`moveToPublicZone`→公共区）。
- 尾部 `this.assertPlayerSnapshotConsistency(playerCards)` 保留，注释由 A1 更新为 A2。

## 顺序一致性与游标断档

- **顺序键取 `room.cards` 下标**：`rebuild` 时把每张牌的下标写入 `playerSnapshotOrder`；增量插入按该键二分定位，保证快照顺序与 `this.cards.filter(...)` 完全一致，`assertPlayerSnapshotConsistency` 的逐位比较通过。
- **`room.cards` 追加牌**：仅 `initDeck`（rebuild 前）与 `createExternalCards`（低频兜底，新牌先入 `outside` 公共区）会 push。rebuild 之后新建、首次进入 player 的牌用 `this.cards.indexOf(card)` 兜底取真实下标作键，故快照顺序与全量 filter **始终一致**，不存在「同批多张外部牌乱序进 player」的偏差。此处比 `CardLocationIndex.orderOf` 的单调兜底更严格——后者存在同款潜在偏差，可作为后续统一项。
- **游标断档**：`dirtyCardEvents` 被 `DIRTY_CARD_EVENT_LIMIT`（500）splice 后，落后的游标漏事件时回退全量 `rebuildPlayerSnapshot()`，照抄 `CardLocationIndex.applyDirtyCardEvents` / `AmbiguousKnownIndex.applyDirtyCardEvents` 的断档检测。

## 与 CardLocationIndex 的关系（为何安全）

- `CardLocationIndex.applyDirtyCardEvents` 已用 `dirtyCardEvents` 追踪每张牌的 `location` 以维护公共区/玩家区桶；A2 的 `location === 'player'` 成员判定是它追踪信息的**严格子集**。
- 因此「每次 location 变化都发 `dirtyCardEvents`」这一不变量已由 step 2/3 建立并被 `CardLocationIndex` 的 DEV 影子断言 + 集成测试验证（含 step 3 修复的「同座位子区/技能/明牌变更补发事件」）。A2 复用同一事件流，不引入新的事件依赖，不增加新的漏事件风险面。
- A2 的 `assertPlayerSnapshotConsistency` 是独立于 `CardLocationIndex` 的第二重等价护栏。

## 测试计划

- 复用现有 `Room.assertPlayerSnapshotConsistency()` DEV 断言：`pnpm test:tracker` 全量用例（含 `resolveConstraintsIncrementalIndex.test.ts` 真实 `moveCards` / `shufflePile` 集成路径）每次 `resolveConstraints()` 尾部都校验增量快照与全量 filter 顺序一致，无需单列 A2 测试（沿用主计划 §八「A2 等价性由断言 + 基线覆盖」）。
- 确认 vitest `import.meta.env.DEV === true`（一次性临时用例已确证），保证上述断言真实运行。
- 刷新 `tests/tracker/traversalBaseline.test.ts` 内联快照：四场景的 `resolveConstraints:playerSnapshot` 全量项归零，改为 `resolveConstraints:playerSnapshotIncremental` 极小值。

## 验收标准

- `resolveConstraints()` 入口与轮末在常规高频移动下不再全量扫描 `Room.cards` 构建 player 快照。
- 增量快照与全量 `filter` 在顺序上一致（DEV `assertPlayerSnapshotConsistency` 全部用例零告警）。
- 轮内候选落定为 player、明牌移出 player 等 location 漂移后，增量列表与全量 `filter` 一致。
- 游标断档时稳定回退全量重建。
- 收敛语义、约束三排他行为、E1/E2 跳过统计不变。
- 遍历基线 `resolveConstraints:playerSnapshot`（全量）在四场景归零，`playerSnapshotIncremental` 为个位数/零。
- 执行并通过：`pnpm test:tracker`、`pnpm typecheck:tracker`、`pnpm lint`、`pnpm build`。

## 实测遍历量（`traversalBaseline.test.ts` 内联快照，40 张基线）

| 场景 | `playerSnapshot`（前） | `playerSnapshotIncremental`（后） | total（前 → 后） |
| --- | --- | --- | --- |
| 常规摸牌 | calls=2 visited=80 | calls=2 visited=1 | 127 → 48 |
| 暗牌分配 | calls=1 visited=40 | calls=1 visited=2 | 90 → 52 |
| 约束三排他触发 | calls=2 visited=80 | calls=2 visited=2 | 138 → 60 |
| 洗牌 | calls=1 visited=40 | calls=1 visited=0 | 120 → 80 |

## 假设与默认选择

- **不新建独立类**：沿用主计划「Room 维护 player 快照」的定位，字段/方法直接挂在 `Room`，`resolveConstraints()` 读局部 `playerCards`；不新建 `PlayerCardsSnapshot` 类，避免与三个已挂载索引外再起并行结构。
- **保持顺序一致而非放宽为集合断言**：约束一/三对 `playerCards` 的遍历与 `handSlotCounts` 统计均与顺序无关，但为对齐 `CardLocationIndex` house style 并保留更强的逐位等价断言，仍维护 `room.cards` 顺序。
- **`initDeck` seed**：与区域索引在同一处 seed，保证被测 `resolveConstraints()` 走增量而非首次全量，遍历基线反映稳态成本。
- **不实现阶段 4 快路径**：本计划只落地 step 7；A2 之后由数据 gate（§九 step 8）决定是否启动阶段 4。
- **不改公开读面**：`playerCardsSnapshot` 仅供 `resolveConstraints()` 内部使用，不对视图侧暴露新读面。
