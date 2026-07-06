# Room.cards 增量索引与确定移动快路径计划

> 本计划承接 [`cards-traversal-optimization-final.md`](cards-traversal-optimization-final.md) 的 P1-D / P1-E1 之后阶段。目标是减少“确定明牌确定移动”这类高频协议动作触发的 `Room.cards` 全量扫描，优先处理当前剩余大头：`CardLocationIndex.rebuild()`、`AmbiguousKnownIndex.rebuild()` 与 `resolveConstraints()` 入口 player 快照。

> **修订记录（2026-07-03，评审对齐后）**
>
> - **分档推进**：阶段 1-3（`CardLocationIndex` / `AmbiguousKnownIndex` 增量 + 手牌摘要）与新增的 **阶段 3.5「A2：增量 player 快照，收敛照跑」** 为既定落地目标；阶段 4（绕收敛快路径 4A-4D）改为**按命中率数据逐条 gate**，不作为既定目标，从最稳的 4A 起、每条强制带命中率埋点。理由：本计划以“遍历计数”为代理指标，尚未建立可测的 wall-clock/帧预算瓶颈证据；阶段 1-3+A2 便宜且安全（A2 保留收敛，正确性 by construction），阶段 4 绕收敛的边际收益需用真实命中率反证是否值得其维护税。
> - **手牌摘要折入 `CardLocationIndex`（方案 B）**：不新建独立 `PlayerHandIndex`。`knownHandBySeat` / `candidateHandBySeat` 已由该索引维护，只新增 `plainUnknownHandCards` 与 `handConstraintGroupIDs` 两类读面，复用其同一批 dirty 消费，减少并行 dirty 结构带来的 stale 面。
> - **补三处评审发现**：
>   - **C1**：快路径必须调用（按 seat 增量的）`syncViewGroups()`。`Player.knownHandCards/candidateHandCards/equipCards/judgeCards/markCards` 是 DOM 渲染真正读取的数据源，由 `syncViewGroups()`（[`roomConstraints.ts:230`](../src/tracker/roomConstraints.ts)）从 `locationIndex` 投影写回；仅增量更新索引而跳过它会让手牌视图 stale。
>   - **C2**：增量索引统一以 `Room.dirtyCardEvents` 游标消费本次变化集（照抄 `CardCounter` 的私有 dirty + 游标范式），游标落后超过 `DIRTY_CARD_EVENT_LIMIT` 时回退全量 `rebuild()`，不依赖“每处 mutation 都手工通知到位”。
>   - **C4（已澄清为非问题）**：`AmbiguousKnownIndex` 的 description 依赖 `formatSeatPrefix()`→`fixedViewId`→`firstID`。经确认 `firstID` 只在牌局开始由先手协议设定一次（唯一调用点 `setTrackerFirstHand`→`setFirstHand`，`fixedViewId` 别无写入），此后不变；且模糊明牌只在对局过程中出现，届时座位前缀已固定。故 step 6 增量无需监听 `firstID`、无需为它回退全量。

> **实施记录（2026-07-06，收敛非终止修复与数据 gate 复盘）**
>
> - **根因修复优先于 4A**：`fastPathTiming()` 暴露 `avgRounds≈88`、`maxRounds=100`、`c2ChangedCount≈roundsTotal`，说明约束二在语义已收敛后仍虚报 `changed`。根因是 `ConstraintGroup.apply()` 把单值展示标签 `card.combinationID` 写成当前 group id，并把这个标签切换计入收敛状态；同一张牌属于多个约束组时会在 group 间来回覆盖，驱动空转到循环上限。修复后 `combinationID` 仍同步，但不再作为 `resolve()` 的 changed 来源。
> - **幂等护栏**：`Card.setSeats()` 对多座位候选重投影增加 key 级幂等判断，同候选不再重赋数组；新增回归测试覆盖“重复候选投影不返回 changed”和“重叠约束组切换 `combinationID` 不驱动重循环”。
> - **测试环境验证**：同一批 177 次移动中，`avgRounds` 从 `88.37` 降到 `1.14`，`maxRounds` 从 `100` 降到 `2`，`c2ChangedCount` 从 `15700` 降到 `0`，`totalMs` 从约 `2947.87ms` 降到约 `269.58ms`。
> - **生产环境验证**：同一口径下 `avgRounds=1.14`、`maxRounds=2`、`c2ChangedCount=0`、`totalMs≈424.17ms`，确认生产也不再出现约束二空转。此后 4A 的可省上界变为毫秒级，阶段 4 继续保持数据 gate，不再作为当前首要优化。

---

## 一、问题背景

当前 `Room.moveCards()` 每次移动结束都会调用 `Room.resolveConstraints()`。即使只是“角色 A 的一张已确定明牌进入弃牌堆”，仍会触发：

| 位置 | 当前行为 | 是否全量扫 `Room.cards` |
| --- | --- | --- |
| `resolveConstraints:playerSnapshot` | 过滤 `location === 'player'` 建快照 | 是 |
| 约束一 / 约束三 | 遍历 `playerCards` 快照 | 否，已缩小到玩家区 |
| `CardLocationIndex.rebuild()` | 重建玩家区与公共区投影 | 是 |
| `AmbiguousKnownIndex.rebuild()` | 重建模糊明牌反查 | 是 |
| `CardCounter.update()` | 处理新牌与 dirty 牌 | 否，已增量化 |

因此，高频确定移动的剩余成本主要来自“收敛后的全量索引重建”和“即使没有约束语义也进入完整收敛流程”。

另一个高频场景是“角色 A 有若干暗手牌，打出一张第一次出现的正 ID 明牌”。它不是单纯的确定明牌移动，而是“暗占位揭示身份”：

1. 协议声明某张正 ID 明牌从 A 手牌进入公共区。
2. 本地若发现该正 ID 不在 A 手牌中，会从 A 手牌中找一张暗占位与该正 ID 实体置换。
3. 正 ID 实体被确认明牌并进入公共区，原暗占位继承正 ID 实体旧位置或被回补到旧公共区。
4. 当前实现随后仍进入完整 `resolveConstraints()`。

这个场景也可以优化，但它需要单独的“暗牌揭示快路径”，不能直接复用“已确定明牌确定移动”的安全条件。

第三个高频场景是“角色 B 获得角色 A 的一张手牌，协议不给正 ID”。如果 A 没有明牌、候选牌或相关约束，这只是普通暗手牌占位从 A 转给 B；但当前实现仍会扫描 A 的已知手牌以判断是否需要候选传播，再扫描 `Room.cards` 取一张暗占位，最后进入完整 `resolveConstraints()`。如果 A 存在明牌，则当前语义会把来源明牌传播成 `A/B` 候选并创建约束组，这种情况必须回退完整收敛。

第四个高频场景是“角色 B 获得角色 A 的一张手牌，协议给了正 ID”。这和不给正 ID 的随机暗牌转移不同：协议已经确定被移动的是哪张牌，不需要把 A 的其它明牌传播成 `A/B` 候选。它包含两个子场景：正 ID 第一次出现，需要先用 A 的普通暗手牌占位揭示身份再转给 B；正 ID 已经是 A 的确定明牌，则是 A 到 B 的确定手牌移动。

---

## 二、目标与非目标

### 既定目标（阶段 1-3 + A2）

1. 为 `CardLocationIndex` 增加增量维护能力，只更新受影响的玩家缓存与公共区缓存。
2. 在 `CardLocationIndex` 内新增手牌推理摘要读面（`plainUnknownHandCards` / `handConstraintGroupIDs`），配合已有 `knownHandBySeat` / `candidateHandBySeat`，用 O(1) 判断某玩家是否存在确定明牌、候选手牌或手牌相关约束。
3. 为 `AmbiguousKnownIndex` 增加增量维护能力，确定明牌确定移动时只删除或更新单牌条目。
4. **A2：把 `resolveConstraints()` 入口/轮末的 player 快照增量化**，收敛流程照跑，只消除每次重建快照的 O(N) 过滤成本。
5. 让 `syncViewGroups()` 支持按 seat 增量，为快路径与 A2 提供只刷新受影响玩家视图组的能力（**C1** 前置）。
6. 保留完整回退路径：任何不满足安全条件的移动仍走现有全量收敛。

### 数据 gate 的目标（阶段 4，逐条评估）

> 以下四类快路径**绕过** `resolveConstraints()`，风险与维护税更高。每条落地前先用命中率埋点确认真实收益，从最稳的 4A 起，达不到收益阈值或命中率过低则不实施。A2 若已把 `playerSnapshot` 成本压到可接受范围，阶段 4 可能整体不必做。

