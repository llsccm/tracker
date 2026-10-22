# Phase A（P0-1）：收拢 `Room` 与 `PileIdentityLedger` 的事务一致性边界

> 导航：[总览](tracker_architecture_refactoring_plan.md) · [Phase B](tracker_architecture_phase_b.md)
>
> 状态：已完成，执行记录与验证结果见下文。

## 执行状态（2026-10-22）

- [x] A1：普通移动快照与账本事件构造下沉至 `RoomIdentity`，`Room.moveCards()` 直调自动提交；Controller 移除三项账本辅助方法及普通移动后置提交。洗牌事件同样由 Room 构造。
- [x] A2：公共范围揭示使用独立 `detachedKnownCards` 身份载体，不新增物理实体；精确来源揭示在原匿名槽上物化并回收载体，保留公共区顺序。
- [x] 补齐范围候选的索引重建、手牌容量分配、完整范围摸牌后物化和旧夹具的账本准备；保持既有遍历快照。
- [x] 最终验证：`pnpm test:tracker`（82 个文件、869 项通过）、`pnpm typecheck:tracker`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm build:prod` 全部通过；`git diff --check` 通过，遍历快照未变。未进行浏览器手工验收。

实施调整：账本提交放在最终 `resolveConstraints()` **之前**，使 cohort 投影带来的实体匿名化也被本次
稳定索引同步消费；移动末尾再执行 Room/ledger 一致性检查。Controller 透传类型化
`pileIdentityEvent` 保留协议事实，领域直调由上下文推导；低层物化仍允许分阶段使用。
公共范围身份与物理槽的统一读面为 `trackedCards`，匿名手牌分配同时维护身份名额与物理容量。
以下方案代码保留为阶段设计背景，当前实现以上述执行记录及源码为准。

## 1. 根因剖析

1. **普通移动与洗牌的账本提交位置割裂**：
   - 在 `src/tracker/runtime/trackerController.ts` 的 `syncTrackerMove()` 中，普通移动先调用 `readyRoom.moveCards()`（内部已执行 `resolveConstraints()`），随后才由 Controller 调用私有方法 `createPileIdentityMove()` 和 `readyRoom.applyPileIdentityMove()`。
   - 这导致两个问题：一是 `resolveConstraints()` 执行时账本仍处于未更新的中间态，迫使 `assertPileIdentityLedgerConsistency()` 不能内聚在收敛尾部；二是任何不经过 `TrackerController.syncTrackerMove()` 而直接调用 `Room.moveCards()` 的路径（例如内部技能补偿或单元夹具）都会漏更账本。
2. **公共范围揭示污染物理实体池 `Room.cards`**：
   - `TrackerController.revealPublicCandidateCards()`（用于周群【天候】`3903` 亮牌顶三张之一）对尚未物化的正 ID 调用了 `readyRoom.createExternalCards([], 1)` 再 `materialize(id, target)`。这会在 `Room.cards` 中凭空多造出一张物理实体，破坏“无游戏外加牌时 `Room.cards` 物理槽数量恒定”的领域直觉。

## 2. 具体重构方案

### 步骤 A1：将账本事件构造下沉至 `Room` 内部

在 `src/tracker/Room.ts`（或委托给 `src/tracker/room/identity.ts`）中内聚牌堆移动前后快照采集与账本同步，让 `Room.moveCards()` 自身成为完整的“物理移动 + 约束收敛 + 身份账本同步 + 一致性断言”原子事务。

```ts
// src/tracker/room/identity.ts（新增账本事务快照与提交流水线）
export interface PileMoveSnapshot {
  pileCountBefore: number
  knownPileDrawCards: readonly Card[]
}

export class RoomIdentity {
  capturePileMoveSnapshot(context: RoomMoveContext): PileMoveSnapshot {
    const pileCards = this.room.zones.get('pile')?.cards ?? []
    const pileCountBefore = pileCards.length
    if (
      context.fromZone !== 'pile' ||
      context.knownIDs.length > 0 ||
      context.moveType !== MOVE_TYPE.DRAW
    ) {
      return { pileCountBefore, knownPileDrawCards: [] }
    }

    const count = Math.min(Math.max(0, context.cardCount), pileCards.length)
    const sourceCards =
      context.fromPosition === POSITION_BOTTOM ? pileCards.slice(0, count) : pileCards.slice(-count)
    const knownPileDrawCards = sourceCards.filter((card) => card.id > 0 && card.isKnown === true)
    return { pileCountBefore, knownPileDrawCards }
  }

  commitPileIdentityForMove(context: RoomMoveContext, snapshot: PileMoveSnapshot): void {
    const pileCards = this.room.zones.get('pile')?.cards ?? []
    const pileCountAfter = pileCards.length
    const knownPileIdentityIDsConsumed = snapshot.knownPileDrawCards
      .filter((card) => card.location !== 'pile' && card.id > 0)
      .map((card) => card.id)
    const actualPileConsumptionCount = Math.max(0, snapshot.pileCountBefore - pileCountAfter)
    const cardIDs = context.pileIdentityCardIDs ?? context.knownIDs
    const anonymousPileConsumptionCount =
      context.fromZone === 'pile' && cardIDs.length === 0
        ? Math.max(0, actualPileConsumptionCount - knownPileIdentityIDsConsumed.length)
        : undefined

    this.room.applyPileIdentityMove({
      eventType: context.eventType,
      fromZone: context.rawFromZone,
      toZone: context.rawToZone,
      cardIDs,
      cardCount: context.cardCount,
      pileCountBefore: snapshot.pileCountBefore,
      anonymousPileConsumptionCount,
      knownPileIdentityIDsConsumed,
      visiblePileIdentityIDsAfter: this.collectVisiblePileTopIdentityIDs(),
      fromPosition: context.fromPosition,
      toPosition: context.position,
      moveType: context.moveType,
      spellID: context.spellID ?? undefined
    })
  }
}
```

随后在 `Room.moveCards()` 中：

1. 在物理移动前调用 `const pileSnapshot = this.identity.capturePileMoveSnapshot(context)`；
2. 在 `this.resolveConstraints()` 之后紧接调用 `this.identity.commitPileIdentityForMove(context, pileSnapshot)`；
3. 从 `TrackerController.syncTrackerMove()` 中移除 `collectRegularDrawKnownPileCards`、`collectVisiblePileTopIdentityIDs`、`createPileIdentityMove` 以及手动调用的 `readyRoom.applyPileIdentityMove()`。

### 步骤 A2：用 Detached 身份载体替代 `revealPublicCandidateCards` 中的 `createExternalCards`

在 `src/tracker/room/identity.ts` 中新增 `ensureDetachedKnownIdentity(cardID: CardID): Card | null`（与 `createDetachedSuspendedIdentity` 共享底层机制，但不标记 `suspended = true`，而是直接设置 `locationCandidates = [publicLocationCandidate]`）：

- 当该身份后续在牌堆端点或玩家移动中被真实物化时，`RoomIdentity.materialize()` 识别该 detached 载体，将其候选合并或迁移到目标物理匿名槽，并回收临时载体，从而保证物理牌堆槽数与 `Room.cards` 物理容量严格守恒。

## 3. 提交拆分与验证命令

- **PR 1**：`refactor(tracker): internalize PileIdentityLedger move transactions into Room`
- **PR 2**：`refactor(tracker): avoid external card creation on public candidate reveal`
- **验证门槛**：
  ```sh
  pnpm test:tracker
  pnpm typecheck:tracker
  pnpm lint
  pnpm build
  ```
