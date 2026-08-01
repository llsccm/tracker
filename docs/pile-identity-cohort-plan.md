# 牌堆身份批次模型当前计划

> 状态：**Phase 0/0.5 纯模型保留；Phase 1 观测已归档退役；Phase 2–6 已完成**
> 日期：2026-08-01
> 文档角色：当前有效的设计契约与实施入口
> 适用范围：`tests/tracker/` 纯模型 + `src/tracker/PileIdentityLedger.ts` 生产身份账本；
> `Room.shufflePile()` 的身份判断已切换为 cohort 权威，公共 known 物化已切换为匿名槽/
> 同 ID 端点契约，迁移 observer、统计 schema 与 ledger 开关已删除，UI 沿用既有实体投影
> 讨论归档：[`pile-generation-identity-pool-plan.md`](pile-generation-identity-pool-plan.md)

---

## 1. 当前裁决

```text
全局世代身份守恒：GO，仅保留为纯模型对照
active pool = 确定仍在牌堆：NO-GO，语义错误
批次候选集合 + 在牌堆数量：GO，完成产品与协议可维护性决策
全局世代独立生产 observer：不推进
三模型只读 observer：历史采样完成，Phase 6 已删除运行时、控制台入口与固定统计 schema
匿名任意位置牌堆获取：只在身份不可筛方面类似暗摸；不沿用牌顶边界，身份进入全局未决
匿名获取导致的批次合并：正常身份失效，不计批次风险或模型降级
生产身份账本迁移：Phase 3–6 已完成，ledger 是不可关闭的生产权威状态
cohort 用户界面：本轮不接入；生产 ledger 仅保留结构化快照，不携带用户文案
生产迁移 Phase 6：已删除正 ID 暗牌堆读取兼容、observer 双写与迁移诊断
```

当前生产洗牌以 `PileIdentityLedger` 的未决身份集合为身份权威，`Room.shufflePile()` 只负责
物理槽、公开边界与区域对象的迁移。Phase 4 删除了基于本地正 ID 暗槽分类的 detached/
suspended 启发式；Phase 6 再以 cohort 权威恢复 detached `suspendedKnownCards` 展示投影，
用于保留真实洗牌后旧世代尚未出现的身份，但不让展示实体占用物理槽。Phase 5 已将
`materialize()` 与公共 known 端点切换为“匿名槽或端点同 ID 实体”契约。玩家/mark interop
继续保留，cohort 分组 UI 经 Phase 6 裁决保持不接入。

---

## 2. 问题与目标

协议暗摸只提供物理张数，不提供真实 `CardID`。追踪器需要同时满足：

1. 牌堆、手牌和公共区的物理槽数量准确。
2. 身份全集不丢失、不重复。
3. 不把本地随机顺序或代表身份绑定伪装成协议事实。
4. 保留协议真正支持的集合级牌堆信息。
5. UI 不把“仍可能来自牌堆”误写成“确定仍在牌堆”或“确定已离开牌堆”。

本阶段不迁移玩家手牌、mark、exchange 或 process 的槽位模型，也不修改生产 UI。

---

## 3. 当前模型

### 3.1 匿名物理槽

物理暗牌继续使用稳定负 `id/entityID`：

```text
card.location === 'pile' && card.isKnown !== true
=> card.id < 0 && card.entityID < 0
```

物理槽负责数量、顺序和移动端点，不承载真实身份。

### 3.2 未决身份

身份尚未被协议揭示时，可以保留“牌堆来源可能性”。这不等价于确定仍在牌堆。

```text
unresolved identity
!= definitely in pile
!= definitely outside pile
```

全局世代模型中的 active pool 只属于这一层语义。UI 没有显示 active 身份时，只能称为
“未展示的未决身份”，不能按闭世界规则推导它仍在牌堆。

### 3.3 批次基数

Phase 0.5 的目标模型：

```ts
interface PileIdentityCohort {
  generation: number
  candidateIdentityIDs: Set<CardID>
  remainingPileCount: number
}
```

示例：

```text
candidateIdentityIDs = {1,2,3,4,5}
remainingPileCount = 4
```

其含义仅为“五个身份中恰有四个仍在牌堆”，不指认具体是哪四个。

批次按牌底到牌顶排序。当前洗牌重建规则为：

```text
rebuiltPile = recycledCards + remainingPileCards
```

因此新洗回批次位于牌底侧，旧剩余批次位于牌顶侧。普通摸牌可以按批次边界减少基数，
不需要 `CardID <-> 匿名槽` 映射。

### 3.4 UI 投影

当前纯模型区分：

```text
definitelyInPileIDs            确定仍在牌堆
unknownLocationCandidateIDs   可能已进入暗区的具体身份
omittedOutsidePileIDs         未显示，但 oracle 证明已离开牌堆
displayedStillInPileIDs       已显示为候选，但 oracle 证明仍在牌堆
```

后两项只能由纯模型 oracle 得到。真实回放没有服务器隐藏牌序，不能直接计算完整假阴性率。

#### 3.4.1 分组投影原型

`projectCohorts()` 把批次状态投影成三类可读陈述，不引入任何新推断：

```text
all-in-pile    remainingPileCount === size    「这 N 张都在牌堆」
none-in-pile   remainingPileCount === 0       「这 N 张都不在牌堆」
partial        0 < remainingPileCount < size  「这 N 张里有 K 张在牌堆」
```

`none-in-pile` 是扁平投影**无法表达**的一类：这些身份在逐卡候选里仍会被列出，而分组
投影可以直接把它们移出候选区。这正是批次模型的信息表达收益所在。

`evaluateCohortProjection()` 用 oracle 逐组校验这三类陈述。`all-in-pile` 与
`none-in-pile` 都是对用户的**确定**陈述，一旦为假就是记牌器在说谎，比候选偏宽严重。

---

## 4. 不变量

### 4.1 物理守恒

```text
pile slots
+ player anonymous slots
+ located player cards
+ discard slots
== identity universe size
```

合法外部身份和物理牌必须由明确入口同时扩展。普通端点不足不得用外部牌兜底。

### 4.2 批次守恒

对每个批次：

```text
0 <= remainingPileCount <= candidateIdentityIDs.size
```

对当前纯模型支持的事件域：

```text
sum(cohort.remainingPileCount) == pileSlotCount
所有批次 candidateIdentityIDs 两两互斥
批次候选全集 == 未定位身份全集
批次身份不得同时位于 locatedIdentityIDs
```

匿名弃牌槽尚未纳入批次身份模型，遇到时必须显式报不支持，不能静默虚构身份集合。

### 4.3 语义守恒

- active pool 与批次候选都不是当前真实牌堆身份集合。
- 候选集合大小与物理牌堆张数不要求相等。
- 未显示不等于确定在牌堆。
- 显示为未知位置候选不等于确定已离开牌堆。
- 只有协议明确来源或 oracle 才能形成具体位置事实。

---

## 5. 事件规则

| 事件         | 物理槽                     | 批次集合                  | 批次基数           |
| ------------ | -------------------------- | ------------------------- | ------------------ |
| 初始化       | 建立等量匿名牌堆槽         | 全部身份进入 generation 0 | 等于身份数         |
| 暗摸         | 从牌顶消费槽并进入玩家暗区 | 不删除具体身份            | 从牌顶批次依次减少 |
| 从牌堆揭示   | 消费一个牌顶槽             | 从牌顶所属批次删除身份    | 同时减 1           |
| 从手牌揭示   | 复用一个玩家匿名槽         | 从所属批次删除身份        | 不变               |
| 明牌弃置     | 明牌进入 discard           | 不属于任何未决批次        | 不变               |
| 弃牌洗回     | discard 槽进入牌底侧       | 洗回身份建立新批次        | 等于洗回身份数     |
| 初次洗牌     | 空弃牌不变；全量弃牌洗回   | 不建立批次                | 不变               |
| 合法外部身份 | 由专用入口创建物理牌       | 首次加入身份全集          | 由入口决定         |

### 5.1 自动补牌

自动补牌事件必须满足：

```text
drawCount > preShufflePileSlotCount
discardSlotCount > 0
drawCount <= postShufflePileSlotCount
```

该次摸牌先消费旧牌顶批次，再至少消费一张新洗回批次。

### 5.2 非自动回收

`FromZone=2 -> ToZone=9` 目前只说明弃牌进入洗牌区，不足以证明一定由超量摸牌触发。
显式回收和未知原因事件必须与自动补牌分开建模。`k=0` 只是不满足相邻自动补牌周期的
前置条件，不能笼统称为协议非法。

### 5.3 批次边界破坏

已完成协议枚举（2026-07-31）。边界无法证明时不得继续沿用旧基数，也不得退回逐槽代表
身份映射。

#### 5.3.1 决定性前提：`POSITION_RANDOM` 破坏批次序

批次模型依赖「牌堆是若干**连续区段**，摸牌只从牌顶批次依次消费」。该前提由
`Zone.add()` 的三种插入位置决定（`src/tracker/Zone.ts`）：

