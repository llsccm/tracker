# 匿名牌堆与世代身份卡池讨论归档

> 文档角色：**历史讨论、反驳与再裁决归档，不再作为实施入口**
> 当前计划：[`pile-identity-cohort-plan.md`](pile-identity-cohort-plan.md)
> 归档状态：Phase 0/0.5 纯模型完成；后续 Phase 2–6 已按当前计划完成生产迁移
> 日期：2026-07-29（Phase 0 再裁决 2026-07-30；Phase 0.5 语义修正 2026-07-31）
> 适用范围：历史纯模型与决策过程；不描述当前 `src/tracker/` 运行时入口
> 上游讨论：[`pile-slot-identity-decoupling-reopen.md`](../plans/pile-slot-identity-decoupling-reopen.md)
> 历史归档：[`anonymous-entity-and-slot.md`](../plans/anonymous-entity-and-slot.md)
>
> 本文保留方案形成过程，不再提供后续实施顺序。当前设计以
> [`pile-identity-cohort-plan.md`](pile-identity-cohort-plan.md) 为准；当前运行时行为仍以
> [`docs/agents/card_tracker.md`](agents/card_tracker.md) 为准。
>
> **§17–§20 保留讨论与反驳过程；[§21](#21-phase-05-语义统一与批次基数模型2026-07-31)
> 修正了“active pool = 确定仍在牌堆”的语义倒置。本文后续所有“冻结”“未放行”均保留
> 当时决策语境；最终生产状态以当前计划和 `docs/agents/card_tracker.md` 为准。**

---

## 0. 一句话结论

牌堆的暗物理槽继续保持稳定匿名；身份推断不得把“仍有牌堆来源可能性”偷换成“确定仍在
牌堆”。Phase 0.5 推荐维护**按洗回批次分组的身份候选集合及其在牌堆数量**：暗摸只减少
批次基数，不为具体身份分配槽位；身份揭示按来源收紧集合与基数；洗回身份形成新批次。

```text
物理牌堆：负责张数、顺序和移动端点
批次候选：负责“这一组身份中仍有多少张在牌堆”
未知位置投影：负责“哪些具体身份可能已经进入暗区”
```

物理槽数、候选集合大小与候选区按钮数**不要求相等**。原全局世代滚动模型继续作为
信息降级对照，不再作为默认生产迁移目标。

---

## 1. 核心判断

### 1.1 此前否决卡池的前提错误

此前使用以下指标否决集合账本：

```text
真实牌堆身份数 = 8
卡池大小 = 58
“漂移率” = 725%
```

该判断隐含了一个并不成立的定义：

> 卡池必须精确表示当前仍在牌堆中的身份集合。

本计划采用的定义是：

> 卡池表示当前牌堆世代中尚未通过协议揭示、因而仍保留牌堆来源可能性的身份集合。

暗摸不会告诉真实 `CardID`，所以卡池不在暗摸时收紧是有意的保守建模，不是漂移。
卡池大小与物理牌堆张数不一致属于正常状态。

### 1.2 用户示例的标准推演

初始：

```text
匿名物理牌堆：5 槽
活动卡池：{1,2,3,4,5}
suspended：{}
```

暗摸 3 张：

```text
匿名物理牌堆：2 槽
活动卡池：{1,2,3,4,5}  // 不变
suspended：{}
```

随后身份 `[1,2]` 被公开并进入弃牌堆：

```text
匿名物理牌堆：2 槽
公开弃牌：{1,2}
活动卡池：{3,4,5}      // 揭示时移除
suspended：{}
```

弃牌洗回牌堆：

```text
旧活动卡池 {3,4,5} -> suspended
洗回身份 {1,2}      -> 新活动卡池

匿名物理牌堆：4 槽
活动卡池：{1,2}
suspended：{3,4,5}
```

这里：

```text
pile slot count = 4
active pool size = 2
suspended size = 3
```

数量不同完全合法。旧牌堆的 2 个匿名槽来自上一世代，其真实身份可能在 `{3,4,5}` 中；
本计划主动放弃“具体哪两个仍在牌堆”的关系，只保留三张身份均已失去可靠位置归因。

### 1.3 方案性质

这是一个有意的信息投影：

- 保留身份集合信息。
- 保留物理张数信息。
- 不虚构身份与匿名槽的一对一代表分配。
- 不试图在暗摸时猜测哪个身份离开牌堆。
- 在世代边界主动降级位置精度，换取状态机简单和语义诚实。

### 1.4 与代表性绑定方案的关系

代表性绑定方案会给每个匿名槽临时分配一个身份，并让绑定随槽移动。它能维持更小的
suspended 集合，但需要维护一对一映射、身份交换和绑定冲突修复。

本计划优先采用世代卡池，因为它：

- 不需要槽位级身份绑定。
- 暗摸不产生任何身份写操作。
- 不需要把任意本地分配误当成位置事实。
- 洗牌只进行集合世代滚动。
- 更接近当前 UI 真正需要的“具体有哪些未知位置身份”。

只有真实回放证明候选规模不可接受，且代表性绑定能显著改善 UI，同时不重新引入复杂
置换路径时，才允许另立精度增强提案；它不是本计划的后续默认阶段。

---

## 2. 目标与非目标

### 2.1 目标

1. 暗牌堆物理槽持续使用稳定负 `id/entityID`。
2. 用世代卡池替代正 ID 暗牌堆槽承担的连续洗牌分类职责。
3. 暗摸只消费物理槽，不更新身份卡池。
4. 身份揭示时统一从活动卡池或 suspended 中恢复。
5. 弃牌洗回时执行原子的卡池世代滚动。
6. 第二次及后续洗牌不依赖 `remainingPileIdentityIDs`。
7. 物理数量、身份分区、suspended 和 UI 投影各自拥有明确不变量。
8. 删除正 ID 暗牌堆端点相关的身份置换和补偿路径。

### 2.2 非目标

- 不精确求解活动卡池中哪些身份仍在物理牌堆。
- 不要求卡池张数等于匿名牌堆张数。
- 不在暗摸时猜测或分配真实身份。
- 不引入槽位代表身份映射。
- 不引入全局 `ConstraintGroup` 或无界收敛。
- 不全面迁移玩家手牌、mark、exchange、process 的槽位模型。
- 不重写随机手牌转移和暗置标记候选。
- 不把 suspended 候选按玩家 × 身份展开到 UI。
- 不以“候选池比牌堆大”为错误指标。

### 2.3 成功标准

成功不是“卡池尽可能接近真实牌堆身份集合”，而是：

```text
物理牌堆数量准确
身份全集不丢失、不重复
身份状态分区合法
世代滚动可重复
suspended 集合有界且可恢复
UI 信息正确且可读
生产状态转换分支减少
```

---

## 3. 术语与数据模型

### 3.1 匿名物理槽

暗牌堆中的实体只表示“一张未知牌”：

```text
card.location === 'pile'
card.isKnown !== true
=> card.id < 0
=> card.entityID < 0
```

稳定负 ID 负责：

- 公共区有序槽位。
- 摸牌/洗牌的物理数量。
- Zone 移动端点。
- 匿名实体引用稳定性。

它不携带真实 CardID。

### 3.2 活动世代卡池

建议字段：

```ts
activePileIdentityPool: Set<CardID>
pileIdentityGeneration: number
```

语义：

> `activePileIdentityPool` 保存当前牌堆世代中尚未被协议揭示的身份候选。

它不是：

- 当前牌堆真实身份集合。
- 当前牌堆槽位的逐槽映射。
- 所有未定位身份的全集。
- suspended 的别名。

特别是，active pool 成员资格只表示“身份仍未揭示且保留牌堆来源可能性”，**不表示追踪器
断言该身份当前仍在牌堆**。暗摸后仍留在 active pool、但没有显示到候选区的身份，应计为
“未展示的未决身份”；只有 UI 明确采用“未显示即确定在牌堆”的闭世界契约时，才能把它
记为错误的牌堆断言。本计划不采用该闭世界契约。

### 3.2.1 批次基数扩展

Phase 0.5 的第三模型将单一 active pool 扩展为按牌堆物理批次排序的集合：

```ts
interface PileIdentityCohort {
  generation: number
  candidateIdentityIDs: Set<CardID>
  remainingPileCount: number
}
```

语义示例：

```text
candidateIdentityIDs = {1,2,3,4,5}
remainingPileCount = 4
```

只表示“五个身份中恰有四个仍在牌堆”，不指认是哪四个。批次按物理牌堆的牌底到牌顶排序；
当前 `rebuiltPile = recycledCards + remainingPileSlots` 下，新洗回批次位于旧剩余批次之下，
普通摸牌可以先消费旧批次基数，再消费新批次基数，而无需逐槽身份绑定。

### 3.3 世代

世代在以下事件建立：

- `initDeck()` 建立初始世代。
- 实际发生弃牌洗回牌堆时建立下一世代。

以下事件不建立新世代：

- 普通暗摸。
- 普通明摸。
- 空弃牌堆上的初始化式 `shufflePile()` 调用。
- 只调整显示顺序、但没有把弃牌重新混入暗牌堆的事件。

### 3.4 suspended

本计划中的 `shuffle-untrusted-location` suspended 表示：

> 该身份属于本局且尚未被重新揭示，但它已经失去对某个活动牌堆世代的可靠归因；
> 它可能仍在牌堆，也可能已经通过暗摸进入玩家或其它暗区。

它不表示：

- 确定不在牌堆。
- 确定在某个玩家手里。
- 确定属于“场上”而非牌堆。

### 3.5 未定位身份

`unlocatedIdentities` 继续是身份基础分区。活动卡池应满足：

```text
activePileIdentityPool ⊆ unlocatedIdentities
```

但反向不成立：可能存在不属于活动牌堆世代的其它未定位身份。

### 3.6 身份全集

`deckIdentities` 继续记录本局已知的真实身份全集。合法外部牌首次出现时只扩展一次。

### 3.7 最小原因枚举

建议将稳定原因收敛为：

```ts
type SuspensionReason =
  | 'overbroad-player-candidates'
  | 'pile-generation-expired'
```

日志可以携带更细的事件 reason，但运行时契约不应依赖任意字符串。

---

## 4. 核心不变量

### 4.1 物理槽守恒

```text
暗牌堆张数只由 pile Zone 中的物理 Card 数量决定
```

对普通公共来源移动：

```text
来源槽减少量 == 实际消费槽数量
```

身份是否位于活动卡池或 suspended，不得改变本次应该消费的槽数。

### 4.2 暗牌堆匿名

目标态：

```text
card.location === 'pile' && card.isKnown !== true
=> card.id < 0 && card.entityID < 0
```

明确保留且协议仍可信的已知牌堆顶/底，可以继续是正 ID 明牌或公共候选；它不属于暗槽。

### 4.3 身份基础分区

对任意 `id ∈ deckIdentities`：

```text
exactly one of:
  id bound to one positive Card in cardIndex
  id in unlocatedIdentities
```

### 4.4 活动卡池包含关系

```text
activePileIdentityPool ⊆ unlocatedIdentities
activePileIdentityPool ⊆ deckIdentities
```

禁止：

- 活动卡池身份同时存在于 `cardIndex`。
- 活动卡池身份同时是活动 suspended 身份。
- 非牌组身份未经合法外部入口直接加入卡池。

### 4.5 数量不等式不是不变量

以下关系均不要求成立：

```text
activePileIdentityPool.size === pile.cards.length
activePileIdentityPool.size <= pile.cards.length
activePileIdentityPool.size >= pile.cards.length
```

例如：

- 大量暗摸后，卡池可能远大于牌堆张数。
- 大量身份已揭示但仍有匿名槽时，卡池可能小于牌堆张数。
- 卡池为空但牌堆仍有匿名槽，表示剩余身份都已失去当前世代归因或以其它方式被追踪。

### 4.6 suspended 一致性

当前兼容存储下：

```text
card.suspended === true
<=> card ∈ suspendedKnownCards
```

并且：

```text
card.id > 0
card.id 不在 activePileIdentityPool
card.id 不在 unlocatedIdentities
cardIndex.get(card.id) === card
```

### 4.7 揭示收敛

任意正 ID 经协议明确出现时：

```text
若在 active pool：从 active pool 删除
若在 generation-expired suspended：恢复并删除 suspended reason
若在 unlocated：绑定到本次实际消费或观察到的实体
```

同一身份不得在揭示后残留于多个状态集合。

### 4.8 世代滚动原子性

一次实际弃牌洗回必须表现为单个逻辑事务：

```text
旧活动卡池剩余身份 -> generation-expired suspended
洗回弃牌身份       -> 新活动卡池
洗回弃牌实体       -> 匿名牌堆槽
generation         -> +1
```

任何中间失败不得留下：

- 旧卡池只迁移一部分。
- 新卡池身份仍绑定正 ID 实体。
- 已匿名化实体对应身份既不在卡池也不在 suspended/其它合法分区。

---

## 5. 事件算法

## 5.1 初始化牌堆

输入：本局牌组身份 `cardIDs`。

目标状态：

```text
pile.cards = 等量稳定负 ID 匿名槽
deckIdentities = Set(cardIDs)
unlocatedIdentities = Set(cardIDs)
activePileIdentityPool = Set(cardIDs)
pileIdentityGeneration = 0
suspendedKnownCards = 空
```

步骤：

1. 校验并去重合法正 ID。
2. 为每个身份创建一个匿名牌堆物理槽。
3. 初始化身份全集和未定位分区。
4. 将全部初始牌组身份加入活动卡池。
5. 重建/初始化 `CardCounter` 与位置索引。
6. 执行 DEV 守恒断言。

说明：初始世代仍是“候选池”，不是对每个匿名槽的逐槽绑定。

---

## 5.2 暗摸

输入：公共牌堆来源，`CardIDs` 为空，`cardCount > 0`。

算法：

```text
从 pile 指定端点消费 cardCount 个匿名物理槽
将槽移动到目标区域
activePileIdentityPool 不变
unlocatedIdentities 不变
suspended 不变
```

原因：协议没有提供真实身份，任何身份删除或绑定都会虚构信息。

必须断言：

- 牌堆严格减少 `cardCount`，或在端点不足时报告守恒错误。
- 不调用身份物化。
- 不从活动卡池随机删除身份。
- 不创建 suspended。
- 不创建正 ID 暗手牌实体来代表被摸身份。

玩家手牌需要的物理数量继续由移动后的匿名实体承担。

批次基数模型在同一事件下执行：

```text
从牌顶批次开始减少 remainingPileCount
candidateIdentityIDs 不变
不选择或移动任何具体 CardID
```

若一个批次从 `{1,2,3,4,5} / 5` 暗摸 1 张，结果是 `{1,2,3,4,5} / 4`，而不是任意
删除一个身份，也不是继续对五个身份逐一断言“仍在牌堆”。

---

## 5.3 身份揭示

“身份揭示”包括但不限于：

- 明摸。
- 从暗手牌打出已知 CardID。
- 完整手牌快照。
- 明确的展示/移动协议。
- suspended 身份再次出现。

统一预处理：

```ts
releaseIdentityFromInferencePools(cardID, reason)
```

建议语义：

1. 若 `cardID ∈ activePileIdentityPool`：删除。
2. 若身份处于 `pile-generation-expired` suspended：准备恢复，清理对应原因。
3. 若身份处于其它 suspended 原因：按该原因现有恢复规则处理，不擅自合并语义。
4. 保证后续物化前身份不会同时留在活动池和 suspended。

### 5.3.1 从牌堆明摸

算法顺序：

```text
1. 按 cardCount 消费匿名牌堆物理槽
2. 从 active pool / suspended 释放 incoming identity
3. 在已消费槽或目标实体上物化 incoming identity
4. 移动到目标区域并确认明牌
5. 执行身份/物理双重守恒断言
```

身份解析成功与否不能改变第 1 步已消费的物理数量。

目标态不再需要：

- 正 ID 暗牌顶身份被挤回 `unlocated`。
- suspended 名额转交给被挤牌堆身份。
- 牌堆代表身份交换。

因为匿名牌堆槽没有被挤出的真实身份。

### 5.3.2 从玩家暗区揭示

算法继续复用现有玩家匿名占位/候选交换语义，但首先从活动卡池或 generation suspended
中释放该身份。

这意味着：

- 如果身份原在活动卡池，说明它可能曾被暗摸；揭示证明后从池中删除。
- 如果身份原在 generation suspended，直接恢复，不需要和牌堆实体交换身份。
- 玩家物理槽数量仍由现有匿名占位承担。

### 5.3.3 只展示但仍留在牌堆

若协议只公开身份，牌仍明确留在牌堆或牌堆范围候选中：

- 从活动卡池删除，因为身份已经揭示。
- 建立正 ID 明牌实体或公共候选，继续由现有公共候选模型追踪。
- 该已知实体不属于暗牌堆匿名不变量的适用对象。

---

## 5.4 身份进入弃牌堆

正 ID 明牌进入弃牌堆时：

1. 确保已从活动卡池删除。
2. 确保已从 suspended 恢复并清理原因。
3. 以正常正 ID 已知实体存在于 discard。
4. 此时尚不加入下一世代卡池；只有实际洗回时才加入。

这样可以区分：

- “在弃牌堆等待可能洗回”。
- “已经成为新牌堆世代候选”。

---

## 5.5 实际弃牌洗回：世代滚动

触发条件：

```text
discard.cards.length > 0
且协议/局流明确执行弃牌洗回牌堆
```

空弃牌堆调用不得滚动世代。

### 5.5.1 事务输入

```text
expiringPoolIDs = 当前 activePileIdentityPool 快照
remainingPileSlots = 当前 pile.cards 快照
recycledCards = 当前 discard.cards 快照
recycledKnownIDs = recycledCards 中所有合法正 ID
```

匿名弃牌槽没有可加入新卡池的身份，只作为物理槽洗回。

### 5.5.2 步骤 A：关闭旧世代

对每个 `id ∈ expiringPoolIDs`：

1. 从 `activePileIdentityPool` 删除。
2. 验证它仍位于 `unlocatedIdentities`。
3. 创建或复用可展示的正 ID 身份实体。
4. 从 `unlocatedIdentities` 移除并进入 `cardIndex`。
5. 以原因 `pile-generation-expired` 加入 suspended。

注意：这不宣称身份确定离开牌堆。它只表示该身份已经失去活动世代归因。

### 5.5.3 步骤 B：匿名化洗回实体

对每张正 ID `recycledCard`：

1. 记录 `cardID`。
2. 从 `cardIndex` 释放身份。
3. 把同一物理实体改为稳定负 ID 匿名槽。
4. 将 `cardID` 放入 `unlocatedIdentities`。
5. 将 `cardID` 加入新活动卡池。

对匿名 `recycledCard`：

- 保持匿名，只重置到牌堆状态。
- 不凭空向新活动卡池添加身份。

### 5.5.4 步骤 C：重建物理牌堆

```text
随机打乱 recycledCards
rebuiltPile = recycledCards + remainingPileSlots
```

保持当前行为：

- 只随机洗回弃牌部分。
- 原本仍在牌堆的部分保持相对顺序。
- 不为协议张数主动补建匿名牌堆槽。
- 协议张数作为硬校验，而不是身份卡池等量条件。

### 5.5.5 步骤 D：提交新世代

```text
activePileIdentityPool = Set(recycledKnownIDs)
pileIdentityGeneration += 1
```

若某个 `recycledKnownID` 因异常仍在 suspended 或已有其它正 ID 实体，事务必须失败并报告
身份分区冲突，不得静默重复加入。

### 5.5.6 步骤 E：事务后断言

```text
active pool ⊆ unlocated
active pool 与 suspended 不重叠
所有洗回正 ID 均已匿名化且进入 active pool
所有旧 active pool 剩余身份均已进入 generation suspended
pile 实体数 == remaining pile slots + recycled slots
discard 为空
```

---

## 5.6 第二次及后续洗牌

每次世代滚动使用完全相同的算法：

```text
当前活动池剩余 -> generation suspended
本次洗回已知弃牌 -> 下一活动池
历史 suspended 未恢复者继续保留
```

不再需要区分：

- “上一轮沿用 suspended”。
- “本轮通过 remainingPileIdentityIDs 排除的身份”。
- “正 ID 暗牌堆实体”。

诊断仍应分别报告：

```text
carriedSuspendedIDs
newlyExpiredPoolIDs
newActivePoolIDs
```

但运行时集合按完整活动状态维护。

---

## 5.7 suspended 身份恢复

当 generation suspended 身份再次被协议明确揭示：

1. 找到现有 suspended 正 ID 实体。
2. 清除 `card.suspended`、集合成员和 suspension reason。
3. 若来源为牌堆，先消费匿名物理槽。
4. 若来源为玩家暗区，复用现有匿名玩家占位或候选交换流程。
5. 将正 ID 实体移动到协议目标。
6. 不转移 suspended 名额给任何匿名牌堆槽，因为槽上不存在代表身份。

恢复后活动 suspended 数量自然减少；本计划不要求 suspended 数量恒定。

---

## 5.8 合法外部身份

12 区或技能生成牌可能带来：

- 新身份。
- 新物理牌。
- 已存在身份的外部入口。

规则：

1. 首次合法外部身份加入 `deckIdentities`。
2. 身份与物理实体是否同时创建由协议入口明确决定。
3. 外部身份若进入弃牌堆，等实际洗回时再进入新活动卡池。
4. 外部身份若直接暗置进入牌堆，必须由专用 API 同时创建匿名槽并决定是否加入当前活动池。
5. 普通公共来源端点不足不得借 `createExternal` 掩盖。

---

## 5.9 已知保留牌堆顶/底

若洗牌协议明确只洗回弃牌部分，原牌堆剩余的公开顶/底信息继续保留：

- 正 ID 已知实体不加入活动卡池。
- 公共候选继续由 `locationCandidates(type: public)` 表达。
- 原匿名槽继续匿名。
- 旧活动卡池在世代滚动时仍整体失效，因为无法知道其中哪些身份属于保留匿名槽。

这是有意的保守降级，不会影响物理顶/底顺序。

---

## 6. 分阶段实施

## Phase 0：冻结基线与候选池模拟

### 6.0.1 目标

先证明世代卡池算法自身闭合，并冻结当前生产行为，避免在实现过程中把“新模型预期差异”误判
为普通回归。

### 6.0.2 工作项

1. 建立纯测试模型：

```text
tests/tracker/helpers/pileGenerationPoolModel.ts
```

2. 模型只维护：

```ts
interface PileGenerationPoolState {
  generation: number
  pileSlotCount: number
  activeIdentityIDs: Set<CardID>
  suspendedIdentityIDs: Set<CardID>
  locatedIdentityIDs: Set<CardID>
}
```

3. 用纯事件驱动模型覆盖：
   - 初始化。
   - 暗摸不更新池。
   - 揭示从池移除。
   - 洗牌滚动。
   - 多次洗牌。
   - suspended 恢复。
   - 合法外部身份。
4. 固定用户给出的 `5 -> 暗摸3 -> 弃1,2 -> 洗牌` 示例为第一条契约测试。
5. 记录当前生产模型在同一序列下的：
   - pile 实体数。
   - 正 ID 暗槽集合。
   - unlocated。
   - suspended。
   - UI 候选集合。
6. 明确标记预期差异：新模型可能比当前代表性分配展示更多 suspended 身份，这不是自动
   回归，但必须进入 UI 可读性闸门。

### 6.0.3 模型测试不变量

- 暗摸前后 `activeIdentityIDs` 完全相同。
- 揭示身份从 active/suspended 中至多删除一次。
- 世代滚动后旧 active 为空，新 active 等于洗回已知身份集合。
- active 与 suspended 不重叠。
- identity universe 不丢失。
- suspended 集合大小不超过本局身份全集。
- 多轮洗牌不会重复加入同一 suspended 身份。

### 6.0.4 闸门

- 纯模型测试全绿。
- 用户示例按预期得到：`pile=4`、`active={1,2}`、`suspended={3,4,5}`。
- 至少三轮连续洗牌仍保持身份分区唯一。
- 团队接受“卡池大小不参与物理牌堆等量断言”。

---

## Phase 0.5：批次集合与基数约束

### 6.0.5.1 目标

在不引入逐槽代表身份的前提下，验证能否保留“候选集合中仍有多少张在牌堆”的真实信息，
并把模型断言错误与 UI 未展示遗漏拆成两个指标。

### 6.0.5.2 交付

`tests/tracker/helpers/pileGenerationPoolModel.ts` 新增 `runCohortPoolModel()`，维护按牌底到牌顶
排序的 `PileIdentityCohort[]`。同一事件序列同时驱动：

```text
当前正 ID 暗槽基线
全局世代滚动模型
批次集合 + remainingPileCount 模型
服务器真实牌序 oracle（仅纯夹具）
```

批次模型必须满足：

```text
0 <= remainingPileCount <= candidateIdentityIDs.size
所有批次身份集合互斥
所有批次基数之和 == 物理牌堆槽数
批次候选全集 == 身份基础分区中的未定位身份
```

### 6.0.5.3 结论

- 五牌示例保留为两个批次：`{1,2}/2` 与 `{3,4,5}/2`；后者准确表达“三选二仍在牌堆”。
- `k=1..5` 单周期夹具中，批次模型与全局世代模型都展示 8 张候选；批次模型额外保留
  `{1..5}/(5-k)` 的基数，不对具体 CardID 作错误牌堆断言。
- 两周期夹具中，批次模型的逐卡候选宽度为 10，但保留 `{6,7}/0`、`{1..5}/0`、
  `{8,9,10}/1` 三个精确关系。全局世代投影显示 7 张，并遗漏 2 张已离开牌堆的 active
  未决身份；这应称为 `omittedOutsidePileIDs`，不是 active pool 的“假阴性断言”。
- 批次模型没有降低最保守的逐卡按钮数量；它的收益是保留集合级真信息，并允许未来使用
  “三张中一张仍在牌堆”这类分组投影，而不是恢复逐槽代表绑定。

### 6.0.5.4 闸门

Phase 0.5 纯模型完成，但**不自动放行全局世代 observer**。进入 Phase 1 前必须先确认：

1. 产品是否接受按批次分组展示或查询，而不是只比较扁平按钮数量。
2. 真实协议事件能否稳定维护批次边界；破坏边界的事件必须有显式合并/降级规则。
3. observer 的指标采用“已确认矛盾下界 / UI 未展示遗漏”，不再把 active pool 当作确定牌堆。

---

## Phase 1：生产只读三模型对照

### 6.1.1 目标

在不改变当前生产写路径的前提下，跟随真实 `Room` 事件维护全局世代与批次基数两个影子
模型，收集候选规模、批次可维护性、后续协议证实的矛盾下界和 UI 差异。

### 6.1.2 兼容期特殊规则

当前生产模型仍有正 ID 暗牌堆槽，这些身份位于 `cardIndex`，因此影子期不能启用正式目标
不变量：

```text
activePileIdentityPool ⊆ unlocatedIdentities
```

影子池应使用独立集合，不写入 `Room.unlocatedIdentities`：

```ts
shadowPileGenerationPool: Set<CardID>
shadowPileIdentityGeneration: number
shadowPileIdentityCohorts: PileIdentityCohort[]
```

影子池表示“若采用新模型，这些身份属于活动世代”，不受当前正 ID 实体绑定限制。
批次数组只维护集合、基数与牌堆端点顺序，同样不写入生产 `Card` / `Zone`。

### 6.1.3 影子事件接入

优先放在测试 controller/回放 adapter 中；只有真实浏览器采集无法复用测试入口时，才增加
可被生产构建剔除的 DEV observer。

事件：

- `initDeck(cardIDs)`：影子池设为全部身份。
- 任意正 ID 明确揭示：从影子池/影子 generation suspended 删除。
- 实际弃牌洗回：旧影子池转影子 suspended；洗回正 ID 成为新影子池。
- `destroy()`：清空。

暗摸事件不更新全局世代身份池；批次模型从牌顶批次开始减少 `remainingPileCount`。
牌堆顶/底展示、交换和技能回牌若破坏批次边界，必须记录显式降级原因，不能静默继续沿用
错误的批次顺序。

### 6.1.4 采集指标

每个世代记录：

```text
generation
pileSlotCountBeforeShuffle
activePoolSizeBeforeShuffle
newlyExpiredCount
carriedSuspendedCount
newActivePoolSize
revealedFromActiveCount
revealedFromExpiredCount
maxDisplayedCandidateCount
cohortCount
cohortCandidateWidth
cohortCardinalitySummaries
batchBoundaryDegradationCount
```

真实回放没有服务器隐藏牌序，不能直接采集“真实假阴性率”。为当前基线、全局世代投影和
批次模型分别建立 belief epoch：判断建立时记录批次和事件序号；任何可能合法改变暗区归属的
事件都会使 epoch 失效。只有同一有效 epoch 内，后续协议明确证明身份从玩家暗区或其它
非牌堆来源出现时，才累计：

```text
confirmedContradictionCount       # 已确认错误断言下界
confirmedProjectionOmissionCount  # 已确认未展示遗漏下界
unresolvedRiskSetSize             # 尚无 oracle 结论的风险集合
riskExposureEventCount            # 风险集合持续经历的事件数
riskExposureDuration              # 风险集合持续时间
```

这些是后续协议提供的证据下界，不得命名为完整“假阴性率”。

禁止继续使用：

```text
abs(activePoolSize - pileSlotCount)
或 activePoolSize / pileSlotCount
```

作为错误率。可以记录其数值，但名称应为“候选宽度比”，只用于 UI/信息精度评估。

### 6.1.5 UI 影子投影

计算但不渲染：

```text
current UI candidate IDs
shadow generation candidate IDs
shadow cohort candidate IDs
shadow cohort cardinality summaries
新增候选 IDs
减少候选 IDs
```

重点回答：

- 新模型是否把大量仍可能在牌堆的身份展示到“场上候选”。
- 当前“场上候选”标题是否需要改成更中性的“未知位置候选”。
- 最大候选按钮数量是否仍可读。
- “N 张候选中仍有 K 张在牌堆”的分组信息是否比扁平按钮更可读。

内部集合按 CardID 去重，不按玩家位置展开。

### 6.1.6 闸门

- 影子池可连续处理完整真实回放。
- 身份不重复、不漏出。
- 候选集合大小始终不超过身份全集。
- 至少三段真实回放，且覆盖多个洗牌世代、至少一段三周期以上牌局与批次边界降级事件。
- 三模型的 belief epoch、失效原因和已确认矛盾下界均可复核。
- 不改变任何生产状态和 UI。

---

## Phase 2：UI 与信息损失决策

### 6.2.1 目标

在切生产前先确认世代降级是否符合记牌器产品目标。该闸门判断的是信息可读性，不是身份池
是否和牌堆等量。

### 6.2.2 必须评估的指标

1. 每次洗牌后新增 generation suspended 数量。
2. 最大同时展示候选身份数量。
3. 身份从 generation suspended 恢复的平均/最大延迟。
4. 下一次洗牌前仍未恢复的历史 suspended 数量。
5. 候选集合是否快速逼近整副牌。
6. 用户真正关注的身份是否仍能从候选区快速识别。
7. 三模型在可比 exposure 下的 `confirmedContradictionCount` / `confirmedProjectionOmissionCount`。
8. 批次分组数量、基数摘要可读性和批次边界降级频率。
9. 新增状态与可删除生产分支的净复杂度变化。

### 6.2.3 UI 语义调整

如果采用本模型，当前“场上候选”容易被理解为“确定不在牌堆”。推荐在正式迁移时改为更
准确的用户概念，例如：

```text
未知位置候选
```

要求：

- 每个 CardID 只显示一次。
- 不显示内部世代号、集合运算或技术原因。
- 悬浮描述可以区分“位置未知”与普通多座位候选，但文案保持简短。
- 不为每个候选身份生成所有可能玩家位置。

具体用户文案在 UI 实施时结合现有面板空间确定，本计划只规定语义。

### 6.2.4 GO 条件

- 实战候选规模可读，未长期逼近整副牌。
- UI 去重后没有玩家 × 身份笛卡尔积。
- 恢复路径能持续收敛历史 suspended。
- 即使候选比当前模型更多，也提供了真实、稳定且可理解的信息。
- 团队接受主动放弃“旧世代中具体哪些身份仍在牌堆”的数量关系。
- 在可比风险暴露下，目标模型的已确认矛盾不高于基线；若正确性无改善，必须有可量化的
  代码净减少或分组信息收益作为迁移理由。
- 批次边界在关键真实回放中可维护，降级事件不会使模型悄悄回到逐槽代表绑定。

### 6.2.5 NO-GO 条件

- 多数实战中一两次洗牌后候选区接近整副牌，失去分析价值。
- 历史 suspended 长期不恢复并持续占满 UI。
- 为保持可读性必须重新引入复杂槽位代表身份绑定。
- 需要玩家 × 身份候选展开才能解释状态。
- 新模型虽然简单，但用户可感知信息显著劣于当前模型。
- 目标模型只把“未展示的未决身份”换了名称，却没有降低遗漏风险或提供可用的批次信息。
- 批次边界在普通技能事件中频繁失效，必须引入接近逐槽映射的补偿逻辑。
- 正确性无改善、候选更宽且生产代码没有明显净减少。

NO-GO 时保留 Phase 0 模型和回放数据，删除影子运行时 observer，不进入生产迁移。

---

## Phase 3：生产账本与状态 API

> 仅在 Phase 2 判定 GO 后执行。

### 6.3.1 新增 Room 状态

```ts
activePileIdentityPool: Set<CardID>
pileIdentityGeneration: number
suspensionReasons: Map<CardID, SuspensionReason>
```

如 `suspendedKnownCards` 暂时继续存 `Set<Card>`，原因映射必须通过现有 suspend/resume API
维护，不允许调用点直接写。

### 6.3.2 原子 API

建议新增或收敛为：

```ts
initializePileIdentityPool(cardIDs)
removeRevealedIdentityFromPilePool(cardID, reason)
expireActivePileIdentityPool(reason)
startPileIdentityGeneration(recycledCardIDs, reason)
suspendGenerationIdentity(cardID, reason)
resumeGenerationIdentity(cardID, reason)
assertPileIdentityPoolConsistency(context)
```

职责边界：

- `initialize` 只用于开局。
- `removeRevealed` 幂等删除活动池身份，并处理 generation suspended 恢复准备。
- `expire` 关闭旧世代，不创建新世代。
- `start` 要求旧世代已关闭，并把洗回身份加入新活动池。
- suspend/resume 维护 `Card`、集合、原因和身份分区。
- 调用方不得直接增删活动池。

### 6.3.3 DEV 一致性断言

检查：

- 活动池元素均为合法正 ID。
- 活动池元素属于 `deckIdentities`。
- 目标态下活动池元素均位于 `unlocatedIdentities`。
- 活动池与 suspended 不重叠。
- suspension reason 与集合、card flag 一致。
- generation 为非负整数且只在实际洗回时递增。

### 6.3.4 迁移期权威状态

Phase 3 只建立账本 API，当前正 ID 暗槽仍是生产权威表示。活动池先双写，但不切换
`shufflePile()` 分类读取。

由于双写期目标包含关系暂时不成立，断言分为：

```text
compat mode：active identity 可位于正 ID 暗牌堆实体
target mode：active identity 必须位于 unlocatedIdentities
```

兼容模式只用于迁移，不进入最终契约。

### 6.3.5 闸门

- 所有事件写入口都经过原子 API。
- 双写活动池与 Phase 1 影子结果一致。
- 重复揭示、重复 suspend、空弃牌洗牌均幂等。
- 无新增未插桩全牌池高频扫描。

---

## Phase 4：切换洗牌为匿名世代滚动

### 6.4.1 改造目标

将 `shufflePile()` 从：

```text
读取剩余牌堆正 ID
排除 remainingPileIdentityIDs
分类 suspended
reset 洗回实体但保留正 ID
```

切换为：

```text
关闭旧活动池
匿名化洗回正 ID 实体
洗回身份建立新活动池
重建匿名物理牌堆
```

### 6.4.2 事务顺序

推荐把世代滚动收敛为单一内部方法：

```ts
rotatePileIdentityGeneration({ remainingPileCards, recycledCards, cardCount })
```

内部阶段：

1. 预校验身份分区和实体唯一性。
2. 快照旧 active、carried suspended、recycled identities。
3. 为旧 active 创建 generation suspended 实体。
4. 匿名化 recycled 正 ID 实体。
5. 重建 pile Zone。
6. 启动新 active pool。
7. 更新 counter/index/dirty 状态。
8. 执行事务后守恒断言。

若无法原子完成，不应提交部分状态；实现可先在局部数组/集合中计算目标，再统一写入。

### 6.4.3 删除的当前依赖

切换后不再需要：

- `remainingPileIdentityIDs` 作为 suspended 分类依据。
- 洗回牌堆后保留正 ID 暗槽。
- 依赖正 ID 暗槽延续下一次洗牌身份信息。

暂时仍保留：

- 旧正 ID 暗槽读取兼容，用于处理切换前创建的局内状态或测试夹具。
- `anonymizeLocatedIdentity()`，因为玩家/mark 等其它区域仍可能需要。
- suspended 实体 UI 投影。

### 6.4.4 闸门

- 洗牌结束后暗牌堆无正 ID 暗槽。
- 新活动池只包含本次洗回的已知身份。
- 旧活动池剩余身份全部进入 generation suspended。
- 第二次、第三次洗牌结果符合世代算法。
- 物理 pile/discard 数量与协议一致。
- `CardCounter`、增量索引和 UI 投影正确。

---

## Phase 5：切换 known 揭示与恢复路径

### 6.5.1 牌堆明摸 slot-first

统一顺序：

```text
消费匿名公共槽
-> 释放 incoming identity 的 active/suspended 状态
-> 物化/恢复 incoming identity
-> 移到目标
```

禁止 known 解析失败改变已消费槽数量。

### 6.5.2 玩家/mark 揭示

在现有玩家来源身份交换前调用：

```text
removeRevealedIdentityFromPilePool
或 resumeGenerationIdentity
```

玩家/mark 的物理占位和候选规则继续沿用现状。本计划只移除“身份仍属于牌堆世代”的标签。

### 6.5.3 可删除分支

完成后候选删除：

- 未定位身份复用正 ID 暗牌堆槽时的 displaced identity 处理。
- suspended 身份命中正 ID 暗牌顶时的 suspended 名额转交。
- `materialize:replaceHiddenPublicIdentity` 的牌堆专用分支。
- `materialize:displacedHiddenPublicIdentity` 的牌堆专用分支。
- 因牌堆正 ID 暗实体改写身份而触发的部分索引/计数补偿。

删除前必须确认这些符号是否还服务玩家/mark/其它公共区，必要时只删牌堆分支。

### 6.5.4 闸门

- 所有牌堆明摸严格消费匿名槽。
- active/suspended 身份均能从牌堆和玩家区恢复。
- 不再出现 displaced hidden pile identity。
- 12 区外部身份不重复创建。
- 玩家/mark 回归无变化。

---

## Phase 6：收口兼容路径与文档

### 6.6.1 清理

- 删除迁移期 compat mode。
- 启用正式 `active pool ⊆ unlocated` 断言。
- 删除正 ID 暗牌堆读取兼容。
- 删除只服务决策的影子 observer 和固定统计 schema。
- 保留纯模型测试和通用守恒测试。

### 6.6.2 文档

更新 `docs/agents/card_tracker.md`：

- 牌堆暗槽持续匿名。
- 活动世代卡池定义。
- 暗摸不更新卡池。
- 洗牌世代滚动算法。
- generation suspended 的准确语义。
- 卡池与物理牌堆数量不要求相等。

更新 `docs/agents/testing.md`：

- 新增世代卡池测试主题。
- 记录真实回放候选规模结论。
- 删除旧正 ID 暗牌堆兼容的测试说明。

### 6.6.3 最终闸门

- 全量自动化与真实回放通过。
- 无正 ID 暗牌堆槽。
- 无迁移双写状态。
- 生产状态机分支相对当前模型净减少。
- UI 文案与实际语义一致。

---

## 7. 测试矩阵

### 7.1 核心模型测试

| 编号 | 场景 | 关键断言 |
| --- | --- | --- |
| G01 | 初始化 5 张牌 | pile=5、active=5、suspended=0、generation=0 |
| G02 | 暗摸 3 张 | pile=2、active 仍为 5 |
| G03 | 揭示 `[1,2]` 入弃牌 | active=`{3,4,5}` |
| G04 | `[1,2]` 洗回 | pile=4、active=`{1,2}`、suspended=`{3,4,5}` |
| G05 | generation suspended 的 4 再揭示 | suspended 删除 4，位置恢复 |
| G06 | active 的 1 明摸 | active 删除 1，pile 减 1 |
| G07 | 第二次洗牌 | 旧 active 剩余转 suspended，新弃牌成为 active |
| G08 | 第三次洗牌 | 身份不重复、不漏失，generation 连续递增 |
| G09 | 空弃牌洗牌 | generation 和 active 不变 |
| G10 | 匿名弃牌槽洗回 | 增加物理槽，不增加 active 身份 |
| C01 | 五牌批次模型 | `{1,2}/2`、`{3,4,5}/2`，不绑定具体槽位身份 |
| C02 | 批次暗摸 | 只减少 `remainingPileCount`，候选集合不变 |
| C03 | 手牌/牌堆揭示 | 按来源分别只减集合或同时减集合与基数 |
| C04 | 连续洗牌批次顺序 | 新洗回批次位于牌底侧，旧剩余批次先被摸走 |
| C05 | oracle 三模型对照 | 区分错误牌堆断言、保守展示与 UI 未展示遗漏 |
| C06 | 模型输入边界 | 初始化去重、牌序全集、超量摸牌与非空弃牌堆均校验 |

### 7.2 生产状态测试

| 编号 | 场景 | 必须断言 |
| --- | --- | --- |
| P01 | `initDeck` | 暗 pile 全负 ID；全部身份在 active/unlocated |
| P02 | 暗摸 | 不写 active/unlocated/suspended |
| P03 | 明摸 active 身份 | 先消费槽，再从 active 释放并物化 |
| P04 | 玩家暗手牌揭示 active 身份 | 从 active 删除，复用玩家物理占位 |
| P05 | generation suspended 从牌堆揭示 | 消费匿名槽，恢复身份，不转移名额 |
| P06 | generation suspended 从玩家揭示 | 恢复身份，玩家槽数量守恒 |
| P07 | 已知弃牌洗回 | 实体匿名化，身份进入新 active |
| P08 | 连续两次洗牌 | active/suspended 按世代滚动 |
| P09 | 原 pile 顶已知保留 | 顺序和公开身份不丢，暗槽仍匿名 |
| P10 | 协议 pile count 不一致 | 报物理守恒错误，不用 active 凑数 |
| P11 | 12 区外部牌 | identity universe 和物理数量各扩一次 |
| P12 | 同批 known IDs | 每个严格消费独立槽，不互相占位 |
| P13 | hidden mark 占位 | 暂停/恢复不破坏账本引用 |
| P14 | 玩家手牌观测 | 匿名手牌数量不因身份池变化漂移 |
| P15 | destroy/new game | generation、active、reason 全清空 |

### 7.3 身份分区测试

每个关键步骤断言：

```text
deckIdentities
= located positive IDs
∪ unlocatedIdentities

located positive IDs ∩ unlocatedIdentities = ∅
activePileIdentityPool ⊆ unlocatedIdentities
activePileIdentityPool ∩ suspended IDs = ∅
```

对合法外部身份，identity universe 只允许单调增加一次。

### 7.4 UI 测试

- generation suspended 每个 CardID 只显示一次。
- 与普通 ambiguous candidate 去重。
- active pool 不直接显示；它仍有当前世代牌堆来源可能性。
- generation suspended 使用“未知位置”语义，不声称确定在场上。
- 候选集合较大时布局不重叠、不溢出。
- 历史 suspended 恢复后对应按钮消失。

### 7.5 索引与计数测试

- `CardCounter` 不为 active pool 创建重复实体计数。
- 洗回身份匿名化后仍保留静态卡面查询能力。
- suspended 身份恢复后 status 正确。
- `CardLocationIndex` 增量结果等于全量 rebuild。
- `AmbiguousKnownIndex` 不把 active pool 当作普通位置候选。
- 动态创建 suspended 身份实体时稳定排序立即登记。

### 7.6 性能与遍历测试

- 活动池集合操作应为 O(1)。
- 世代滚动允许 O(active pool + recycled cards)，只在实际洗回触发。
- 暗摸热路径不得遍历活动池。
- UI 渲染不得按玩家数乘活动池或 suspended 数量扫描。
- 新增全牌池扫描必须使用 `recordTraversal(...)`。
- 更新 `tests/tracker/traversalBaseline.test.ts` 时解释数字变化。

### 7.7 属性式序列测试

使用固定 seed 生成合法序列：

```text
drawUnknown
revealFromHand
discardKnown
shuffleWithDiscard
revealSuspended
introduceExternal
```

每一步验证：

- pile/discard/player 物理数非负。
- generation 只在实际洗回时增加。
- active 在暗摸时不变。
- active/suspended 不重叠。
- 身份全集完整。
- 任意身份不会同时有两个正 ID 实体。

失败输出必须包含 seed 和完整可重放事件序列。

---

## 8. 诊断与观测

### 8.1 推荐洗牌日志

```ts
{
  generationBefore,
  generationAfter,
  actualPileCountBefore,
  recycledSlotCount,
  actualPileCountAfter,
  expiredPoolCardIDs,
  recycledIdentityIDs,
  activePoolCardIDs,
  carriedSuspendedCardIDs,
  newlySuspendedCardIDs
}
```

### 8.2 禁止的诊断命名

不要把以下数值称为“漂移”或“错误率”：

```text
activePoolSize - pileSlotCount
activePoolSize / pileSlotCount
```

可使用：

```text
candidateWidth
candidateToPileRatio
expiredCandidateCount
```

并明确它们只衡量信息宽度和 UI 压力。

### 8.3 DEV 告警

只对真正不变量告警：

- active 与 suspended 重叠。
- active 身份已有正 ID 实体。
- active 身份不属于 `deckIdentities`。
- generation 非法变化。
- 洗回正 ID 未匿名化或未加入新 active。
- 旧 active 未完整转 suspended。
- 物理 pile 数量与重建结果不一致。

不对 active 与 pile 数量不同告警。

### 8.4 长期探针清理

完成 GO/NO-GO 后：

- 删除固定影子统计 schema 和浏览器控制入口。
- 保留通用守恒断言、遍历插桩和测试快照。
- 若候选宽度成为长期产品指标，另建通用、低成本统计，不保留实验命名。

---

## 9. GO / NO-GO 总闸门

### 9.1 生产迁移 GO

必须同时满足：

1. 纯模型三轮以上洗牌身份守恒。
2. 只读影子覆盖至少三段关键真实回放。
3. 最大候选集合在 UI 中可读。
4. 历史 generation suspended 能通过后续揭示持续恢复。
5. 物理牌堆数量完全独立于身份池且始终正确。
6. 玩家/mark 现有模型无需同步大改。
7. 预期可删除至少两条正 ID 暗牌堆置换/补偿路径。
8. 不新增暗摸热路径身份遍历。
9. active pool、unknown-location projection 与“确定仍在牌堆”三种语义在 API/UI 中明确分离。
10. 目标模型在可比 belief epoch 下不增加已确认矛盾；若仅保留批次基数信息，分组投影已
    通过产品可读性验证。
11. observer 样本覆盖多个洗牌世代与批次边界降级，不只按回放文件数量计数。

### 9.2 生产迁移 NO-GO

任一成立即停止：

- 候选区在普通实战中快速逼近整副牌并长期不收敛。
- UI 无法在不误导用户的情况下表达“可能仍在牌堆或暗区”。
- 玩家/mark 必须全面槽位化才能恢复身份。
- 新活动池和 suspended 形成难以维护的双重权威状态。
- 不能原子执行世代滚动。
- 旧复杂分支无法删除，生产代码继续显著净增。
- 性能或增量索引出现无法接受的回退。
- active pool 仍被实现或 UI 隐式解释为“未显示即确定在牌堆”。
- 批次模型需要频繁丢弃基数或恢复逐槽身份映射，无法维持其中间方案的边界。
- 三模型对照没有显示正确性、信息表达或代码净复杂度中的任何一项实质改善。

### 9.3 NO-GO 后保留

- 用户示例与纯模型测试。
- 实战候选宽度数据。
- 当前身份守恒测试的增强。
- 对“卡池大小不等于牌堆数不是错误”的设计结论。

删除影子运行时 observer 和未进入生产契约的状态字段。

---

## 10. 风险与缓解

| 风险 | 表现 | 缓解 |
| --- | --- | --- |
| suspended 语义被误读 | 用户认为候选确定不在牌堆 | 改为“未知位置”投影；文档明确可能仍在牌堆 |
| 候选池过宽 | UI 接近整副牌 | Phase 1 实测宽度；Phase 2 产品闸门 |
| 世代滚动部分失败 | 身份分区漏出 | 预计算目标状态 + 原子 API + DEV 断言 |
| active/suspended 双重权威 | 同一身份重复 | 单一写入口 + 集合不重叠断言 |
| 活动池参与物理补数 | 牌堆实体虚增 | 明确物理数量只读 Zone；禁止按 pool 补槽 |
| 空弃牌调用误滚动 | 候选无故暂停 | `discard.length > 0` 硬门槛 |
| 已知顶底被匿名化 | 公共候选丢失 | 暗槽不变量仅适用非公开槽；保留公开/候选实体 |
| 合法外部牌重复扩展 | 身份或物理数增加两次 | 显式外部 API + identity universe 断言 |
| 玩家/mark 恢复路径遗漏 | 匿名占位数量漂 | 所有正 ID 揭示统一先释放身份池状态 |
| 迁移双写长期存在 | 维护成本翻倍 | 每阶段硬闸门；Phase 6 删除 compat mode |
| 用候选宽度当正确性错误 | 错误否决模型 | 诊断术语区分守恒和信息精度 |

---

## 11. 回退策略

每阶段独立提交：

| 阶段 | 回退方式 |
| --- | --- |
| Phase 0 | 仅测试模型，可直接删除，不影响生产 |
| Phase 1 | 删除只读 observer，不影响 Room 状态 |
| Phase 2 | NO-GO 并归档数据，不改生产 |
| Phase 3 | 关闭双写并删除新字段，旧模型仍权威 |
| Phase 4 | 回退世代滚动提交，恢复正 ID 暗槽洗牌 |
| Phase 5 | 回退 known 路径切换，保留已验证的 Phase 4 或整体回退 |
| Phase 6 | 删除兼容前保留上一稳定提交；实战异常整体回退清理提交 |

原则：

1. Phase 4 前旧模型始终是生产权威。
2. 不在出现差异时临时叠加代表性绑定补丁。
3. 候选 UI 不可接受时回退产品方向，不通过隐藏候选掩盖。
4. 触发玩家/mark 全面迁移需求时停止扩范围。

---

## 12. 提交切片

| 提交 | 内容 |
| --- | --- |
| C0 | 纯世代卡池模型 + 用户示例 + 多轮测试 |
| C1 | 生产只读影子 observer + 标准化快照 |
| C2 | 真实回放候选宽度报告 + GO/NO-GO |
| C3 | Room 活动池/世代/原因 API，兼容双写 |
| C4 | `shufflePile` 切换世代滚动和洗回匿名化 |
| C5 | known 揭示统一释放 active/suspended |
| C6 | UI 语义调整 + 兼容路径删除 + 文档收口 |

每个提交说明：

- 状态机改变。
- 明确不变行为。
- 自动化和真实回放验证。
- 候选宽度数据。
- 可回退点。

---

## 13. 验证命令

代码阶段按范围运行：

```powershell
$ErrorActionPreference = 'Stop'
pnpm test:tracker
pnpm typecheck:tracker
pnpm typecheck
pnpm lint
pnpm build
pnpm build:prod
```

最低要求：

- `src/tracker/` 或 `tests/tracker/`：`test:tracker`、`typecheck:tracker`、`lint`、`build`。
- Phase 4–6 核心迁移：额外 `typecheck`、`build:prod`。
- 新增全量扫描：更新 traversal baseline 并解释数字。

---

## 14. 完成定义

### 14.1 模型验证完成

- 用户示例、`k=1..5` 矩阵和两周期序列通过。
- 暗摸不更新卡池成为自动化契约。
- 卡池/牌堆不等量不再被视为守恒错误。
- active pool、确定牌堆集合与 UI 未展示身份已拆成不同语义。
- 批次集合 + 在牌堆数量模型通过 oracle 对照和身份/物理守恒。
- 待完成：固定 seed 属性序列、真实回放 belief epoch 数据与 Phase 2 GO/NO-GO。

### 14.2 生产迁移完成（仅 GO）

- 暗牌堆物理槽持续匿名。
- 活动卡池只在揭示和世代滚动时更新。
- 实际洗回建立新世代。
- 旧世代剩余身份进入 generation suspended。
- 第二次及后续洗牌不读取正 ID 暗牌堆身份。
- known 揭示不再置换牌堆代表身份。
- UI 使用准确的未知位置语义。
- 旧兼容路径已删除或记录明确保留原因。
- 生产代码复杂度相对当前模型有可量化下降。

---

## 15. 执行清单

### Phase 0

- [x] 新增纯世代卡池模型。
- [x] 固化用户五牌示例。
- [x] 补三轮以上连续洗牌测试。
- [ ] 补固定 seed 属性序列。

### Phase 0.5

- [x] 拆分 active pool 可能性语义与确定牌堆断言。
- [x] 新增批次集合 + `remainingPileCount` 第三模型。
- [x] 补 oracle 初始牌序与自动补牌物理边界。
- [x] 固化单周期/两周期三模型对照。
- [ ] 用真实协议样例枚举会破坏批次边界的事件及降级规则。

### Phase 1

- [ ] 满足 §6.0.5.4 后建立生产只读三模型 observer。
- [ ] 接入初始化、揭示、洗牌、销毁事件。
- [ ] 建立 belief epoch 与失效原因，记录已确认矛盾/遗漏下界。
- [ ] 记录扁平候选宽度、批次基数摘要和边界降级数据。
- [ ] 跑至少三段且覆盖多个洗牌世代的真实回放。

### Phase 2

- [ ] 评估最大候选按钮数。
- [ ] 评估历史 suspended 收敛速度。
- [ ] 确定 UI “未知位置”语义。
- [ ] 判定 GO/NO-GO。

### Phase 3（仅 GO）

- [ ] 新增活动池、世代和原因状态。
- [ ] 收敛原子 API。
- [ ] 完成兼容双写和一致性断言。

### Phase 4

- [ ] 实现世代滚动事务。
- [ ] 洗回正 ID 实体匿名化。
- [ ] 删除 `remainingPileIdentityIDs` 分类依赖。
- [ ] 验证连续洗牌与公开顶底。

### Phase 5

- [ ] known 揭示统一释放池状态。
- [ ] 牌堆明摸改为 slot-first。
- [ ] 恢复 generation suspended 不转移名额。
- [ ] 删除牌堆 displaced identity 分支。

### Phase 6

- [ ] 删除 compat mode 和影子 observer。
- [ ] 启用正式包含关系断言。
- [ ] 更新 UI 文案与投影。
- [ ] 更新正式文档和归档。
- [ ] 完成全量验证和真实回放。

---

## 16. 建议的下一批工作

Phase 0/0.5 已完成。下一批仍不修改生产状态：

1. 从真实协议样例枚举牌堆顶/底展示、技能交换、回牌堆与显式回收对批次边界的影响。
2. 为边界保持、批次合并和保守降级分别定义纯事件与回归。
3. 设计不按玩家 × 身份展开的批次分组投影，验证“候选集合中 K 张仍在牌堆”是否可读。
4. 定义 belief epoch、失效事件与已确认矛盾/遗漏下界的采集 schema。
5. 满足 §6.0.5.4 后，再决定是否增加可剔除的三模型只读 observer。

这样即使分组 UI 或协议边界闸门最终 NO-GO，实验状态仍不会进入 `Room` 权威状态。

---

## 17. Phase 0 实测结论（2026-07-30）

> 本节保留第一轮评估的原始判断，作为决策过程记录。其“跳过 Phase 1 / Phase 2 并最终
> NO-GO”的结论已被 §18 撤回，不再代表本文当前裁决。

### 17.1 一句话结论

**语义主张成立，候选宽度闸门 NO-GO。** 世代卡池算法自身闭合、身份守恒、可重复滚动；
但它在 §0-A 同一夹具上产出的候选宽度与「洗回即匿名化」完全一致（5 → 8），
且方向与当前模型相反（当前 5 → 3 收敛）。Phase 1–6 不执行。

### 17.2 交付物

| 文件 | 内容 |
| --- | --- |
| `tests/tracker/helpers/pileGenerationPoolModel.ts` | 两个纯模型：`runGenerationPoolModel`（本计划）+ `runBaselineLedgerModel`（当前生产语义），同一事件序列驱动 |
| `tests/tracker/pileGenerationPool.test.ts` | 18 例，含 §1.2 五牌示例、身份分区不变量、三轮连续洗牌、候选宽度对照 |

未新增任何生产代码，未接入 Phase 1 影子 observer。`pnpm test:tracker` 343 例全绿，
`typecheck:tracker` / `lint` 通过。

### 17.3 §1.1 对「725% 漂移率」的反驳：**成立**

旧否决（`pile-slot-identity-decoupling-reopen.md` §0-B）隐含了「卡池必须精确等于当前牌堆
身份集合」这个定义。本计划改用「本世代尚未揭示的身份候选」后，暗摸不收紧卡池是有意的
保守建模而非漂移。已固化为契约：

- G02：暗摸前后 `activeIdentityIDs` 完全相同。
- G04：`pileSlotCount=4 / activePoolSize=2 / suspendedSize=3` 三者不等且合法（§4.5）。
- 三轮洗牌每代输出 `{pileSlotCount: 10, activePoolSize: 2, suspendedSize: 8}`——
  牌堆槽数远大于活动卡池是正常状态。

§8.2 关于诊断命名的要求同样成立：`activePoolSize - pileSlotCount` 只应称为
`candidateWidth`，不是错误率。

### 17.4 但 §0-A 的否决未被绕过

`pile-slot-identity-decoupling-reopen.md` §0-A 的夹具（10 张牌 / 摸 2 弃 5 / 连续两次洗牌）
在本轮由两个独立纯模型复现：

| 模型 | 第一次洗牌 | 第二次洗牌 | 第二次的 suspended IDs |
| --- | ---: | ---: | --- |
| 当前正 ID 暗槽账本（基线） | 5 | **3** | `[8, 9, 10]` |
| 洗回即匿名化（§0-A 已否决） | 5 | **8** | `[1,2,3,4,5,8,9,10]` |
| **世代身份卡池（本计划）** | 5 | **8** | `[1,2,3,4,5,8,9,10]` |

世代卡池与已否决的纯匿名化**数字完全一致**。按 §7.4，活动卡池不直接展示、UI 展示的是
generation suspended，所以这就是候选区实际宽度：8/10 = **牌组的 80%**，是基线的 2.67 倍。

三轮夹具进一步分化：

```text
generationWidths: [7, 8, 8]
baselineWidths:   [7, 5, 3]
```

方向相反是决定性的，不是幅度问题。

### 17.5 根因

`Room.shufflePile()` 用 `remainingPileIdentityIDs`（剩余牌堆里的正 ID 暗槽）排除仍有明确
牌堆位置的身份，这是当前模型收敛的唯一机制。世代滚动（§5.5.2）把旧 active 池**整体**
过期，恰好丢掉这条排除依据——§2.1 目标 6「第二次洗牌不依赖 `remainingPileIdentityIDs`」
的实现方式，就是丢掉它承载的信息。

`Card.reset()` 保留正 ID 不是遗留缺陷，而是承载「该身份确定仍在牌堆」这一条真实信息的
载体。§1.3 把它描述为「不虚构身份与匿名槽的一对一代表分配」，但被丢弃的并非虚构的
一对一映射，而是「这批身份仍在牌堆」这个集合级事实。

附带成本：当前分类只为已排除 remaining pile ID 后的 unlocated 候选建实体；世代滚动要为
**每个**过期 active 身份建正 ID 实体。108 张牌的局里 active 池可达 ~58，每次洗牌多建
几十个实体。

### 17.6 命中的 NO-GO 条件

§6.2.5 与 §9.2：

- 「多数实战中一两次洗牌后候选区接近整副牌，失去分析价值」——两次洗牌后达 80%。
- 「候选区在普通实战中快速逼近整副牌并长期不收敛」——方向为累积，无收敛点。
- 「新模型虽然简单，但用户可感知信息显著劣于当前模型」——候选宽度 2.67 倍。

§9.1 生产迁移 GO 的第 3 条（最大候选集合在 UI 中可读）与第 4 条（历史 suspended 能持续
恢复）均未满足。

### 17.7 为何跳过 Phase 1 / Phase 2

计划把候选宽度判定推给 Phase 1（生产只读影子 + 三段真实回放）与 Phase 2（UI 闸门）。
但候选宽度是**算术**的而非经验的：世代滚动每次把整个活动池转为 suspended，而恢复只能
靠后续逐张揭示，收支比由「每轮离开牌堆张数 vs 每轮揭示张数」决定，与具体牌局无关。
纯模型已足以判定，无需影子 observer 与回放采集。

§6.0.2 第 6 项本已预告「新模型可能比当前代表性分配展示更多 suspended 身份」；本轮把
「可能」量化为确定数值。

### 17.8 保留与删除

按 §9.3 保留：

- 用户五牌示例与纯模型契约测试（`pileGenerationPool.test.ts`）。
- 候选宽度对照数据（本节表格 + 测试内联断言）。
- 「卡池大小不等于牌堆张数不是错误」这一设计结论——已成为可执行断言。

未产生需要删除的影子 observer 或迁移期状态字段（Phase 1 未启动）。

### 17.9 仍然成立、可独立采纳的部分

即使不迁移生产模型，以下结论对后续工作有效：

1. **诊断命名**（§8.2）：不要把 `activePoolSize - pileSlotCount` 叫「漂移」或「错误率」。
2. **UI 语义**（§6.2.3）：当前「场上候选」容易被读作「确定不在牌堆」，而 suspended 的真实
   语义是「位置未知，可能仍在牌堆」。改用「未知位置候选」是纯文案改进，与本计划的状态机
   迁移解耦，可单独实施。
3. **§4.5 的非不变量清单**：任何未来提案都不应把卡池/牌堆等量当作守恒条件。

### 17.10 若要重开的条件

同时满足才值得重新评估：

1. 找到在世代边界**保留**「哪些身份仍在牌堆」集合级信息的机制，且不引入槽位代表绑定。
2. 该机制能让候选宽度随洗牌轮数收敛而非累积（可用本节两个纯模型直接验证）。
3. 有实战证据表明当前正 ID 暗槽模型确实产生了错误结论（而非仅仅"看起来不优雅"）。

第 1 条是实质门槛：本轮结论是「正 ID 暗槽 + suspended 已经是推断精度与可读性之间的调好的
平衡点」，与 §0-C 的修订后方向一致。

---

## 18. 对 §17 反驳的再评估（2026-07-30）

> 本节记录 2026-07-30 的中间裁决；其中“Phase 1 允许继续”已由 §21 的 Phase 0.5
> 语义修正替代，当前全局世代 observer 暂缓。

### 18.1 用户原始语义

世代卡池的目标不是给出“当前牌堆内精确有哪些身份”，而是避免在协议没有提供 CardID 时
虚构身份与物理槽的一对一关系。`suspended` 的准确含义是：

> 身份仍属于本局，但已经失去当前活动牌堆世代的可信归因；追踪器停止承诺其具体暗区位置。

十牌夹具应按以下状态滚动：

```text
初始：
  active      = {1,2,3,4,5,6,7,8,9,10}
  suspended   = {}

暗摸 2 张，随后 1～5 揭示进入弃牌堆：
  物理牌堆   = 3 个匿名槽
  匿名手牌   = 2 个槽
  active      = {6,7,8,9,10}

第一次洗牌：
  旧 active  {6,7,8,9,10} -> suspended
  洗回身份   {1,2,3,4,5}  -> 新 active

6、7 从暗手牌揭示并进入弃牌堆：
  active      = {1,2,3,4,5}
  suspended   = {8,9,10}

第二次洗牌：
  旧 active  {1,2,3,4,5} -> suspended
  洗回身份   {6,7}       -> 新 active

最终：
  active      = {6,7}
  suspended   = {1,2,3,4,5,8,9,10}
```

因此 `8/10` 不是身份守恒错误，也不是算法意外；它是“未重新揭示的旧世代身份全部停止具体
位置追踪”这一保守投影的预期结果。§17 的纯模型正确复现了设计，但仅凭候选更宽不能反证
该语义。

### 18.2 §17 夹具缺少真实触发条件

§17 使用的对照序列等价于：

```text
第一次洗牌
-> 不发生任何牌堆暗摸
-> 6、7 揭示并弃置
-> 立即第二次洗牌
```

纯模型允许任意 `shuffle` 事件，却没有编码真实协议何时会再次发送“弃牌堆洗回牌堆”。真实
触发条件是：**当前牌堆不足以满足接下来的一次摸牌**。洗牌完成后，该次摸牌会先消费洗牌前
剩余的牌顶槽，再至少消费 1 张刚洗回的新牌。因此，对相邻两个自动洗牌周期而言，第一次
洗回批次在第二次洗牌前必然已经被不透明消费至少 1 张；§17 的 `k=0` 序列不可达，不能作为
生产 NO-GO 的决定性证据。

还需区分“发生摸牌”和“开始消费上一洗回批次”。当前 `Room.shufflePile()` 只随机弃牌堆
部分，并按：

```text
rebuiltPile = recycledCards + remainingPileCards
```

重建牌堆；牌顶从 `remainingPileCards` 一侧消费。十牌夹具第一次洗牌时仍有 3 个原牌堆匿名
槽；触发该次洗牌的摸牌会消费这 3 个槽，并因“原牌堆不足”再至少消费洗回批次 `1～5` 中的
1 个槽。所以该夹具进入下一洗牌周期时的最小值是 `k=1`，不是 `k=0`。

### 18.3 候选宽度取决于批次暴露量

定义：

```text
k = 第二次洗牌前，从上一轮洗回批次 {1,2,3,4,5} 中被不透明摸走的槽数
```

在这些摸牌均未揭示、其它条件与 §17 相同时：

| `k` | 协议可达性 | 当前模型输出宽度 | 语义正确的未知位置候选宽度 | 世代卡池输出宽度 |
| --: | :--------- | -----------------: | ---------------------------: | -----------------: |
|   0 | 不可达     |                  3 |                            3 |                  8 |
|   1 | 最小可达   |                  4 |                            8 |                  8 |
|   2 | 可达       |                  5 |                            8 |                  8 |
|   3 | 可达       |                  6 |                            8 |                  8 |
|   4 | 可达       |                  7 |                            8 |                  8 |
|   5 | 可达       |                  8 |                            8 |                  8 |

当前模型的宽度近似为：

```text
{8,9,10}
+ 被本地洗牌顺序判定为已摸走的 k 个正 ID 暗槽
```

因此 `k=1` 时“当前模型宽度为 4”的来源是：历史 suspended `{8,9,10}` 共 3 张，再加上
当前本地随机牌序恰好绑定到被摸槽的 1 个正 ID。这个 `4` 只是当前实现会显示的数量，不是
语义上正确的候选宽度。

只要 `k > 0`，`1～5` 中任意身份都可能是被摸走者；协议没有提供 CardID，无法证明当前
模型选中的具体 k 张就是真实离开牌堆的身份。故 `{1,2,3,4,5}` 应整体进入未知位置候选，
再与 `{8,9,10}` 合并，正确宽度从最小可达的 `k=1` 起就是 8。世代卡池输出 8 是正确的
保守投影；当前模型在 `k=1..4` 输出 4～7，属于依赖本地代表绑定的欠近似，并可能漏掉真实
已经进入暗区的身份。`k=5` 时两者才都达到 8。

因此 §17.7“候选宽度与具体牌局无关”的判断不成立。候选宽度至少依赖：

- 两次洗牌之间总共发生多少牌堆消费。
- 其中多少消费已经进入上一洗回批次。
- 被消费身份有多少随后通过协议揭示。
- 是否发生整手揭示、牌堆展示、交换或其它收敛事件。

### 18.4 当前正 ID 暗槽不是持续可靠的身份事实

当前实现自身已经把正 ID 暗槽描述为“一次本地身份绑定”，并明确其不代表身份确定处于
该具体槽。洗回批次尚未被不透明消费时，整个批次确实仍在牌堆；但开始不透明消费后，只能
知道“Q 个候选身份中仍有 P 张在牌堆”，不能可靠确定是哪 P 张。

所以 `remainingPileIdentityIDs` 的信息质量分为两个阶段：

```text
批次未被不透明消费：
  集合级牌堆归属可靠

批次已被不透明消费：
  具体剩余身份受本地代表顺序影响
```

§17.5 将两者统一表述为“该身份确定仍在牌堆”的真实信息，范围过宽。候选更少只能证明当前
实现保留了更多本地绑定，不能单独证明这些绑定在真实隐藏牌序下没有假阴性。

### 18.5 再裁决

当前裁决调整为：

```text
世代卡池语义与身份守恒：GO
§17 的 k=0 边界数据：保留，但不是最终 NO-GO
生产迁移：尚未 GO
Phase 1 只读影子验证：允许继续
Phase 2 UI / 信息损失决策：必须执行
Phase 3～6：继续冻结，等待 Phase 2
```

理由：

1. §17 证明了全局世代滚动在纯模型允许的 `k=0` 状态下会主动遗忘仍可推导的牌堆归属；
   但真实自动洗牌触发条件使该状态在相邻洗牌周期之间不可达。
2. 真实可达范围从 `k=1` 开始，而此时 `1～5` 的每个身份都已经具有离开牌堆的可能；世代
   模型将其整体列入未知位置候选符合保守语义。
3. `3 vs 8` 只比较候选宽度，没有验证当前模型按本地代表顺序排除的身份是否可能在真实牌序
   中已经离开牌堆。
4. 原计划已经把真实回放、恢复延迟和 UI 可读性设为 Phase 1 / Phase 2 闸门，现有数据不足以
   合理跳过这些闸门。

### 18.6 继续计划前的 Phase 0 修正

在接入生产影子 observer 前，先扩充纯模型：

1. 为第二次洗牌增加协议可达性前置条件：洗牌必须服务于一次超过当前牌堆剩余量的摸牌，
   并在模型中消费“全部旧牌顶 + 至少 1 张洗回牌”。
2. 增加 `k=1..5` 的可达批次暴露矩阵，分别记录当前模型输出、语义正确候选与世代模型输出。
3. 增加真实隐藏牌序 oracle，区分：
   - 候选宽度。
   - 假阳性：显示但真实仍在牌堆。
   - 假阴性：未显示但真实已经进入暗区。
4. 至少加入一条“摸穿原剩余 3 槽后，再不透明消费 `1～5` 洗回批次”的序列。
5. 保留现有 `k=0` 夹具作为“非自动补牌序列回归”，断言其不满足自动补牌触发前置条件；不得
   再把其候选宽度用于生产方案比较。

### 18.7 Phase 1 必须回答的问题

只读影子回放至少记录：

```text
remainingPileSlotsAtGenerationStart
drawCountBeforeNextShuffle
consumedPreviousGenerationSlotCount
revealedFromActiveCount
revealedFromSuspendedCount
currentCandidateWidth
shadowCandidateWidth
baselineExcludedThenRevealedCount
```

其中 `baselineExcludedThenRevealedCount` 用于观察：被当前 `remainingPileIdentityIDs` 排除的
身份，后续是否从玩家暗区或其它非牌堆位置揭示。该指标能直接测量当前本地代表绑定是否产生
假阴性。

Phase 1 至少完成三段真实回放后，再按 §6.2 判定：

- 若真实可达序列中世代候选长期接近整副牌且 UI 无法承载，转为 NO-GO。
- 若候选规模可读，且当前模型存在代表绑定假阴性，继续 Phase 2。
- 无论结果如何，Phase 1 只读观察不得改变 `Room`、UI 或生产状态。

---

## 19. §18 修正的实测确认（2026-07-30）

> 本节保留对 `k=0` 与基线漏分支的实测修正；关于 active pool 假阴性的解释由 §21 取代。

### 19.1 结论

**§18 的反驳全部成立，并已由纯模型独立复现。** §18.3 的批次暴露矩阵是分析推导的，
`tests/tracker/pileGenerationPool.test.ts` 的实现是独立编码的，两者数值完全吻合。

### 19.2 §17 的两处实质错误

**错误一：夹具不可达（§18.2 指出）。**
§17 夹具的第二次 `shuffle` 发生时，牌堆里还有 8 张牌。真实洗牌只在牌堆不足以满足下一次
摸牌时触发，因此该状态在协议下不可达。§17 把一个不可达点上的测量当作了生产 NO-GO 的
决定性证据。模型现已把该前置条件编码为断言：

```text
drawAcrossShuffle 事件要求 count > pileSlotCount，否则抛错
「摸牌未超过牌堆剩余量，不会触发洗牌」
```

原 k=0 夹具保留为非自动补牌序列回归（§18.6-5），其候选宽度不再用于自动补牌方案比较。

**错误二：基线模型漏了一条生产路径（本轮自查发现）。**
`runBaselineLedgerModel` 原先只复刻了 `Room.shufflePile()` 的 `neverAppearedCards` 分支，
漏掉了 `appearedHiddenIdentityCards`——即被暗摸带进玩家暗区的正 ID 暗槽（`reset()` 保留
了 id、牌面未明示）同样不在协议牌堆内，也要暂停追踪并由
`preserveUnknownPlaceholderForShuffle()` 复制匿名占位承担手牌数量。

这个遗漏使 k=1 时基线输出 3 而非正确的 4，**方向上偏向基线**，即 §17 的对照对当前模型
有利。修正后与 §18.3 表格一致。生产行为本身正确，
`tests/tracker/anonymousPileSpike.test.ts` 的「二次洗牌日志合并沿用与本轮新增的暂停身份」
用例已覆盖该分支。

### 19.3 实测矩阵

`k` = 第二次洗牌前，从上一轮洗回批次 `{1,2,3,4,5}` 中被不透明摸走的槽数。

| `k` | 协议可达性 | 基线实测 | 世代模型实测 | §18.3 预测 |
| --: | :--------- | -------: | -----------: | :--------- |
|   0 | **不可达** |        3 |            8 | 一致       |
|   1 | 最小可达   |        4 |            8 | 一致       |
|   2 | 可达       |        5 |            8 | 一致       |
|   3 | 可达       |        6 |            8 | 一致       |
|   4 | 可达       |        7 |            8 | 一致       |
|   5 | 可达       |        8 |            8 | 一致       |

### 19.4 §17 中被撤回与仍成立的部分

**撤回：**

- §17.1「候选宽度闸门 NO-GO」——基于不可达夹具。
- §17.4 的 `3 vs 8` 对照——k=0 行不可用于生产比较。
- §17.5「方向相反是决定性的」——在可达范围内两者差距是 `8 vs 4..8`，随 k 收敛而非发散。
- §17.6「命中 NO-GO 条件」——未在可达序列上验证。
- §17.7「候选宽度与具体牌局无关」——**明确错误**。宽度依赖批次暴露量 k，而 k 由牌局
  进程决定（§18.3 末尾四项）。这是我跳过 Phase 1/2 的核心理由，它不成立。
- §17.10「重开条件」——已由 §18.5 的再裁决取代。

**仍成立：**

- §17.3：§1.1 对「725% 漂移率」的反驳成立，卡池大小 ≠ 牌堆张数不是守恒错误。
- §17.2 的交付物与验证状态（数量更新为 19 例）。
- §17.9 的三条可独立采纳项，其中 UI 文案改进（「场上候选」→「未知位置候选」）与本计划
  的状态机迁移解耦，可单独实施。
- §17.5 关于实体创建成本的观察：世代滚动要为每个过期 active 身份建正 ID 实体，
  108 张牌的局里 active 池可达 ~58。这是 Phase 3 的工程成本项，不是语义否决理由。

### 19.5 §17.5 根因表述的范围修正

§17.5 称正 ID 暗槽承载「该身份确定仍在牌堆」的真实信息，§18.4 正确指出范围过宽。
准确表述分两阶段：

```text
洗回批次尚未被不透明消费：集合级牌堆归属可靠
批次已开始被不透明消费：只知「Q 个候选中仍有 P 张在牌堆」，不知是哪 P 张
```

因此基线在 k=1..4 输出的 4~7 是**依赖本地随机牌序代表绑定的欠近似**，不是语义上正确的
候选宽度。候选更少只证明当前实现保留了更多本地绑定，不能证明这些绑定无假阴性。

已固化为断言：k=1 时基线仍把 `{1..5}` 中的 4 张排除在候选外，其中恰有 1 张在真实牌序下
已离开牌堆——这 4 张就是当前实现的假阴性风险面，正是 Phase 1
`baselineExcludedThenRevealedCount` 要实测的对象。

### 19.6 当前裁决

采纳 §18.5：

```text
世代卡池语义与身份守恒：GO（§17.3 + 本节实测）
§17 的 k=0 边界数据：保留为非自动补牌序列回归，不作自动补牌路径的 NO-GO 依据
生产迁移：尚未 GO
Phase 1 只读影子验证：允许继续
Phase 2 UI / 信息损失决策：必须执行
Phase 3–6：继续冻结，等待 Phase 2
```

§18.6 的 Phase 0 修正中，第 1、2、5 项已完成（触发前置条件、k=1..5 矩阵、非法序列回归）。
第 3 项（真实隐藏牌序 oracle，区分假阳性/假阴性）与第 4 项（摸穿原剩余槽后继续消费洗回
批次的更长序列）尚未实施——若要在接生产影子前补齐纯模型，这是下一步。

---

## 20. §18.6-3 / §18.6-4 补充实测（2026-07-30）

> **2026-07-31 语义更正：**本节把 `activeIdentityIDs` 直接传给
> `getGenerationBelievedInPile()`，与 §1.1 / §3.2“仍保留牌堆来源可能性、不是当前真实牌堆
> 集合”的定义冲突。下列数值保留为讨论记录，但“世代模型假阴性”统一改读为“全局世代
> UI 未展示遗漏”；最终裁决与第三模型实测见 §21。

### 20.1 交付

`tests/tracker/helpers/pileGenerationPoolModel.ts` 新增真实隐藏牌序 oracle：
`runOracle()` / `evaluateAgainstOracle()` / `getGenerationBelievedInPile()` /
`getBaselineBelievedInPile()`。测试增至 26 例。

oracle 持有服务器视角的真实牌序，两个追踪模型都看不到它，从而把单一的「候选宽度」
拆成两类可判定的错误：

- **假阳性**：显示为未知位置候选，但真实仍在牌堆。保守代价，只是候选更宽。
- **假阴性**：相信仍在牌堆，但真实已不透明进入暗区。危险错误——追踪器在断言假事。

oracle 同时校验夹具自身可实现（牌堆揭示必须与真实牌序一致、洗回顺序必须是当前弃牌堆的
排列），本轮已用它揪出三个物理上不可能的夹具。

### 20.2 单周期结论：证实 §18.4

夹具让本地代表绑定与真实牌序不一致（洗回批次 `{1..5}` 真实以 `[5,4,3,2,1]` 排列，
而两个模型都只能假设本地顺序）：

| `k` | 基线宽度 | 基线假阴性 | 世代宽度 | 世代假阴性 |
| --: | -------: | ---------: | -------: | ---------: |
|   1 |        4 |          1 |        8 |          0 |
|   2 |        5 |          2 |        8 |          0 |
|   3 |        6 |          2 |        8 |          0 |
|   4 |        7 |          1 |        8 |          0 |
|   5 |        8 |          0 |        8 |          0 |

**§18.4 得到实测证实**：基线更窄的候选确实伴随真实的假阴性，候选宽度指标完全看不到它。
`k=5` 时基线假阴性归零，因为此时它已把整个批次列入候选，不再有可犯错的断言空间。

### 20.3 多周期结论：推翻「世代模型假阴性恒为 0」

§18.6-4 的两周期序列给出了本轮最重要的发现：

```text
baselineWidth: 4,  baselineFalseNegative:  [8]
generationWidth: 7, generationFalseNegative: [8, 9]
```

**世代模型的假阴性不是恒为 0，多周期下甚至比基线更多。**

原因：世代模型只对「上一世代」不做牌堆归属断言；对**当前世代**的洗回批次，它同样断言
「这批身份仍在牌堆」——这就是活动卡池的定义。该批次一旦被暗摸消费，它同样不知道具体
离开的是哪几张，于是产生与基线**同源**的代表绑定假阴性。

因此 §20.2 表格里「世代假阴性恒为 0」只是单周期切片的假象：在那个观测点上，被检验的
恰好是刚过期的旧世代，而当前世代还没来得及被消费。

### 20.4 对 §18.5 理由 3 的修正

§18.5 理由 3 称「`3 vs 8` 只比较候选宽度，没有验证当前模型按本地代表顺序排除的身份是否
可能在真实牌序中已经离开牌堆」——这条**成立且已由 §20.2 证实**。

但由此推出的隐含期待（世代模型能消除该类假阴性）**不成立**。准确表述是：

```text
两个模型都在各自的「当前批次」上犯同一类代表绑定错误。
差别只是世代模型额外把旧世代整体列入候选，即用更宽的假阳性换取旧世代的零假阴性。
```

世代滚动**缩小**了做错误断言的时间窗口（旧世代不再被断言），但没有**消除**错误来源。
只要存在「相信某批身份仍在牌堆」的断言，且该批次会被不透明消费，假阴性就会出现。

### 20.5 对裁决的影响

§18.5 的裁决结构不变（生产迁移尚未 GO，Phase 1/2 必须执行），但决策依据需要调整：

- 原本可能的论证「世代模型消除假阴性，因此值得付出更宽候选的代价」已被证伪。
- 真正的取舍是：**用旧世代的零假阴性 + 更宽的候选，换取当前世代仍然存在的假阴性**。
  这比原设想弱得多。
- 因此 Phase 1 的 `baselineExcludedThenRevealedCount` 必须**双向**采集：既测基线的假阴性，
  也测影子世代模型在当前世代上的假阴性。只测前者会重复本节被证伪的假设。

建议 Phase 1 采集指标在 §18.7 基础上增加：

```text
shadowBelievedInPileThenRevealedCount   # 世代模型当前世代的假阴性
generationRollbackWindowLength          # 旧世代从过期到重新揭示的时长分布
```

### 20.6 §18.6 五项修正的完成状态

| 项 | 内容 | 状态 |
| -- | ---- | ---- |
| 1 | 洗牌触发前置条件 | 已完成（`drawAcrossShuffle` 强制 `count > pileSlotCount`） |
| 2 | `k=1..5` 可达矩阵 | 已完成（§19.3） |
| 3 | 真实牌序 oracle / 假阳性假阴性 | 已完成（§20.2、§20.3） |
| 4 | 摸穿原剩余槽的更长序列 | 已完成（§20.3 两周期序列） |
| 5 | `k=0` 转非自动补牌序列回归 | 已完成 |

Phase 0 修正全部完成。是否进入 Phase 1 只读影子取决于 §20.5：若接受「取舍比原设想弱得多」
这一结论后仍认为值得验证，则按修订后的指标集执行。

---

## 21. Phase 0.5 语义统一与批次基数模型（2026-07-31）

### 21.1 语义裁决

§20.3 的 oracle 数值复现正确，但指标命名错误：active pool 按本计划从来不是“确定仍在
牌堆”的集合。暗摸后保留 active 身份，是为了不虚构具体离开身份；若 UI 不展示这些未决
身份，oracle 找到的是**投影遗漏**，不是模型作出的牌堆事实断言。

纯模型已删除 `getGenerationBelievedInPile()`，改为：

```text
getGenerationUnresolvedIDs()
evaluateUnknownLocationProjection()
omittedOutsidePileIDs
displayedStillInPileIDs
```

基线正 ID 暗槽仍可使用 `getBaselineBelievedInPile()`，因为具体正 ID 实体确实被生产模型放在
pile；两种语义不再强行对称。

### 21.2 第三模型

`runCohortPoolModel()` 维护 `PileIdentityCohort[]`：

```text
candidateIdentityIDs = 身份候选集合
remainingPileCount   = 其中确定仍在牌堆的数量
```

暗摸只从牌顶批次减少基数；从手牌揭示删除身份但不减基数；从牌堆揭示同时删除身份并减基数；
弃牌洗回在牌底侧建立新批次。该模型没有任何 CardID ↔ 匿名槽映射。

### 21.3 实测结果

目标测试增至 31 例并全部通过。

单周期 `k=1..5`：

```text
基线宽度：4 / 5 / 6 / 7 / 8，并出现 oracle 可证实的错误牌堆断言
全局世代：8 / 8 / 8 / 8 / 8，本观测点无 UI 未展示遗漏
批次基数：8 / 8 / 8 / 8 / 8，无具体身份错误断言并保留 5-k 基数
```

两周期最终状态：

```text
基线：candidateWidth=4，falseNegative=[8]
全局世代：candidateWidth=7，omittedOutsidePile=[8,9]
批次基数：candidateWidth=10，falseNegative=[]

批次关系：
  {6,7}       中 0 张仍在牌堆
  {1,2,3,4,5} 中 0 张仍在牌堆
  {8,9,10}    中 1 张仍在牌堆
```

这说明批次模型没有降低最保守的逐卡候选宽度，但保留了另外两个模型都没有的集合级真实
关系。它是否值得生产化取决于分组投影是否有用户价值，以及真实技能协议是否能稳定维护
批次边界。

### 21.4 顺手修正的模型边界

- 初始化统一按合法正 ID 去重，物理槽数与身份全集不再因重复输入分叉。
- oracle 验证 `deckOrder` 必须是初始化身份全集的完整无重复排列。
- oracle 的自动补牌事件验证超量摸牌前置条件与非空弃牌堆。
- 基线 `drawAcrossShuffle` 在洗牌后先验证物理槽数，不再用 `pop() ?? null` 静默制造匿名槽。
- `k=0` 只标记为“不满足普通自动补牌前置条件”；显式回收或未知原因的 `2 -> 9` 仍作为
  独立事件保留，不能泛化成协议非法。

### 21.5 当前裁决

```text
全局世代身份守恒：GO（纯模型对照继续保留）
active pool = 确定在牌堆：NO-GO（语义错误）
批次集合 + 基数：GO（进入产品/协议可维护性决策）
全局世代生产 observer：暂缓
批次三模型只读 observer：满足 §6.0.5.4 后再进入
Phase 3–6：继续冻结
```
