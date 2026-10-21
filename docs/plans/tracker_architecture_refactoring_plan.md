# 三国杀打小抄记牌器（`src/tracker/`）按优先级架构重构方案

> **适用范围**：本方案严格遵循仓库现有代码规范（2 空格缩进、单引号、无分号、优先 `const` 与 early return、禁止 `import as` 别名、不新增 UI 自动化测试、遵循防御式编程信任边界与 Conventional Commits 规范），可直接作为 `plans/` 下的架构演进蓝图分 PR 落地。

## 优先级路线图总览

| 优先级 | 阶段代号 | 核心重构目标 | 解决的架构痛点 | 涉及主要文件 | 建议 PR 拆分 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **P0-1** | **Phase A** | **内聚 `Room` 与 `PileIdentityLedger` 事务边界** | 普通移动由 Controller 后置拼装账本事件、直接调 `Room.moveCards()` 导致账本失步、`revealPublicCandidate` 虚增场外实体 | `src/tracker/Room.ts`<br>`src/tracker/runtime/trackerController.ts`<br>`src/tracker/room/identity.ts` | 2 个 PR |
| **P0-2** | **Phase B** | **统一“三轨分裂”的技能扩展管线** | 技能分散在 `handler/skills/*`、`RoomMoveEvents`、`TrackerController` 硬编码钩子三处；混用 `spell` 与 `tracker` 状态空间 | `src/tracker/room/moveEvents.ts`<br>`src/tracker/skill/registerHandlers.ts`<br>`src/handler/PubGsCMoveCard.js`<br>`src/handler/skills/*` | 3 个 PR |
| **P1-1** | **Phase C** | **抽象跨消息协议序列协调器（`ProtocolSequence`）** | 诡伏、观虚、诫厉、天候、下书等跨协议技能各自手写散装状态，缺乏被其他技能/判定打断时的自动失效与诊断机制 | `src/tracker/skill/protocolSequence.ts`<br>`src/tracker/skill/GuiFu.ts`<br>`src/tracker/skill/GuanXu.ts`<br>`src/tracker/skill/JieLi.ts` | 2 个 PR |
| **P1-2** | **Phase D** | **升级 `exchange` 命名批次容器与 `[min, max]` 区间约束** | `Zone('exchange')` 扁平数组迫使技能伪造逻辑桶（`Card.location` 与 `Zone.cards` 分叉）；`ConstraintGroup` 无法表达半明半暗区间上下界 | `src/tracker/model/Zone.ts`<br>`src/tracker/skill/HandExchange.ts`<br>`src/tracker/constraint/ConstraintGroup.ts`<br>`src/tracker/constraint/handSlotUsage.ts` | 2 个 PR |
| **P2-1** | **Phase E** | **清理死代码与开启 `tsconfig.tracker.json` 严格模式** | `src/utils/generalTip.js` 悬挂导入已删除的 `./trial.js`；`strict: false` 掩盖 `SeatID` / `null` 边界隐患 | `src/utils/generalTip.js`<br>`tsconfig.tracker.json`<br>`package.json` | 2 个 PR |
| **P2-2** | **Phase F** | **拆分 `logic.js` 消息路由与支持断线重连降级建局** | `logic.js` 400 行巨型 `switch` 耦合所有外围功能；`MsgReconnectGame` 直接令记牌器整局停摆 | `src/logic.js`<br>`src/tracker/runtime/trackerController.ts`<br>`src/tracker/Room.ts` | 2 个 PR |

## P0-1（最高优）：收拢 `Room` 与 `PileIdentityLedger` 的事务一致性边界

### 执行状态（2026-10-22）