7. 为“确定明牌确定移动”增加 `moveCards` 快路径（4A），跳过完整 `resolveConstraints()`。
8. 为“普通暗手牌首次揭示为确定明牌”增加第二类快路径（4B），减少暗牌出牌场景的线性查找和完整收敛。
9. 为“普通暗手牌在玩家间转移”增加第三类快路径（4C），减少顺手牵羊、获得随机手牌等暗牌转移场景的扫描。
10. 为“协议给正 ID 的确定手牌转移”增加第四类快路径（4D），覆盖正 ID 首次揭示后转移与已有确定明牌转移。

### 非目标

- 不在第一阶段改变约束收敛语义。
- 不把所有移动都增量化；暗牌、候选牌、技能标记、洗牌、批量分配仍优先走完整路径。
- 不移除现有 `rebuild()`，它仍作为初始化、回退、测试断言和复杂场景兜底。
- **不把阶段 4 当作既定交付**；它是由实测命中率驱动的可选优化，缺乏收益证据时保持完整收敛。

---

## 三、安全边界

> 本节的条件只约束**阶段 4 的绕收敛快路径**。阶段 1-3 与 A2 不绕收敛（收敛仍会跑或索引结果与全量 `rebuild()` 等价），其正确性由“增量结果 == 全量结果”的 DEV 影子断言保证，不依赖这里的充分条件。

“唯一位置”是确定明牌快路径的必要条件，但不是充分条件。确定移动快路径必须同时满足以下条件：

1. 移动牌全部为正 ID 已知牌，且 `isKnown === true`。
2. 每张牌移动前没有 `locationCandidates`、`subZoneCandidates`、`publicCandidates`。
3. 玩家来源牌要求 `location === 'player'`、`seats.size === 1`、`owner` 明确，且来源子区明确。
4. 目标位置明确：例如确定进入 `discard`、`pile`、`process`、`exile` 或确定玩家子区。
5. 相关牌不属于任何 `ConstraintGroup`。
6. 本次移动不会创建新的 `ConstraintGroup`，不会触发隐藏标记候选、公共候选传播或跨座位候选传播。
7. 移动不会改变其它牌的候选集合；如果会影响其它牌，必须回退完整 `resolveConstraints()`。
8. 观测手牌数变化不会触发“暗牌额度归零后排除候选”的跨牌收敛；无法证明时回退。

保守原则：宁可少走快路径，也不要让快路径承担推理。

暗牌首次揭示快路径还需要额外满足：

1. 来源必须是明确玩家手牌：`fromSeat` 唯一且 `fromSubZone === 'hand'`。
2. 本次移动只有正 ID 明牌，且 `cardCount === knownIDs.length`，没有额外暗牌同行。
3. 来源玩家手牌中可选的暗占位必须是普通手牌暗占位：
   - `location === 'player'`
   - `subZone === 'hand'`
   - `isKnown !== true`
   - `seats` 只包含来源玩家
   - 无完整位置候选、无子区候选、无公共候选
   - 不在任何 `ConstraintGroup` 中
4. 被揭示的正 ID 实体不能正在承担可见候选、暂停追踪、标记账本或其它推理语义。
5. 置换出的暗占位回到旧位置时，不会影响其它牌的候选和约束。
6. 来源玩家手牌数变化只影响普通暗牌额度，不触发候选排除；无法证明时回退。

普通暗手牌玩家间转移快路径需要满足：

1. 来源和目标必须都是明确玩家手牌：`sourceHandSeat` 与 `targetHandSeat` 都唯一，且二者不同。
2. 协议不给正 ID 或只表示暗牌数量：`unknownCount === handMoveCount`，没有已知牌同行。
3. 来源玩家 A 当前没有需要传播的已知手牌：
   - 没有确定明牌手牌
   - 没有候选明牌手牌
   - 没有公共候选转入手牌的相关牌
4. 来源玩家 A 的可取牌必须是普通暗手牌占位：
   - `location === 'player'`
   - `subZone === 'hand'`
   - `isKnown !== true`
   - `seats` 只包含 A
   - 无完整位置候选、无子区候选、无公共候选
   - 不在任何 `ConstraintGroup` 中
5. 目标玩家 B 接收后只增加普通暗手牌，不创建候选或约束组。
6. A/B 的观测手牌数变化不会触发候选排除；无法证明时回退。

协议给正 ID 的玩家间手牌转移快路径需要满足：

1. 来源和目标必须都是明确玩家手牌：`sourceHandSeat` 与 `targetHandSeat` 都唯一，且二者不同。
2. 本次移动给出正 ID，且 `unknownCount === 0`。
3. 被移动的正 ID 语义确定：
   - 若正 ID 已在来源玩家手牌中，必须是确定手牌明牌，不能是候选手牌。
   - 若正 ID 不在来源玩家手牌中，必须能从来源玩家取出一个普通暗手牌占位用于揭示身份。
4. 来源玩家 A 存在其它确定明牌本身不阻塞；因为协议已经明确被移动的正 ID，不需要执行随机手牌候选传播。
5. 被移动正 ID、用于揭示的暗占位、来源/目标玩家手牌摘要均不涉及手牌相关约束组、隐藏标记账本、公共候选或暂停追踪。
6. 目标玩家 B 接收后是确定明牌手牌，不创建候选或约束组。
7. A/B 的观测手牌数变化不会触发其它候选排除；无法证明时回退。

---

## 四、阶段 1：增量维护 `CardLocationIndex`

### 设计

保留 `CardLocationIndex.rebuild(room)`，新增增量入口，例如：

- `applyDirtyCardEvents(room)`：按 `Room.dirtyCardEvents` 游标消费本次变化集（**C2**）。
- `applyCardChange(room, card)`：单牌重投影。
- `refreshPublicZones(room, zoneIDs)`：局部刷新受影响公共区。

核心做法：

1. **变化集来源统一走 `Room.dirtyCardEvents` 游标（C2）**。索引持有 `lastConsumedSeq`，每次增量只处理 `seq > lastConsumedSeq` 的事件；若游标落后到已被 `DIRTY_CARD_EVENT_LIMIT` splice 掉（`headSeq > lastConsumedSeq + 1`），直接回退全量 `rebuild()`。照抄 `CardCounter` 的私有 dirty + `roomCardCursor` 范式（[`CardCounter.ts`](../src/tracker/CardCounter.ts)），不依赖“每处 mutation 手工通知到位”。
2. 为每张牌维护上一轮投影记录。
   - 可使用 `WeakMap<Card, ProjectionRecord[]>`。
   - 记录该牌曾插入哪些桶：确定手牌、候选手牌、装备、判定、标记、公共区。
3. 更新单牌时先按旧投影记录从桶中删除，再按当前状态重新计算投影并插入。
4. 玩家区桶可以精确到单牌增删。
5. 公共区保留 `Zone.cards` 为顺序源。
   - 公共区发生变化时，不逐张推断顺序，直接只刷新受影响 `zoneID` 的 `publicByZone.set(zoneID, [...zone.cards])`。
   - 这比全量 `room.zones.forEach()` 更小，也避免公共区插入位置带来的顺序复杂度。
6. **同批维护手牌摘要读面（折入本索引，方案 B）**：在同一次单牌重投影里，除既有 `knownHandBySeat` / `candidateHandBySeat` 外，额外维护 `plainUnknownHandBySeat`（普通暗手牌集）与 `handConstraintGroupIDsBySeat`。前者在单牌重投影时顺带增删；后者由 `ConstraintGroup` 变更事件驱动（见阶段 2）。
7. 调试或测试环境提供一致性断言：增量更新后临时全量 rebuild 一个影子索引，对比各 bucket（含手牌摘要读面）的 card id 顺序。

### 需要改动的代码点

| 文件 | 改动 |
| --- | --- |
| `src/tracker/CardLocationIndex.ts` | 增加投影记录、单牌移除/插入、局部公共区刷新、`dirtyCardEvents` 游标消费与手牌摘要读面 |
| `src/tracker/Room.ts` | 在 `resolveConstraints()` 尾部根据 dirty 信息选择增量更新或全量 rebuild；维护索引可消费的 `dirtyCardEvents` 游标 |
| `src/tracker/roomConstraints.ts` | `syncViewGroups()` 支持可选 `seatIDs`，只刷新受影响玩家视图组（C1 前置） |
| `src/tracker/roomMovement.ts` | 暴露本次移动影响的公共区集合，或通过 `Room` 记录 dirty public zones |
| `tests/tracker/` | 增加索引增量与全量 rebuild 等价测试 |

### 验收

