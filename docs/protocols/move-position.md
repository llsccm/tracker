# `PubGsCMoveCard`：公共区目标位置

## 字段流转

`RawMoveCardEvent.ToPosition` 是移动协议的通用目标位置字段，不绑定任何技能：

1. `src/handler/PubGsCMoveCard.js` 只在已知协议特例中修正该值，并把最终值交给 tracker。
2. `src/tracker/MoveEventNormalizer.ts` 将其保留为 `MoveOptions.position`。
3. `Room.moveCards()` 最终把该位置交给公共 `Zone.add()`。

移动协议输入摘要同时保留原始 `ToPosition`，便于核对预处理前后的字段值。

## 数值语义

公共 `Zone` 内部顺序统一为底 -> 顶。目标位置按以下规则解释：

| 值                              | 语义                                           |
| ------------------------------- | ---------------------------------------------- |
| `POSITION_BOTTOM = 0`           | 牌底；同时也是从牌底起算的零基插槽 `0`        |
| 普通非负小整数                  | 从目标区域牌底起算的零基精确插槽               |
| `POSITION_TOP = 65280`          | 牌顶；解析为当前区域张数对应的末端插槽         |
| `POSITION_RANDOM = 65282`       | 随机/无序，不能把本地代表顺序解释为协议事实    |
| 缺失、负数、非整数或当前区越界 | 无可复现精确插槽，沿用对应移动路径的保守降级值 |

批量插入普通数值槽位时，输入数组使用与 `POSITION_BOTTOM` 相同的批次方向；通用实现位于
`src/tracker/candidate/cardPositions.ts` 的 `insertCardsAtProtocolPosition()`，公共区和需要维护
逻辑有序桶的技能都应复用它，不能各自重新解释 `ToPosition`。

## 观虚示例

```text
CardCount: 1
CardIDs: [39]
FromID: 3
FromZone: 10
MoveType: 11
SpellID: 987
ToID: 7
ToPosition: 2
ToZone: 10
```

`ToPosition=2` 表示目标有序桶从底部起算的第 3 个插槽。观虚的物理 `exchange(10)` 同时承载
牌堆侧和手牌侧，无法直接用全局区顺序表达两个桶；`GuanXu` 只负责维护这层逻辑分桶，桶内仍
使用通用的底 -> 顶顺序和位置插入函数。
