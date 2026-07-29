# 牌堆槽位与身份解耦重开提案

> 状态：**待讨论 / 未进入实施**
> 日期：2026-07-29
> 触发：连续洗牌、暂停身份恢复与正 ID 暗牌堆槽置换期间，反复出现牌堆数量、身份总数、
> `suspended` 集合和增量索引不一致。
> 历史关联：[`anonymous-entity-and-slot.md`](anonymous-entity-and-slot.md)
>
> 本文记录问题证据、结构性判断和下一阶段的候选方向。除“已确认事实”和“当前临时修复”外，
> 其余内容均需后续讨论，不是当前运行时契约。代码契约仍以
> [`docs/agents/card_tracker.md`](../docs/agents/card_tracker.md) 为准。

---

## 0. 结论摘要

本轮问题不是单一边界遗漏，而是当前牌堆模型长期处于两种语义的混合状态：

```text
物理槽位语义：这里有一张牌，但身份未知
真实身份语义：这是 CardID=X 的牌，但位置可能未知
```

当前 `Card` 同时承载这两种语义。初始牌堆使用稳定负 ID 匿名槽，但已知弃牌洗回牌堆后，
`Card.reset()` 只隐藏牌面，不解除正 ID 身份，因此第一次洗牌之后会重新出现
`id > 0 && isKnown === false` 的“正 ID 暗槽”。

这使已知摸牌同时承担三件事：

1. 消费一个真实牌堆物理槽；
2. 找到或创建协议给出的真实身份；
3. 处理该物理槽此前随机绑定的旧身份。

三件事没有被一个原子操作统一维护，导致局部修复分别影响牌堆数量、身份集合、
`suspended` 候选和增量索引。

**建议重开身份/槽位解耦，但只先处理牌堆边界，不进行玩家手牌、mark、候选和 UI 的
全局大爆炸迁移。**

---

## 1. 本次实战问题

### 1.1 12 区外部牌进入牌组后的概率性牌堆偏差

开局从 12 区获得牌：

```text
CardCount: 1
CardIDs: [60461]
FromID: 255
FromZone: 12
MoveType: 19
ToID: 1
ToZone: 5
```

该牌后续进入弃牌堆并参与洗牌。洗牌后的某次明摸会出现本地牌堆比现实多一张，
但不固定发生在洗牌后的第一次摸牌。

已确认直接原因：

- 已知身份解析未消费正 ID 暗牌堆端点；
- 解析失败进入 `createExternal`，创建了身份实体；
- 原物理牌堆槽仍保留，因此牌堆没有按 `CardCount` 减少。

概率性来自端点组合：

- 负 ID 匿名端点可被旧 `materialize` 正常消费；
- 已知身份已有正确实体时也可能正常；
- 只有“身份未定位或实体不在来源 + 端点是正 ID 暗槽”等组合才触发。

### 1.2 第二次洗牌的暂停身份计算不完整

第一次洗牌曾暂停 8 个身份：

```text
[15, 131, 45, 46, 150, 138, 139, 102]
```

部分身份随后从敌方手牌再次出现并恢复追踪。第二次洗牌前仍存在上一轮沿用的暂停身份，
但旧诊断只报告本轮重新分类的身份，同时把已 `confirmKnown()` 的历史 suspended 身份误算进
`visibleKnownCardIDs`。

表现为：

- `preservedPlayerPlaceholders` 看起来像新增了不应存在的牌；
- `suspendedCardIDs` 只包含本轮子集；
- 实际需要的是“上一轮仍存活 + 本轮新增”的完整活动集合。

其中 `preservedPlayerPlaceholders` 本身不是新增真实卡牌。它是当前混合模型下的补偿机制：
正 ID 暗身份转为 suspended 后不再承担玩家区物理暗槽，因此必须创建稳定负 ID 替身维持手牌
或 mark 数量。

### 1.3 身份总数从 132 下降到 131

两次身份集合差确认，缺失身份曾为 `147`。

直接原因：

1. suspended 身份从玩家区再次出现；
2. 它与一个正 ID 暗占位交换位置；
3. 该占位不再承担玩家区物理数量；
4. 旧路径直接把占位移到 `outside`；
5. 占位携带的正 ID 仍被 `cardIndex` 视为已定位，但 `CardCounter` 已把实体归为移出；
6. 后续洗牌既不会从 `unlocatedIdentities` 找到该 ID，也不会把它分类为活动 suspended。

