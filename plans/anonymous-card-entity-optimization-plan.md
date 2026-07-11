# 匿名牌实体与手牌槽位范围优化计划

> 状态：实施中
> 适用范围：`src/tracker/`、`tests/tracker/`
> 目标：在不推翻现有物理牌模型、位置候选与局部约束组的前提下，将匿名牌从零散兜底提升为可追踪、可复用、可验证的正式不确定性模型。

## 0. 前置阶段：随机暗牌转移的全实体候选传播

匿名实体只能解决“槽位存在但实体覆盖不足”的问题，不能修正随机转移时对既有暗牌实体作出的错误身份选择。因此，在继续扩展匿名实体生命周期前，先统一随机手牌转移的语义：

1. 当协议只给出转移数量、不公开具体 `cardIDs`，且来源与目标都是普通手牌时，不再优先确定性移动来源暗牌实体。
2. 收集转移前所有可能位于来源手牌的实体，包括：
   - `isKnown=true` 的明牌身份候选；
   - `isKnown=false`、`id>0` 的真实暗牌实体；
   - `id=0` 的匿名实体。
3. 若来源已观测手牌总数大于实体覆盖数，仅补建差额数量的匿名实体，并先绑定到来源手牌。匿名实体在这里仍是覆盖不足的兜底，而不是默认表示。
4. 将全部来源实体的位置候选扩展为“来源手牌或目标手牌”，并建立同一个精确槽位约束。设转移前来源总数为 `N`、转移数量为 `K`：

```text
来源手牌精确槽位 = N - K
目标手牌精确槽位 = K
候选实体总数 = N
```

5. 该候选传播成功覆盖 `N` 个实体后，设置 `skipUnknownMovement=true`，阻止默认未知移动再次挑选若干暗牌并将其确定性搬到目标手牌。
6. `isKnown=false` 的真实暗牌实体参与位置约束和来源身份置换，但不得进入明牌候选 UI、明牌反查索引或诊断输出中的公开牌名列表。
7. 后续完整手牌展示或具体明牌来源协议收敛时，优先使用组内既有暗牌实体完成身份置换；只有实体覆盖确实不足时才创建瞬时匿名实体。

### 0.1 接管条件

仅在以下条件同时满足时接管默认未知移动：

- `unknownCount > 0`；
- 来源和目标均为不同玩家的普通手牌；
- 不是 `showCards` 之类仅展示、不改变所有权的事件；
- 转移数量 `K` 不大于来源观测总数或可枚举实体数；
- 补齐匿名实体后，候选实体数能够完整覆盖转移前来源手牌总数。

若无法建立完整覆盖，则保留现有保守移动路径并记录诊断，不创建一个“部分精确”的错误约束。

### 0.2 本次验收场景

以“2 号位转移 3 张暗牌给 3 号位”为核心回归：

1. 转移前 2 号位共 9 张手牌，其中 7 张明牌、2 张暗牌实体。
2. 转移后 9 个实体全部具有 `{2, 3}` 手牌位置候选。
3. 约束组记录 2 号位 6 个槽位、3 号位 3 个槽位。
4. 两张暗牌实体都不能在转移时被提前固定到 3 号位。
5. 明牌候选展示仍只包含 7 张已知身份，不泄露两张暗牌的物理 ID。
6. 3 号位完整展示 `[39, 46, 114]` 后，可以利用既有暗实体收敛。
7. 后续 2 号位打出具体暗牌时，可以与既有暗实体置换，不创建瞬时匿名实体。
8. 不再出现“玩家来源明牌未找到可立即置换的手牌占位”和公共区残留回补警告。

---

## 1. 背景

记牌器当前以 `Card` 表示物理牌身份，以 `Room` 表示单局状态源，并通过以下信息共同推断玩家手牌：

- `Player.observedHandCount`：协议或界面确认的玩家手牌总数。
- 确定明牌：物理 ID 和手牌位置都已确定的 `Card`。
- 候选明牌：物理 ID 已知，但可能属于多个玩家或多个玩家子区域的 `Card`。
- 暗牌实体：物理 ID 未公开，但本地仍以某张真实 `Card` 或 `id=0` 占位表示其槽位。
- `ConstraintGroup`：一次随机转移、分配或模糊展示形成的局部数量约束。

真实实体牌作为暗牌占位在大多数普通移动中仍然有效。例如从牌堆摸取三张暗牌时，直接移动牌堆中的三个 `Card` 能同时维持牌堆张数、顺序和后续身份揭示。