```text
POSITION_BOTTOM  splice(0, 0, ...)   插入牌底 → 批次序可维持
POSITION_TOP     push(...)           插入牌顶 → 批次序可维持
POSITION_RANDOM  push(...)           实现落到牌顶，但语义是「随机位置」
```

`POSITION_RANDOM` 的实现与语义不一致：本地按牌顶追加，真实位置未知。任何以
`POSITION_RANDOM` 进入牌堆的牌都会落在某个未知批次内部，使
`sum(remainingPileCount) == pileSlotCount` 不再可推导。

**这是批次模型的核心风险，且它在生产中确实发生。**

#### 5.3.2 事件枚举表

| #   | 事件                 | 触发条件                                                                                                  | 位置                                  | 批次影响                                                     | 建议规则                                        |
| --- | -------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| B1  | 权变/观虚同区展示    | `From/ToZone=1`、`MoveType=21`、`SpellID ∈ {7011, 987, 988}`（`PubGsCMoveCard.js:11,70`）                 | 两端归一为 TOP                        | 不移动卡牌，只揭示牌顶身份                                   | **保持边界**：从所属批次删身份并减基数          |
| B2  | 天候牌顶三选一       | `SpellID=3903`（`MoveEventNormalizer.ts:257`、`runtime/moveEventHandlers.ts:141,416`）                    | 牌顶三张中亮一张，位置不确定          | 揭示一个身份但不确定消费哪个槽                               | **保持边界**（同批次内），基数减 1              |
| B3  | 浑天仪特殊底置       | `SpellID=3694`、`FromZone=0→1`、`MoveType=19`（`specialZones.js:16-27`）                                  | 强制改写为 `POSITION_RANDOM`          | **破坏**：外部牌进入未知批次                                 | **合并批次**：合并全部批次为单一批次            |
| B4  | 回魂牌随机入堆       | `ToZone=1`、`CardID ∈ {4400, 4401}`（`PubGsCMoveCard.js:144-152`）                                        | 强制改写为 `POSITION_RANDOM`          | **破坏**：同 B3                                              | **合并批次**                                    |
| B5  | 牌堆添加初始牌       | `FromZone=0→1`、`ToPosition=TOP`、`MoveType=19`（`specialZones.js:29-38`）                                | TOP                                   | 外部身份 + 物理牌同时扩展                                    | **保持边界**：建立新牌顶批次                    |
| B6  | 手气卡放回牌堆       | `FromZone=5→1`、`SpellID=0`、`MoveType=19`；协议层归一为 RANDOM，tracker 装饰器设置 `resetKnownToUnknown` | RANDOM                                | 明牌匿名化后重新混入牌堆                                     | **条件降级**：多批次时合并                      |
| B7  | 弃牌堆→洗牌区        | `FromZone=2→9`、`MoveType=255`（`specialZones.js:50-54`）                                                 | —                                     | 正常世代滚动                                                 | **保持边界**（已建模）                          |
| B8  | 潜伏（弃牌回堆）     | `FromZone=2→1`、`MoveType=15`、无正 ID（`spellEffects.js:93-105`）                                        | 由协议决定                            | 弃牌堆身份回牌堆                                             | **保持边界**：建立新批次                        |
| B9  | 伊籍机捷（牌底摸）   | `FromZone=1`、`SpellID=3101`，`RANDOM→BOTTOM`（`PubGsCMoveCard.js:109-118`）                              | BOTTOM                                | 从**牌底批次**消费                                           | **保持边界**：需支持双端消费                    |
| B10 | 骋烈/天辩/宴戏       | `SpellID=3208`、`MoveType=13`、`SpellID ∈ {7016,7017}`，`RANDOM→TOP`（`PubGsCMoveCard.js:83-130`）        | TOP                                   | 从牌顶批次消费                                               | **保持边界**                                    |
| B11 | 特殊装备牌           | `FromZone=1`、`FromPosition=TOP+1`、4 张 type=8，改写为 `RANDOM`（`PubGsCMoveCard.js:131-142`）           | **RANDOM 来源**                       | **破坏**：从未知位置取走 4 张                                | **保守降级**：受影响批次基数不可推              |
| B12 | 回收区 12            | `From/ToZone=12`（`specialZones.js:11-14`）                                                               | —                                     | 直接 `finishMove`，不入牌堆                                  | 无影响                                          |
| B13 | 搜牌类技能取指定牌   | `FromZone=1`、`MoveType=18`（`MoveEventNormalizer.getProtocolMoveSpecialLabel()`），协议给出 CardID       | **任意位置**                          | 从所属批次扣基数，**不要求位于牌顶批次**                     | **保持边界**                                    |
| B14 | 权变牌顶范围取牌     | `FromZone=1`、`MoveType=18`、`SpellID=7011`，`CardIDs: []`、`CardCount=1`                                 | 牌顶 X 张范围内，非主视角不知是第几张 | 范围内 → 只扣牌顶批次；**跨批次 → 合并降级**                 | **条件降级**                                    |
| B15 | 匿名任意位置牌堆获取 | `FromZone=1`、无正 CardIDs、来源位置为 RANDOM/任意位置；牌数与 SpellID 不限                               | RANDOM / 任意位置                     | 只确认暗槽数量减少，不能筛出具体身份；旧批次统一进入全局未决 | **正常失效**：合并为单一未决批次，不计风险/降级 |

> **B13/B14/B15 的重要性**：`MoveType=18`（`MOVE_TYPE.GAIN`「获得」）表示「从牌堆获取牌」，
> 它**不等同于牌顶摸牌**。协议给出 CardIDs 时按 B13 精确扣所属身份；协议不给 CardIDs
> 时，无论首个样本是否来自 `SpellID=3644`，都只能确认暗槽数量减少，等待该身份后续展示。
> 获取方式本身不能从大候选集合中筛出具体身份，因此不再维护跨 cohort 消费债务。
>
> 生产移动层对无 CardIDs 的公共区取牌只移走 `isKnown !== true` 的暗槽。牌顶或牌底已有
> 明牌时会跳过明牌；RANDOM 使用哪个匿名实体仅是物理代表选择，不产生身份推断。

#### 5.3.3 六类原始猜想的核实结果

| 原猜想                         | 核实结论                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 牌堆顶/底范围展示              | **存在**：B1、B2。可保持边界                                                                                                                 |
| 技能交换区与牌堆批量交换       | **不存在**：`exchange`（协议区 10）是逻辑临时区，`Card.ts:552` 明确「只记 location，不加入 `zones.get('exchange')`」，无与牌堆的批量交换路径 |
| 手牌/mark/process/exile 回牌堆 | **部分存在**：B6（手牌）、B8（弃牌堆）。未发现 mark/process/exile 直接回牌堆                                                                 |
| 只重排部分牌堆的技能           | **不存在**：未发现纯重排路径。`shufflePile()` 是唯一重排入口，且只随机弃牌部分                                                               |
| 匿名弃牌槽洗回                 | **存在**：`shufflePile()` 的 `discardAnonSlotCount`。§4.2 已要求显式报不支持                                                                 |
| 直接向牌堆加入合法外部牌       | **存在**：B3、B4、B5。其中 B3/B4 是 RANDOM，破坏边界                                                                                         |

#### 5.3.4 结论

- **可保持边界**：B1、B2、B5、B7、B8、B9、B10、B12、B13（9/15）
- **必须合并批次**：B3、B4（RANDOM 入堆）
- **必须保守降级**：B11（RANDOM 来源）
- **条件降级**：B6（手气牌混入且已有多批次时合并）、B14（牌顶范围跨批次时合并）
- **正常身份失效**：B15。合并后的身份继续保留为全局未决，后续由明示协议收敛；该事件
  不进入 `batchBoundaryRiskEventCount` 或 `batchBoundaryDegradationCount`。

B3/B4/B11 仍是低频技能路径。B6 是常见开局流程，但通常发生在 generation 0 仍只有一个
cohort 时；它属于边界风险事件，不等于每次都发生信息损失。是否触发 §9.2 的频率闸门，
必须读取 `boundaryDegraded`，不能只统计 B6 消息次数。

两条模型能力修正（均已实现并回归）：

1. **批次消费不是单向的**（B9 伊籍机捷从牌底摸）：模型须同时支持牌顶与牌底消费。
2. **牌堆揭示不必来自牌顶批次**（B13 搜牌类技能）：原假设「牌堆明摸的身份必属牌顶
   批次」已被固定 seed 属性测试证伪并移除。协议给出 CardID 本身就证明该身份此刻在
   牌堆，只需校验所属批次仍有在牌堆名额。

#### 5.3.5 纯模型建模范围

**B8–B11（潜伏、伊籍机捷、骋烈/天辩/宴戏、特殊装备牌）不由本纯模型覆盖**，改由各自的
特殊路径实现（2026-07-31 决定）。因此：