- 单张确定手牌进入弃牌堆，只刷新来源玩家桶与弃牌堆公共桶。
- 单张确定弃牌进入手牌，只刷新弃牌堆公共桶与目标玩家桶。
- 装备、判定、标记区确定移动能正确从旧桶删除并插入新桶。
- 候选牌、多候选位置、装备容器候选仍可回退或正确增量。
- `dirtyCardEvents` 游标断档（被 splice 覆盖）时能自动回退全量 `rebuild()`，结果与全量一致。
- `syncViewGroups(seatIDs)` 只刷新受影响玩家，与全量 `syncViewGroups()` 结果一致。

---

## 五、阶段 2：玩家手牌推理摘要

### 设计

为普通暗牌快路径提供 O(1) 安全判定，避免每次通过 `getKnownHandCardsBySeat(seatID)` / `takeUnknownCardsFromPlayer()` 扫 `Room.cards`。

建议不要只在 `Player` 上维护一个孤立布尔值，而是维护手牌摘要结构。布尔值由摘要派生。

落点（评审已定）：**方案 B — 折入 `CardLocationIndex` 增量投影，在其中增加手牌摘要读面**。

不新建独立 `PlayerHandIndex`（方案 A），也不在 `Player` 上直接存字段（方案 C）。理由：`CardLocationIndex` 已增量维护 `knownHandBySeat` / `candidateHandBySeat`，摘要真正新增的只有 `plainUnknownHandBySeat` 与 `handConstraintGroupIDsBySeat` 两项；复用其同一批 dirty 消费，避免再起一个并行 dirty 结构、多一份 stale 面。摘要读面对外只读，写入统一由索引模块在收敛尾部/快路径完成，业务路径不得直接改。

建议摘要字段：

```ts
interface PlayerHandSummary {
  knownHandCards: Set<Card>
  candidateHandCards: Set<Card>
  plainUnknownHandCards: Set<Card>
  handConstraintGroupIDs: Set<string | number>
}
```

派生判定：

```ts
canUsePlainHiddenHandFastPath =
  knownHandCards.size === 0 &&
  candidateHandCards.size === 0 &&
  handConstraintGroupIDs.size === 0
```

字段边界：

- `knownHandCards` 只统计 `location === 'player'`、`subZone === 'hand'`、`isKnown === true` 的确定手牌。
- `candidateHandCards` 统计可能位于该玩家手牌的明牌，包括 `locationCandidates` / `subZoneCandidates` / 多 seat 手牌候选。
- `plainUnknownHandCards` 只包含普通暗手牌占位：
  - `location === 'player'`
  - `subZone === 'hand'`
  - `isKnown !== true`
  - `seats` 只包含该玩家
  - 无完整位置候选、无子区候选、无公共候选
  - 不在任何手牌相关约束组或特殊账本中
- `handConstraintGroupIDs` 只记录会影响该玩家手牌槽的约束组；装备、判定、标记区约束不应阻塞普通暗手牌快路径。

### 与现有索引的关系

`CardLocationIndex` 已经维护 `knownHandBySeat` 与 `candidateHandBySeat`。手牌摘要可以从它增量维护的投影中派生，但还需要额外覆盖两类信息：

1. 普通暗手牌集合：当前视图索引主要服务可见/候选展示，暗占位不一定进入展示桶。
2. 手牌相关约束组：需要在 `ConstraintGroup` 创建、合并、删除、移除牌时同步更新。

因此把这两项读面直接挂进 `CardLocationIndex`：普通暗手牌集在单牌重投影时顺带增删，与既有展示桶共用 dirty 消费；手牌相关约束组集由 `ConstraintGroup` 变更事件驱动，标记受影响 seat 后局部更新。二者都不新起独立索引。

### 需要改动的代码点

| 文件 | 改动 |
| --- | --- |
| `src/tracker/CardLocationIndex.ts` | 新增 `plainUnknownHandBySeat` / `handConstraintGroupIDsBySeat` 读面与 O(1) 查询（折入，不新建 `PlayerHandIndex`） |
| `src/tracker/Room.ts` | 持有索引并在收敛尾部或快路径中更新 |
| `src/tracker/roomMovement/sources.ts` | `getKnownHandCardsBySeat()` / `takeUnknownCardsFromPlayer()` 优先读取摘要 |
| `src/tracker/ConstraintGroup.ts` / `roomConstraints.ts` | 约束组变更时标记受影响 seat |
| `tests/tracker/` | 摘要与全量扫描等价测试 |

### 验收

- A 只有普通暗手牌时，摘要显示可走普通暗手牌快路径。
- A 有确定手牌明牌时，摘要阻止玩家间暗牌快路径，并可直接返回需传播的明牌集合。
- A 有候选手牌时，摘要阻止快路径。
- A 只有装备区/判定区/标记区明牌时，不阻止普通暗手牌快路径。
- 约束组只影响 A 标记区时，不阻止普通暗手牌快路径；影响 A 手牌时必须阻止。
- 摘要结果与全量扫描辅助函数结果一致。

---

## 六、阶段 3：增量维护 `AmbiguousKnownIndex`

### 设计

`AmbiguousKnownIndex` 只关心模糊明牌：多座位候选、完整位置候选、公共候选或相关约束组。确定明牌进入弃牌堆时，它通常不需要全量重建，只需要确保该牌条目被删除。

新增入口：

- `applyCardChanges(cards, groups)`
- `applyCardChange(card, groups)`
- `remove(card)`

核心做法：

1. 如果牌不再满足模糊条件，删除 `items[card.id]`。
2. 如果牌满足模糊条件，只重算该牌 description。
3. 如果 `ConstraintGroup` 结构发生变化，先保守回退全量 rebuild。
4. 后续如果要支持组级增量，再建立 `card -> groups` 反向索引。
5. **description 的“非牌”依赖已澄清为非问题（C4）**：`formatCardDescription()` 调 `formatSeatPrefix()`→`fixedViewId`→`firstID`。`firstID` 只在牌局开始由先手协议设定一次（唯一调用点 `setTrackerFirstHand`），此后不变；模糊明牌均在其后的对局过程中产生，其 description 一律用最终座位前缀计算。故增量无需监听 `firstID`，不必为它加全量回退。

### 验收

- 确定明牌离开玩家区后不会残留 tooltip 描述。
- 多候选明牌候选收缩后 description 与全量 rebuild 一致。
- `ConstraintGroup` 创建、合并、删除时仍走全量 rebuild，避免组关系漏更新。

---

## 六·5、阶段 3.5（A2）：增量维护 player 快照（收敛照跑）

### 目标与定位

这是评审新增的**中间档**：不绕收敛，只把 `resolveConstraints()` 里两处 `this.cards.filter(c => c.location === 'player')`（入口 `playerCards` 构建 + 轮末 `changed` 时重建，见 [`Room.ts`](../src/tracker/Room.ts) `resolveConstraints`）增量化。收敛流程、三类约束、E2 跳过逻辑全部不变，**正确性 by construction**，风险显著低于阶段 4。

在基线里，`resolveConstraints:playerSnapshot` 是常规摸牌 205 中的 80（`calls=2 visited=80`）。A2 把它压到接近 0；若这一步已把成本压到可接受范围，**阶段 4 可能整体不必做**。

### 设计

1. `Room` 维护一份增量的 `playerCards`（有序数组 + 成员判断），成员定义严格等于 `card.location === 'player'`。
2. 更新来源统一走 `Room.dirtyCardEvents` 游标（复用阶段 1 的 C2 机制）：事件 detail 已带 `previousSeats` 等字段，可据“进入/离开 player”增删；游标断档时回退一次全量 filter 重建。
3. 收敛**轮内**的 location 漂移（候选落定→player、`moveToPublicZone`→公共区）都经 `notifyCardChanged` 进入 `dirtyCardEvents`，所以轮末 `if (changed)` 分支改为“消费本轮新增事件增量更新列表”，替代整表 `filter`。
4. 复用现有 `Room.assertPlayerSnapshotConsistency()`（[`Room.ts`](../src/tracker/Room.ts)）作 DEV 等价断言：增量列表必须与全量 `filter` 顺序一致。

### 需要改动的代码点

| 文件 | 改动 |
| --- | --- |
| `src/tracker/Room.ts` | 增量维护 `playerCards`；`resolveConstraints()` 入口/轮末改读增量列表；保留 DEV 等价断言 |
| `tests/tracker/traversalBaseline.test.ts` | `playerSnapshot` visited 降低并刷新内联快照 |

### 验收

- 常规摸牌 / 暗牌分配 / 约束三排他三个基线场景的 `resolveConstraints:playerSnapshot` visited 明显下降。
- 轮内候选落定为 player、明牌移出 player 等 location 漂移后，增量列表与全量 `filter` 完全一致（DEV 断言不告警）。
- 收敛语义、约束三排他行为、E2 跳过统计不变。

---

