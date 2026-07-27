# `GsCRoleOptTargetNtf`：天候私有观看与单牌展示

## 消息用途

周群发动天候（`SpellID = 3903`）时，发动者当前可收到两种私有
`GsCRoleOptTargetNtf` 消息：

1. `Type = 28` 向主视角提供本次观看的牌堆顶卡牌，同时附带主视角手牌数据。
2. `Type = 29` 向发动者展示牌堆顶三张牌。

两种消息的 `Params` 布局不同，不能使用同一偏移量解析。牌堆顶卡牌均按
**top-first** 排列，即卡牌数组第一项是最顶牌。有效牌面参数只下发给发动者；
其他角色可能收到 `Params=[]` 的同类通知，并通过后文的匿名交换移动和单牌
`PubGsCMoveCard` 展示消息获得公开信息。

## `Type = 28`：主视角观看

```text
className: "GsCRoleOptTargetNtf"
SpellID: 3903
Type: 28
Param: 0
SeatID: 5
SrcSeatID: 5
targetSeatID: 255
Timeout: 30
Params: [3, 5, 88, 146, 106, 38, 8, 54, 99, 51]
```

`Params` 布局：

```text
[pileCount, handCount, ...pileTopCardIDs, ...mainViewHandCardIDs]
```

本例中：

- `pileCount = 3`
- `handCount = 5`
- 牌堆顶三张为 `[88, 146, 106]`，其中 `88` 是最顶牌
- 后续主视角手牌数据为 `[38, 8, 54, 99, 51]`

当前适配只将
`Params.slice(2, 2 + pileCount)` 同步为牌堆顶。后续手牌片段属于主视角已知数据，
不重复写入其它座位或手牌候选。

实现会先检查实际切出的牌堆顶张数是否等于 `pileCount`。消息不完整时不做部分牌顶同步，
避免把后续字段错误解释为牌堆卡牌。

## `Type = 29`：发动者私有展示牌顶三牌

```text
className: "GsCRoleOptTargetNtf"
SpellID: 3903
Type: 29
Param: 0
SeatID: 5
SrcSeatID: 5
targetSeatID: 255
Timeout: 30
Params: [5, 8, 99, 146]
```

`Params` 布局：

```text
[seatID, ...pileTopCardIDs]
```

本例中：

- `Params[0] = 5` 是展示者座位号，不是卡牌 ID
- 发动者看到的牌堆顶三张为 `[8, 99, 146]`
- `8` 是最顶牌，随后依次为 `99`、`146`

当前适配要求 `Params` 恰好包含一个座位号和三张卡牌，再将 `Params.slice(1)`
同步为牌堆顶。

## 其他视角的匿名交换序列

发动者主视角的交换移动携带明确 `CardIDs`，按默认路径精确同步，不建立候选。其他视角中，
交换相关消息的 `CardIDs` 全为 `[]`。交换 `x` 张时（`1 <= x <= 3`）顺序如下：

| 顺序 | `FromZone -> ToZone` | 张数 | 语义                                        |
| ---: | -------------------- | ---: | ------------------------------------------- |
|    1 | `1 -> 10`            |  `x` | 从观看的牌顶三张中选择 `x` 张进入交换区     |
|    2 | `5 -> 10`            |  `x` | 发动者选择 `x` 张原手牌进入交换区           |
| 3、4 | `10 -> 10`           |  `x` | 客户端交换动画；空 `CardIDs` 不提供实体顺序 |
|    5 | `10 -> 5`            |  `x` | 选中的原牌顶牌进入发动者手牌                |
|    6 | `10 -> 1`            |  `x` | 换出的原手牌回到牌堆顶                      |

最终牌堆顶结构为：

```text
[换出的 x 张原手牌, 未被选择的原牌顶牌]
```

因此原手牌中的每张确定明牌都形成以下位置候选：

```text
发动者手牌 | 牌堆顶前 x 张
```

设交换前手牌总数为 `N`、其中确定明牌数为 `K`，则确定明牌换出数量范围为：

```text
min = max(0, x - (N - K))
max = min(x, K)
```

- `min != max` 时只保留逐牌弱候选，不断言具体有几张明牌被换出。
- `min == max` 时建立完整位置数量约束。
- 两条 `10 -> 10` 直接忽略；后续按批次中记录的牌堆实体和手牌匿名占位拆回，不能依赖
  交换区当前顺序。