问题出现在协议只证明“存在一个手牌槽位”，却无法可靠选择对应物理身份的场景：

1. 随机手牌转移后，明牌身份只形成跨座位候选。
2. 完整手牌展示使候选批量收敛，但本地没有对应暗牌实体。
3. 断线重连或外部观测只恢复手牌数量。
4. 协议突然证明某张仍在牌堆的物理牌实际来自玩家手牌。
5. 洗牌暂停、公共区残留修复和标记区迁移需要替代身份回补旧位置。

如果强行从牌堆选择真实物理牌充当这些槽位，就会无依据地猜测身份；猜错后会污染牌堆顺序、候选传播、洗牌和技能标记账本。

---

## 2. 当前基线

以下能力已经存在，本计划在此基础上渐进优化：

1. 匿名牌协议 ID 保持 `id=0`。
2. 每个匿名实体另有递减负数的唯一 `entityID`。
3. `Room.resolveConstraints()` 稳定后会尝试对账玩家未知手牌实体。
4. 候选手牌没有精确槽位约束时，不会提前把未知额度实体化。
5. 具体明牌移动协议证明牌来自某玩家手牌时，可以创建瞬时匿名实体完成身份交换。
6. 多余匿名实体可以释放到 `outside`。
7. 真实暗牌实体仍优先于匿名实体参与来源置换。

当前基线仍有以下不足：

- `unknownCardCount` 同时承担“未知槽位数量”和“可实体化暗牌数量”，语义过载。
- 候选明牌占用手牌的数量可能是范围，不能始终视为单一确定值。
- 匿名实体只有 `entityID`，缺少创建原因、来源协议、替代目标和迁移历史。
- `outside` 中的匿名实体尚未形成正式复用池。
- 玩家来源置换、洗牌替身、公共区残留回补等路径仍各自维护部分交换逻辑。
- 诊断日志主要输出 `id=0`，难以跨多条消息追踪同一个匿名实体。

---

## 3. 目标

### 3.1 正确性目标

1. 不凭空猜测未知牌的真实物理 ID。
2. 只主动创建“确定存在”的匿名手牌实体。
3. 候选未决时保留范围，不把上界误当作确定数量。
4. 明牌身份揭示时保持全局身份与区域槽位守恒。
5. 匿名实体不得同时出现在两个位置。
6. 匿名实体不得进入以物理 ID 查询为主的 `cardIndex`。
7. 不破坏公共区顺序、暗置标记账本和暂停追踪语义。

### 3.2 可维护性目标

1. 匿名实体具有稳定、唯一、可检索的内部身份。
2. 每个匿名实体可说明“为什么创建、替代了什么、由哪条协议触发”。
3. 所有身份交换最终收口到一个原子操作。
4. 匿名实体创建、复用、迁移和释放具备统一生命周期。
5. 开发日志能按 `entityID` 串联匿名实体的完整过程。

### 3.3 性能目标

1. 普通移动在没有匿名状态变化时，不新增 `Room.cards` 全量遍历。
2. 复用 `resolveConstraints()` 已维护的玩家快照和手牌槽位缓存。
3. 匿名池检索为 O(1) 或摊销 O(1)。
4. 不引入全局二分匹配或全局约束求解器。

---

## 4. 非目标

本计划不处理以下事项：

1. 不把所有暗牌都替换为匿名实体。
2. 不移除真实 `Card` 作为暗牌占位的现有路径。
3. 不重写 `ConstraintGroup` 为通用 SAT、ILP 或图匹配求解器。
4. 不改变外部协议字段、UI 展示用物理 ID 或卡牌配置查询方式。
5. 不一次性拆分 `Card` 身份对象与槽位对象。
6. 不借机重构无关技能处理器、视图或历史遗留模块。

---

## 5. 术语与模型

### 5.1 真实物理牌

```ts
card.id > 0
card.entityID === card.id
```

物理身份已由牌局卡牌配置确定。即使 `isKnown=false`，它仍然代表某张真实牌，只是玩家尚不知道该身份。

### 5.2 匿名牌实体

```ts
card.id === 0
card.entityID < 0
```

表示某个确定存在的槽位，但没有足够依据为它选择真实物理身份。

### 5.3 虚拟匿名额度

表示“可能需要匿名实体，但当前不能证明其确定存在”的数量范围。它不是 `Card`，不得进入 `Room.cards`、公共 `Zone` 或玩家投影。

### 5.4 候选手牌占用范围

对于某座位，候选明牌占用普通手牌槽位的数量应表示为：

```ts
interface HandCandidateOccupancyRange {
  min: number
  max: number
  exact: boolean
  reasons: string[]
}
```