## 七、阶段 4：移动快路径（数据 gate，逐条评估）

> **前置门槛**：本阶段每条快路径绕过 `resolveConstraints()`，属高风险优化。落地前必须先加命中率埋点（见 §九 step），确认目标协议动作的真实命中率与单条收益；A2 已消除 `playerSnapshot` 成本后，若剩余收益不足以覆盖维护税，则不实施对应快路径。实施顺序固定为 4A → 4B/4C/4D，从最稳的一条起。

### 四条快路径的共同执行约定

无论哪条快路径，在“标记视图 dirty 并结束”之前都必须完成：

1. **`syncViewGroups(affectedSeats)`（C1，必做）**：增量更新 `CardLocationIndex` 之后、结束之前，把投影写回受影响玩家的 `knownHandCards / candidateHandCards / equipCards / judgeCards / markCards`。跳过它 = 手牌视图 stale。用按 seat 增量版本，只刷新来源/目标玩家。
2. **同批更新 `AmbiguousKnownIndex`、`CardCounter`、`unknownCardCount`**，并做公共区一致性检查。
3. **DEV 断言（必做）**：`import.meta.env.DEV` 下，快路径结束后临时跑一次全量 `resolveConstraints()` 的等价影子（或至少影子索引 + 快照对比），断言快路径结果与全量收敛一致；不一致时告警并以全量结果为准。这是绕收敛路径唯一可信的护栏。
4. **命中率埋点（必做）**：记录每条快路径的命中/回退计数与回退原因，供 §九 的数据 gate 决策。

### 4A：已确定明牌确定移动

在 `Room.moveCards()` 正常构建并应用 `MoveContext` 后，进入收敛前判断是否可以跳过完整 `resolveConstraints()`。

建议新增方法：

- `Room.canUseDeterministicMoveFastPath(context): boolean`
- `Room.applyDeterministicMoveFastPath(context): void`

判定要点：

1. `context.knownCards.length === context.cardCount`，无暗牌占位。
2. `context.movedUnknownCards.length === 0`。
3. 所有 moved known cards 移动前后均为确定位置。
4. `context` 未创建或修改候选、公共候选、隐藏标记账本、约束组。
5. 被移动牌不在任何约束组。
6. 手牌数变化只影响来源/目标玩家自身缓存，且不会触发候选排除。

### 快路径执行

1. 更新受影响玩家的 `unknownCardCount`。
2. 增量更新 `CardLocationIndex`（含手牌摘要读面）。
3. **`syncViewGroups(affectedSeats)` 写回受影响玩家视图组（C1，见共同执行约定，勿漏）。**
4. 增量更新 `AmbiguousKnownIndex`。
5. 调用 `counter.update()`，保持现有 dirty card 增量逻辑。
6. 执行公共区一致性检查。
7. DEV 下跑等价影子断言。
8. 标记视图 dirty 并结束，不进入完整 `resolveConstraints()`。

> 备注：4A 的手牌数变化对约束三是安全的——确定明牌移出/移入使来源/目标玩家的 `observedHandCount` 与 `knownCount` 同增同减，`observedHandCount - knownCount` 不变，不会新触发“额度归零排他”。这是四条里最稳的一条，先做它验证收益。

### 回退

任何条件不满足时直接执行现有：

```ts
this.resolveConstraints()
```

这条回退路径必须长期保留。

### 4B：普通暗手牌首次揭示

这是“角色 A 有若干普通暗手牌，打出一张第一次出现的正 ID 明牌”的专用快路径。

建议新增方法：

- `Room.canUseHiddenHandRevealFastPath(context): boolean`
- `Room.applyHiddenHandRevealFastPath(context): void`

识别条件：

1. `fromSeat` 明确，`fromSubZone === 'hand'`。
2. `toZone` 是明确公共区，或明确玩家子区但不会创建候选。
3. 本次移动只包含正 ID 明牌，不混入 `id=0` 或协议暗牌数量。
4. 每个正 ID 当前不在来源玩家手牌中，但可以找到一个普通来源暗占位。
5. 来源暗占位和正 ID 实体都不参与约束组、候选传播、隐藏标记账本、公共候选或暂停追踪。
6. 本次移动不会触发技能处理器、`createPublicMoveConstraintGroup()` 或其它移动事件装饰器的推理副作用。

执行流程：

1. 从来源玩家的“普通暗手牌缓存”中取出一个暗占位，避免再通过 `Room.cards.find()` 查找。
2. 将正 ID 实体绑定到来源玩家手牌并确认明牌，再按协议移入目标区域。
3. 将暗占位恢复到正 ID 实体原位置，或按现有公共区回补规则继承旧位置。
4. 局部更新来源玩家手牌缓存、目标公共区缓存、`CardLocationIndex`、`AmbiguousKnownIndex` 和 `CardCounter`，并 `syncViewGroups(affectedSeats)` 写回视图组（C1）。
5. 更新来源玩家 `unknownCardCount`。
6. 做公共区一致性检查。

回退条件：

- 找不到普通暗占位。
- 来源玩家存在候选手牌或相关 `ConstraintGroup`，且本次手牌数变化可能影响候选排除。
- 正 ID 实体当前位置不是可安全置换的普通公共/牌堆位置。
- 需要创建、合并或删除约束组。
- 触发任何技能或特殊账本逻辑。

这条快路径可以在 4A 之后实施，也可以先只建立“普通暗手牌缓存”作为预备优化：即使暂不跳过 `resolveConstraints()`，也能减少 `swapCardWithUnknown()` 的线性查找。

### 4C：普通暗手牌玩家间转移

这是“B 获得 A 的一张未知手牌，且 A 没有明牌/候选/约束”的专用快路径。

建议新增方法：

- `Room.canUsePlainHiddenHandTransferFastPath(context): boolean`
- `Room.applyPlainHiddenHandTransferFastPath(context): void`

识别条件：

1. `sourceHandSeat` 与 `targetHandSeat` 都明确且不同。
2. `unknownCount === handMoveCount`，`knownCards.length === 0`。
3. `sourceEvent?.type !== 'showCards'`，且没有技能处理器或移动事件装饰器要求候选传播。
4. 来源玩家普通暗手牌缓存数量足够。
5. 来源玩家手牌摘要满足 `canUsePlainHiddenHandFastPath`；否则必须回退。
6. 若摘要显示来源玩家有已知手牌，现有逻辑会调用 `markRandomHandTransferCandidates()` 将明牌传播为 `A/B` 候选，必须回退。
7. 来源和目标玩家没有相关候选手牌或约束组。

执行流程：

1. 从 A 的普通暗手牌缓存中取出指定数量的暗占位。
2. 将这些占位绑定到 B 的普通手牌。
3. 更新 A/B 的普通暗手牌缓存、手牌数量、`unknownCardCount`。
4. 增量更新 `CardLocationIndex`、`AmbiguousKnownIndex` 和 `CardCounter`。
5. `syncViewGroups([sourceHandSeat, targetHandSeat])` 写回视图组（C1），标记 A/B 玩家视图 dirty。

回退条件：

- A 有任何已知手牌，需要传播候选。
- A/B 任一方有相关候选手牌、子区候选、公共候选或约束组。
- 本次移动混有正 ID 明牌、技能标记、装备/判定/标记子区。
- 来源暗占位不足或不是普通暗手牌。

这条快路径和 4B 共用“普通暗手牌缓存”。缓存需要支持按 seat 取出、插入和校验，且只包含不会承载推理语义的普通暗手牌。

### 4D：协议给正 ID 的玩家间手牌转移

这是“B 获得 A 的一张手牌，协议明确给出正 ID”的专用快路径。它覆盖两种情况：

1. 正 ID 第一次出现：从 A 的普通暗手牌占位揭示为该正 ID，再转移到 B。
2. 正 ID 已经是 A 的确定明牌：直接从 A 的确定手牌转移到 B 的确定手牌。

建议新增方法：

- `Room.canUseKnownIdHandTransferFastPath(context): boolean`
- `Room.applyKnownIdHandTransferFastPath(context): void`

识别条件：

1. `sourceHandSeat` 与 `targetHandSeat` 都明确且不同。
2. `knownCards.length === handMoveCount`，`unknownCount === 0`。
3. `toZone === 'player'`，目标子区为普通手牌。
4. 每张正 ID 要么已经是来源玩家的确定手牌明牌，要么可以用来源玩家普通暗手牌占位安全揭示。
5. 被移动牌不在任何手牌相关 `ConstraintGroup` 中，没有完整位置候选、子区候选、公共候选或暂停追踪。
6. 本次移动不会触发技能处理器、隐藏标记账本、公共候选传播或约束组创建。
7. 来源玩家存在其它确定明牌不要求回退；只有这些明牌本身参与候选/约束时才回退。