这不是物理牌凭空减少，而是一个真实身份从身份账本的可枚举集合中永久漏出。

### 1.4 `known` 路径存在实体缺口

实战出现：

```text
knownIDs: [132, 39, 133]
missingIDs: [132]
inCardIndex: false
inUnlocated: true
inDeckIdentities: true
```

以及：

```text
knownIDs: [74, 99, 35]
missingIDs: [99]
inCardIndex: false
inUnlocated: true
inDeckIdentities: true
```

来源端点存在可消费的正 ID 暗槽，但端点筛选和 `Room.materialize()` 只接受负 ID 匿名槽。
身份账本明确知道 `132/99` 是合法未定位牌组身份，物理端点也有容量，却仍返回 `null`，
最后错误进入 `createExternal`。

### 1.5 第二次洗牌后增量索引与全量 rebuild 顺序不同

洗牌和身份补偿会动态创建新实体。旧增量索引在实体第一次产生脏事件时才登记排序键，
因此顺序取决于“先进入哪个投影桶”；全量 rebuild 则按 `Room.cards` 创建顺序登记。

当 suspended 身份、匿名替身以不同于创建顺序的顺序进入玩家区时，两条路径结果发散。

该问题属于混合模型的次生问题：身份置换需要动态创建实体，实体生命周期又参与位置索引排序。

### 1.6 修复正 ID 暗槽消费后出现新的过度 suspended

第一轮临时修复允许未定位身份消费正 ID 暗牌堆槽，并把被挤身份一律转为 suspended。
随后实战出现：

```text
CardIDs: [160, 106, 159]
reason: materialize:displacedHiddenPublicIdentity
id: 146
```

以及：

```text
CardIDs: [59, 76, 7]
reason: materialize:displacedHiddenPublicIdentity
id: 109
```

完整因果链：

1. 初始 suspended 身份从敌方手牌恢复；
2. 玩家区正 ID 暗占位上的身份被释放回 `unlocatedIdentities`；
3. 这些释放身份后来从牌堆明摸；
4. 它们消费了本地随机绑定为 `146/109` 的正 ID 暗牌堆槽；
5. 第一轮修复把 `146/109` 过度升级为新的 suspended。

这里 incoming 身份只是 `unlocated`，并没有一个 suspended 名额需要转移。正确语义是：

```text
incoming 身份：unlocated -> 绑定当前物理槽
旧槽身份：bound -> unlocated
suspended 活动集合：不变
```

只有 incoming 身份原本确实是 suspended，并从牌堆再次出现时，才需要把 suspended 名额转交给
被挤身份，以保持“场外暗身份候选”数量。

---

## 2. 当前临时修复

截至本文创建时，已完成以下保护性修复：

1. 正 ID 暗占位退出追踪区前统一释放身份：
   - 删除旧 `cardIndex` 绑定；
   - 身份退回 `unlocatedIdentities`；
   - 原物理实体改为稳定负 ID；
   - 再把不再承担位置的物理实体移到 `outside`。
2. 公共来源解析允许牌组身份消费正 ID 暗端点，并排除同批 `knownIDs` 互相占位。
3. `unlocated` 身份消费正 ID 暗槽时复用同一物理实体，旧槽身份退回未定位池，不再新增
   suspended。
4. 已有 suspended 实体消费正 ID 暗槽时仍转移 suspended 名额，随后恢复 incoming 身份，
   活动 suspended 数量保持不变。
5. 第二次及后续洗牌日志合并历史沿用与本轮新增 suspended，并拆分诊断字段。
6. 动态实体创建时立即登记 `CardLocationIndex` 稳定顺序。
7. 已补充 12 区 `60461`、连续洗牌、正 ID 暗端点、身份释放、suspended 转移与增量索引回归。

这些修复建立了当前安全基线，但仍然是在混合模型上维护更多状态转换，不视为最终架构。

---

## 3. 结构性根因

### 3.1 未知牌堆槽并未持续保持匿名

历史阶段 1 的目标态是：

```text
未知槽位 -> 稳定负 ID 匿名实体
未揭示身份 -> unlocatedIdentities
协议揭示 -> materialize
```

该目标只在 `initDeck()` 后完整成立。洗牌路径对已知弃牌调用 `reset()` 后仍保留正 ID，
因此牌堆进入：

