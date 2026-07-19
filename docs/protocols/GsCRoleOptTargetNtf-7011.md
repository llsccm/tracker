# `GsCRoleOptTargetNtf` / `PubGsCMoveCard`：权变观看牌堆顶

## 消息用途

晋司马懿发动权变（`SpellID = 7011`）观看牌堆顶时，会收到一组配对消息：

1. `GsCRoleOptTargetNtf` 提供本次看到的牌堆顶卡牌 ID。
2. `PubGsCMoveCard` 描述这些牌在牌堆内的同区展示，不代表真实移动或随机洗入牌堆。

## 目标通知

```text
className: "GsCRoleOptTargetNtf"
SpellID: 7011
Type: 28
Param: 1
SeatID: 2
SrcSeatID: 2
targetSeatID: 255
Params: [158, 2, 63, 125]
Timeout: 30
```

| 字段           |                示例 | 含义                         |
| -------------- | ------------------: | ---------------------------- |
| `SpellID`      |              `7011` | 权变                         |
| `Type`         |                `28` | 选择目标/区域的技能通知      |
| `SrcSeatID`    |                 `2` | 发动技能的座位               |
| `targetSeatID` |               `255` | 目标是公共牌堆，不是玩家座位 |
| `Params`       | `[158, 2, 63, 125]` | 本次看到的牌堆顶卡牌 ID      |

`Params` 按牌堆顶向内排列，第一项是最顶牌；本例中 `158` 位于牌堆顶。

当 `SrcSeatID` 是己方座位时，记牌器将 `Params` 同步为牌堆明牌。
同步时会将对应实体定位到牌堆顶；相同牌组已在顶部时不会重复重排。

## 同区展示

```text
CardCount: 4
CardIDs: [158, 2, 63, 125]
FromID: 255
FromZone: 1
FromZoneParam: 0
MoveType: 21
SpellID: 7011
ToID: 255
ToZone: 1
ToZoneParam: 0
```

`FromZone = 1`、`ToZone = 1` 且两端 ID 都为 `255`，说明来源和目标都是牌堆。
结合 `SpellID = 7011` 与 `MoveType = 21`，该消息表示原地展示牌堆顶卡牌：

- `CardIDs` 不应被当作随机位置的卡牌。
- 不应把卡牌从牌堆移出后再随机放回。
- 预处理会把 `FromPosition` 和 `ToPosition` 都归一为牌顶，使后续归一化识别为同区展示并跳过实体重排。

## 相关技能

- 观虚：docs/protocols/GsCRoleOptTargetNtf-987.md
- 诫厉：docs/protocols/GsCRoleOptTargetNtf-3483.md（Params 含牌堆顶与目标部分手牌，且后续有交换区暂存）

## 代码位置

- 目标通知与牌堆明牌：`src/handler/GsCRoleOptTargetNtf.js`
- 权变端点归一化：`src/handler/PubGsCMoveCard.js` 的 `normalizeMovePosition`
- 同区展示识别：`src/tracker/MoveEventNormalizer.ts` 的 `isSameZoneShowEvent`