- `PileGenerationEvent` 没有 `drawUnknownFromBottom` / `takeFromRandomPosition`；
- 批次消费只有牌顶方向，上面第 1 条修正随之不在纯模型范围内；
- 本模型内唯一破坏批次边界的仍是 B3/B4 的 RANDOM 入堆。

§5.3.2 的 15 行事件表仍是完整的协议枚举，保留作为特殊路径实现时的依据。

---

## 6. 已完成证据

纯模型位于：

- `tests/tracker/helpers/pileGenerationPoolModel.ts`
- `tests/tracker/pileGenerationPool.test.ts`

并排维护：

1. 当前正 ID 暗槽基线。
2. 全局世代滚动模型。
3. 批次集合 + `remainingPileCount` 模型。
4. 仅用于纯夹具的服务器真实牌序 oracle。

目标测试共 57 例。

### 6.1 五牌示例

```text
初始化 {1,2,3,4,5}
暗摸 3
从手牌揭示并弃置 1、2
弃牌洗回
```

批次结果：

```text
{1,2} / 2
{3,4,5} / 2
```

### 6.2 单周期 `k=1..5`

```text
基线宽度：4 / 5 / 6 / 7 / 8
全局世代：8 / 8 / 8 / 8 / 8
批次基数：8 / 8 / 8 / 8 / 8
```

基线存在 oracle 可证实的具体身份牌堆断言错误。批次模型没有降低扁平候选宽度，但保留
`{1..5}/(5-k)` 的真实数量关系。

### 6.3 两周期结果

```text
基线：candidateWidth=4，falseNegative=[8]
全局世代：candidateWidth=7，omittedOutsidePile=[8,9]
批次基数：candidateWidth=10，falseNegative=[]

批次关系：
  {6,7}       中 0 张仍在牌堆
  {1,2,3,4,5} 中 0 张仍在牌堆
  {8,9,10}    中 1 张仍在牌堆
```

结论：批次模型的收益是保留集合级真信息，而不是减少最保守的逐卡按钮数。

### 6.4 分组投影实测（§10 第 4 项）

对 §6.2 的可达两周期夹具（`k=1`）投影：

```text
{6,7}       all-in-pile    这 2 张都在牌堆
{1,2,3,4,5} partial        这 5 张里有 4 张在牌堆
{8,9,10}    none-in-pile   这 3 张都不在牌堆
```

界面成本对照：

```text
扁平逐卡候选宽度   8 张按钮
分组投影           3 行，其中 2 行是确定陈述
真正模糊的集合     只剩 partial 那 5 张
```

`k` 增大时 `partial` 组会收紧为 `none-in-pile`（`k=5` 时三组变成
`all-in-pile / none-in-pile / none-in-pile`），**分组数不随之增长**。

oracle 校验：`k=1..5` 全部通过，`brokenAllInPileIDs`、`brokenNoneInPileIDs`、
`brokenPartialCounts` 均为空——三类陈述没有一条为假。

降级代价也在此可量化：夹具后追加一次 RANDOM 入堆，3 组精确陈述立即塌缩为 1 组
`partial`，`definitelyOutsidePileIDs` 清空。

**可读性结论**：分组投影通过 §9.1 第 2 条闸门（不需要玩家 × 身份展开）。它的价值不是
减少按钮数，而是把「已确定离开牌堆」这类扁平投影说不出的结论表达出来。

---

## 7. 阶段计划

### Phase 0：全局世代纯模型

状态：**完成**。

- [x] 身份与物理槽守恒。
- [x] 五牌示例。
- [x] 多轮洗牌与 suspended 恢复。
- [x] `k=1..5` 可达矩阵。
- [ ] 固定 seed 属性序列。

### Phase 0.5：批次基数纯模型

状态：**完成**。

- [x] 拆分未决身份、确定牌堆断言与 UI 投影。
- [x] 实现 `PileIdentityCohort`。
- [x] 补 oracle 初始牌序与物理边界校验。
- [x] 固化单周期和两周期三模型对照。
- [x] 枚举真实协议中的批次边界破坏事件（§5.3.2，15 类）。
- [x] 为边界保持、合并和降级补纯事件回归（§5.3 两组，19 例）。
- [x] 支持牌底批次消费（B9）与降级计数 `cohortDegradationCount`。
- [x] 支持 `MoveType=18` 搜牌（B13）与牌顶范围取牌（B14）。
- [x] 固定 seed 属性序列（5 例，已证伪「牌堆揭示必属牌顶批次」假设）。
- [x] 验证批次分组投影的产品可读性（§3.4.1、§6.4）。

### Phase 1：只读三模型 observer

状态：**历史采样已完成；运行时、控制台入口、固定 schema 与对应测试已在 Phase 6 删除**。

本节保留 Phase 1 的实施和判读过程，不再提供当前可调用入口。下面提到的 observer 文件、
`__trackerBeliefReport()` 与双写比较都只代表迁移期历史状态。

前置条件（全部满足）：

1. 批次边界事件表与降级规则完成。→ §5.3.2 / §5.3.4 / §5.3.5
2. 分组投影证明具有用户价值。→ §6.4
3. belief epoch schema 完成。→ §8.3 / §8.4
4. observer 不写 `Room`、UI 或索引状态，只在 DEV 测试环境启用。→ 已完成

已完成：

- `src/tracker/observer/beliefEpochObserver.ts`：只读 observer + 协议证据分类器。
  基线现在统计牌堆内**全部正 ID 槽**，包括洗回后 `isKnown !== true` 的正 ID 暗槽。
- `src/tracker/observer/pileIdentityModelComparison.ts`：并排维护当前 UI、全局世代与批次
  三个只读影子投影，记录候选宽度、分组数量、模型差异、批次边界降级与不支持事件。
  匿名任意位置取牌合并为全局未决，但以 `anonymous-pile-draw` 记录为非风险正常失效。
- `TrackerController` 在 DEV 下接入牌堆初始化、协议移动与显式区域揭示；随
  `initTrackerRoom()` 每局重建，`destroyTrackerRoom()` 不清账本，结算阶段仍可读数。
- UI 候选宽度通过等价的纯只读选择逻辑采集，不调用会推进增量游标的 UI 选择器。
- `tests/tracker/beliefEpochObserver.test.ts` 与
  `tests/tracker/pileIdentityModelComparison.test.ts` 合计 44 例，覆盖只读契约、三模型
  exposure、协议事件、候选差异、批次降级与接线。

历史执行范围只覆盖 DEV 测试环境，当时不把生产产物字符串检索作为采集前置条件。

**历史读数入口（已删除）**：当时需用 `pnpm dev` 启动后在控制台执行：

```js
__trackerBeliefReport()
```

`classifyBeliefEvidence()` 是协议与 §8.3 证据语义之间唯一的映射点：

```text
FromZone=2 → ToZone=9        pile-shuffle 失效
FromZone=1 且实际消费暗槽      anonymous-pile-draw 失效（常规摸牌或匿名获得）
FromZone=1 且有正 ID          证实这些身份在牌堆（明摸/搜牌）
MoveType=1 摸走牌顶明牌        证实并精确结束这些身份的牌堆断言
FromZone=5 且有正 ID          证伪牌堆断言（手牌现身）
```

旧实测的数据有效性与后续采集字段见 §8.5。旧报告中的 `verdict` 与基线计数不可直接
沿用；已有样本按修正语义重判，新增样本按实际牌堆交互机会继续积累。

**采集前必读 §8.3**：`confirmedContradictionCount` 在多数对局里恒为 0，它是下界不是
错误率；把它读成「模型没有错」是明确的误读。

### Phase 2：产品与信息损失决策

状态：**已完成（2026-08-01），生产身份账本迁移 GO**。

裁决采用分层 GO：

1. **内部状态迁移 GO**：Phase 3 可建立批次身份账本与原子 API，并与当前正 ID 暗槽权威
   状态双写对照。
2. **首轮 UI 迁移不启动**：Phase 3 不新增 cohort 面板，不把 161/166 张扁平身份直接铺到
   现有候选区。分组投影保留为后续产品能力，不是内部正确性迁移的前置依赖。
3. **匿名获取统一处理**：无 CardIDs 的牌堆获取只消费暗槽；不按获取技能或 SpellID 推断
   身份，等待后续展示收敛。
4. **observer 当时继续保留**：样本少或暂未遇到洗牌不构成拒绝理由；完成迁移裁决后，
   Phase 6 已删除该临时观测链路。

决策依据：

- 三局累计 686 个事件中，baseline/cohort 的 exposure per event 为 15.77/1.23；三路确认
  矛盾均为 0，但该值只是可见证据下界，不能覆盖 baseline 的代表绑定风险。
- 两局完整边界明细共有 11 次 B6 风险、0 次实际降级；B15 两次均为正常匿名失效，未发现
  普通事件迫使模型恢复逐槽代表身份。
- cohort 扁平峰值达到 166，但完整样本中的分组峰值为 10/1；产品层可以按组表达，生产
  热路径不需要玩家 × 身份展开。