```text
负 ID 匿名槽
+ 正 ID 暗槽
+ unlocated 身份
+ suspended 实体
```

四种状态并存。

### 3.2 `Card` 同时表示物理槽位和真实身份

当前真实牌满足：

```text
card.id === card.entityID === CardID
```

匿名牌满足：

```text
card.id === card.entityID < 0
```

因此“替换一个槽上的身份”不能只改变身份绑定，还会改变实体 ID、`cardIndex`、计数器缓存、
位置索引排序及所有持有该 `Card` 引用的约束和技能账本。

### 3.3 `suspended` 把推断状态表达成物理位置

`suspended` 的真实含义是：

> 已知这个身份属于本局，但当前没有可信物理位置；根据协议牌堆张数，它可能位于不可见场上空间。

当前实现却通过：

```text
card.location = 'suspended'
suspendedKnownCards: Set<Card>
```

表达。这迫使一个没有可信物理槽的身份继续拥有 `Card` 实体，并在恢复时与真实物理占位交换。

### 3.4 身份转换不是单一原子操作

一次身份置换可能需要同步：

- `Card.id` / `Card.entityID`
- `Card.isKnown` / `Card.suspended` / `Card.location`
- `Room.cardIndex`
- `Room.deckIdentities`
- `Room.unlocatedIdentities`
- `Room.suspendedKnownCards`
- `CardCounter`
- `CardLocationIndex`
- `ConstraintGroup`
- `hiddenMarkCandidates`
- 公共 `Zone` 有序引用

目前这些职责分散在 `Room.materialize`、`materializeExistingIdentityAtTarget`、
`anonymizeLocatedIdentity`、`releaseUnknownPlaceholderToOutside`、`shufflePile`、
`RoomMovement` 来源置换和 mark 快照清理中。

### 3.5 `createExternal` 同时承担合法入口和错误兜底

12 区、技能生成牌等来源确实需要创建外部身份或物理实体，但公共牌堆 known 解析失败也复用
同一工厂。这样会把“已有物理槽未正确消费”的身份错误掩盖成“成功创建了一张外部牌”，
直接破坏牌堆物理数量。

---

## 4. 对历史 NO-GO 决策的重新判断

历史归档在 2026-07-20 决定：

- 保留匿名牌堆阶段 1；
- 不推进未知槽位阶段 2–7；
- 不引入全局独立 `HandSlot` 模型；
- 只有出现新的非零冲突或高频 interop，并能说明继续迁移的收益时才重开。

当时三段真实回放累计 263.309 秒，旧冲突站点与玩家身份 interop 都是零触发，
而生产源码净增，因此 NO-GO 在当时证据下合理。

本次实战提供了新的重开证据：

1. 正 ID 暗端点与身份释放路径在真实对局中连续触发；
2. 同一根因先后影响牌堆数量、身份全集、suspended 和索引；
3. 修复一个分支后立即暴露相邻状态组合；
4. 触发集中在洗牌后的高频普通摸牌，不是单一低频技能；
5. 若继续追加条件分支，代码只会继续净增，无法达到历史计划要求的“统一身份交换并净删路径”。

因此建议重开，但缩小范围：

```text
重开：牌堆物理槽 + 身份绑定 + suspended 身份账本
暂不重开：玩家手牌/mark 全面 HandSlot 化、通用候选求解器、UI 模型
```

---

## 5. 候选目标模型

本节只描述方向，具体数据结构和 API 尚待讨论。

### 5.1 物理槽位优先

移动协议先决定物理事实：

```text
从来源消费 CardCount 个槽
将这些槽移动到目标
再把 CardIDs 身份绑定到已消费槽
```

身份是否已定位、是否 suspended、是否需要重新绑定，都不能改变本次应消费的物理槽数量。

### 5.2 暗牌堆槽始终匿名

候选不变量：

```text
pile 中 isKnown !== true 的实体必须是稳定负 ID 匿名槽
```

弃牌洗回牌堆时：

- 物理实体继续作为牌堆槽；
- 已知身份从槽上解绑，进入身份账本；
- 不再产生正 ID 暗牌堆槽。

是否允许“明确保留、未参与洗牌的已知牌堆顶”继续绑定身份，需要在实施设计中单独定义；
它不能和被随机洗回的暗槽共用规则。

### 5.3 身份账本独立表达位置可信度

每个 `deckIdentities` 中的正 ID 必须且只能处于一种基础状态：