- 新一轮只接管其他视角的全暗协议，主视角明确 `CardIDs` 不进入该账本。

## 配对的 `PubGsCMoveCard` 同区展示

天候还会发出牌堆同区展示移动（`MoveType = 21`，`From/To` 均为牌堆 `255`），样例：

```text
className: "PubGsCMoveCard"
CardCount: 1
CardIDs: [18]
FromID: 255
FromZone: 1
FromZoneParam: 0
MoveType: 21
SpellID: 3903
ToID: 255
ToZone: 1
ToZoneParam: 0
```

语义与权变/观虚的同区展示不同：

- 这里只是**牌顶三张中展示一张**
- 协议**不能**确定它是第几张
- 因此**不能**把该牌固定到牌顶第一张，也不能按牌顶端点物化/重排
- 对非发动者而言，这条消息也不能提供完整的有序牌顶
- 不要把 `3903` 并入 `PILE_SAME_ZONE_SHOW_SPELL_IDS` 或 `PILE_RANDOM_AS_TOP_SPELL_IDS`

基础归一仍将该消息标为 `noop`，避免复用普通 `showCards` 后把身份放到具体牌顶；
天候技能装饰器随后将它转换成公共区范围揭示：

- 展示牌命中本轮原手牌候选时，确认该牌已经换出，并收紧为“牌堆顶前 `x` 张”。
- `x = 1` 时，“牌堆顶前 1 张”即确定牌顶；其余原手牌候选可据唯一换出名额排除。
- 展示牌未命中原手牌候选时，只建立“牌堆顶前 3 张”候选。
- 单牌展示只提供正面证据，不能据此排除其他候选牌。

范围揭示只确认身份和候选区间，不把身份绑定到某个具体匿名牌堆槽，也不修改牌堆顺序。

## 私有处理条件

两种 `GsCRoleOptTargetNtf` 消息仅在以下条件同时成立时处理：

- `SpellID = 3903`
- `Param = 0`
- `targetSeatID = 255`
- `SrcSeatID` 是本地主视角（开发环境保留测试入口）
- `Type` 为 `28` 或 `29`

有序牌顶只同步到实际发动天候的本地主视角，不能将 `Type=29` 解释为全局公开消息。

## 与相似消息的差异

| 技能                    | `Params` 牌堆偏移 | 是否含手牌数据           | 特殊首项                 |
| ----------------------- | ----------------: | ------------------------ | ------------------------ |
| 天候 `3903` / `Type=28` |               `2` | 含主视角手牌，当前忽略   | `pileCount`、`handCount` |
| 天候 `3903` / `Type=29` |               `1` | 否                       | 展示者 `seatID`          |
| 观虚 `987` / `988`      |               `2` | 含目标手牌，需要同步     | `pileCount`、`handCount` |
| 诫厉 `3483`             |               `2` | 含目标部分手牌，需要同步 | `pileCount`、`handCount` |

天候 `Type=28` 虽然与观虚、诫厉共享前两个计数字段，但其后手牌数据属于主视角，
不能照搬目标手牌同步逻辑。天候 `Type=29` 的首项则是座位号，若直接把完整
`Params` 当卡牌数组，会错误地把座位 `5` 记为牌堆顶卡牌。

## 代码位置

- 目标通知：`src/handler/GsCRoleOptTargetNtf.js` 的 `handleRoleOptTargetNtf`
- 牌堆顶明牌入口：同文件的 `revealPileCards`
- 匿名交换候选：`src/tracker/skill/TianHou.ts`
- 同区展示基础归一：`src/tracker/MoveEventNormalizer.ts` 的 `inferEventType`
- 公共区范围揭示：`src/tracker/runtime/trackerController.ts` 的
  `revealPublicCandidateCards`
- 位置归一化：`src/handler/PubGsCMoveCard.js`（`3903` 不进 RANDOM-as-top 白名单）
- 回归测试：`tests/tracker/roleOptTargetNtf.test.ts`、`tests/tracker/pubGsCMoveCard.test.ts`、
  `tests/tracker/moveEventNormalizer.test.ts`、`tests/tracker/trackerController.test.ts`、
  `tests/tracker/tianHouExchange.test.ts`