- `min`：无论候选如何分配，该座位至少被候选明牌占用的槽位数。
- `max`：候选允许的情况下，该座位最多被候选明牌占用的槽位数。
- `exact`：`min === max`。
- `reasons`：参与推导的约束组、完整位置候选和保守回退原因。

### 5.5 匿名槽位范围

设：

- `H`：`observedHandCount`。
- `K`：确定明牌手牌槽位数。
- `[Cmin, Cmax]`：候选明牌占用范围。

则：

```text
anonymousMin = max(0, H - K - Cmax)
anonymousMax = max(0, H - K - Cmin)
```

含义：

- `anonymousMin`：确定存在、可以主动实体化的匿名槽位数。
- `anonymousMax`：在候选全部不占该座位时，可能需要的匿名槽位上界。
- `[anonymousMin, anonymousMax]` 之间未实体化的部分保留为虚拟匿名额度。

---

## 6. 核心不变量

### 6.1 身份不变量

1. 所有真实物理牌 `id > 0` 在单局中最多对应一个活动 `Card`。
2. 所有匿名实体 `entityID` 在单局中唯一。
3. 匿名实体永远保持 `id=0`，不得伪装成正物理 ID。
4. 匿名实体不进入 `cardIndex`。
5. `anonymousEntitySeq` 只递减，不复用本局已分配过的 `entityID`。

### 6.2 位置不变量

1. 一个匿名实体在任意时刻只能有一个确定位置或一组合法位置候选。
2. 匿名实体进入公共 `Zone` 时，必须与 `card.location` 一致。
3. 明牌被匿名实体回补后，旧公共 `Zone` 不得同时保留明牌与替代匿名实体。
4. 释放到 `outside` 的匿名实体必须清理 owner、seat、子区域、技能和组合约束。

### 6.3 手牌不变量

当玩家手牌候选范围可计算时：

```text
K + Cmin + anonymousMax >= H
K + Cmax + anonymousMin <= H
materializedAnonymous >= anonymousMin
materializedAnonymous <= anonymousMax
```

若约束交叠导致无法安全计算范围，应扩大范围而不是缩小范围：

```text
Cmin 回退为 0
Cmax 回退为候选牌数量与剩余手牌容量的较小值
```

### 6.4 交换不变量

明牌 `knownCard` 与匿名实体 `anonymousCard` 交换时：

1. `knownCard` 先被证明属于协议来源。
2. `anonymousCard` 继承 `knownCard` 的旧位置或旧位置候选。
3. `knownCard` 再按协议移动到目标位置。
4. 两张牌的公共区引用、约束组、计数器和脏事件一次性更新。
5. 任一步骤失败时不得留下重复公共区引用。

---

## 7. 总体设计

### 7.1 新增槽位范围类型

建议新增：

```text
src/tracker/candidate/handSlotRange.ts
```

核心接口：

```ts
interface HandSlotRangeSummary {
  seatID: SeatID
  observedCount: number
  knownCount: number
  candidateMin: number
  candidateMax: number
  anonymousMin: number
  anonymousMax: number
  materializedAnonymousCount: number
  exact: boolean
  reasons: string[]
}
```

核心函数：

```ts
collectHandSlotRangeBySeat(
  room: Room,
  playerCards: Card[],
  seatIDs: Iterable<SeatID>,
  cachedCounts?: Map<SeatID, HandSlotCountSummary>
): Map<SeatID, HandSlotRangeSummary>
```

### 7.2 候选范围推导原则

候选范围必须保守，不要求第一阶段求得最紧范围。

#### 确定位置

`getHandSlotKindForSeat(card, seatID) === 'known'`：

```text
K += 1
```

#### 无约束跨座位候选

一张牌可能属于 A 或 B，且没有局部数量约束：

```text
对 A：min += 0, max += 1
对 B：min += 0, max += 1
```

#### 单一局部约束组

若某 `ConstraintGroup` 对座位有 `expectedSlotsBySeat` 或手牌完整位置名额：

- 将其解释为该组在该座位的上界。
- 若组内牌总数及其他座位上界足以推导下界：

```text
seatMin = max(0, groupCardCount - sum(otherSeatMax))
seatMax = min(groupSeatExpected, candidateCardCountForSeat)
```

#### 交叠约束组

若同一候选牌被多个无法证明独立的约束组覆盖：

1. 不直接相加各组上下界。
2. 先按共享卡牌构建局部连通分量。
3. 第一阶段对复杂分量回退到保守范围。
4. 后续可在局部分量内部增加小规模流量求解，但不得扩展为全局求解。

