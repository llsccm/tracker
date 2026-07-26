# `GsCRoleOptTargetNtf`：天候私有观看与单牌展示

## 消息用途

周群发动天候（`SpellID = 3903`）时，发动者当前可收到两种私有
`GsCRoleOptTargetNtf` 消息：

1. `Type = 28` 向主视角提供本次观看的牌堆顶卡牌，同时附带主视角手牌数据。
2. `Type = 29` 向发动者展示牌堆顶三张牌。

两种消息的 `Params` 布局不同，不能使用同一偏移量解析。牌堆顶卡牌均按
**top-first** 排列，即卡牌数组第一项是最顶牌。这两种消息不会下发给其他角色；
其他角色只能收到后文所述的单牌 `PubGsCMoveCard` 展示消息。

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

当前实现暂不建立“该牌位于牌顶三张之一”的候选约束，而是在
`MoveEventNormalizer` 中将这类消息归一为 `noop`。因此它既不会确认牌面，也不会修改、
物化或重排牌堆；后续确有展示需求时，再单独补充牌顶前三候选模型。

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
- 同区展示丢弃：`src/tracker/MoveEventNormalizer.ts` 的 `inferEventType`
- 位置归一化：`src/handler/PubGsCMoveCard.js`（`3903` 不进 RANDOM-as-top 白名单）
- 回归测试：`tests/tracker/roleOptTargetNtf.test.ts`、`tests/tracker/pubGsCMoveCard.test.ts`、
  `tests/tracker/moveEventNormalizer.test.ts`、`tests/tracker/trackerController.test.ts`