- 身份恢复仍由同一个后续 reveal/known 事件触发。批次模型扩大的是揭示前的诚实未决集合，
  不增加协议证据出现后的恢复延迟。
- 生产代码审计确认至少四类正 ID 暗公共槽专用分支可在 Phase 4/5 删除，且玩家/mark 模型
  无需全面槽位化，满足以代码净减少支撑迁移的条件。

### Phase 3：生产账本与状态 API

状态：**首个迁移切片已完成（2026-08-01）**。

已完成：

- 新增独立生产 `PileIdentityLedger`，由 `Room` 持有并在 `initDeck()` 初始化 generation 0。
- `TrackerController` 当时在协议动作成功后把同一份归一化事件双写生产 ledger 与 DEV
  observer；Phase 6 已删除 observer 一侧，只保留生产 ledger 后置入口。
- ledger 提供匿名顶/底/任意位置消费、身份揭示、已知/匿名回堆、全局合并、弃牌洗回、
  快照和一致性诊断原子 API。
- B14 在范围大小未知且存在多个活动批次时保守合并；B15 仍不绑定获取技能或 SpellID，
  只合并为全局未决并扣暗槽。
- DEV 当时只比较轻量 cohort 快照，差异只告警；ledger 关闭开关和旧权威回退均已在
  Phase 6 删除。

Phase 3 完成时，`Room`、`shufflePile()`、`materialize()` 与 UI 仍以既有状态为权威；该阶段
没有删除任何正 ID 暗槽、suspended、玩家或 mark 兼容分支。此段记录 Phase 3 闸门基线，
后续 Phase 4 已完成 `shufflePile()` 的身份权威切换。

### Phase 4：洗牌身份权威切换

状态：**已完成（2026-08-01）**。

- `PileIdentityLedger.getUnresolvedIdentityIDs()` 成为洗牌未决身份枚举入口，覆盖
  `remainingPileCount === 0` 但尚未展示的 cohort 成员。
- `shufflePile()` 不再从正 ID 暗实体反推牌堆身份，并删除基于旧本地分类创建 detached/
  suspended 身份的启发式。Phase 6 后续以 cohort 权威恢复 suspended 展示投影。
- 洗回弃牌、剩余牌堆和仍承载未决身份的暗区正 ID 实体原地匿名化；玩家座位、mark 子区、
  候选集合及 `hiddenMarkCandidates` 对象引用保持不变。
- ledger 明确仍在牌堆的身份和 `isKnown === true` 的牌顶/牌底公开边界继续保留正 ID。
- 协议 `cardCount` 大于本地物理槽时继续告警，不为满足协议张数虚构实体。

### Phase 5：known 物化权威切换

状态：**已完成（2026-08-01）**。

- 未定位身份只能物化到匿名实体；其它正 ID 即使 `isKnown !== true` 也不能作为可替换代表。
- 公共端点中的同 ID 实体可直接确认，既有 outside/suspended 身份可接管匿名端点并恢复追踪。
- 删除 `materialize:replaceHiddenPublicIdentity` 和
  `materialize:displacedHiddenPublicIdentity` 两类牌堆专用身份交换。
- `resolveKnownMoveCards()` 只检查本次协议 `cardCount` 覆盖的端点范围，不再扫描整个公共区
  寻找更深处匿名槽；B13 指定身份仍可通过来源区中的同 ID 实体精确命中。
- 玩家暗手牌/mark 的旧式正 ID interop、`releaseUnknownPlaceholderToOutside()` 与通用
  `suspendedKnownCards` 继续保留。

### Phase 6：最终兼容清理与 UI 裁决

状态：**已完成（2026-08-01）**。

- 删除 belief epoch、三模型只读 observer、控制台报告入口、对应测试 helper 与固定统计
  schema；`PileIdentityLedger` 不再支持关闭，成为单一生产身份权威。
- 删除 ledger/observer 快照比较、迁移期告警与 cohort 投影中的用户文案字段。cohort 分组 UI
  本轮不接入，现有公共候选继续投影具体可展示实体。
- 真实弃牌洗回时，ledger 旧 cohort 尚未出现身份转成 detached `suspendedKnownCards` 展示
  实体；原玩家/mark 暗实体原地匿名化并保留物理位置，suspended 不占物理槽。
- 同 ID 再次出现时恢复 suspended 身份并消费对应匿名槽；Room 最终分区断言要求 cohort 身份
  恰好存在于 `unlocatedIdentities` 或 `suspendedKnownCards`。
- 初次洗牌统一识别两种协议形态：弃牌堆数量为 `0`，或弃牌堆数量等于整副卡池身份数。
  两者都不暂停身份、不滚动 generation；全量弃牌形态仍正常重建匿名物理牌堆。
- 玩家/mark 的通用身份交换继续保留；它仍服务非牌堆候选和 suspended 恢复，不属于迁移
  兼容残留。

---

## 8. Phase 1 观测契约（历史归档）

本章描述已删除 observer 的历史采集契约，仅用于解释 Phase 2 裁决，不是当前测试或运行时
入口。

真实回放没有 oracle。只能记录后续协议证实的下界，并为每个判断建立 belief epoch。

### 8.1 belief epoch

每个 epoch 至少包含：

```text
model
cardID or cohort generation
startEventSeq
beliefType
sourceEvidence
invalidatedAt
invalidationReason
confirmedAt
```

任何可能合法改变暗区归属的事件都会使旧 epoch 失效。只有同一有效 epoch 内，后续协议明确
证明身份从玩家暗区或其它非牌堆来源出现时，才能计入已确认矛盾或投影遗漏。

### 8.2 指标

`__trackerBeliefReport()` 分三层输出：

```text
metrics
  observedEventCount
  totalEpochCount / maxKnownInPileCount
  confirmedContradictionCount / explainedContradictionCount
  unresolvedRiskSetSize / riskExposureEventCount / riskExposurePerEvent
  totalCohortBeliefCount / maxConcurrentCohortBeliefCount
  maxCohortCandidateCount / maxDisplayedCandidateCount

modelMetrics.{baseline,generation,cohort}
  totalEpochCount / maxBelievedInPileCount
  confirmedContradictionCount / explainedContradictionCount
  unresolvedRiskSetSize / riskExposureEventCount / riskExposurePerEvent

modelComparison.metrics
  maxCurrentCandidateCount
  maxGenerationCandidateCount
  maxCohortCandidateCount
  maxCohortFlatCandidateWidth
  maxCohortGroupCount
  batchBoundaryRiskEventCount
  batchBoundaryDegradationCount
  unsupportedEventCount
```

`maxKnownInPileCount` 是兼容旧报告的字段名，当前语义是「牌堆内正 ID 身份绑定峰值」，
包括 `isKnown !== true` 的正 ID 暗槽。`maxDisplayedCandidateCount` 只统计当前 UI 实际会
展示的候选身份，不再使用物理牌堆张数替代。

`modelComparison.snapshot` 另给出当前三路候选、generation/cohort 相对当前 UI 的增删差异、
批次分组及确定在堆/离堆身份。`batchBoundaryRiskEventCount` 统计结构上可能破坏边界的事件，
`batchBoundaryDegradationCount` 只统计分组数实际下降；`degradations` 保存协议上下文与合并
前后组数。

禁止将 `activePoolSize - pileSlotCount`、两者比值或上述确认下界命名为完整错误率。

### 8.3 失效语义的直接后果（2026-07-31 实测）

`revealFromHand X` 证明 X 此刻在暗区，但 X 必然是某次**暗摸**进去的，而暗摸正是 §8.1
所说的「可能合法改变暗区归属的事件」。因此一旦断言与证据之间隔着一次暗摸，就无法证明
模型当时错了——模型只是不知道被带走的是哪张，而这本来就是协议不提供的信息。

**直接后果：`confirmedContradictionCount` 在多数序列里恒为 0。** 这不是采集失败，而是
「下界」一词的真实含义。为避免把它误读成「模型没有错」，采集 schema 把证据分两层：

```text
confirmedContradictionCount    epoch 仍有效时被证伪 —— 模型确实错了，无合法解释
explainedContradictionCount    epoch 已失效后被证伪 —— 可能错了，但存在合法解释
```

只有前者可写入 §8.2 的确认下界；后者是风险暴露量，同样禁止改称错误率。

纯模型对照实测：同一序列下 oracle 能证明基线存在假阴性，而 epoch 采集的
`confirmedContradictionCount` 为 0，`explainedContradictionCount` 与
`unresolvedRiskSetSize` 非零。**这个差值就是「回放看不见的部分」**，是 Phase 1 必须
预先接受的前提。

### 8.4 只读采集 schema

实现位于 `tests/tracker/helpers/pileBeliefEpoch.ts`（纯模型，不接生产状态）：

```text
collectBeliefEpochs(events, model)      单模型 epoch 账本 + §8.2 指标
collectAllModelBeliefEpochs(events)     三模型并排采集
```