#### 容量裁剪

```text
remainingCapacity = max(0, H - K)
candidateMax = min(candidateMax, remainingCapacity)
candidateMin = min(candidateMin, candidateMax)
```

如果 `K > H`，记录状态矛盾，不通过负匿名数掩盖问题。

### 7.3 匿名实体元数据

建议在 `Card` 中为匿名实体增加：

```ts
interface AnonymousCardMetadata {
  reason:
    | 'hand-reconciliation'
    | 'known-source-swap'
    | 'shuffle-preservation'
    | 'public-residue-repair'
    | 'hidden-mark-preservation'
  sourceEvent: unknown
  createdAt: TrackerTimestamp
  origin: CardLocationSnapshot | null
  replacesCardID: CardID | null
  history: AnonymousCardHistoryEntry[]
}
```

`history` 使用固定长度环形或截断数组，例如最多 16 条：

```ts
interface AnonymousCardHistoryEntry {
  action: 'created' | 'reused' | 'moved' | 'swapped' | 'released'
  timestamp: TrackerTimestamp
  from: CardLocationSnapshot | null
  to: CardLocationSnapshot | null
  reason: string
  sourceEventType: string | null
}
```

约束：

- 真实牌不分配该元数据。
- 释放到池中时保留历史，但清理本次绑定字段。
- 日志输出 `entityID`、`reason`、`replacesCardID`，不再只输出 `placeholderCardID: 0`。

### 7.4 匿名实体池

`Room` 新增：

```ts
anonymousCardPool: Card[]
```

接口：

```ts
acquireAnonymousCard(options: AcquireAnonymousCardOptions): Card
releaseAnonymousCard(card: Card, options: ReleaseAnonymousCardOptions): void
```

获取顺序：

1. 从 `anonymousCardPool` 取空闲实体。
2. 验证其 `location === 'outside'`，且不在约束组、公共 Zone 或技能账本中。
3. 重置位置状态并更新 provenance。
4. 池为空时才创建新的负 `entityID`。

释放规则：

1. 只释放 `id=0` 的匿名实体。
2. 不释放正 ID 暗牌。
3. 从所有约束组和技能占位账本移除。
4. 从公共 Zone 移除。
5. 移至 `outside` 并加入池。
6. 同一实体不得重复入池。

### 7.5 主动手牌对账

将现有 `reconcileAnonymousHandCards()` 调整为范围驱动：

```ts
reconcileAnonymousHandCards(
  ranges: Map<SeatID, HandSlotRangeSummary>
): AnonymousReconciliationResult
```

对每个已观测玩家：

1. 读取 `anonymousMin`、`anonymousMax`。
2. 统计该座位确定手牌中的匿名实体。
3. 若实体数小于 `anonymousMin`，从匿名池补齐差值。
4. 若实体数大于 `anonymousMax`，释放超出上界的匿名实体。
5. 若实体数位于范围内，不作修改。
6. 若范围不精确，不把实体数补到 `anonymousMax`。

结果包含：

```ts
interface AnonymousReconciliationResult {
  created: Card[]
  reused: Card[]
  released: Card[]
  unchangedSeats: SeatID[]
  deferredSeats: {
    seatID: SeatID
    anonymousMin: number
    anonymousMax: number
    reason: string
  }[]
}
```

只有 `created/reused/released` 非空时才刷新玩家快照和相关索引。

### 7.6 按协议事实瞬时实体化

当 `PubGsCMoveCard` 明确给出：

```text
knownCardID = X
fromSeat = A
fromSubZone = hand
```

但本地 `X` 不在 A 的手牌中时，协议本身就是强事实。

处理顺序：

1. 优先寻找 A 手牌中现有暗实体。
2. 若本次移动会清空整手，允许沿用已有确定明牌回补路径。
3. 若没有可用实体，从匿名池获取瞬时匿名实体。
4. 临时绑定到 A 的手牌，表示协议证明的来源槽位。
5. 调用统一身份交换操作。
6. 匿名实体继承 `X` 的旧位置。
7. `X` 继续移动到协议目标。

瞬时匿名实体不代表主动推断结果，因此不要求 `anonymousMin > 0`。

### 7.7 原子身份交换

建议在 `RoomMovementSourceMethods` 中新增：

```ts
swapKnownIdentityWithPlaceholder(
  knownCard: Card,
  placeholder: Card,
  context: RoomMoveContext,
  options?: {
    replacementCandidate?: PlayerLocationCandidate | null
    preservePublicPosition?: boolean
    reason?: string
  }
): IdentitySwapResult
```

