# `SpellID=361`：下书展示与明暗选择

## 消息链

下书由三类消息共同表达，不能只看其中一条：

1. `GsCRoleOptTargetNtf` 给出本次展示的手牌 ID 和目标座位，技能层在这里记录明暗分组依据。
2. `PubGsCMoveCard` 以手牌同区展示把这些牌同步为目标手牌明牌。
3. `CGsRoleSpellOptRep` 的 `Datas[0]` 表示发动者选择取展示牌还是暗牌。

## 展示牌通知

```text
Param: 0
Params: [108, 131, 49, 54, 78]
SeatID: 1
SpellID: 361
SrcSeatID: 1
targetSeatID: 4
Timeout: 30
Type: 29
className: "GsCRoleOptTargetNtf"
```

`SeatID` 与 `SrcSeatID` 都是发动者座位；被展示手牌的角色由 `targetSeatID` 明确给出。
`handleXiaShuTargetNotice()` 只接受 `Param=0`、`Type=29` 且 `Params` 为数组的通知；它会将牌 ID
转为数字并过滤非正值，不对重复 ID 做静默去重，重复值应视为上游游戏异常。规范化后的列表为空，
或 `targetSeatID` 转换后不是整数、等于 `255` 时会拒绝该通知；否则记录规范化后的
`{ targetSeatID, shownCardIDs }`，不再从配对移动或当前卡牌候选反推目标。该通知不直接同步卡牌，
避免与随后必到的手牌同区展示重复处理。

## 配对的手牌同区展示

```text
CardCount: 5
CardIDs: [108, 131, 49, 54, 78]
FromID: 4
FromPosition: 65280
FromZone: 5
FromZoneParam: 0
MoveType: 21
SpellID: 361
ToID: 4
ToPosition: 65280
ToZone: 5
ToZoneParam: 0
```

该消息负责确认：

- `FromID=ToID=4`：牌仍位于同一目标角色手中。
- `CardIDs`：本次展示的明牌列表。
- `FromZone=ToZone=5`、`MoveType=21`：仅展示，不改变物理归属。

该移动完全交给通用 `showCards` 分支同步明牌；技能层不在这里重复保存状态或实现展示移动。

## 选择回复

```text
Datas: [2, 1]
SeatID: 1
SpellID: 361
Type: 22
className: "CGsRoleSpellOptRep"
```

只处理最终的两项回复（`data_count=2`；字段缺失时以 `Datas.length=2` 兼容）：

| `Datas[0]` | 语义 | 记牌器处理 |
| ----------: | ---- | ---------- |
| `1` | 取展示牌 | 后续已知牌移动由通用框架处理 |
| `2` | 取暗牌 | 通用随机转移后，零增量确认展示牌仍在原目标并触发数量收敛 |

实测 `CGsRoleSpellOptRep` 固定早于随后执行取牌的 `PubGsCMoveCard` 到达。因此选择处理器只记录
`choice/actorSeatID`，不立即改变卡牌；后续移动完成回调是唯一结算点。选择暗牌时，通用随机转移先
建立“原目标剩余 N-K 张、发动者获得 K 张”的约束并同步双方手牌数；技能层随后以
`handMoveCount=0` 把展示牌确认在原目标手中。若展示牌正好填满原目标的剩余手牌槽，通用数量约束
会删除其它牌的原目标手牌分支：确定暗牌落定到发动者，候选槽获得发动者分支并保留原有的其它候选
位置。下书无需快照、删除或重建既有 `ConstraintGroup`。

## 代码入口

- 展示与移动状态：`src/handler/skills/XiaShu.js`
- 移动前后副作用：`src/handler/PubGsCMoveCard.js`、`src/handler/spellEffects.js`
- 选择回复：`src/handler/CGsRoleSpellOptRep.js`
- 回归：`tests/tracker/xiaShu.test.ts`
- 录像回放：`tests/replay/tracker/helpers/protocolReplay/handlers.ts`、`tests/replay/tracker/protocolReplay.test.ts`
