# 反间（SpellID=713）：展示、移交与目标手牌展示

## 样例范围

本文记录一组依次收到的三条 `PubGsCMoveCard` 消息。5 号角色先在手牌区展示牌 `119`，随后将该牌移交给 1 号角色；接着 1 号角色在手牌区展示五张牌，其中包括 `119`。

## 协议序列与含义

| 步骤 | FromZone / FromID | ToZone / ToID | CardCount | MoveType | 可确认的协议事实 |
| --- | --- | --- | ---: | ---: | --- |
| 1 | `5 / 5` | `5 / 5` | 1 | 21 | 5 号在手牌区展示 `119`，端点未变 |
| 2 | `5 / 5` | `5 / 1` | 1 | 27 | `119` 从 5 号手牌移交到 1 号手牌 |
| 3 | `5 / 1` | `5 / 1` | 5 | 21 | 1 号在手牌区展示 `[103, 138, 126, 18, 119]` |

三条消息的 `SpellID` 都是 `713`，`ZoneParam` 都是 `0`。`MoveType=21` 的两条消息是同区展示，不表示卡牌离开手牌；第二条 `MoveType=27` 的两端座位不同，表示主动交给（通用常量 `MOVE_TYPE.GIVE`），不是反间专属移动类型。该序列确认 `119` 在最后的展示列表中，但不据此推断其他四张牌的来源或列表顺序代表的手牌位置。

## 原始消息

```yaml
# 1. 5 号在手牌区展示一张牌
CardCount: 1
CardIDs: [119]
FromID: 5
FromPosition: 65280
FromZone: 5
FromZoneParam: 0
MoveType: 21
SpellID: 713
ToID: 5
ToPosition: 65280
ToZone: 5
ToZoneParam: 0
---
# 2. 将牌移交给 1 号
CardCount: 1
CardIDs: [119]
FromID: 5
FromPosition: 65282
FromZone: 5
FromZoneParam: 0
MoveType: 27
SpellID: 713
ToID: 1
ToPosition: 65280
ToZone: 5
ToZoneParam: 0
---
# 3. 1 号在手牌区展示五张牌
CardCount: 5
CardIDs: [103, 138, 126, 18, 119]
FromID: 1
FromPosition: 65280
FromZone: 5
FromZoneParam: 0
MoveType: 21
SpellID: 713
ToID: 1
ToPosition: 65280
ToZone: 5
ToZoneParam: 0
```

`65280` / `65282` 分别是位置字段中的顶端与随机/无序哨兵；同区展示不改变卡牌归属，不能把哨兵值理解成实际手牌插槽。

## 与现有解码逻辑的差异

本文三条样例均为 `CardCount === CardIDs.length`，列表直接表示 CardID，不应把首项作为待剔除下标。此前未接入的首项下标解码处理器已删除，当前沿用通用移动与揭示流程。

本文描述的是上述抓包中实际出现的协议字段与顺序，不将解码器预期的下标编码格式外推到本样例。