返回：

```ts
interface IdentitySwapResult {
  swapped: boolean
  knownCardID: CardID
  placeholderEntityID: number
  knownOldLocation: CardLocationSnapshot
  placeholderNewLocation: CardLocationSnapshot
  repairedPublicZone: PublicZoneName | null
}
```

该操作负责：

1. 拍摄双方完整位置快照。
2. 清理占位实体的旧约束。
3. 将明牌绑定到协议来源。
4. 将占位实体迁移至明牌旧位置或继承替代候选。
5. 修复公共 Zone 有序引用。
6. 清理暗置标记账本中的旧占位引用。
7. 记录匿名历史。
8. 标记计数器、位置索引和视图脏变更。

---

## 8. 分阶段实施

## 阶段 0：冻结基线与补充场景

### 目标

在调整模型前固定当前已知行为。

### 工作项

1. 为以下场景补充或确认回归：
   - 7 明 2 暗随机转移 3 张。
   - 候选明牌只确定 1 张进入目标手牌。
   - 来源只剩跨座位候选时打出此前位于牌堆的明牌。
   - 观测手牌数表明有暗槽，但没有暗实体。
   - 暗置标记候选未精确时不得提前补匿名手牌。
   - 洗牌暂停正 ID 时保留玩家和标记区槽位。
2. 固定遍历基线，避免优化引入额外全量扫描。
3. 将现有匿名实体日志加入测试断言。

### 主要文件

- `tests/tracker/handCountObservation.test.ts`
- `tests/tracker/hiddenMarkCandidates.test.ts`
- `tests/tracker/pileDisplayOrder.test.ts`
- `tests/tracker/traversalBaseline.test.ts`

### 完成标准

- 所有场景可在测试中独立复现。
- 不依赖浏览器 DOM。
- 当前 `pnpm test:tracker` 全绿。

---

## 阶段 1：引入候选槽位范围

### 目标

将单值 `candidateCount` 扩展为保守的 `[candidateMin, candidateMax]`。

### 工作项

1. 新增 `handSlotRange.ts`。
2. 复用 `collectHandSlotCardsBySeat()` 的分类结果。
3. 处理无约束候选、单组约束和交叠组保守回退。
4. 输出 `HandSlotRangeSummary`。
5. 保留现有 `candidateCount` 兼容读面：
   - 精确范围时返回确定值。
   - 非精确范围时继续保持旧行为，暂不驱动实体创建。
6. 在 DEV 日志中比较旧单值与新范围，不立即改变移动行为。

### 测试

1. 单张 A/B 候选：`[0,1]`。
2. 7 明 2 暗随机转移 3 张后：
   - 来源候选占用 `[4,6]`。
   - 目标候选占用 `[1,3]`。
3. 完整手牌明牌后范围收敛。
4. 暗置标记 `A 手牌/A 标记` 候选保持范围。
5. 两个共享卡牌的约束组回退到保守范围。

### 完成标准

- 新范围不会比真实可行集合更窄。
- 对精确旧场景给出相同结果。
- 遍历基线无无关上升。

---

## 阶段 2：匿名实体 provenance

### 目标

让每个匿名实体可诊断、可追踪。

### 工作项

1. 为 `Card` 增加可空的 `anonymousMetadata`。
2. 抽取位置快照结构，避免日志临时拼装。
3. 新增匿名历史记录辅助方法。
4. 将以下创建点写入统一原因：
   - 主动手牌对账。
   - 玩家来源瞬时置换。
   - 洗牌身份保留。
   - 公共区残留修复。
   - 暗置标记占位迁移。
5. 日志统一输出 `entityID`。

### 测试

1. `entityID` 单局唯一。
2. provenance 原因和来源事件准确。
3. 历史超过上限时丢弃最旧记录。
4. 真实牌不创建匿名元数据。

### 完成标准

- 任意匿名实体可通过 `entityID` 查询创建原因和最近迁移。
- 不改变协议 ID 和 UI 物理牌查询。

---

## 阶段 3：匿名实体池

### 目标

复用已释放匿名实体，减少重复创建和状态碎片。

### 工作项

1. 在 `Room` 增加匿名池。
2. 实现 `acquireAnonymousCard()`。
3. 实现 `releaseAnonymousCard()`。
4. 将现有 `createExternalCards([], count)` 的匿名创建点逐步迁移到池接口。
5. `destroy()` 清空池和序列。
6. 增加池一致性断言。

### 测试