执行流程：

1. 对已在 A 手牌中的确定明牌，直接从 A 的确定手牌桶移除。
2. 对首次出现的正 ID，从 A 的普通暗手牌缓存取一个占位完成揭示与置换。
3. 将正 ID 绑定为 B 的确定手牌明牌。
4. 更新 A/B 的手牌摘要、普通暗手牌缓存、`unknownCardCount`。
5. 增量更新 `CardLocationIndex`、`AmbiguousKnownIndex` 和 `CardCounter`。
6. `syncViewGroups([sourceHandSeat, targetHandSeat])` 写回视图组（C1），标记 A/B 玩家视图 dirty。

回退条件：

- 正 ID 对应牌当前是候选牌，或不在来源玩家确定手牌且找不到普通暗占位揭示。
- 被移动牌或暗占位参与手牌相关约束组。
- 目标不是普通手牌，或本次移动混有暗牌数量。
- 触发技能、隐藏标记、公共候选或其它推理副作用。
- A/B 手牌数变化可能触发其它候选排除。

这条快路径和 4C 的关键差异：

- 4C 不给正 ID，来源玩家只要有确定明牌就必须回退并传播候选。
- 4D 给了正 ID，来源玩家有其它确定明牌不阻塞，因为被移动身份已经明确。

---

## 八、测试计划

### 新增等价测试

> 测试 1-4 属阶段 1-3（索引/摘要增量），随对应阶段落地；测试 5-14 属阶段 4 快路径，随各条快路径 gate 通过后才落地；A2 的等价性由 `assertPlayerSnapshotConsistency` DEV 断言 + 遍历基线覆盖，无需单列。

1. `CardLocationIndex` 增量更新与全量 rebuild 等价。
2. `AmbiguousKnownIndex` 增量更新与全量 rebuild 等价。
3. 确定手牌明牌进入弃牌堆，索引只更新来源玩家与弃牌堆读面。
4. 确定弃牌进入手牌，索引只更新弃牌堆与目标玩家读面。
5. 普通暗手牌首次揭示为明牌，能使用暗占位缓存并局部更新来源玩家与目标公共区。
6. 普通暗手牌从 A 转移到 B，且 A 无明牌/候选/约束时，能使用暗占位缓存并局部更新 A/B。
7. 玩家间暗牌转移但来源玩家存在明牌时，必须回退完整收敛并传播候选。
8. 玩家间手牌转移给出正 ID，且正 ID 是 A 的确定明牌时，能局部更新 A/B。
9. 玩家间手牌转移给出正 ID，且正 ID 首次出现时，能用 A 的普通暗占位揭示并局部更新 A/B。
10. 玩家间手牌转移给出正 ID 时，A 有其它确定手牌明牌不阻止快路径。
11. 来源玩家只有装备区/判定区/标记区明牌时，不阻止普通暗手牌玩家间转移快路径。
12. 暗牌揭示但来源玩家存在候选明牌或约束组时，必须回退完整收敛。
13. 候选明牌移动、复杂暗牌移动、隐藏标记移动、公共候选传播全部回退完整收敛。
14. 约束组三选一、四选一等场景中，相关牌移动时不得走快路径。

### 遍历基线

扩展 `tests/tracker/traversalBaseline.test.ts`：

| 场景 | 阶段 1-3 后 | A2 后 | 阶段 4 后（若该条 gate 通过） |
| --- | --- | --- | --- |
| 确定明牌弃置 | `locationIndex:rebuild` / `ambiguousKnownIndex:rebuild` 降为 0，增量计数为 1 | `playerSnapshot` visited 下降 | `playerSnapshot` 降为 0（4A） |
| 确定弃牌回手牌 | 同上 | 同上 | 同上（4A） |
| 普通暗牌首次揭示 | 索引全量重建降为 0 | `playerSnapshot` 下降 | `playerSnapshot` 降为 0，且不扫 `Room.cards` 找暗占位（4B） |
| 普通暗牌玩家间转移 | 索引全量重建降为 0 | `playerSnapshot` 下降 | `playerSnapshot` 降为 0，暗牌来源查找不扫 `Room.cards`（4C） |
| 正 ID 玩家间手牌转移 | 索引全量重建降为 0 | `playerSnapshot` 下降 | `playerSnapshot` 降为 0，首次揭示不扫 `Room.cards` 找暗占位（4D） |
| 候选牌收敛 | 允许继续全量 rebuild | — | — |
| 洗牌 | 暂不优化，维持现状 | — | — |

> 阶段 1-3 只把索引改增量，收敛仍跑，故 `playerSnapshot` 不变；它由 A2 下降、由阶段 4（若实施）归零。每步用 `vitest run -u` 刷新内联快照。

---

## 九、推荐实施顺序

### 既定推进（阶段 1-3 + A2）

1. 补充测试工具：提供“增量索引结果 vs 全量 rebuild 结果”的断言辅助，以及 `dirtyCardEvents` 游标消费的封装（C2）。
2. 实施 `CardLocationIndex` 增量更新（含 C2 游标消费与 C1 `syncViewGroups(seatIDs)`），但 `resolveConstraints()` 仍默认全量 rebuild；先在测试中单独验证增量能力与游标断档回退。
3. 接入 `Room`：无约束组结构变化时使用 `dirtyCardEvents` + dirty public zones 增量刷新 `CardLocationIndex`。
4. 在 `CardLocationIndex` 内折入手牌摘要读面（`plainUnknownHandBySeat` / `handConstraintGroupIDsBySeat`），用全量扫描断言验证等价（方案 B）。
5. 用手牌摘要替代 `getKnownHandCardsBySeat()` / `takeUnknownCardsFromPlayer()` 的简单扫描路径；复杂路径仍可回退扫描。
6. 实施并接入 `AmbiguousKnownIndex` 单牌增量（沿用 C4：无需监听 `firstID`、无需为它回退全量；补装备容器候选反向依赖）；约束组结构变化仍全量 rebuild。
7. **A2：增量维护 player 快照，收敛照跑**；更新遍历基线，确认两次全量重建 + `resolveConstraints:playerSnapshot` 三处均下降。

### 数据 gate 决策点

8. **分档评估**：读 A2 后的遍历基线 + 真实场景 profile（高频移动帧时间），决定阶段 4 是否启动、启动哪几条。先给四条快路径加命中率埋点（命中/回退/回退原因）。

### 数据 gate 通过后逐条推进（阶段 4）

9. 建立来源玩家普通暗手牌缓存，先替代 `swapCardWithUnknown()` 的线性查找（**不跳收敛**的预备优化，独立可回退）。
10. 4A：实施确定明牌确定移动快路径，跳过 `resolveConstraints()`（四条里最稳，先做，带 DEV 等价影子断言）。
11. 4B：实施普通暗手牌首次揭示快路径（命中率达标后）。
12. 4C：实施普通暗手牌玩家间转移快路径（依赖手牌摘要成熟，命中率达标后）。
13. 4D：实施协议给正 ID 的玩家间手牌转移快路径（命中率达标后）。
14. 保守回退日志/DEV 断言常态化，持续观察哪些协议动作仍走全量收敛，反哺后续取舍。

---

## 十、风险点