```text
bound(entity)
或
unlocated
```

`suspended` 更适合作为身份账本上的候选范围或诊断标签，而不是一个物理 `Card.location`。

待讨论的两种表达：

1. `suspendedIdentityIDs: Set<CardID>`，作为 `unlocated` 的受限子集；
2. `IdentityRecord` 保存 `binding`、`candidateScope`、`visibleForTracking`、`reason`。

### 5.4 身份绑定必须原子化

所有调用点只能通过统一原语改变身份：

```text
bindIdentityToSlot
unbindIdentityFromSlot
replaceSlotIdentity
markIdentitySuspended
resumeIdentity
```

名称和参数尚未确定，但原语必须一次性维护：

- 身份分区；
- 正 ID 索引；
- 计数器身份状态；
- 物理实体投影变更通知；
- suspended 标签；
- 开发环境守恒断言。

### 5.5 外部实体创建与内部解析兜底分离

候选规则：

- 12 区、明确游戏外来源、技能生成牌：允许创建身份/物理实体；
- `pile`、`discard` 等已有公共区来源：禁止以 `createExternal` 掩盖端点缺失；
- 公共来源槽不足时记录硬守恒错误，并保留可回放上下文。

### 5.6 suspended 不再拥有伪物理实体

理想方向：

- 玩家暗手牌数量由匿名物理槽承担；
- suspended 只表示“哪些身份可能对应这些未知槽”；
- 身份恢复时把 ID 绑定到已经消费的物理槽；
- 不再为了暂停身份创建 detached `Card`，也不再为了恢复身份置换多个实体。

该目标可能需要兼容现有候选 UI 和 `CardCounter`，因此不预设一次完成。

---

## 6. 建议范围

### 6.1 本轮建议目标

1. 统一洗牌后牌堆暗槽表示。
2. 让公共来源移动严格先消费物理槽。
3. 中心化牌堆身份绑定/解绑。
4. 将 suspended 的身份语义从物理实体语义中逐步抽离。
5. 删除正 ID 暗牌堆端点的兼容分支和牌堆 `createExternal` known fallback。
6. 保持 `CardLocationIndex`、`CardCounter` 和视图对外行为兼容。

### 6.2 明确非目标

- 不在第一阶段重写玩家手牌的随机转移候选。
- 不重写 `hiddenMarkCandidates`、木马容器或 mark 数量约束。
- 不引入全局通用 `HandSlot` 层。
- 不改 UI 展示模型和查询交互。
- 不扩展通用范围求解器。
- 不在设计讨论完成前删除当前保护性修复。

---

## 7. 候选实施阶段

以下阶段用于后续讨论，不代表已经批准。

### Phase 0：冻结复现与守恒基线

目标：

1. 把本轮完整协议链整理为稳定回放夹具。
2. 建立每条移动后的身份/物理双重快照。
3. 将关键不变量变成开发断言和自动化测试。
4. 记录当前兼容分支真实触发次数，作为后续净删依据。

建议必须覆盖：

- 12 区 `60461` 进入手牌、弃牌、洗牌、连续明摸；
- 第一次洗牌暂停 8 个身份；
- suspended 身份从敌方手牌逐个恢复；
- 正 ID 暗占位释放身份；
- `[160,106,159]` 与 `[59,76,7]` 后不新增异常 suspended；
- 第二次洗牌完整身份总数仍为 132；
- 增量 `CardLocationIndex` 与全量 rebuild 一致。

Phase 0 不改变生产语义。

### Phase 1：牌堆暗槽统一匿名化

候选目标：

1. 洗回牌堆且牌面不再公开的物理实体统一解除正 ID 绑定。
2. 洗牌结束后验证暗牌堆不存在正 ID 暗槽。
3. 公共 known 移动只在已消费匿名端点上物化身份。
4. 移除 `materialize` 对正 ID 暗公共槽的主要兼容分支。

闸门：

- 全量 tracker 回归通过；
- 本轮实战回放通过；
- `materialize:displacedHiddenPublicIdentity` 在普通 unlocated 明摸路径归零；
- 牌堆来源 `known-fallback createExternal` 归零；
- 无新增全牌池高频扫描。

### Phase 2：移动流水线改为 slot-first

候选顺序：

```text
normalize event
-> select/consume physical source slots by cardCount
-> resolve identity bindings for knownIDs
-> move physical slots
-> apply candidates/constraints
-> reconcile indexes and views
```