1. 释放后再次获取复用同一 `entityID`。
2. 同一匿名实体不能重复入池。
3. 公共 Zone、约束组或技能账本中的匿名实体不能入池。
4. 复用后不残留旧 seat、owner、spellID 或 combinationID。

### 完成标准

- 稳态对局中匿名实体数量不随重复对账无限增长。
- 池操作不进入 `cardIndex`。

---

## 阶段 4：范围驱动主动对账

### 目标

只实体化确定存在的匿名槽位。

### 工作项

1. 将 `reconcileAnonymousHandCards()` 改为读取范围摘要。
2. 仅补到 `anonymousMin`。
3. 仅在超过 `anonymousMax` 时释放。
4. 记录区间内未实体化的虚拟匿名额度。
5. 复用收敛循环已有的槽位缓存。
6. 匿名实体变化后才刷新 player 快照。

### 测试

1. 精确 2 明 1 暗：创建 1 个匿名实体。
2. 候选导致匿名范围 `[0,1]`：不创建。
3. 候选收敛后范围变为 `[1,1]`：创建。
4. 范围从 `[2,2]` 变为 `[1,1]`：释放 1 个。
5. 正 ID 暗牌已占槽时不重复创建匿名实体。

### 完成标准

- 不再依赖“候选数量是否为 0”的特判决定实体化。
- 暗置标记和跨座位候选均由范围自然表达。

---

## 阶段 5：统一身份交换

### 目标

把来源置换和公共区回补收口成原子操作。

### 工作项

1. 新增 `swapKnownIdentityWithPlaceholder()`。
2. 先迁移普通玩家来源暗占位置换。
3. 再迁移瞬时匿名来源置换。
4. 迁移暂停追踪明牌恢复。
5. 迁移公共区残留回补。
6. 迁移洗牌身份替身。
7. 最后评估暗置标记账本迁移是否适合复用同一操作。

### 迁移原则

- 每次只迁移一种路径。
- 每种路径保留原有日志和测试，确认等价后再删除旧分支。
- 不在同一提交中同时改动候选范围算法和交换算法。

### 测试

1. 明牌原位于牌堆中部时保持顺序。
2. 明牌原位于弃牌、处理或交换区时正确回补。
3. 明牌原位于玩家候选位置时继承替代候选。
4. 同批多张明牌不互相充当占位。
5. 身份交换后公共区一致性检查为空。

### 完成标准

- `moveKnownCardsForContext()` 不再自行拼装多套交换步骤。
- 所有交换结果都携带 `placeholderEntityID`。

---

## 阶段 6：不变量、诊断与性能

### 目标

让错误在第一次出现时被定位，而不是等后续移动才暴露。

### 工作项

1. 新增 DEV 断言：
   - 匿名 `entityID` 唯一。
   - 匿名实体不在 `cardIndex`。
   - 匿名池与活动区域不交叠。
   - 公共 Zone 与 `card.location` 一致。
   - materialized anonymous 落在允许范围内。
2. 新增结构化诊断：
   - 座位槽位范围。
   - 匿名实体清单。
   - provenance。
   - 参与范围推导的约束组。
3. 给遍历统计增加匿名对账标签。
4. 仅在匿名状态变化或不变量失败时输出 info/warn。

### 完成标准

- 普通高频移动不增加无意义日志。
- 遍历基线新增开销有明确上限和说明。
- 任何匿名重复、漏位或越界都能在当前协议批次定位。

---

## 阶段 7：评估槽位与身份彻底拆分

### 目标

在混合模型稳定后，评估是否有必要继续演进。

### 研究方向

```ts
interface HandSlot {
  slotID: number
  seatID: SeatID
  identityCandidates: Set<Card | AnonymousIdentity>
}
```

可能收益：

- 直接表达“哪个身份可能占哪个槽位”。
- 避免通过位置交换模拟身份替换。
- 可在局部连通分量中使用二分匹配或网络流收敛。

成本：

- `Card` 不再直接拥有唯一确定位置。
- 公共 Zone 顺序与玩家槽位需要双层投影。
- `RoomMovement`、`CardLocationIndex`、`ConstraintGroup` 和视图都需重构。
- 高频约束求解成本上升。

决策门槛：

只有当混合模型仍频繁出现无法表达的身份/槽位矛盾，且这些问题不能通过局部范围与原子交换解决时，才进入该阶段。

---

## 9. 文件级改动地图

