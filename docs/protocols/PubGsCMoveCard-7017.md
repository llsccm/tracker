# 宴戏（SpellID=7017）：连续获得牌堆顶牌

宴戏的获得移动使用 `MoveType=8`。连续获得两张牌时，虽然消息的 `FromPosition=65282` 表示来源位置未明确给出，
实际顺序仍是依次从牌堆顶取牌；若只观察到其中一张，则无法判断它是牌堆顶第一张还是第二张。

## 成功样例：连续获得两张

以下是同一段成功序列，目标均为座位 7。第一条是从座位 4 的手牌获得 `116`；其后两条才是从牌堆连续获得 `68`、`55`：

```yaml
CardCount: 1
CardIDs: [116]
FromID: 4
FromPosition: 65282
FromZone: 5
FromZoneParam: 0
MoveType: 8
SpellID: 7017
ToID: 7
ToPosition: 65280
ToZone: 5
ToZoneParam: 0
```

```yaml
CardCount: 1
CardIDs: [68]
FromID: 255
FromPosition: 65282
FromZone: 1
FromZoneParam: 0
MoveType: 8
SpellID: 7017
ToID: 7
ToPosition: 65280
ToZone: 5
ToZoneParam: 0
```

```yaml
CardCount: 1
CardIDs: [55]
FromID: 255
FromPosition: 65282
FromZone: 1
FromZoneParam: 0
MoveType: 8
SpellID: 7017
ToID: 7
ToPosition: 65280
ToZone: 5
ToZoneParam: 0
```

两条牌堆来源移动按消息顺序表示连续取牌：`68` 是牌堆顶第一张，`55` 是随后取得的牌堆顶第二张。
`FromID=255` 是牌堆来源的占位值，不是角色座位；判断来源应结合 `FromZone=1`。

## 单张样例：只能确定前两张范围

```yaml
CardCount: 1
CardIDs: [126]
FromID: 255
FromPosition: 65282
FromZone: 1
FromZoneParam: 0
MoveType: 8
SpellID: 7017
ToID: 7
ToPosition: 65280
ToZone: 5
ToZoneParam: 0
```

这条消息只记录了一张牌堆获得，无法从移动本身判断 `126` 是牌堆顶第一张还是第二张。
两种位置都应保留为可能，不应仅凭 `FromPosition=65282` 或 `CardIDs` 中的身份强行选定其中一个。

## 识别要点

- 宴戏相关移动以 `SpellID=7017` 识别；牌堆获得为 `FromZone=1`、`ToZone=5`、`MoveType=8`。
- 成功连续获得两张时，将连续的两条牌堆获得按顺序映射到牌堆顶第一张和第二张。
- 单张获得不足以区分牌堆顶第一张或第二张，推断应保持两者皆可能。
- `FromPosition=65282` 在这些样例中没有提供单条移动的精确牌堆槽位；连续事件顺序是两张牌顶端顺序的依据。

## 相关入口

- [协议索引](README.md)
- [牌堆位置通用说明](move-position.md)
