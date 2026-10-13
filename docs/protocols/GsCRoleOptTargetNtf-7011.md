# `GsCRoleOptTargetNtf` / `PubGsCMoveCard`：权变观看牌堆顶与获得已展示牌

## 消息用途

晋司马懿发动权变（`SpellID = 7011`）观看牌堆顶时，会收到一组配对消息：

1. `GsCRoleOptTargetNtf` 提供本次看到的牌堆顶卡牌 ID。
2. `PubGsCMoveCard` 描述这些牌在牌堆内的同区展示，不代表真实移动或随机洗入牌堆。
3. 若随后获得其中一张，另一条 `PubGsCMoveCard` 记录该牌从牌堆进入角色手牌。

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

`Params` 描述通知中公开的牌面；配对的同区展示移动提供 `CardIDs`，由移动协议同步牌面与牌堆展示状态。不要把通知和移动消息重复解释成两次实体移动。

## 同区展示

```text
CardCount: 4
CardIDs: [158, 2, 63, 125]
FromID: 255
FromPosition: 65280
FromZone: 1
FromZoneParam: 0
MoveType: 21
SpellID: 7011
ToID: 255
ToPosition: 65280
ToZone: 1
ToZoneParam: 0
```

`FromZone = 1`、`ToZone = 1` 且两端 ID 都为 `255`，说明来源和目标都是牌堆。
结合 `SpellID = 7011` 与 `MoveType = 21`，该消息表示原地展示牌堆顶卡牌：

- `CardIDs` 不应被当作随机位置的卡牌。
- 不应把卡牌从牌堆移出后再随机放回。
- 本例的 `FromPosition` 和 `ToPosition` 明确为 `65280`（牌顶）；该消息表示展示牌堆顶牌，不表示实体被重新排序。

## 随后获得已展示牌

```text
CardCount: 1
CardIDs: [158]
FromID: 255
FromPosition: 65282
FromZone: 1
FromZoneParam: 0
MoveType: 18
SpellID: 7011
ToID: 2
ToPosition: 65280
ToZone: 5
ToZoneParam: 0
```

该消息将明确的牌 `158` 从公共牌堆移入 2 号角色的手牌，`MoveType = 18` 表示获得。结合前面的展示消息，`158` 是本次已公开的牌堆顶牌，随后被 2 号获得。来源 `FromPosition = 65282` 是随机/无序位置哨兵；牌的身份由 `CardIDs` 明确给出，不应因该位置值抹去已知身份，也不应由此推断其它展示牌的位置变化。

## 相关技能

- 观虚：docs/protocols/GsCRoleOptTargetNtf-987.md
- 诫厉：docs/protocols/GsCRoleOptTargetNtf-3483.md（Params 含牌堆顶与目标部分手牌，且后续有交换区暂存）

## 代码位置

- 目标通知与牌堆明牌：`src/handler/GsCRoleOptTargetNtf.js`
- 移动位置预处理：`src/tracker/runtime/protocolRules.ts` 的 `normalizeTrackerMovePosition`
- 同区展示识别：`src/tracker/MoveEventNormalizer.ts` 的 `isSameZoneShowEvent`