| 文件                                         | 预期职责变化                                               |
| -------------------------------------------- | ---------------------------------------------------------- |
| `src/tracker/Card.ts`                        | 匿名元数据、历史记录、匿名辅助判断                         |
| `src/tracker/Room.ts`                        | 匿名池、范围驱动对账、不变量入口                           |
| `src/tracker/Player.ts`                      | 匿名槽位范围兼容读面，逐步减轻 `unknownCardCount` 语义负担 |
| `src/tracker/candidate/handSlotCounts.ts`    | 保留确定/候选牌分类与旧计数                                |
| `src/tracker/candidate/handSlotRange.ts`     | 新增候选和匿名槽位范围推导                                 |
| `src/tracker/ConstraintGroup.ts`             | 暴露局部上下界所需只读信息，不直接创建匿名实体             |
| `src/tracker/roomMovement.ts`                | 调用统一身份交换，缩减分支                                 |
| `src/tracker/roomMovement/sources.ts`        | 匿名获取、来源置换、原子交换实现                           |
| `src/tracker/roomMovement/hiddenMarks.ts`    | 迁移匿名标记占位 provenance 和池操作                       |
| `src/tracker/CardCounter.ts`                 | 明确忽略匿名物理索引，保留状态一致性                       |
| `tests/tracker/handCountObservation.test.ts` | 槽位范围、主动对账和瞬时实体化                             |
| `tests/tracker/pileDisplayOrder.test.ts`     | 公共区顺序与身份回补                                       |
| `tests/tracker/hiddenMarkCandidates.test.ts` | 标记候选范围与匿名占位                                     |
| `tests/tracker/traversalBaseline.test.ts`    | 性能护栏                                                   |
| `docs/agents/card_tracker.md`                | 每阶段完成后同步当前模型                                   |

---

## 10. 测试矩阵

### 10.1 普通手牌

| 场景                     | 预期                         |
| ------------------------ | ---------------------------- |
| 2 明 1 暗，身份都确定    | 1 个匿名或真实暗实体         |
| 2 明，候选可能占 0～1 槽 | 匿名范围保守，不提前补到上界 |
| 观测数减少 1             | 优先释放匿名实体             |
| 正 ID 暗实体存在         | 不重复创建匿名实体           |

### 10.2 随机转移

| 场景                  | 预期                     |
| --------------------- | ------------------------ |
| 7 明 2 暗转移 3       | 已知身份转移范围 1～3    |
| 目标最终确认 1 张候选 | 其余候选允许回到来源     |
| 目标最终确认 3 张候选 | 来源候选相应收敛         |
| 中间有新暗牌进入      | 匿名范围随观测和约束更新 |

### 10.3 明牌来源纠正

| 场景               | 预期                                   |
| ------------------ | -------------------------------------- |
| 来源已有真实暗实体 | 优先使用真实实体置换                   |
| 来源已有匿名实体   | 使用该匿名实体                         |
| 来源只有跨座位候选 | 按协议事实瞬时获取匿名实体             |
| 本次移动清空整手   | 可复用确定来源牌回补，避免多余匿名创建 |
| 同批多张明牌       | 不互相充当占位                         |

### 10.4 公共区

| 场景                 | 预期               |
| -------------------- | ------------------ |
| 明牌旧位置在牌堆中部 | 匿名实体保持原索引 |
| 旧位置在弃牌堆       | 弃牌顺序不变       |
| 旧位置在处理区       | 处理区槽位守恒     |
| 公共区无旧引用       | 不额外插入匿名实体 |

### 10.5 标记与洗牌

| 场景                 | 预期                       |
| -------------------- | -------------------------- |
| 暗置标记候选未精确   | 不提前生成确定手牌匿名实体 |
| 标记正 ID 被洗牌暂停 | 创建或复用匿名标记替身     |
| 标记返回手牌         | provenance 和账本引用迁移  |
| 洗牌后牌堆张数约束   | 匿名补位不破坏协议张数     |

---

## 11. 验证命令

每个实现阶段至少运行：

```text
pnpm test:tracker
pnpm typecheck:tracker
pnpm lint
pnpm build
```

涉及核心移动、洗牌、匿名池或发布前验证时额外运行：

```text
pnpm build:prod
```

修改 Serena 记忆后运行：

```text
serena memories check
```

文件检查：

```text
git diff --check
```

并确认所有修改文件保持 LF。

---

## 12. 风险与缓解

### 风险 1：候选范围计算过窄

后果：提前实体化或释放匿名实体，造成错误收敛。

缓解：

- 无法证明时扩大范围。
- 交叠约束组先保守回退。
- DEV 下与可枚举小场景穷举结果对比。

### 风险 2：匿名实体重复回补公共区