- `CardLocationIndex` 一个候选可能投影到多个桶，必须依赖旧投影记录删除，不能只根据当前状态反推旧桶。
- 公共区有顺序语义，增量维护应刷新受影响 zone 的数组，而不是只按单牌 push/remove 猜顺序。
- `AmbiguousKnownIndex` 的 description 依赖 `ConstraintGroup`，组结构变化时单牌增量容易漏关联，先全量回退更稳。
- `dirtyCards` 是本局级集合，不能直接当作“本次移动变化集”长期使用；需要事件游标或 move context 局部 dirty 集。
- 快路径必须严守回退条件，尤其是手牌数归零导致候选排除、暗置标记、公共候选传播和约束组收敛。
- 普通暗牌缓存只能缓存“无候选、无约束、无特殊账本”的暗手牌；候选暗牌或暗标记占位进入缓存会破坏推理语义。
- 暗牌揭示时同时移动正 ID 实体和暗占位，增量索引必须把两张牌都作为 dirty card 处理。
- 玩家间暗牌转移不能只检查“没有候选牌”；来源玩家只要有确定明牌，就必须保留当前的候选传播语义。
- A/B 手牌数变化可能让某些候选排除条件成立；快路径只能用于没有相关候选输入的普通暗手牌场景。
- 手牌摘要不能被各业务路径随手写入，必须统一通过索引模块或 `Room` 事件更新，否则快路径判定会使用陈旧状态。
- `handConstraintGroupIDs` 必须精确到手牌相关约束，不能因为玩家存在装备/标记约束就无谓阻塞普通暗牌快路径。
- 协议给正 ID 的玩家间转移不能误走随机暗牌传播逻辑；正 ID 明确时，来源玩家其它明牌不应被扩展成候选。
- 首次出现的正 ID 转移会同时影响正 ID 实体和来源暗占位，二者都必须进入 dirty card / 手摘要更新集合。
- **（C1）快路径漏 `syncViewGroups()`**：只增量更新 `CardLocationIndex` 而不写回 `Player.*Cards`，会让 DOM 手牌区渲染出 stale 数据。快路径与 A2 都必须调用按 seat 增量的 `syncViewGroups(affectedSeats)`。
- **（C2）`dirtyCardEvents` 游标断档**：事件日志被 `DIRTY_CARD_EVENT_LIMIT` splice 后，落后的索引游标会漏事件；必须检测断档并回退全量 `rebuild()`，不能静默继续增量。
- **（C4，已澄清为非问题）`AmbiguousKnownIndex` 描述的非牌依赖**：`firstID` 只在牌局开始设定一次、此后不变，模糊明牌都在其后产生；故增量无需监听 `firstID`，无需为它回退全量。
- **快路径回退过保守会侵蚀收益**：安全条件越严，快路径命中越少。若为了正确性把条件收得很紧，实际命中率可能低到不值得维护——这正是阶段 4 必须先埋点、按数据 gate 的原因，不能凭“看起来能省”就实现。
- **A2 轮内 location 漂移**：候选落定→player、`moveToPublicZone`→公共区都发生在收敛循环内，增量 player 列表必须消费这些轮内事件，否则与全量 `filter` 背离；靠 `assertPlayerSnapshotConsistency` DEV 断言兜住。

---

## 十一、完成标准

### 阶段 1-3 + A2 完成标准（既定交付）

- 确定明牌确定移动场景的 `locationIndex:rebuild` / `ambiguousKnownIndex:rebuild` 改为增量（仅游标断档 / 约束组结构变化时回退全量；C4 不设额外回退分支，装备容器候选通过反向依赖增量重算）。
- 增量索引、手牌摘要读面、A2 增量快照的结果与全量 `rebuild()` / 全量扫描 / 全量 `filter` 等价（DEV 影子断言 + 等价测试覆盖）。
- A2 后遍历基线的 `resolveConstraints:playerSnapshot` visited 显著下降，且收敛语义、约束三排他、E2 跳过统计不变。
- `syncViewGroups(seatIDs)` 与全量 `syncViewGroups()` 结果一致；不产生 stale 手牌视图。
- 候选、不确定、技能和洗牌场景行为与全量路径保持一致。
- `pnpm test:tracker`、`pnpm typecheck:tracker`、`pnpm lint`、`pnpm build` 全部通过。

### 阶段 4 完成标准（对应快路径通过数据 gate 后才适用）

- 对应快路径命中率达到预设阈值（埋点数据支撑）；达不到则不实施，维持全量收敛。
- 命中场景不再触发 `resolveConstraints:playerSnapshot`，且 DEV 等价影子断言证明与全量收敛结果一致。
- 普通暗手牌首次揭示场景不再通过 `Room.cards.find()` 查找暗占位。
- 普通暗手牌玩家间转移场景不再通过 `Room.cards` 扫描查找来源暗占位。
- 协议给正 ID 的玩家间手牌转移场景不再通过 `Room.cards` 扫描查找来源暗占位或重建全量索引。
- 普通暗手牌快路径通过玩家手牌摘要做 O(1) 判定；来源玩家有手牌明牌时能稳定回退并传播候选。

---

## 十二、实施进展

> 按 §九 推荐顺序推进；本节记录已落地部分与实测数据，未落地步骤保持勾选空缺。

### 状态清单（对应 §九 步骤）

- [x] **step 1**：测试工具 —— `expectLocationIndexMatchesRebuild()`（`tests/tracker/helpers/locationIndex.ts`）比对“增量结果 vs 全量 rebuild 结果”；`dirtyCardEvents` 游标消费封装进 `CardLocationIndex.applyDirtyCardEvents()`。
- [x] **step 2**：`CardLocationIndex` 增量能力（`applyDirtyCardEvents` / `applyCardChange` / `refreshPublicZones`，含 C2 游标断档回退与 C1 `syncViewGroups(seatIDs)`），`resolveConstraints()` 当时仍默认全量；单独测试验证（`tests/tracker/cardLocationIndexIncremental.test.ts`）。
- [x] **step 3**：接入 `resolveConstraints()` 尾部改走增量；`Zone` 变更记录 `Room.dirtyPublicZones` 补齐纯公共区移动；DEV 影子等价断言 `Room.assertLocationIndexConsistency()`；集成测试 `tests/tracker/resolveConstraintsIncrementalIndex.test.ts` 驱动真实 `moveCards`/`shufflePile` 逐步比对。
- [ ] step 4：`CardLocationIndex` 折入手牌摘要读面（`plainUnknownHandBySeat` / `handConstraintGroupIDsBySeat`）。
- [ ] step 5：手牌摘要替代 `getKnownHandCardsBySeat()` / `takeUnknownCardsFromPlayer()` 简单扫描。
- [x] **step 6**：`AmbiguousKnownIndex` 单牌增量（沿用 C4 非问题结论；含装备容器候选反向依赖）。详见 [`ambiguous-known-index-incremental-step6-plan.md`](ambiguous-known-index-incremental-step6-plan.md)。
- [x] **step 7（A2）**：增量维护 `resolveConstraints()` 的 player 快照，收敛照跑。详见 [`a2-player-snapshot-incremental-step7-plan.md`](a2-player-snapshot-incremental-step7-plan.md)。
- [~] **step 8（进行中）**：阶段 4 快路径「dry-run 数据 gate」。增量 1（4A 命中率埋点，**不绕收敛**）已落地；4B–4D 埋点与 step 4-5 手牌摘要留待后续增量。详见下方「step 8 落地记录」。

> **执行顺序偏差**：step 6-7 先于 step 4-5 落地。step 4-5（手牌摘要）主要为阶段 4 快路径铺路，属数据 gate 前置，缺乏收益证据时可能整体不做；step 6（`AmbiguousKnownIndex` 增量）与 step 7（A2 player 快照）是既定索引/快照增量的核心收尾，故先做。step 4-5 保持勾选空缺待定。

### 改动文件（step 1-3）

| 文件 | 改动 |
| --- | --- |
| `src/tracker/CardLocationIndex.ts` | 抽出共享 `projectCard()`；新增 `applyDirtyCardEvents` / `applyCardChange` / `refreshPublicZones` / `toComparable`；投影记录 + `room.cards` 顺序键 + 游标 + 容器依赖牌集合；`rebuild(room, { record })` |
| `src/tracker/Room.ts` | `dirtyPublicZones` 字段/初始化/清理 + `markPublicZoneDirty()`；`resolveConstraints()` 尾部 `rebuild` → `applyDirtyCardEvents` + 清空 + `assertLocationIndexConsistency()` |
| `src/tracker/Zone.ts` | `add/remove/removeCard/replaceCard/replaceAll/clear` 六个有序关系变更点记录 dirty 公共区 |
| `src/tracker/Card.ts` | `bindCandidates()` / `confirmKnown()` 在改变状态时发 `notifyCardChanged`（补齐子区/技能/明牌变更事件） |
| `src/tracker/roomConstraints.ts` | `syncViewGroups(seatIDs?)` 支持按 seat 增量（C1 前置，暂由 step 3 全量调用） |
| `tests/tracker/helpers/locationIndex.ts` | 新增等价断言辅助 |
| `tests/tracker/cardLocationIndexIncremental.test.ts` | 增量能力隔离测试（9 例，含游标断档回退、显式公共区提示） |
| `tests/tracker/resolveConstraintsIncrementalIndex.test.ts` | 收敛路径集成测试（9 例，含纯公共区移动、洗牌、排他触发） |
| `tests/tracker/traversalBaseline.test.ts` | 四场景快照刷新：`locationIndex:rebuild` → `locationIndex:applyDirty` |

### 增量索引暴露并修复的两处真实缺口

1. **装备容器候选的跨牌依赖**：带装备容器候选的标记牌，其投影座位由 `resolveEquipmentContainerLocationCandidates()` 取自装备当前承载座位。装备移动时该标记牌自身不脏，增量会漏投影。修复：`CardLocationIndex` 维护 `containerDependentCards` 集合，每个增量批次一并重投影（容器候选罕见，通常空集、零开销）。被 `hiddenMarkCandidates.test.ts` 的木马场景捕获。
2. **同座位子区/技能/明牌变更不发脏牌事件**：`bindCandidates()` 做 `equip→mark` 等同 owner 迁移时，`setSeats()` 因席位未变不发事件，增量看不到该牌变脏。根因是事件流原本围绕“席位变更”（服务 E2），而投影还依赖 `subZone`/`spellID`/`isKnown`。修复：`bindCandidates()` / `confirmKnown()` 在改变状态时显式 `notifyCardChanged`。事件流因此对增量索引更完整，后续增量消费者同样受益。