需要讨论：

- 已知牌当前实体位于其它位置时，是复用 incoming 槽，还是交换两个槽的身份绑定；
- 玩家来源和公共来源是否共享同一流水线；
- 技能装饰器在“选槽前”还是“身份绑定后”介入；
- `sourceCards` 是否继续允许绕过端点选择。

### Phase 3：suspended 身份账本化

候选目标：

1. suspended 从 `Set<Card>` 迁移为身份状态。
2. suspended 不再使用 `Card.location = 'suspended'`。
3. 洗牌不再为未定位身份创建 detached 正 ID 实体。
4. 玩家匿名槽与 suspended 候选通过范围关系关联，不复制身份实体。

该阶段风险高于 Phase 1，应在牌堆匿名化稳定并完成实战回放后再决定是否实施。

### Phase 4：删除兼容路径并收口文档

候选删除项：

- 正 ID 暗公共端点筛选；
- 被挤正 ID 暗身份的 suspended/unlocated 分支；
- 牌堆 known `createExternal` fallback；
- 仅为正 ID 暗占位存在的 release/restore 分支；
- 不再可能触发的动态实体排序补偿。

只有实际证明路径不可达且代码量净删时才进入本阶段。

---

## 8. 核心不变量草案

### 8.1 物理槽守恒

对任意普通移动：

```text
来源物理槽减少量 == 实际移动槽数量
实际移动槽数量 == 协议允许的 CardCount 解释值
身份绑定成功与否不得改变该数量
```

### 8.2 身份分区守恒

对任意 `id ∈ deckIdentities`：

```text
exactly one of:
  id bound to one tracked entity
  id in unlocated identity ledger
```

不得同时存在，也不得两者都不存在。

### 8.3 暗牌堆匿名

```text
card.location === 'pile' && card.isKnown !== true
=> card.id < 0 && card.entityID < 0
```

若需要保留已知牌堆顶，应通过明确的公开/候选语义豁免，不能退化成正 ID 暗槽。

### 8.4 suspended 范围守恒

候选语义：

```text
suspendedIdentityIDs ⊆ unlocatedIdentityIDs
```

是否最终采用该包含关系仍待讨论，但 suspended 不应隐式创造物理实体。

### 8.5 外部创建边界

```text
public source move + insufficient source slots
=> conservation error
!= createExternal fallback
```

### 8.6 索引一致性

身份绑定、槽位移动和候选变化完成后：

- 增量 `CardLocationIndex` 等于全量 rebuild；
- `CardCounter` 的身份状态等于身份账本；
- 公共 Zone 中每个物理实体只出现一次；
- `cardIndex` 只索引当前已绑定的正 ID。

---

## 9. 后续必须讨论的问题

### 9.1 物理实体是否继续复用 `Card`

选项 A：保留当前 `Card`，但暗物理槽始终为负 ID，身份绑定仍会改写 `Card.id`。

选项 B：引入最小 `CardSlot` / `identityID` 分层，物理 `entityID` 永不因身份揭示改变。

需要比较：

- 对 `ConstraintGroup` 和技能账本引用稳定性的影响；
- 对 `CardCounter` / UI 查询对象的影响；
- 能否实际净删 swap/recover/release 代码；
- 迁移成本和回退能力。

### 9.2 洗牌匿名化范围

需要决定：

1. 只匿名化从弃牌堆洗回的实体；
2. 匿名化洗牌后整个暗牌堆；
3. 如何处理明确未参与洗牌的剩余牌堆顶部信息；
4. 公共候选牌堆顶/底是否属于“仍有可信绑定”。

### 9.3 suspended 的精确语义

需要回答：

- suspended 是“已知不在实际牌堆”，还是“位置不可信但需要展示”；
- 是否是 `unlocated` 子集；
- 是否需要候选位置范围；
- UI 是否必须展示具体 suspended Card 对象；
- 第二次洗牌如何合并沿用和新增范围。

### 9.4 外部身份与外部物理槽是否分开创建

12 区技能牌可能同时带来：

- 新真实身份；
- 新物理牌；
- 或只是一个已存在身份的外部入口。

需要定义显式 API，避免继续用 `createExternalCards` 同时表达三种情况。

### 9.5 slot-first 与技能装饰器边界

部分技能会：