后果：公共区张数增加或同一槽位出现两个实体。

缓解：

- 原子交换中统一检查 Zone 引用。
- 交换后立即运行公共区一致性断言。

### 风险 3：匿名池残留旧状态

后果：复用后继承旧 owner、spellID 或约束。

缓解：

- `releaseAnonymousCard()` 统一重置。
- `acquireAnonymousCard()` 再次断言干净状态。

### 风险 4：主动对账增加高频遍历

后果：每条移动消息额外扫描全部卡牌。

缓解：

- 复用 `playerCardsSnapshot` 和手牌槽缓存。
- 按 dirty seat 对账。
- 无变化时不刷新索引。

### 风险 5：与暗置标记账本冲突

后果：匿名实体释放后账本仍持有引用。

缓解：

- 池释放前统一调用账本移除。
- 标记区迁移放在统一交换的后期阶段。

---

## 13. 提交与回滚策略

建议每阶段独立提交：

1. `test: freeze anonymous card scenarios`
2. `feat: add hand slot occupancy ranges`
3. `feat: track anonymous card provenance`
4. `feat: reuse anonymous card entities`
5. `refactor: reconcile anonymous hands by range`
6. `refactor: centralize identity swaps`
7. `test: enforce anonymous card invariants`

回滚原则：

- 范围模型先以只读/影子计算接入，可独立关闭行为驱动。
- provenance 与日志不改变推断结果，可单独保留。
- 匿名池可回退为每次创建新实体。
- 原子交换按路径逐项迁移，可逐项恢复旧实现。
- 不在同一阶段删除所有旧兜底，至少保留一轮完整回归后再清理。

---

## 14. 最终验收标准

完成阶段 1～6 后应满足：

1. 匿名实体数量由槽位范围而非模糊单值驱动。
2. 候选未决时不会把可能暗牌提前实体化为确定手牌。
3. 协议证明明牌来源时，无论本地是否已有暗实体，都能完成身份守恒。
4. 真实暗实体始终优先复用。
5. 匿名实体可通过 `entityID` 和 provenance 完整追踪。
6. 释放的匿名实体可安全复用，不残留旧状态。
7. 玩家来源置换、公共区回补和洗牌替身逐步共享原子交换实现。
8. 公共区一致性、暗置标记和遍历基线测试全部通过。
9. `pnpm test:tracker`、`pnpm typecheck:tracker`、`pnpm lint`、`pnpm build`、`pnpm build:prod` 全部通过。
10. 文档与 Serena 记忆反映最终模型，没有悬空引用。

---

## 15. 推荐执行顺序

优先执行：

```text
阶段 0 → 阶段 1 → 阶段 2 → 阶段 4 → 阶段 3 → 阶段 5 → 阶段 6
```

原因：

1. 先冻结场景，避免模型调整失去行为基准。
2. 先解决“数量是范围”这一核心语义问题。
3. provenance 应在更多匿名路径迁移前落地，便于调试。
4. 范围驱动对账先验证正确性。
5. 匿名池属于生命周期和性能优化，可在语义稳定后接入。
6. 原子交换最后迁移，避免同时调试范围与位置守恒。
7. 阶段 7 仅作为后续架构评估，不纳入当前实施承诺。

### 15.1 复核修订（2026-07-12）

结合实施后的独立复核（见 [`random-hand-transfer-and-anonymous-entity-implementation-report.md`](random-hand-transfer-and-anonymous-entity-implementation-report.md) 第 6 节），压缩实施承诺：

```text
阶段 0 → 阶段 1 → 阶段 4 → 阶段 5
（阶段 2 仅最小版；阶段 3 暂缓/可能跳过；阶段 6 并入下述性能项；阶段 7 排除）
```

- **性能项并入阶段 0**：`Room.reconcileAnonymousHandCards()` 每次 `resolveConstraints()` 尾部对每个已观测玩家全量扫描 `Room.cards`（`Room.ts:521` / `:1156`），未被 `traversalBaseline` 覆盖；改用 `CardLocationIndex` 按 seat 投影并补基线场景，是最高性价比项，应最先落地。
- **阶段 1 改为条件推进**：先由阶段 0 的长链路 E2E 跑出真实失败用例，再动 `unknownCardCount` 拆分；否则保留现有保守 guard。
- **阶段 2 降为最小版**：仅 `reason` + `sourceEvent`，不做 16 条 bounded history。
- **阶段 3 暂缓/可能跳过**：手牌规模小属过早优化，且与阶段 2 稳定溯源存在张力。