> 二者都由既有测试 + 新集成测试 + DEV 影子断言捕获，印证“增量 == 全量”等价护栏的价值。

### 实测遍历量（40 张→本节用 20/40 张基线，`traversalBaseline.test.ts` 内联快照）

| 场景 | step 3 前 total visited | step 3 后 total visited | 变化 |
| --- | --- | --- | --- |
| 常规摸牌 | 205 | 166 | `locationIndex:rebuild 40` → `applyDirty 1` |
| 暗牌分配 | 166 | 128 | `rebuild 40` → `applyDirty 2` |
| 约束三排他触发 | 214 | 176 | `rebuild 40` → `applyDirty 2` |
| 洗牌 | 200 | 160 | `rebuild 40` → `applyDirty 0`（公共区靠 Zone dirty 刷新） |

> step 3 当时 `ambiguousKnownIndex:rebuild`（40）与 `resolveConstraints:playerSnapshot` 未变（step 6 / A2 尚未做）；两者分别由 step 6、step 7 归零，见下方「step 6-7 落地记录」。DEV 影子断言用 `rebuild(room, { record: false })`，不污染基线计数。

### 与计划的偏差记录

- **位置索引不需要“约束组结构变化”门槛**：`CardLocationIndex` 投影只依赖卡牌自身状态与 `Zone.cards`，与 `ConstraintGroup` 无关，故 step 3 未加约束组门槛（该门槛属 step 6 `AmbiguousKnownIndex`）。C2 的公共区侧改用 **Zone 变更记录 `dirtyPublicZones`** 这一 choke-point 机制。
- **C1 `syncViewGroups(seatIDs)` 已就位但暂未按 seat 调用**：step 3 收敛尾部仍全量 `syncViewGroups()`（读的是已增量维护的索引，正确）；按 seat 增量留待阶段 4 快路径使用。

### 验证状态（step 1-3）

- `pnpm test:tracker`：**138 通过**（129 + 新增 9 集成）。
- `pnpm typecheck:tracker`、`pnpm lint`、`pnpm build`：**通过**。

### step 6-7 落地记录

**step 6（`AmbiguousKnownIndex` 单牌增量）** 已合入 `dev`（#22）。设计与验收见 [`ambiguous-known-index-incremental-step6-plan.md`](ambiguous-known-index-incremental-step6-plan.md)：`applyDirtyCardEvents` / `applyCardChange` 按 `dirtyCardEvents` 游标单牌增量；`Room.constraintGroupsDirty` 在约束组结构变化时置脏并回退全量 `rebuild()`；装备容器候选走 `containerDependentCards` 反向依赖重算。

**step 7（A2：增量 player 快照）** 本次落地。设计与验收见 [`a2-player-snapshot-incremental-step7-plan.md`](a2-player-snapshot-incremental-step7-plan.md)。

| 文件 | 改动 |
| --- | --- |
| `src/tracker/Room.ts` | 新增 `playerCardsSnapshot` / `playerCardsSnapshotSet` / `playerSnapshotSeq` / `playerSnapshotOrder` 字段；`rebuildPlayerSnapshot()` / `refreshPlayerSnapshot()` / `orderOfPlayerCard()` / `insertPlayerCardOrdered()` 方法；`initDeck` seed、`resolveConstraints()` 入口/轮末改读增量快照、`destroy()` 重置；`assertPlayerSnapshotConsistency` 注释更新为 A2 |
| `tests/tracker/traversalBaseline.test.ts` | 四场景快照刷新：`resolveConstraints:playerSnapshot`（全量）→ `resolveConstraints:playerSnapshotIncremental`（增量） |

step 7 实测遍历量（`traversalBaseline.test.ts` 内联快照，40 张基线）：

| 场景 | `playerSnapshot`（step 7 前） | `playerSnapshotIncremental`（step 7 后） | 当前 total |
| --- | --- | --- | --- |
| 常规摸牌 | calls=2 visited=80 | calls=2 visited=1 | 48 |
| 暗牌分配 | calls=1 visited=40 | calls=1 visited=2 | 52 |
| 约束三排他触发 | calls=2 visited=80 | calls=2 visited=2 | 60 |
| 洗牌 | calls=1 visited=40 | calls=1 visited=0 | 80 |

> `resolveConstraints:playerSnapshot` 全量扫描 `Room.cards` 在全部高频移动中归零，替换为极小的 `playerSnapshotIncremental`。等价性由 DEV `assertPlayerSnapshotConsistency`（已确认 vitest `import.meta.env.DEV === true`，全部用例零不一致告警）+ 遍历基线覆盖。本次 `pnpm test:tracker` 151 例通过（147 + baseline 4 刷新）、`pnpm typecheck:tracker` 通过。

### step 8 落地记录（dry-run 数据 gate，增量 1）

**定位**：§九 step 8 的数据 gate 决策点。评审结论是「A2（step 7）已把 phase 4 的主要成本（`playerSnapshot` 全量扫描）归零，phase 4 不作既定交付，须按真实命中率逐条 gate」。因此不直接实现「绕收敛」的 apply 版本，先落地**只观测、不改变收敛**的命中率埋点，用真实对局数据决定 4A–4D 是否值得做。

本次为增量 1：**4A（确定明牌确定移动）dry-run 埋点**。4A 是四条里最稳的一条（确定明牌移出/移入使 `observedHandCount - knownCount` 不变，不新触发额度归零排他），且其判定只看 `MoveContext` 与被移动牌，**不依赖手牌摘要（step 4-5）**，故先行。

| 文件 | 改动 |
| --- | --- |
| `src/tracker/fastPathStats.ts`（新增） | 运行时命中率计数器（`recordFastPathHit` / `recordFastPathRollback` / `getFastPathStats`）+ 收敛计时（`nowMs` / `recordConvergenceTime` / `getConvergenceTiming`）+ `resetFastPathStats`；生产常开、每次移动 O(1)；仅在 `window.XC` 存在时增补 `fastPathStats` / `fastPathTiming` 只读入口（不覆盖宿主 XC） |
| `src/tracker/fastPathGate.ts`（新增） | `evaluateDeterministicMove(room, context)` 判定 4A 充分条件并归类回退原因；`probeMoveFastPaths(room, context)` 供收敛前 dry-run 观测并返回本次是否本可命中（供计时归桶） |
| `src/tracker/Room.ts` | `moveCards()` 在 `createPublicMoveConstraintGroup` 之后调 `probeMoveFastPaths`，并对随后 `resolveConstraints()` 计时、按命中/回退归桶；只读，不改变收敛 |
| `tests/tracker/fastPathGate.test.ts`（新增，7 例） | 确定摸牌/弃牌命中 4A 且收敛结果仍与全量 rebuild 等价；纯暗牌、明暗混合回退且原因归类为 `unknownCount`；命中率与收敛耗时分桶累计正确 |

**读取方式**：真实对局中执行 `XC.fastPathStats()`（返回各快路径 `{ hit, rollback, total, hitRate, reasons }`，回退原因按次数降序）；Node/测试用具名导出 `getFastPathStats()`。真实对局跨局累计更能反映命中率，一般不重置。

**回退原因分类**（供 gate 分析哪些条件最常挡住 4A）：`emptyMove` / `unknownCount` / `movedUnknownCards` / `knownCountMismatch` / `hiddenMarkRecord` / `constraintGroupsDirty` / `cardNotKnown` / `cardLocationCandidates` / `cardSubZoneCandidates` / `cardPublicCandidates` / `cardAmbiguousSeat` / `cardInConstraintGroup`。

**关键发现（影响 4A 判定与后续 apply）**：

