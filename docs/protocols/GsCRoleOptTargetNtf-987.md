# `GsCRoleOptTargetNtf` / `PubGsCMoveCard`：观虚观看牌堆顶与目标手牌

## 消息用途

黄承彦发动观虚（`SpellID = 987` / `988`）时，会收到一组配对消息：

1. `GsCRoleOptTargetNtf` 同时提供本次看到的牌堆顶卡牌 ID，以及目标座位的手牌明牌 ID。
2. `PubGsCMoveCard` 描述牌堆顶卡牌在牌堆内的同区展示，不代表真实移动或随机洗入牌堆。

## 目标通知

```text
className: "GsCRoleOptTargetNtf"
SpellID: 987
Type: 29
Param: 1
SeatID: 6
SrcSeatID: 6
targetSeatID: 1
Timeout: 30
Params: [5, 4, 62, 67, 37, 53, 142, 16, 160, 79, 106]
```

| 字段           |                                              示例 | 含义                                       |
| -------------- | ------------------------------------------------: | ------------------------------------------ |
| `SpellID`      |                                      `987` / `988` | 观虚                                       |
| `Type`         |                                               `29` | 选择目标/区域的技能通知                    |
| `Param`        |                                                `1` | 当前适配阶段；本技能在 `Param == 1` 时处理 |
| `SrcSeatID`    |                                                `6` | 发动技能的座位                             |
| `targetSeatID` |                                                `1` | 被查看手牌的目标座位                       |
| `Params`       | `[5, 4, 62, 67, 37, 53, 142, 16, 160, 79, 106]` | 见下方拆分规则                             |

`Params` 布局：

```text
[pileCount, handCount, ...pileTopCardIDs, ...handCardIDs]
```

本例中：

- `pileCount = 5`，牌堆顶为 `[62, 67, 37, 53, 142]`
- `handCount = 4`，目标座位 `1` 的手牌明牌为 `[16, 160, 79, 106]`
- 牌堆顶 `Params` 片段按牌顶向内排列，第一项 `62` 是最顶牌

当 `SrcSeatID` 是己方座位（开发环境放宽为任意座位）时：

1. 若 `pileCount > 0`，将牌堆顶片段同步为牌堆明牌，并定位到牌堆顶。
2. 若 `handCount > 0` 且 `targetSeatID` 不是公共占位座位 `255`，将手牌片段同步为该座位的手牌明牌。

## 同区展示

```text
CardCount: 5
CardIDs: [62, 67, 37, 53, 142]
FromID: 255
FromZone: 1
FromZoneParam: 0
MoveType: 21
SpellID: 987
ToID: 255
ToZone: 1
ToZoneParam: 0
```

`FromZone = 1`、`ToZone = 1` 且两端 ID 都为 `255`，说明来源和目标都是牌堆。
结合 `SpellID = 987/988` 与 `MoveType = 21`，该消息表示原地展示牌堆顶卡牌：

- `CardIDs` 不应被当作随机位置的卡牌。
- 不应把卡牌从牌堆移出后再随机放回。
- 预处理会把 `FromPosition` 和 `ToPosition` 都归一为牌顶。
- 同区展示分支会把对应实体纠正到牌堆顶序列；相同牌组已在顶部时不会重复重排。

### 与权变的差异

| 项目         | 权变 `7011`                         | 观虚 `987` / `988`                                      |
| ------------ | ----------------------------------- | ------------------------------------------------------- |
| 目标通知内容 | 仅牌堆顶 `Params`                   | `Params` 同时含牌堆顶与目标手牌                         |
| 目标座位     | `targetSeatID = 255` 表示公共牌堆   | `targetSeatID` 是被查看手牌的玩家座位                   |
| 移动消息     | 牌堆同区展示                        | 同样是牌堆同区展示；手牌由目标通知单独揭开              |
| 张数守恒     | 只公开已有牌堆实体                  | 若某正 ID 被玩家区实体占用，需用牌堆未知实体置换回牌顶 |

### 玩家区占用身份

若协议声明某正 ID 位于牌堆顶，但本地该 ID 仍被某玩家区实体占用：

1. 优先从牌堆未知实体中取一张接管原玩家槽位，保持牌堆总张数不变。
2. 再把真实身份回收到牌堆顶。
3. 只有牌堆没有可换未知实体时，才退化新建匿名占位。

这样观看 5 张后，牌堆展示仍应是“5 明 + 剩余暗”，而不是多出一张。

## 相关技能

- 权变：docs/protocols/GsCRoleOptTargetNtf-7011.md
- 诫厉：docs/protocols/GsCRoleOptTargetNtf-3483.md（同类 Params 布局，但手牌片段是部分手牌，且后续还有交换区暂存链）

## 代码位置

- 目标通知与牌堆/手牌明牌：`src/handler/GsCRoleOptTargetNtf.js`
- 观虚端点归一化：`src/handler/PubGsCMoveCard.js` 的 `normalizeMovePosition`
- 同区展示识别：`src/tracker/MoveEventNormalizer.ts` 的 `isSameZoneShowEvent`
- 公共区展示与玩家占用身份回收：`src/tracker/runtime/trackerController.ts`
- 回归测试：
  - `tests/tracker/roleOptTargetNtf.test.ts`
  - `tests/tracker/pubGsCMoveCard.test.ts`
  - `tests/tracker/trackerController.test.ts`