`BeliefEpoch` 字段与 §8.1 一一对应，另加 `contradictedAt` 区分证实与证伪。
`sourceEvidence` 区分四类来源证据，其中 `residual-never-observed`（从未观测到它离开
牌堆）是最弱的一类，不应与 `recycled-to-pile` 这类正面证据等同看待。

失效原因枚举对应四类匿名消费：`anonymous-pile-draw`、`draw-across-shuffle`、
`anonymous-top-range-gain`、`cohort-degradation`。

运行时实现位于：

- `src/tracker/observer/beliefEpochObserver.ts`：三路 epoch、cohort-cardinality 与报告汇总。
- `src/tracker/observer/pileIdentityModelComparison.ts`：当前 UI、generation、cohort
  三模型影子状态及差异。

基线断言集合为牌堆内所有 `id > 0` 的槽；稳定负 ID 匿名槽不产生具体身份断言。
generation 与 cohort 各自维护独立 epoch，显式牌堆揭示、显式非牌堆揭示和匿名消费会同步
进入三路账本。批次基数断言仍来自 `Card.publicCandidates` 的牌堆端点，与具体身份 epoch
分开记录。

### 8.5 旧口径实测与数据清洗（2026-08-01）

#### 8.5.1 已作废的结论

2026-07-31 的首轮采集器只把 `isKnown === true && id > 0` 计为基线断言，漏掉
`Room.shufflePile()` 洗回后保留的正 ID 暗槽。当前基线已改为牌堆内全部 `id > 0`。
因此以下旧结论均不可用于 §9 闸门：

- 「只有观星类技能才会产生 in-pile 断言」。
- 「四局中三局没有断言」以及由此推导的 0/9 双峰分布。
- 旧报告中的基线 `totalEpochCount`、`maxKnownInPileCount`、风险暴露、矛盾计数与
  `verdict`。

旧第三局的卡 40 轨迹仍可说明 epoch 失效与后续证伪的状态机曾被真实协议触发，但其计数
只覆盖已知牌子集，不能与修正后的 baseline/generation/cohort 横向比较。

旧 `maxDisplayedCandidateCount` 直接取了 `pile.cards.length`。实测值 `161` 只是物理牌堆
峰值，不是候选按钮数，也不能证明扁平候选已扩张到整副牌量级。该字段现已改用与 UI
等价的纯只读候选选择逻辑，必须重采。

#### 8.5.2 178 事件历史样本的新口径复核

批次基数采集不依赖上述 `isKnown` 基线过滤。178 事件样本中的以下字段仍可作为
「cohort-cardinality 已在真实协议触发」的原始证据：

```text
totalCohortBeliefCount            5
maxConcurrentCohortBeliefCount    2
maxCohortCandidateCount           1

pile:top:1       1 张
pile:top:4       1 张
pile:bottom:1    1 张
pile:top:2       1 张
pile:top:1       1 张
```

最新口径再次运行该样本后，5 条 belief 与上述原始数据一致；它们全部由
`anonymous-pile-draw` 解释性失效，没有确认或未解释矛盾。修正后的报告为：

```text
observedEventCount                      178
maxDisplayedCandidateCount               1
totalCohortBeliefCount                    5
maxConcurrentCohortBeliefCount            2
maxCohortCandidateCount                   1

baseline    epoch / exposure / maxBelieved     0 / 0 / 0
generation  epoch / exposure / maxBelieved   161 / 0 / 161
cohort      epoch / exposure / maxBelieved   161 / 0 / 161
```

这确认旧 `maxDisplayedCandidateCount=161` 是采集错误，真实 UI 峰值为 1。generation/cohort 的
161 表示整批身份确定在堆，exposure 为 0；它与单独记录的 cohort-cardinality belief 不冲突。
该结果来自同一历史样本的重跑，只作为回放回归证据，不计入 §8.5.5 的独立实战样本。

#### 8.5.3 首局新口径冒烟（445 事件）

三模型报告已成功采集：

```text
current UI
  maxDisplayedCandidateCount             7
  modelComparison.maxCurrentCandidateCount 7

baseline
  totalEpochCount                      152
  maxBelievedInPileCount               139
  explained / confirmed contradiction  1 / 0
  riskExposureEventCount             10821
  riskExposurePerEvent                24.32
  unresolvedRiskSetSize                 104

generation
  totalEpochCount                      317
  maxBelievedInPileCount               161
  maxGenerationCandidateCount           12
  riskExposurePerEvent                   0
  unresolvedRiskSetSize                   0

cohort
  totalEpochCount                      317
  maxBelievedInPileCount               161
  maxCohortCandidateCount              161
  maxCohortFlatCandidateWidth          161
  maxCohortGroupCount                   10
  riskExposurePerEvent                 1.89
  unresolvedRiskSetSize                   0

旧报告 batchBoundaryDegradationCount     5
已分类 boundary risk event               5
unsupportedEventCount                     0
```

本局确认了四件事：

1. UI 候选两路峰值都为 7，修正后的 `maxDisplayedCandidateCount` 与当前模型投影完全对齐；
   旧值 161 确认是采集错误。
2. baseline 峰值 139，证明正 ID 暗槽是普通对局中的主要断言来源。24.32 的风险 exposure 与
   104 个未决身份表示大量具体槽位绑定在匿名消费后仍留在牌堆状态中，但这仍是风险量，
   不是 104 个已确认错误。
3. generation 的候选峰值为 12；`maxBelievedInPileCount=161` 主要包含初始化时整副牌确定在堆
   的阶段，不能与候选宽度混读。cohort 的扁平候选宽度达到 161，但最多压成 10 组；当前
   证据支持“分组数量受控”，不支持“扁平候选更窄”。
4. generation/cohort 各产生 317 个 epoch，合计等于 `modelEpochs=634`。两路均无确认矛盾，
   仍不能据此判定正确性高于 baseline。

两个同名字段必须区分：`metrics.maxCohortCandidateCount=0` 表示本局没有触发基于
`Card.publicCandidates` 的 cohort-cardinality 断言；
`modelComparison.metrics.maxCohortCandidateCount=161` 表示影子批次模型的候选身份并集峰值。

5 次事件现已完成协议分类：

- 事件 10/12/14：`5 -> 1`、`MoveType=19`、`SpellID=0`，每次 4 张重新混入牌堆，属于
  B6 手气流程。旧报告中的 TOP 是 tracker 归一化错误；主视角的具体 CardIDs 只证明身份
  回堆，不证明牌顶位置。只有当时已存在多个 cohort 时才会实际合并边界。
- 事件 28/71：`SpellID=3644`、`MoveType=18`，从 RANDOM 位置匿名取 2 张，是 B15 的首个
  实测样本，但规则不绑定 3644。无 CardIDs 时只减少暗槽，身份统一进入全局未决。

因此旧报告中的 5 只能改读为 5 条待分类协议事件：其中 3 条 B6 是边界风险，2 条 B15 是
正常匿名失效，均不能直接当作实际信息损失。observer 已拆分
`batchBoundaryRiskEventCount` 与 `batchBoundaryDegradationCount`，并为每条记录补充
`boundaryDegraded` 和合并前后组数。

#### 8.5.4 B15 语义重判

旧 observer 曾把两次 B15 计为边界风险和实际分组合并，原始输出为 `6/2`。按照当前产品
语义，匿名获取只在“不能筛出具体身份”方面与暗摸相同；它不具有牌顶位置语义。`2 -> 1`
只是未决集合归一化，不是可用身份信息的失败。候选宽度与分组峰值不变，计数应重判为：

```text
batchBoundaryRiskEventCount          4
batchBoundaryDegradationCount        0
maxCurrentCandidateCount            7
maxGenerationCandidateCount        12
maxCohortCandidateCount           161
maxCohortFlatCandidateWidth       161
maxCohortGroupCount                10
unsupportedEventCount               0
```

相关记录的当前解释为：

- 事件 10/12/14：B6，`unknown-return-to-pile`，`1 -> 1`，均未降级。
- 事件 16：B6，`random-pile-insertion`，`1 -> 1`，未降级。该原因与前三条不同是因为主视角
  给出了具体 CardIDs；四条记录都表示 RANDOM 混入，不代表不同的位置语义。
- 事件 28/71：B15，现统一记录为 `anonymous-pile-draw`；虽从 `2 -> 1`，但
  `boundaryRisk=false`、`boundaryDegraded=false`，不计入风险或实际降级。

因此本局按当前口径是 **4 次边界风险、0 次实际分组合并**。B6 四次均发生在单 cohort，
B15 两次属于正常匿名失效。该重判撤销了“真实损失全部来自 B15”的旧结论，也不能再用
B15 作为停止批次模型或删除 observer 的证据。

#### 8.5.5 多局采集

牌堆交互和洗牌低频，但仍按通用协议规则实现。后续遇到相关对局时机会性保存：

1. `modelMetrics.baseline/generation/cohort` 的 `totalEpochCount`、矛盾计数、风险集合、
   exposure 与 `maxBelievedInPileCount`。