- 把 RANDOM 解释为牌顶；
- 只展示不移动；
- 从玩家候选来源取牌；
- 操作 exchange/process/mark 临时区。

需要定义哪些装饰发生在物理选槽之前，哪些只修改身份或候选，避免 slot-first 被技能旁路。

### 9.6 迁移期如何双轨验证

候选方式：

- 开发环境同时运行旧身份结果与新账本影子结果；
- 每条移动比较物理槽数量、绑定身份和 suspended 集合；
- 只记录差异，不双写生产状态；
- 通过完整实战回放后再切换写路径。

是否需要影子模式及其保留周期，后续讨论决定。

---

## 10. 测试与验收矩阵

| 场景 | 必须断言 |
| --- | --- |
| 初始化匿名牌堆 | 暗牌堆槽全部为稳定负 ID；身份全集全部在账本 |
| 12 区 `60461` | 外部牌身份与物理数量只增加一次 |
| 弃牌洗回 | 暗牌堆不残留正 ID 暗槽 |
| 连续明摸 | 每次严格消费 `CardCount` 个牌堆槽，不走公共 known 外部兜底 |
| 身份未定位明摸 | incoming 绑定已消费槽，旧绑定身份回未定位，不新增 suspended |
| suspended 身份从牌堆出现 | suspended 名额按既定语义守恒，不增加物理实体 |
| suspended 身份从玩家手牌出现 | 玩家匿名槽数量保持，旧占位身份不丢失 |
| 连续两次洗牌 | 牌组身份总数始终为初始身份 + 合法外部新增身份 |
| `132/99` known 缺口复现 | 有公共端点时不得 `createExternal` |
| `146/109` 过度暂停复现 | 普通 unlocated 明摸后不新增 suspended |
| hidden mark / 木马 | 现有占位和完整快照回归不受牌堆切片影响 |
| 位置索引 | 增量结果与全量 rebuild 完全一致 |
| 遍历基线 | 不新增未插桩全牌池高频扫描 |

适用验证：

```powershell
$ErrorActionPreference = 'Stop'
pnpm test:tracker
pnpm typecheck:tracker
pnpm typecheck
pnpm lint
pnpm build
pnpm build:prod
```

涉及新全量扫描时还必须更新 `tests/tracker/traversalBaseline.test.ts`。

---

## 11. 风险与回退原则

| 风险 | 影响 | 候选缓解 |
| --- | --- | --- |
| 洗牌匿名化丢失仍可信牌堆顶 | 顶底候选错误 | 明确定义“参与洗牌范围”和公开绑定豁免 |
| slot-first 与技能装饰冲突 | 技能移动少取/多取牌 | 先建立协议矩阵，装饰器分选槽前/后两类 |
| suspended 账本化影响 UI | 场上候选缺失 | 先提供只读投影兼容，不直接改 UI |
| 身份原子 API 更新不全 | 计数器/索引漂移 | 每个原语内执行开发守恒断言 |
| 双轨迁移状态互相污染 | 难以定位差异 | 影子路径只读计算，禁止双写 |
| 改造面重新扩大为 HandSlot 大迁移 | 交付失控 | Phase 1 只处理牌堆，逐阶段 GO/NO-GO |

回退原则：

1. 每个 Phase 独立提交并保留上一阶段回归。
2. 新路径切换前保留当前保护性修复。
3. 不能证明可删除兼容代码时，不进入下一阶段。
4. 任何阶段出现 mark/随机手牌转移回归，立即回退到牌堆边界，不扩大修复范围。

---

## 12. 后续讨论产出

下一轮讨论至少需要拍板：

1. 选用“保留 `Card` + 强制匿名牌堆”还是“最小 `CardSlot` 分层”。
2. 洗牌匿名化整个暗牌堆还是只匿名化参与洗回的部分。
3. suspended 是否作为 `unlocated` 子集，以及 UI 投影形式。
4. 公共移动 slot-first 的准确阶段顺序。
5. 12 区和技能生成牌的外部创建 API。
6. 是否先做影子身份账本以及回放采集周期。
7. Phase 1 的净删目标、触发探针和 GO/NO-GO 标准。

这些决策完成前，不进入生产实现。

---

## 13. 变更记录

| 日期 | 内容 |
| --- | --- |
| 2026-07-29 | 初稿：记录连续洗牌实战异常、混合模型根因、历史 NO-GO 重开依据、有限迁移方向与待讨论问题 |