- [x] A1：普通移动快照与账本事件构造下沉至 `RoomIdentity`，`Room.moveCards()` 直调自动提交；Controller 移除三项账本辅助方法及普通移动后置提交。洗牌事件同样由 Room 构造。
- [x] A2：公共范围揭示使用独立 `detachedKnownCards` 身份载体，不新增物理实体；精确来源揭示在原匿名槽上物化并回收载体，保留公共区顺序。
- [x] 补齐范围候选的索引重建、手牌容量分配、完整范围摸牌后物化和旧夹具的账本准备；保持既有遍历快照。
- [x] 最终验证：`pnpm test:tracker`（82 个文件、869 项通过）、`pnpm typecheck:tracker`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm build:prod` 全部通过；`git diff --check` 通过，遍历快照未变。未进行浏览器手工验收。

实施调整：账本提交放在最终 `resolveConstraints()` **之前**，使 cohort 投影带来的实体匿名化也被本次
稳定索引同步消费；移动末尾再执行 Room/ledger 一致性检查。Controller 透传类型化
`pileIdentityEvent` 保留协议事实，领域直调由上下文推导；低层物化仍允许分阶段使用。
公共范围身份与物理槽的统一读面为 `trackedCards`，匿名手牌分配同时维护身份名额与物理容量。
以下方案代码保留为阶段设计背景，当前实现以上述执行记录及源码为准。

### 1. 根因剖析

1. **普通移动与洗牌的账本提交位置割裂**：
   - 在 `src/tracker/runtime/trackerController.ts` 的 `syncTrackerMove()` 中，普通移动先调用 `readyRoom.moveCards()`（内部已执行 `resolveConstraints()`），随后才由 Controller 调用私有方法 `createPileIdentityMove()` 和 `readyRoom.applyPileIdentityMove()`。
   - 这导致两个问题：一是 `resolveConstraints()` 执行时账本仍处于未更新的中间态，迫使 `assertPileIdentityLedgerConsistency()` 不能内聚在收敛尾部；二是任何不经过 `TrackerController.syncTrackerMove()` 而直接调用 `Room.moveCards()` 的路径（例如内部技能补偿或单元夹具）都会漏更账本。
2. **公共范围揭示污染物理实体池 `Room.cards`**：
   - `TrackerController.revealPublicCandidateCards()`（用于周群【天候】`3903` 亮牌顶三张之一）对尚未物化的正 ID 调用了 `readyRoom.createExternalCards([], 1)` 再 `materialize(id, target)`。这会在 `Room.cards` 中凭空多造出一张物理实体，破坏“无游戏外加牌时 `Room.cards` 物理槽数量恒定”的领域直觉。

### 2. 具体重构方案

#### 步骤 A1：将账本事件构造下沉至 `Room` 内部

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
      context.fromPosition === POSITION_BOTTOM
        ? pileCards.slice(0, count)
        : pileCards.slice(-count)
    const knownPileDrawCards = sourceCards.filter(
      (card) => card.id > 0 && card.isKnown === true
    )
    return { pileCountBefore, knownPileDrawCards }
  }

  commitPileIdentityForMove(
    context: RoomMoveContext,
    snapshot: PileMoveSnapshot
  ): void {
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

#### 步骤 A2：用 Detached 身份载体替代 `revealPublicCandidateCards` 中的 `createExternalCards`

在 `src/tracker/room/identity.ts` 中新增 `ensureDetachedKnownIdentity(cardID: CardID): Card | null`（与 `createDetachedSuspendedIdentity` 共享底层机制，但不标记 `suspended = true`，而是直接设置 `locationCandidates = [publicLocationCandidate]`）：
- 当该身份后续在牌堆端点或玩家移动中被真实物化时，`RoomIdentity.materialize()` 识别该 detached 载体，将其候选合并或迁移到目标物理匿名槽，并回收临时载体，从而保证物理牌堆槽数与 `Room.cards` 物理容量严格守恒。

### 3. 提交拆分与验证命令

- **PR 1**：`refactor(tracker): internalize PileIdentityLedger move transactions into Room`
- **PR 2**：`refactor(tracker): avoid external card creation on public candidate reveal`
- **验证门槛**：
  ```sh
  pnpm test:tracker
  pnpm typecheck:tracker
  pnpm lint
  pnpm build
  ```

## P0-2（最高优）：统一“三轨分裂”的技能扩展管线

### 1. 根因剖析

目前记牌器对技能特例的处理散落在三个不同层级：
1. **第一轨（`src/handler/spellEffects.js` + `src/handler/skills/*`）**：在 `PubGsCMoveCard.js` 中对 `patched.CardIDs` 原地修改（如 `ChengXiang.ts`、`QingYiLianJu.ts`、`QianFu.ts`、`ShengMo.ts`、`ZeXing.ts`、`ZuoLian.ts`、`JiaoYu.ts`、`XiaShu.ts`），状态存在 `GameState` 的 `spell` 命名空间。
2. **第二轨（`src/tracker/skill/*`）**：通过 `Room.registerMoveEventHandler` 装饰 `NormalizedMoveEvent`，状态存在 `GameState` 的 `tracker` 命名空间。
3. **第三轨（`TrackerController` 硬编码）**：在 `syncTrackerMove` 和 `revealTrackerCards` 里直接 import 并调用 `deferGuiFuMove`、`commitDuoQiMove`、`observeDuoQiKnownCardIDs`。

这导致：
- 蔡瑁【佐练】（`3488`）被迫同时存在 `src/handler/skills/ZuoLian.ts` 和 `src/tracker/skill/ZuoLian.ts` 两个同名文件；
- `src/handler/skills/JiaoYu.ts` 在 Handler 层直接调用 `context.game.room?.refreshPlayerSnapshot()` 越界查询记牌器内部快照；
- Node 侧对 `Room` 或 `TrackerController` 做集成测试时，如果不特意走 `handleMoveCard()`，就会丢失第一轨的技能修正。

### 2. 具体重构方案

#### 步骤 B1：扩展 `RoomMoveEvents` 为全生命周期钩子注册表

在 `src/tracker/room/moveEvents.ts` 中，将单一的 `decorateMoveEvent` 扩展为四阶段流水线接口：

```ts
// src/tracker/room/moveEvents.ts
export interface RoomSkillPlugin {
  readonly id: string
  readonly spellIDs?: readonly (SpellID | '*')[]
  /** 阶段 1：归一化前拦截原始/预处理协议（承接诡伏 3709 暂存、迁附/清议/联句/椒遇 CardIDs 补全） */
  beforeNormalizeMove?: (
    patched: PatchedMoveCardFields,
    raw: Readonly<RawMoveCardEvent>,
    room: Room
  ) => 'defer' | void
  /** 阶段 2：归一化后修饰标准移动事件（现有 MoveEventHandler） */
  decorateMove?: MoveEventHandler
  /** 阶段 3：Room.moveCards 及身份账本落定后的后置钩子（承接下书 361 结算、夺炁 commitDuoQiMove） */
  afterMoveCommitted?: (event: NormalizedMoveEvent, room: Room) => void
  /** 阶段 4：明牌确认或移动公开 ID 后的通知钩子（承接夺炁 observeDuoQiKnownCardIDs） */
  onCardsRevealed?: (cardIDs: readonly CardID[], room: Room) => void
}
```

#### 步骤 B2：剥离 `TrackerController` 中的特定技能耦合

修改 `src/tracker/runtime/trackerController.ts`：
- 删除对 `DuoQi` 与 `GuiFu` 的直接 import；
- 在 `syncTrackerMove()` 中依次调用：
  1. `if (readyRoom.beforeNormalizeMove(patched, raw) === 'defer') return`
  2. `const normalizedEvent = normalizeMoveEvent(patched, raw)`
  3. `const event = readyRoom.decorateMoveEvent(normalizedEvent)`
  4. 执行移动/洗牌/展示分支
  5. `readyRoom.afterMoveCommitted(event)`
  6. `readyRoom.notifyCardsRevealed(event.cardIDs)`
- 在 `revealTrackerCards()` 尾部统一调用 `readyRoom.notifyCardsRevealed(ids)`。

#### 步骤 B3：迁移 `src/handler/skills/*` 至 `src/tracker/skill/` 并合并同名技能

- 将 `QingYiLianJu.ts`（`3157/3511`）、`QianFu.ts`（`3750`）、`ShengMo.ts`（`3434`）、`ZeXing.ts`（`3854`）、`JiaoYu.ts`（`3571`）、`XiaShu.ts`（`361`）迁入 `src/tracker/skill/`，统一使用 `room.readSkillState` / `room.setSkillState`（`tracker` scope）。
- 将 `src/handler/skills/ZuoLian.ts` 合并进 `src/tracker/skill/ZuoLian.ts`，彻底消除双文件跨 scope 维护。
- **保留边界**：仅负责纯小抄 UI 绘制的【称象】（`441/3492` -> `drawChengXiang`）留在 `src/handler/`，因为它不参与记牌器状态推断。
- 完成后，`src/handler/PubGsCMoveCard.js` 中的 `afterMoveCallbacks` 与 `applySpellEffect` 可简化为纯 UI 副作用触发。

### 3. 提交拆分与验证命令

- **PR 1**：`refactor(tracker): introduce Room lifecycle hooks for skill plugins`
- **PR 2**：`refactor(tracker): decouple GuiFu and DuoQi from TrackerController`
- **PR 3**：`refactor(tracker): migrate handler card-patching skills into tracker skill layer`
- **验证门槛**：
  ```sh
  pnpm test:tracker
  pnpm typecheck:tracker
  pnpm lint
  pnpm build
  ```

## P1-1：抽象跨消息协议序列协调器（`ProtocolSequenceCoordinator`）

### 1. 根因剖析

三国杀中大量技能并非单条消息可闭环，而是横跨多条异构消息：
- **诡伏（`3709`）**：`PubGsCMoveCard`（无 ID 获得）$\rightarrow$ 紧邻 `GsCUpdateRoleDataExNtf (DataID=3709)`
- **下书（`361`）**：`GsCRoleOptTargetNtf`（展示牌+目标）$\rightarrow$ `CGsRoleSpellOptRep (Type=22)`（选明/选暗）$\rightarrow$ `PubGsCMoveCard (5->5)`
- **诫厉（`3483`）**：`GsCRoleOptTargetNtf` $\rightarrow$ `PubGsCMoveCard (1->10, 5->10)` $\rightarrow$ `CGsRoleSpellOptRep (Type=53)` $\rightarrow$ `PubGsCMoveCard (10->1, 10->5)`
- **观虚（`987/988`）/ 天候（`3903`）/ 骋烈（`3208`）**：多段 `1->10`、`5->10`、`10->10`、`10->1`、`10->5`

目前每个技能各自在 `skillState` 中维护零散的阶段字段。当序列中途插入被动响应（如受到伤害触发反馈/贞烈、装有木牛流马或闪电判定）或录像跳帧时，散装状态机缺乏统一的**过期清理与异常中断回退**机制。

### 2. 具体重构方案

在 `src/tracker/skill/protocolSequence.ts` 中提供轻量、无外部依赖的会话管理辅助器：

```ts
// src/tracker/skill/protocolSequence.ts
import { trackerLogger } from '@/utils/logger'
import type { Room } from '../Room'
import type { NormalizedMoveEvent } from '../types'

export interface ProtocolSequenceSpec<State> {
  readonly stateKey: string | number
  /** 判断当前移动事件是否属于本序列期望的合法步骤，或属于允许穿插的无害旁路事件 */
  classifyMove: (
    state: State,
    event: NormalizedMoveEvent,
    room: Room
  ) => 'match' | 'bypass' | 'interrupt'
  /** 当序列被非预期移动打断时的清理与告警回调 */
  onInterrupt?: (state: State, interruptingEvent: NormalizedMoveEvent, room: Room) => void
}