2. `metrics.maxDisplayedCandidateCount`，并与
   `modelComparison.metrics.maxCurrentCandidateCount` 交叉核对。
3. `modelComparison.metrics` 的 generation/cohort 候选峰值、扁平宽度、分组数、边界风险数、
   实际降级数与不支持事件数。
4. `modelComparison.snapshot` 的三路增删差异；降级或不支持计数非零时同时保存
   `degradations`。
5. `totalCohortBeliefCount`、`maxConcurrentCohortBeliefCount` 与
   `metrics.maxCohortCandidateCount`，用于延续仍有效的 cohort-cardinality 样本。

当前有 3 个独立新口径样本；第 3 局缺少 `modelComparison.metrics/degradations`，因此只计入
三模型 epoch/exposure 汇总，不用于边界事件统计。B15 列为正常匿名失效事件数：

| 局次     | 计数风险 | 实际降级 | B6 风险 / 降级 | B15 正常失效 | current / generation / cohort 扁平峰值 | cohort 分组峰值 | unsupported | 报告完整度   |
| -------- | -------: | -------: | -------------: | -----------: | -------------------------------------: | --------------: | ----------: | ------------ |
| 1        |        4 |        0 |          4 / 0 |            2 |                           7 / 12 / 161 |              10 |           0 | 完整         |
| 2        |        7 |        0 |          7 / 0 |            0 |                            0 / 0 / 166 |               1 |           0 | 完整         |
| 3        |        — |        — |              — |            — |                                      — |               — |           — | 缺边界明细   |
| 已知累计 |       11 |        0 |         11 / 0 |            2 |                                      — |               — |           0 | 2 局边界完整 |

三模型完整报告如下；各模型单元格依次为“epoch / exposure per event / max believed in pile”：

| 局次 | observed events |          baseline |    generation |           cohort | confirmed contradiction |
| ---- | --------------: | ----------------: | ------------: | ---------------: | ----------------------: |
| 1    |             445 | 152 / 24.32 / 139 | 317 / 0 / 161 | 317 / 1.89 / 161 |               0 / 0 / 0 |
| 2    |             101 |         0 / 0 / 0 | 166 / 0 / 166 |    285 / 0 / 166 |               0 / 0 / 0 |
| 3    |             140 |         0 / 0 / 0 | 161 / 0 / 161 |    365 / 0 / 161 |               0 / 0 / 0 |

三局累计 686 个观测事件，baseline/generation/cohort 的 epoch 总数分别为 152/644/967；风险
exposure 总数为 10821/0/843，按累计事件数归一为 15.77/0/1.23。首局 baseline 有 1 条已解释
矛盾，其余已解释矛盾均为 0；三路确认矛盾均为 0。这些累计值仍是风险暴露描述，不是正确率。

第 2 局的事件 5/17 为 `unknown-return-to-pile`，事件 7/9/11/13/15 为
`random-pile-insertion`；它们都是 B6，原因名称差异只来自 CardIDs 可见性。7 条记录均为
`1 -> 1`，与 `maxCohortGroupCount=1` 一致，因此本局没有可被合并的既有边界。

第 2 局 cohort 扁平峰值 166 但只有 1 组，且 `maxBelievedInPileCount=166`、exposure 为 0；这表示
166 个身份都确定在堆，不是 166 份歧义。分组表示可以把这一批身份压成单个精确约束，但本局
没有覆盖多 cohort 或 B15。第 3 局 140 个事件没有 belief、矛盾或 exposure，generation/cohort
仍分别产生 161/365 个 epoch；它证明低交互对局中 observer 可保持无风险运行，但不补足边界
事件明细。

不再设置“必须完成 5 局”硬门槛。样本少、洗牌少或牌堆交互低频都不能单独构成拒绝理由；
Phase 2 依据协议语义、守恒、代码复杂度和已有证据继续推进，Phase 1 则在后续真实牌堆交互
出现时继续机会性采样。

---

## 9. 生产迁移闸门

### 9.1 GO

必须同时满足：

1. 批次边界在关键真实协议中可维护，降级规则可解释。
2. 分组投影在 UI 中可读，不需要玩家 × 身份展开。
3. 目标模型在可比 belief exposure 下不增加已确认矛盾。
4. 若正确性没有改善，必须有可量化的信息表达收益或生产代码净减少。
5. 玩家/mark 现有模型无需全面槽位化。
6. 不新增暗摸热路径身份遍历。
7. 可删除至少两条正 ID 暗槽置换或补偿路径。
8. 物理牌堆数量完全独立于身份候选状态。

Phase 2 核对结果：

| 闸门               | 证据                                                                        | 结果 |
| ------------------ | --------------------------------------------------------------------------- | ---- |
| 协议边界可维护     | 15 类事件均有保持、合并、降级或正常失效规则；11 次 B6 风险均未实际降级      | 通过 |
| 分组可读           | 完整样本分组峰值 10/1，不需要玩家 × 身份展开                                | 通过 |
| 不增加确认矛盾     | 三路确认矛盾均为 0；继续按下界解释                                          | 通过 |
| 有信息或代码收益   | exposure/event 从 baseline 15.77 降至 cohort 1.23；存在明确兼容分支删除清单 | 通过 |
| 玩家/mark 隔离     | 首个切片只新增牌堆身份账本，保留现有玩家/mark 槽位与候选模型                | 通过 |
| 暗摸热路径         | MoveType 1 只检查端点张数；MoveType 18 只消费暗槽；均不遍历身份全集         | 通过 |
| 至少两条可删除路径 | §10 已列出 `remainingPileIdentityIDs` 分类、正 ID 暗槽挤出/转交等路径       | 通过 |
| 物理与身份分离     | 目标不变量以 `Zone` 暗槽数和 cohort 账本分别维护                            | 通过 |

### 9.2 NO-GO

任一成立即停止：

- 批次边界在普通技能中频繁失效。
- 为维持批次必须恢复逐槽代表身份映射。
- 扁平候选接近整副牌，分组投影也没有用户价值。
- UI 仍隐式采用“未显示即确定在牌堆”。
- 正确性、信息表达和代码净复杂度均无实质改善。
- 玩家/mark 必须全面迁移才能恢复身份。
- 性能、增量索引或遍历基线出现不可接受回退。

低频事件样本不足、暂未遇到洗牌或某一 SpellID 未出现，不单独构成 NO-GO。规则必须按
协议语义泛化，不能通过只支持已采到的技能 ID 规避牌堆交互。

即使生产迁移最终 NO-GO，也保留纯模型、协议边界结论、回放数据和 DEV observer，除非有
等价诊断替代；不因一次产品裁决自动删除现有观测能力。

本轮审计未命中上述 NO-GO 条件。扁平候选确实可能接近整副牌，但分组投影保持有界；当前
生产实现的较窄候选依赖本地代表绑定，不能把“更窄”本身当作更正确。

### 9.3 Phase 2 裁决（历史状态）

```text
生产身份账本迁移：GO
Phase 3 最小双写切片：解冻
cohort 新 UI：暂缓，不作为 Phase 3 前置条件
Phase 4–6：当时继续冻结
```

该 GO 不要求再等待固定局数，也不绑定某个获取技能。后续新增实测若发现普通事件频繁实际
降级、分组失去可读性或遍历基线回退，可重新触发 NO-GO 审计，但不回退已确认的匿名暗槽
选择规则。

Phase 3 闸门随后通过，Phase 4 已在独立任务中完成；当前状态以文档顶部和 §10.7 为准。

---

## 10. 实施记录

已完成：

1. ~~从协议样例枚举批次边界保持与破坏事件。~~ → §5.3.2，15 类事件
2. ~~为每类事件定义保持、合并或降级规则。~~ → §5.3.4，9 保持 / 2 合并 / 1 降级 / 3 条件降级
3. ~~边界事件纯模型测试 + 固定 seed 属性序列。~~ → §5.3 两组共 19 例 + 属性 5 例
4. ~~设计“候选集合中 K 张仍在牌堆”的分组投影原型。~~ → §3.4.1 + §6.4，`projectCohorts()`
   与 `evaluateCohortProjection()`，oracle 校验 `k=1..5` 全部成立
5. ~~定义 belief epoch 与只读采集 schema。~~ → §8.3 + §8.4，
   `tests/tracker/helpers/pileBeliefEpoch.ts`，13 例回归
6. ~~实现 DEV 三模型只读 observer。~~ → baseline/generation/cohort 并排 epoch、
   候选投影差异、批次降级与 unsupported 计数
7. ~~修正基线与 UI 候选采集口径。~~ → 基线覆盖全部正 ID 牌堆槽，UI 候选不再误取
   物理牌堆张数

当前执行方向：

1. ~~完成一局新口径 schema 冒烟。~~ → §8.5.3，445 事件，三路报告完整
2. ~~为降级记录补充协议上下文。~~ → move/reveal 方向、位置、牌数、CardIDs、
   MoveType、SpellID 与牌堆张数
