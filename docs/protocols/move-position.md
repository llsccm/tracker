# `PubGsCMoveCard`：公共区目标位置

## 字段流转

`RawMoveCardEvent.FromPosition` 与 `RawMoveCardEvent.ToPosition` 均为必填数字字段。
原始协议使用数值哨兵或槽位；内部公共区 API 与候选模型使用的 `top` / `bottom` / `random` /
`any` 等语义字符串不属于协议契约，不能复用 `PublicPosition` 声明原始位置字段。
入口 `raw` 快照原样保留位置值，不做字符串转换，也不把缺失位置补成牌底 `0`；已知特例只修改 `patched`。

`RawMoveCardEvent.ToPosition` 是移动协议的通用目标位置字段，不绑定任何技能：

1. `src/handler/PubGsCMoveCard.js` 只在已知协议特例中修正该值，并把最终值交给 tracker。
2. `src/tracker/protocol/MoveEventNormalizer.ts` 将其保留为 `MoveOptions.position`。
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

## 回堆位置与身份

是否随机入堆只看修正后的目标位置，不看来源位置，也不以 CardIDs 是否为空判断：

| 场景 | 来源位置 | 目标位置 | 处理 |
| --- | --- | --- | --- |
| 思泣 3543：弃牌 17 回堆 | 65282 | 0 | 明确回到牌底，保留已知身份 |
| 兴学 743：手牌回堆，CardIDs 为空 | 65282 | 65280 | 明确回到牌顶；身份按已有来源信息和候选逻辑处理 |
| 浑天仪 3694：外部牌加入 | 不影响目标语义 | 特殊值经入口修正为 65282 | 随机入堆，实体匿名化 |
| 手气卡：手牌重新混入 | 不影响目标语义 | 经入口修正为 65282 | 随机入堆，实体匿名化 |

位置特例统一由 src/tracker/protocol/protocolRules.ts 的 normalizeTrackerMovePosition 修正；
Controller 接收修正后的 patched 协议以及只读 raw 快照。直接调用 Controller 的测试也应遵守
这一边界。FromZone=0 的外部来源由通用区域映射处理，浑天仪和手气卡无需在
decorateGenericMove 中重复设置来源、位置或匿名化开关。

RoomMovement.anonymizeRandomPileReturn 在实际移动后统一处理随机入堆实体，包括显式 CardIDs
以及无 CardIDs 但取到已知来源实体的移动。身份退回 cohort，物理槽变为负 ID；不会因本地
代表顺序而被误认成牌顶明牌。牌顶、牌底和精确插槽不触发这条规则，CardIDs 为空也不会凭空
获得已知身份。未移动的牌堆实体与相对顺序保持不变。

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
