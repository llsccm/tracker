# 标记区暗交手牌与后续批量弃牌（3658）

## 已确认的前置状态

0 号的 `3657` 标记区有两张明牌，暗交其中一张给 3 号。无法确定交出的是哪张，因此两张牌
都保留“0 号标记区 / 3 号手牌”候选，并由完整位置名额约束两边各一张。
后续弃牌包含 `96`，可以确认它是被交出的牌；另一张标记牌的 ID 未提供。

## 原始协议

### 暗交一张标记牌

```yaml
CardCount: 1
CardIDs: []
FromID: 0
FromPosition: 65282
FromZone: 4
FromZoneParam: 3657
MoveType: 27
SpellID: 3658
ToID: 3
ToPosition: 65280
ToZone: 5
ToZoneParam: 0
```

### 装备移出

```yaml
CardCount: 1
CardIDs: [31275]
FromID: 3
FromPosition: 65282
FromZone: 6
FromZoneParam: 0
MoveType: 4
SpellID: 0
ToID: 255
ToPosition: 65280
ToZone: 12
ToZoneParam: 0
```

### 三张手牌弃置

```yaml
CardCount: 3
CardIDs: [92, 111, 96]
FromID: 3
FromPosition: 65282
FromZone: 5
FromZoneParam: 0
MoveType: 4
SpellID: 0
ToID: 255
ToPosition: 65280
ToZone: 2
ToZoneParam: 0
```

## 处理契约

- `FromZone=5` 明确表示手牌来源；上一条装备移动独立处理，不影响本批手牌来源。
- 候选牌保留 `subZone=mark` 是代表字段，不表示它确定仍在标记区；`seats` 包含 3 也不表示
  它可能位于 3 号标记区。匹配来源必须同时核对完整位置中的座位、子区和标记 ID。
- `96` 已有“3 号手牌”候选，可直接接受本次来源事实，不占用其它暗手牌的物化槽。
  `92`、`111` 分别物化已有匿名手牌槽，不需要 `known-fallback` 补造实体。
- 弃置后 3 号手牌数减少三张，另一张标记候选收敛回 0 号标记区。调整 `CardIDs` 顺序不能改变
  实体数量、物化结果或剩余标记牌的位置。

实现入口为 `TrackerController.syncTrackerMove()`、`RoomMovementSources.isCardInPlayerSource()`
和 `RoomMovementCandidates.markMarkToHandCandidates()`；连续协议回归位于
`tests/tracker/markToHandAmbiguous.test.ts`。