3. ~~分类 3 次未知回堆与 2 次随机取牌。~~ → B6 RANDOM 混入 + B15 匿名任意位置取牌
4. ~~重判 B15。~~ → 不绑定 3644；无 CardIDs 时只消费暗槽、合并为全局未决，
   `boundaryRisk=false`、`boundaryDegraded=false`
5. ~~补第三个独立样本并汇总。~~ → 686 事件，三路 epoch 152/644/967，累计 exposure/event
   15.77/0/1.23，三路确认矛盾均为 0
6. ~~移除 5 局硬门槛。~~ → Phase 1 转为机会性观测，低频不能单独构成 NO-GO

Phase 2 已完成：

1. ~~固化匿名公共区取牌规则。~~ → 无 CardIDs 时只移走暗槽，跳过牌堆中全部已知身份。
2. ~~比较产品价值与信息损失。~~ → 内部迁移 GO；cohort 新 UI 暂缓。
3. ~~审计生产净复杂度。~~ → Phase 4/5 可删除路径见下表。
4. ~~形成 Phase 3 启动裁决。~~ → 最小双写切片解冻。

Phase 3 首个双写切片已完成：

1. ~~新增生产 `PileIdentityLedger` 并由 `Room` 持有。~~
2. ~~接入初始化、成功协议移动、洗牌与显式揭示双写。~~
3. ~~覆盖 B1–B15 的保持、合并、条件降级和正常失效规则。~~
4. ~~增加 DEV ledger/observer cohort 快照一致性告警。~~
5. ~~保留旧权威路径、UI、正 ID 暗槽与玩家/mark 模型。~~
6. ~~提供独立关闭开关，账本异常只告警。~~

Phase 4 洗牌身份权威切换已完成：

1. ~~由 ledger 未决身份集合取代 `remainingPileIdentityIDs` 与 CardCounter 分类。~~
2. ~~删除旧本地分类驱动的 detached/suspended 创建和玩家/mark 替身校验。~~
3. ~~将暗区正 ID 实体原地匿名化，并保留位置、候选与 mark 账本引用。~~
4. ~~保留 ledger 已知牌堆身份和牌顶/牌底公开明牌。~~
5. ~~覆盖连续洗牌、完整 Controller 双写、身份守恒与遍历基线回归。~~

Phase 6 最终清理已完成：

1. ~~删除 observer、belief epoch、控制台报告入口、双写比较和 ledger 开关。~~
2. ~~以 cohort 权威恢复 suspended 展示投影，并增加 Room 最终身份分区断言。~~
3. ~~裁决不接入 cohort 分组 UI，删除生产快照中的用户文案。~~
4. ~~覆盖空弃牌与全量弃牌两种初洗协议，均不暂停身份或滚动 generation。~~

### 10.1 Phase 3 首个迁移切片（历史状态，已完成）

生产 `PileIdentityLedger` 由 `Room` 持有：

```ts
interface PileIdentityCohort {
  generation: number
  candidateIdentityIDs: Set<CardID>
  remainingPileCount: number
}
```

首个切片已完成：

1. `Room.initDeck()` 初始化 generation 0；候选全集来自合法初始牌组身份。
2. 成功移动后通过原子 API 双写初始化、匿名顶/底消费、已知身份揭示、已知/未知回堆、
   弃牌洗回和全局合并事件。
3. `unlocatedIdentities` 继续作为“尚未绑定实体”的基础身份分区；cohort 只表达这些身份与
   牌堆暗槽数量的集合关系，不复制 `Card` 实体。
4. 物理牌堆数量只读 `Zone`：正式目标不变量为
   `sum(cohort.remainingPileCount) === hiddenPileSlotCount`，已知牌堆明牌单独由实体表示。
5. DEV 下比较生产账本与当时 observer 快照；该迁移比较已在 Phase 6 删除。
6. 不修改 `shufflePile()` 分类读取、不删除正 ID 暗槽、不新增 cohort UI、不改变玩家/mark。

已实现的原子 API：

```ts
initialize(cardIDs)
applyMove(move)
applyReveal(reveal)
consumeAnonymous(count, position, reason)
revealIdentity(cardID, source, reason)
insertKnown(cardIDs, count, position, reason)
insertAnonymous(count, position, reason)
mergeAll(reason)
rotateFromDiscard(cardIDs, reason)
assertConsistency(pileCount, context)
getSnapshot()
setEnabled(enabled) // Phase 6 已删除
```

协议适配不为 B15 建立 SpellID 白名单；匿名任意位置获取先合并为全局未决，再扣对应暗槽。
B6 走匿名随机插入并按需合并；B14 在无法证明范围仍位于单批次时保守合并。

### 10.2 已删除与后续可删除路径

| 阶段              | 当前符号/分支                                                                                          | 目标处理                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Phase 4（已完成） | ~~`Room.shufflePile()` 的 `remainingPileIdentityIDs`、UNKNOWN/APPEARED 分类与 detached identity 创建~~ | 已改由 cohort 事务滚动                     |
| Phase 4（已完成） | ~~`preserveUnknownPlaceholderForShuffle()` 与洗牌手牌替身校验~~                                        | 已删除洗牌专用替身与校验                   |
| Phase 5（已完成） | ~~`Room.materialize()` 的 `materialize:replaceHiddenPublicIdentity`~~                                  | known 只物化匿名槽，不再挤出代表身份       |
| Phase 5（已完成） | ~~`materializeExistingIdentityAtTarget()` 的 `materialize:displacedHiddenPublicIdentity` 名额转交~~    | 已删除牌堆专用 displaced/suspended 交换    |
| Phase 5（已完成） | ~~`RoomMovement.resolveKnownMoveCards()` 接受正 ID 暗公共目标与失败后回塞目标~~                        | known 端点只消费匿名槽或来源中的同 ID 实体 |

`releaseUnknownPlaceholderToOutside()`、`suspendedKnownCards` 和玩家/mark 身份交换继续保留；
它们既服务非牌堆候选，也承担 Phase 6 的旧 cohort 身份展示与再次出现恢复，不能删除。

### 10.3 Phase 3 闸门（已通过）

以下记录是 Phase 3 结束时用于解冻 Phase 4 的闸门；Phase 4 后续已按独立任务完成。

1. 生产账本与 observer 在现有 44 个 observer 回归及 tracker 全量回归中一致。
2. B1–B15 的生产账本事件测试覆盖保持、合并、降级和正常失效。
3. 匿名摸牌不新增身份全集遍历，`traversalBaseline` 不回退。
4. 账本异常只告警，不改变当前移动结果；可单独关闭并回退到旧权威状态。
5. Phase 3 完成不自动启动 Phase 4；`shufflePile()` 权威切换需独立任务与提交（后续已完成）。

2026-08-01 闸门结果：`pnpm test:tracker` 50 个文件、458 项通过；
`pnpm typecheck:tracker`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、
`pnpm build:prod` 全部通过，`traversalBaseline` 未回退。

真实回放仍拿不到服务器隐藏牌序，`confirmedContradictionCount` 只是确认下界。Phase 1
能比较的是可见证据下的风险暴露与信息表达成本，不是完整正确率。

### 10.4 Phase 3 实测追补：常规摸牌与获得分流

首轮 Phase 3 实测的 445 事件报告没有出现“生产账本与 DEV observer 不一致”告警，但事件
351/353 暴露了共同口径错误：两条协议均为 `FromZone=1 -> ToZone=5`、`MoveType=1`、
`CardIDs=[]`、`CardCount=2`，Room 每次只减少 1 张，observer 随后记录
`pile-count-reconcile:protocol-move`。事件 351 还把 cohort 从 8 组合并为 1 组，却因 reconcile
诊断使用 `boundaryRisk=false` 而没有计入实际降级。

“无双写告警”只证明两个账本执行了同一转换，不能证明转换符合协议。根因是实现把
`CardIDs=[]` 同时当成了身份和位置语义：所有无 ID 牌堆移动都走
`takeUnknownCardsFromPublicZone()`，从而跳过牌顶明牌。正确语义分为两个轴：

1. `MoveType=1` 是常规摸牌，按牌顶/牌底实体顺序移动；端点明牌必须精确离堆，剩余张数
   才按暗槽消费。
2. `MoveType=18` 是获得，不等同于牌顶摸牌；无 CardIDs 时只消费暗槽，并按 B14/B15 的
   范围或任意位置规则更新 cohort。
3. CardIDs 只表示协议是否直接给出身份，不能用来决定是否保留端点顺序。

追补实现保留 Room 作为 Phase 3 权威顺序源。Controller 在移动前只读取本次端点范围，不扫
身份全集；移动后把实际离堆的牌顶明牌 ID、实际暗槽消费数和仍留在牌堆的事件明牌 ID 同时
传给生产 ledger 与 observer。两者分别执行“已知身份离堆”和“暗槽基数减少”，不再依赖
全局牌数 reconcile 修复。若物理牌堆本身不足，observer 只记录非风险诊断
`anonymous-pile-draw-count-adjusted`，不合并 cohort。