1. **确定明牌移入手牌会顺带创建平凡约束组**：`moveKnownCardsForContext()` 的 `toZone==='player'` 分支对每批 known 牌调 `createConstraintGroup()`；但 `createConstraintGroup()` 只在牌**影响模糊明牌反查**（`affectsAmbiguousKnownIndex`）时才 `markConstraintGroupsDirty()`。故一次确定单座位摸牌建出的是「单候选席位 + 无额度约束」的平凡组，`constraintGroupsDirty` 保持 false，但该牌成了组成员。若「牌在任意约束组即回退」，则计划 §八/§十一 明确列为 4A 命中的「确定弃牌回手牌」会被误判回退。故 `evaluateDeterministicCard` 用 `isTrivialDeterminedGroup`（`candidateSeats.size<=1 && expectedSlotsByLocation.size===0 && expectedSlotsBySubZone.size===0`）放行平凡组，多座位/带额度的真歧义组仍回退。
2. **apply 阶段须补 owner 同步的告警**：摸牌进手牌后 `owner` 由收敛 `syncOwnerFromSeats()` 落定。dry-run 只统计「本可命中」，不代表纯跳过收敛即正确——4A 的 apply 版本必须自行完成 owner 同步（或验证 `bindCandidates` 已置 owner），并由 DEV 影子断言兜住。

**增量 1.5（wall-clock 计时）**：只测命中率不足以做 go/no-go——A2 后一次 4A 命中跳过的只是 O(玩家区牌数) 的收敛循环，须量真实耗时。`moveCards` 用 `nowMs()` 量整段 `resolveConstraints()` 耗时，按「本次 4A 本可命中/回退」分桶累计；`XC.fastPathTiming()` 返回 `{ totalMoves, totalMs, avgMsPerMove, hitCount, saveableMsUpperBound, avgHitMs, missCount, missMs, saveableShare }`。`saveableMsUpperBound` 是 4A 可省时间的**上界**（4A apply 仍付增量索引/视图/计数尾部，实际略少）；连上界都可忽略即为明确 no-go。

**修正（window.XC 覆盖）**：埋点挂载入口一度被改成 `window.XC = new EventTarget()`，会**覆盖** `utils/client.js` 创建的共享 `XC`（清掉宿主的 `XC.moveType` / `XC.Rpvp` 与事件派发）。已改回「仅在 `window.XC` 存在时增补 `fastPathStats` / `fastPathTiming` 两个只读入口」，不再新建/覆盖。

**实测（真实对局，4A）**：`total=177, hit=125, hitRate≈0.706`，回退 `unknownCount=49`、`cardNotKnown=3`。
- 71% 的表面命中率被暗牌移动稀释：49 次 `unknownCount` 是带暗牌的移动，定义上不归 4A（归 4B/4C/4D 或全量）。
- **「全明牌移动」内的条件命中率 ≈ 97.7%**（125 命中 / 128 全明牌移动），判定既不漏也不过松。
- `cardNotKnown=3` 几乎可确定是手气卡/换牌把明牌洗回牌堆（`resetKnownToUnknown && toZone==='pile'` → `card.reset()` 使 `isKnown=false`）或恢复暂停追踪的牌，属正确回退。

**实测（真实对局，计时）**：`totalMoves=177, totalMs≈1858, avgMsPerMove≈10.5, avgHitMs≈10.6, saveableMsUpperBound≈1327`。

**诊断：这 ~10.6ms/move 几乎全是 DEV 影子断言，不是 4A 能省的收敛工作。**
- `resolveConstraints()` 尾部四个一致性断言 `assertPlayerSnapshotConsistency` / `assertLocationIndexConsistency` / `assertAmbiguousKnownIndexConsistency` / `assertPublicZoneConsistency` 全部 `if (!import.meta.env.DEV) return`；其中两个各做一次全量 `rebuild()` + 两次 `JSON.stringify(toComparable(room))`。用户跑的是 `pnpm build`（dev 模式，`import.meta.env.DEV===true`），故每次移动都付「2 次全量重建 + 4 次全索引 JSON 序列化」。
- 佐证：`avgHitMs(10.6) ≈ avgMsPerMove(10.5)`——命中（确定、廉价）与回退（暗牌）耗时几乎相同，说明成本是**每次移动固定的 DEV 断言开销**，而非 4A 会跳过的可变收敛工作。
- 故 `saveableMsUpperBound≈1327ms` 是 dev 假象：① 生产构建里这些断言消失；② 即便在 dev，4A 的 apply 版本本身也要跑自己的 DEV 影子断言（§七 4A 执行第 7 步），并不省这份开销。

**结论（当时，待生产构建确认）**：4A apply 在性能上 no-go；预测 `pnpm build:prod` 后 `avgHitMs << 1ms`。

**反证（生产实测，推翻上面的 dev 假象结论）**：`pnpm build:prod` 重测同规模一局得 `totalMoves=177, totalMs≈7568, avgMsPerMove≈42.8, avgHitMs≈43.7, saveableMsUpperBound≈5463`。**生产比 dev 更慢（43ms vs 10ms/move），不是更快。** 说明「10ms 全是 DEV 断言、生产亚毫秒」的假设错了——生产收敛本身就重（~43ms/move、一局 ~7.5s）。且 43ms 与只有 48–80 次 `Room.cards` 访问的遍历基线完全对不上，说明**成本不在被遍历计数的 while 循环里**，而在别处（很可能是 tail 的 `syncViewGroups` / `counter.update` 触发真实视图/DOM 更新，或多轮收敛里的 `约束二 group.resolve()` / 手牌槽解析）。这也正是遍历基线用 20/40 张合成场景**严重低估**真实对局收敛成本的证据。

**增量 1.6（相位拆分，回答「43ms 花在哪、4A 能不能省到」）**：4A 只跳过 `converge`（refreshPlayerSnapshot + while 循环 + suspend），仍付 `tail`（增量索引 + `syncViewGroups` + ambiguous + `counter.update`）。`resolveConstraints()` 按此二相计时，`XC.fastPathTiming()` 增出 `{ convergeMsTotal, tailMsTotal, avgConvergeMs, avgTailMs, convergeShare, ... }`。

**相位实测（生产一局）**：`avgMsPerMove≈82.6, avgConvergeMs≈81.8, avgTailMs≈0.245, convergeShare≈0.997, tailMsTotal≈43.7ms（178 次调用合计）`。
- **`convergeShare 0.997`——收敛耗时 99.7% 在 while 循环（4A 可跳过），tail 只 0.25ms/次（可忽略）。** 故 4A 的可省时间上界几乎等于真实节省。
- 结论：**4A apply 被数据放行**——命中一次省 ~82ms、只付 ~0.25ms tail。但——

**更关键的转向：82ms 是收敛循环本身病态慢，且它拖累的是全部移动（含 4A 覆盖不到的 52 次暗牌移动，miss 均摊 ~75ms/次），不只是 4A 能救的 71%。** 且 82ms 与「48–80 次数组访问」的遍历基线差两个数量级——**成本不在被遍历计数的循环体量里，而在某个未被计数的高开销操作**。首要嫌疑：**`约束二`（`for group of constraintGroups: group.resolve()`）没有跳过优化**——A2 优化了约束一、E1/E2 优化了约束三，唯独约束二每轮 re-resolve 全部组；真实对局里约每张已知手牌一个组（空组会被 `removeCardsFromConstraintGroups` 删除，但在手的仍在），`group.resolve()` 内含多次 `Array.from` 与 Set 分配。若属实，**优化约束二（跳过本轮未触碰的组，与 E2 同构）比 4A 更值**：修的是根因、帮全部移动、且保收敛语义（未触碰组 re-resolve 结果不变），比绕收敛的 4A 更安全。

**增量 1.7（约束拆分，定位根因）**：`resolveConstraints()` 再对约束一/二/三分别计时，并记录轮数、约束组数、player 快照大小。`XC.fastPathTiming()` 增出 `{ c1MsTotal, c2MsTotal, c3MsTotal, c1Share, c2Share, c3Share, roundsTotal, avgRounds, maxRounds, maxGroupCount, maxPlayerCards }`。下一局用它拍板：`c2Share` 高 → 优化约束二；`c1/c3Share` 高或 `avgRounds` 大 → 另找。

**验证**：`pnpm test:tracker` **163 例通过**、`pnpm typecheck:tracker` / `pnpm lint` / `pnpm build:prod` 通过。埋点/计时均只读，`traversalBaseline.test.ts` 计数不变、DEV 影子断言无告警，**收敛行为零变化**。

**后续增量**：① 生产重测 `XC.fastPathTiming()` 读 `c1/c2/c3Share` + `avgRounds` + `maxGroupCount`，定位 82ms 根因；② 若 `c2Share` 高（预期）→ 给约束二加「跳过未触碰组」优化（帮全部移动、保语义、比 4A 简单安全），大概率**取代 4A**；③ 4A apply 仅在「根因修完后仍有可观确定移动收益」时才做，且带 DEV 等价影子断言；④ 暗牌方向（49 次 `unknownCount`）：step 4-5 手牌摘要 + 4B/4C/4D 埋点，看根因修完后是否还值得；⑤ 教训：遍历计数与真实 wall-clock 背离两个数量级，收益判断一律以 wall-clock 相位/约束拆分为准。
