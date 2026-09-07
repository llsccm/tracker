# 焚巢（SpellID=3752）：从弃牌堆获得牌

## 协议样例

```json
{
  "CardCount": 2,
  "CardIDs": [],
  "FromID": 255,
  "FromPosition": 65282,
  "FromZone": 2,
  "FromZoneParam": 0,
  "MoveType": 18,
  "SpellID": 3752,
  "ToID": 7,
  "ToPosition": 65280,
  "ToZone": 5,
  "ToZoneParam": 0
}
```

`FromZone=2` 表示弃牌堆，`FromID=255` 是公共区占位；`ToZone=5`、`ToID=7` 表示进入座位 7
的手牌。`MoveType=18` 为获得，`FromPosition=65282` 表示协议未给出精确来源位置。

## 当前推断规则

根据实测获得结果反推，焚巢从当前弃牌堆中优先获得**最早进入弃牌堆**的以下牌：

- 杀，包括火杀、雷杀、冰杀。
- 决斗、南蛮入侵、万箭齐发、火攻。

所有符合条件的牌共用入堆顺序，不按牌名设优先级，也不限制每种牌只取一张。获得张数以
`CardCount` 为准；牌离开弃牌堆后再次进入时，按重新入堆的顺序处理。

运行时 `Card.name` 已经由 `CardConfig` 归一化，南蛮入侵、万箭齐发分别为 `南蛮`、`万箭`。
弃牌区数组按底到顶保存，因此正向筛选即可选择最早入堆的牌。

## 适配边界

- 仅处理 `SpellID=3752`、`FromZone=2`、`ToZone=5`、`MoveType=18`、
  `FromPosition=65282`，且 `CardIDs` 没有正 ID 的事件。
- 保留原始 `CardIDs`，通过 `sourceCards` 指定已有弃牌实体，交由通用移动同步手牌数、位置和明牌。
- 协议已给出正 ID 时，以协议为准；无匹配牌时保持默认移动路径。
- 本地可识别的目标牌不足时，复用通用来源补足规则，不重复消费选中实体。这不能保证缺失牌面或
  缺失弃牌历史下的推断准确性。
- 此规则来自当前样例及结果观察，后续有反例时应同步调整筛选规则与回归测试。

## 代码与验证

- 技能装饰：`src/tracker/skill/FenChao.ts` 的 `decorateFenChao`。
- 默认注册：`src/tracker/runtime/moveEventHandlers.ts` 的 `registerDefaultMoveEventHandlers`。
- 回归：`tests/tracker/fenChao.test.ts`。
- 协议索引：[README.md](README.md)。