重跑同类事件时检查：

1. `MoveType=1` 且牌顶有明牌时，`knownPileIdentityIDsConsumed` 应列出实际离堆身份；
   `anonymousPileConsumptionCount` 只等于同批剩余暗槽数。
2. `MoveType=18` 无 CardIDs 时，`knownPileIdentityIDsConsumed` 应为空，牌堆中全部已知身份
   实体均保持原位，只消费匿名槽。
3. 牌堆实体足够时，不应再出现 `pile-count-reconcile:protocol-move` 或
   `anonymous-pile-draw-count-adjusted`。
4. `batchBoundaryDegradationCount` 只统计真正有风险且组数减少的事件；数量调整保持
   `boundaryRisk=false`、`boundaryDegraded=false`。
5. 仍需确认没有“生产账本与 DEV observer 不一致”以及牌堆身份/槽位守恒告警。

2026-08-01 追补验证结果：`pnpm test:tracker` 50 个文件、464 项通过；
`pnpm typecheck:tracker`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、
`pnpm build:prod` 全部通过，`traversalBaseline` 未回退。

### 10.5 Phase 3 实测追补：匿名获得后的延迟身份展示

2026-08-01 曾尝试在匿名任意位置获得时，把除连续牌顶外的 `knownPileIdentityIDs` 全部释放
进 cohort，以避免后续身份展示触发数量对账。后续产品语义复核发现，该方案会让一次无
CardIDs 的 `MoveType=18` 撤销牌底甚至整段已知牌堆身份，例如牌底 10 张明牌会同时从 UI
消失；这与“获得只消费匿名槽”的既定规则冲突，因此该追补方案已废止。

最终规则：

1. `MoveType=18` 且无 CardIDs 时，Room 与 ledger 都只消费匿名槽；牌堆中全部
   `knownPileIdentityIDs` 保持不变，不区分牌顶、牌底或中间位置。
2. RANDOM 只表示匿名物理代表与暗 cohort 边界不确定，不用于推断任一已知身份已经离堆。
3. 若某个已知牌堆身份之后在手牌、弃牌或 mark 中明确展示，再由该条携带 CardID 的协议
   精确移出已知牌堆集合，并根据实际牌堆数量对账匿名 cohort 基数。
4. `MoveType=1` 常规摸牌仍按真实端点实体精确消费明牌；协议直接给出 CardID 时仍按 B13
   精确扣除所属身份。
5. 回归必须覆盖连续 10 张已知牌底经过匿名任意位置获得后仍保持实体、顺序和 UI 投影。

### 10.6 Phase 3 复测：手气卡路由与匿名获得收敛

> 本节保留 2026-08-01 observer 实验数据；其中“释放非牌顶 knownPile 身份”的解释已由
> 10.5 最终规则取代，不代表当前生产行为。

同一局 445 事件复测中，`degradations` 只剩 6 条预期记录：其他视角手气卡未知回堆 3 次、
主视角已知手气卡随机回堆 1 次、匿名任意位置获得 2 次。此前延迟弃牌展示触发的
`pile-count-reconcile:protocol-move` 已消失，生产账本与 DEV observer 未报告不一致。

最终 cohort 投影为 4 张确定在堆、6 张确定在堆外，以及一个 105 选 104 的密集部分集合。
该集合只表达“一张匿名获得尚未展示”，不是 105 次独立推理；保留成员集合后，身份展示时
才能把剩余 104 张收敛为确定在堆。cohort exposure 为 843、每事件 1.89，确认矛盾为 0，
与修正前的有效样本一致，未发现新的 Phase 3 阻塞项。

`handleSpecialZones` 原手气卡分支只提前调用 `finishMove()`，没有承担位置、身份或 Room
转换。位置归一已由 `normalizeMovePosition()` 负责，批次与匿名化由 tracker
`decorateGenericMove()` 负责，因此删除该提前返回，让主视角派生状态继续经过
`handleGameFlowState()`；`SpellID=0` 不会命中技能效果处理器。

2026-08-01 路由清理验证结果：`pnpm test:tracker` 51 个文件、466 项通过；格式检查、
`pnpm typecheck:tracker`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、
`pnpm build:prod` 全部通过，`traversalBaseline` 未回退。

### 10.7 Phase 4 洗牌身份权威切换（已完成）

`Room.shufflePile()` 已改为从 `PileIdentityLedger.getUnresolvedIdentityIDs()` 读取未决身份，
不再依赖正 ID 暗槽、CardCounter UNKNOWN/APPEARED 分类或本地代表顺序判断牌堆归属。

物理层采用原地匿名化：正 ID 暗实体变为稳定负 `id/entityID`，但保留原对象、位置、座位、
子区、SpellID、候选集合和 mark 账本引用。洗回弃牌、剩余牌堆以及由玩家/mark 暗实体承载
的 cohort 未决身份都走同一规则；ledger 已知牌堆身份与 `isKnown === true` 的公开边界不变。

本阶段删除了：

1. `remainingPileIdentityIDs` 与洗牌 UNKNOWN/APPEARED 分类。
2. detached 正 ID identity 与洗牌专用 suspended 身份。
3. `preserveUnknownPlaceholderForShuffle()`、玩家/mark 洗牌替身和手牌校验。
4. 正 ID 暗槽作为洗牌身份权威的兼容逻辑。

回归覆盖玩家暗手牌、mark 引用、后续展示重新物化、连续两次洗牌、公开牌顶/牌底、
Controller 完整双写、身份全集守恒和遍历基线。2026-08-01 验证结果：Prettier、
`git diff --check`、`pnpm test:tracker`（51 个文件、469 项）、`pnpm typecheck:tracker`、
`pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm build:prod` 全部通过；洗牌场景 visited 为
49，旧 `shufflePile:classify` 扫描已消失。

### 10.8 Phase 5 known 物化权威切换（已完成）

`Room.materialize()` 现在只允许未定位身份占用匿名物理槽；公共端点中已经存在同 ID 实体时
直接确认，不再把其它正 ID 暗实体解释为可替换的本地代表。已有 outside/suspended 身份重新
出现时接管匿名端点并直接恢复原身份，匿名槽退出公共区，不再继承 suspended 名额。

`RoomMovement.resolveKnownMoveCards()` 的公共来源候选范围改为本次协议 `cardCount`，避免为
寻找匿名槽穿透牌顶/牌底端点；指定 CardID 若已存在于来源区，仍按 B13 精确消费同 ID 实体。
匿名端点按协议顺序分配后不再回塞，防止后续 CardID 错占前一张牌的物理端点。

本阶段删除了：

1. `materialize:replaceHiddenPublicIdentity` 的正 ID 暗公共身份挤出。
2. `materialize:displacedHiddenPublicIdentity` 的 displaced/suspended 名额转交。
3. 公共 known 扫描整个区域寻找匿名槽，以及正 ID 暗目标进入可物化候选集合的兼容逻辑。

回归覆盖正 ID 暗端点拒绝覆盖、端点同 ID 确认、suspended 身份从匿名端点恢复、玩家/mark
interop、特殊牌堆获取、身份守恒和遍历基线。玩家/mark 的通用 suspended 与占位置换语义
仍保留，不属于本阶段删除范围。

2026-08-01 验证结果：Prettier、`git diff --check`、`pnpm test:tracker`（51 个文件、471 项）、
`pnpm typecheck:tracker`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm build:prod` 与
`serena memories check` 全部通过。

### 10.9 Phase 6 最终兼容清理与 UI 裁决（已完成）

Phase 6 删除了 `beliefEpochObserver`、`pileIdentityModelComparison`、控制台报告入口、
迁移期双写比较、固定统计 schema 和 ledger 开关。`PileIdentityLedger` 现在是不可关闭的生产
身份权威，snapshot 只提供结构化 cohort 数据，不再携带 UI 文案；cohort 分组 UI 本轮不接入。

真实弃牌洗回会读取旧 ledger cohort，把尚未出现身份转成 detached suspended 展示实体。
实体只负责沿用现有公共候选界面展示，原玩家/mark 暗实体保持物理槽并原地匿名化；同 ID
再次出现时恢复 suspended 身份并消费对应匿名槽。Room/ledger 事务后会断言每个 cohort 身份
恰好由 `unlocatedIdentities` 或 `suspendedKnownCards` 承载。

初次洗牌按实测协议统一为两种形态：弃牌堆数量为 `0`，或弃牌堆数量等于整副卡池身份数。
两者都不关闭 generation 0、不创建 suspended；全量弃牌形态仍把实体洗回并重建匿名牌堆。

2026-08-01 最终 tracker 回归为 48 个文件、415 项通过；完整格式、类型、lint、构建与
Serena 对齐结果见本次提交记录。

---

## 11. 验证

修改纯模型或 `tests/tracker/` 时运行：

```
pnpm test:tracker
pnpm typecheck:tracker
pnpm lint
pnpm build
```

修改生产核心、打包或发布配置时再补：

```
pnpm typecheck
pnpm build:prod
```