export function guardSequenceOnMove<State>(
  room: Room,
  spec: ProtocolSequenceSpec<State>,
  event: NormalizedMoveEvent
): State | undefined {
  const state = room.readSkillState<State>(spec.stateKey)
  if (!state) return undefined

  const decision = spec.classifyMove(state, event, room)
  if (decision === 'match' || decision === 'bypass') return state

  trackerLogger.warn('技能协议序列被非预期移动打断，已清理暂存状态', {
    stateKey: spec.stateKey,
    interruptingSpellID: event.protocol.SpellID,
    interruptingType: event.type
  })
  spec.onInterrupt?.(state, event, room)
  room.deleteSkillState(spec.stateKey)
  return undefined
}
```

- 将 `GuiFu.ts`（`3709`）、`YanXi.ts`（`7017`）、`WenGua.ts`（`780`）、`JieLi.ts`（`3483`）接入该守卫，统一处理“相邻消息失配或被打断时告警并清理状态”的横切逻辑。

### 3. 提交拆分与验证命令

- **PR 1**：`refactor(tracker): add protocol sequence guard for multi-message skills`
- **PR 2**：`refactor(tracker): migrate GuiFu, YanXi, WenGua, and JieLi to sequence guard`
- **验证门槛**：`pnpm test:tracker && pnpm typecheck:tracker && pnpm lint && pnpm build`

## P1-2：升级 `Zone('exchange')` 命名批次子空间与 `[min, max]` 区间约束

### 1. 根因剖析

1. **`Zone('exchange')` 与 `Card.location` 的不变量裂痕**：
   - `src/tracker/skill/HandExchange.ts` 顶部注释明确写道：“逻辑暂存的候选牌 `location` 记为 `'exchange'`，但刻意不加入 `zones.get('exchange')`；因此按 `Zone` 成员统计的口径不会计入它们，按 `card.location` 统计的口径才会。”
   - 同时 `GuanXu.ts` 为了区分“牌堆侧进交换区”和“手牌侧进交换区”，在 `skillState` 里手写了另一套数组桶。这是因为 `Zone('exchange')` 只是一个单层 `Card[]`，没有原生的子批次（Batch/Bucket）概念。
2. **`ConstraintGroup` 只能表达等式名额，无法利用区间上下界**：
   - `ConstraintGroup.expectedSlotsByLocation` 类型为 `Map<string, number>`。
   - 在 `src/tracker/room/movement/hiddenMarks.ts`（如 2 明 2 暗暗置 2 张进标记区，`knownMarkMin = 0, knownMarkMax = 2`）或 `TianHou.ts`（`knownOutMin < knownOutMax`）中，当 `min !== max` 时无法建立 `ConstraintGroup`，导致 `computeHandSlotAllocation()` 计算单座位候选明牌容量上界时丢失了 `max` 上界限制（例如 3 明 2 暗暗置 1 张进标记区，留在手牌的明牌数在 `[2, 3]` 之间，标记区最多只能占 1 张明牌）。

### 2. 具体重构方案

#### 步骤 D1：为 `RoomPublicZones` / `Zone` 增加命名子批次视图

在不破坏普通公共区 `Zone.cards` 读写的前提下，为 `exchange` 区提供原生的命名批次管理（`room.publicZones.getExchangeBatch(batchKey)`），让 `GuanXu`、`TianHou`、`XingZuo`、`HandExchange` 统一通过 `batchKey`（如 `${spellID}:pile`、`${spellID}:seat:${seatID}:${seq}`）存取交换批次，消除各技能文件重复实现的桶切片与回填逻辑。

#### 步骤 D2：将 `ConstraintGroup` 扩展为支持 `{ min, max }` 区间名额

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

### 3. 提交拆分与验证命令

- **PR 1**：`feat(tracker): support [min, max] slot range constraints in ConstraintGroup`
- **PR 2**：`refactor(tracker): unify exchange batch buckets across GuanXu, TianHou, and HandExchange`
- **验证门槛**：
  - 运行 `pnpm test:tracker`，并重点检查 `tests/tracker/traversalBaseline.test.ts` 的遍历计数快照是否保持不变。

## P2-1：清理死代码与开启 TypeScript 严格类型检查

### 1. 根因剖析

1. **悬挂导入隐患**：`src/utils/generalTip.js` 第 1 行仍保留 `import { hasAdvancedFeature, notifyAdvancedFeatureTrial } from './trial.js'`，而 `src/utils/trial.js` 已被删除（`docs/agents/overview.md` 中也标注了“属待清理残留”）。
2. **`tsconfig` 未开启 `strict`**：`tsconfig.json` 中 `"strict": false`，导致 `src/tracker/` 内部虽然已全面 TS 化，但 `strictNullChecks`、`noImplicitAny` 未生效。例如 `Room.ts` 中 `const pile = this.zones.get('pile')` 后直接调用 `pile.replaceAll(...)`、以及协议入参 `SeatID` 在部分边界可能为 `undefined` 的情况未被编译器强制拦截。
3. **缺少统一的 `pnpm test` 脚本**：`package.json` 只有 `test:tracker`，未将 `tests/runtime/` 与 `tests/utils/` 纳入统一测试入口。

### 2. 具体重构方案

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

### 3. 提交拆分与验证命令

- **PR 1**：`chore: remove dead trial.js import in generalTip and add pnpm test script`
- **PR 2**：`refactor(tracker): enable TypeScript strict mode in tsconfig.tracker.json`
- **验证门槛**：`pnpm typecheck:tracker && pnpm typecheck && pnpm test:tracker && pnpm lint && pnpm build`

## P2-2：拆分 `src/logic.js` 消息路由与支持断线重连降级建局

### 1. 根因剖析

1. **`src/logic.js` 职责过载与开局主视角识别分散**：
   - `src/logic.js` 承担了消息白名单过滤、录制器调用、登录 UUID 提取、皮肤/击杀特效屏蔽、弹窗自动关闭、心愿池提示、山河图同步以及全部记牌器协议分发。
   - 主视角 `mySeatID` 的识别散落在 4 个不同地方：`Room.registerPlayers`（匹配 `user.userID`）、`logic.js` 的 `GsCUpdateRoleDataNtf (StateID === 58)`、`logic.js` 的 `SmsgGameSetCharacter`（斗地主/山河图单人选将）、以及 `src/handler/gameFlowState.js`（录像首次摸明牌）。
2. **断线重连（`MsgReconnectGame`）完全放弃当局记牌**：
   - 收到 `MsgReconnectGame` 后，`Game.isDuanXian = true`，`TrackerController.isTrackerReady()` 直接返回 `false` 并 `unmount()` 视图，导致玩家在断线重连后整局失去记牌辅助（连场面已知装备、后续弃牌堆和各角色明牌都无法查看）。

### 2. 具体重构方案

#### 步骤 F1：按领域拆分 `src/logic.js` 并收口 `PerspectiveResolver`

将 `src/logic.js` 瘦身为不到 80 行的顶层调度器，按职责拆分为三个子路由模块：
- `src/handler/trackerRouter.ts`：专门处理记牌器生命周期、选将、回合阶段与卡牌移动消息；
- `src/handler/clientEnhancementRouter.js`：处理皮肤屏蔽、击杀特效、开包弹窗、心愿池、聊天与广播；
- `src/tracker/runtime/perspectiveResolver.ts`：集中管理“主视角座位判定策略”（UUID 匹配 $\rightarrow$ 2v2 阵营语音 `StateID=58` $\rightarrow$ 斗地主/山河图选将 $\rightarrow$ 录像首摸明牌），消除多处散落的 `if (Game.isRecord && Game.myID === undefined)`。

#### 步骤 F2：实现断线重连的“残局降级追踪模式（Degraded Mode）”

将 `Game.isDuanXian` 从“彻底禁用记牌器”改为 `Room.trackingMode: 'full' | 'degraded'`：
- 当收到 `MsgReconnectGame` 时，不卸载视图，而是将当前 `Room` 切换为 `'degraded'` 模式（UI 顶部状态栏提示“断线重连：残局受限追踪”）；
- 在 `'degraded'` 模式下：
  - 关闭依赖完整开局牌堆守恒的强收敛（如 `assertPileIdentityLedgerConsistency` 和未知牌堆容量告警）；
  - 继续正常记录重连之后的所有明牌移动、弃牌堆新增、装备/判定/标记区变动以及玩家手牌差量；
  - 当后续发生洗牌（`2 -> 9`）且协议给出明确的 `CardCount` 时，以该 `CardCount` 重新锚定牌堆物理槽数量，逐步恢复牌堆数量追踪。

### 3. 提交拆分与验证命令

- **PR 1**：`refactor(handler): split logic.js into domain routers and unify perspective resolver`
- **PR 2**：`feat(tracker): support degraded tracking mode after MsgReconnectGame`
- **验证门槛**：`pnpm test:tracker && pnpm typecheck && pnpm lint && pnpm build && pnpm build:prod`
