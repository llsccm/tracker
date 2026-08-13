# `GsCUpdateRoleDataExNtf`：角色扩展数据更新

## `DataID = 8`：OPT_DATA_ADD_SPELL_EFFECT

该消息是后续 `SpellID=3730` 自动获取所使用目标与技能拥有者的唯一记录来源。
`PubGsCUseSpell(3730)` 不参与目标记录。

```text
DataID: 8
Datas: [3730, 4]
IsSpell: false
SeatID: 2
```

字段语义：

- `SeatID`：本次夺炁目标座位。
- `Datas[0]`：需要更新目标的技能 ID；当前只处理 `3730`。
- `Datas[1]`：夺炁技能拥有者座位。

运行时由 `recordDuoQiRoleDataTarget()` 覆盖 `DuoQiState.activations[3730]`，使后续无
`CardIDs` 的弃牌堆与目标手牌移动按新的目标选择初始牌实体。

## `DataID = 4022`：裴秀地图状态更新

消息记录地图 ID、当前位置和已经绘制的
移动轨迹，可用于恢复当前地图状态并计算从当前位置开始的剩余最优路径。

仅处理 `SeatID === Game.myID` 的己方消息。

## 数据结构

```text
Datas: [mapID, currentCell, historyCount, ...historyCells, 0]
```

|               位置 | 字段           | 含义                          |
| -----------------: | -------------- | ----------------------------- |
|                `0` | `mapID`        | 地图 ID，对应 `PXcell.cellID` |
|                `1` | `currentCell`  | 当前所在格子                  |
|                `2` | `historyCount` | 后续历史轨迹包含的格子数量    |
|             `3...` | `historyCells` | 按经过顺序记录的历史格子      |
| `3 + historyCount` | 截止符         | 固定为 `0`，表示本段数据结束  |

`historyCount` 是历史轨迹的格子数量，不是使用卡牌或主动移动的次数。强制移动经过的格子也会
写入历史轨迹。例如从 `24` 触发 `24,3,1,2` 后向左移动两格，轨迹会追加 `23,22`。

## 已观测样例

```text
Datas: [12, 18, 0, 0]
data_count: 4

Datas: [12, 19, 1, 19, 0]
Datas: [12, 14, 2, 19, 14, 0]
Datas: [12, 15, 3, 19, 14, 15, 0]
Datas: [12, 14, 3, 19, 14, 15, 0]
Datas: [12, 24, 4, 19, 14, 15, 24, 0]
Datas: [12, 22, 6, 19, 14, 15, 24, 23, 22, 0]
Datas: [12, 7, 9, 19, 14, 15, 24, 23, 22, 17, 12, 7, 0]
```

最后一条消息可拆解为：

```text
mapID: 12
currentCell: 7
historyCount: 9
historyCells: [19, 14, 15, 24, 23, 22, 17, 12, 7]
terminator: 0
```

## 最优路径计算

1. 使用 `mapID` 从 `SpellExtendConfig.PeiXiuCellDic` 取得地图配置。
2. 使用 `currentCell` 作为本次求解起点。
3. 将 `historyCells` 作为已经经过并领取奖励的格子。
4. 地图自身奖励位置标识 `26` 不参与路线目标。
5. 对剩余奖励格执行广度优先搜索，优先选择取得全部剩余奖励且移动次数最少的路线。
6. 若无法取得全部奖励，则选择取得奖励数量最多、移动次数更少的路线。

历史轨迹中的奖励格按“经过即获得”处理。效果 1（摸牌）和效果 2（回复体力）不改变地图转移；
效果 3 会按配置的方向和距离产生强制移动。

## 运行时状态

解析和求解结果保存到：

```js
Game.getSpellState(4022)
```

状态结构如下：

```js
{
  mapId,
  currentCell,
  historyCount,
  historyCells,
  presetRoutes,
  result: {
    map,
    solution,
    complete
  }
}
```

`presetRoutes` 在首次收到当前地图消息时计算并固定，包含按移动步数排序的两条完整奖励路线。
`result.solution` 则随每条 4022 消息重新计算，表示从当前位置开始的动态最优路线。

地图配置尚未加载时仍保存协议字段，并将 `result` 设为 `null`。

## `DataID = 3544`：巧织暗取牌

巧织的 `PubGsCMoveCard` 在非主视角只提供暗取数量，实际获得的牌面通过角色扩展数据通知补充。
通知只在目标不是当前主视角时消费，避免与主视角移动协议中已经携带的正 `CardIDs` 重复同步。

### 数据结构

```text
Datas: [cardID, 0]
```

| 位置 | 字段 | 含义 |
| ---: | --- | --- |
| `0` | `cardID` | 巧织暗取到的牌 ID |
| `1` | 截止符 | 固定为 `0`，表示本条数据结束 |

处理入口为 `src/handler/skills/QiaoZhi.js` 的
`handleQiaoZhi()`。它将 `cardID` 作为已知身份物化到 `SeatID` 的普通手牌，
但不再次增加手牌总数；暗取数量已经由前置移动消息记录。

## `DataID = 3709`：诡伏获得牌

诡伏会从摸牌堆或弃牌堆随机获得牌。主视角的 `PubGsCMoveCard` 已经携带实际 `CardIDs`，沿用普通移动同步，不需要处理这条角色数据。

其他视角获得牌时，移动消息可能只有数量：

```text
CardCount: 1
CardIDs: []
FromID: 255
FromPosition: 65282
FromZone: 2
MoveType: 18
SpellID: 3709
ToID: 2
ToPosition: 65280
ToZone: 5
```

随后到达的 `GsCUpdateRoleDataExNtf` 才提供实际牌面。`Datas` 的格式是首项数量，后面紧跟对应数量的 CardID，末尾可以有补位零。该列表是当前仍因 3709 获得并持有的全部牌；后续消息会把新获得的 ID 放在前面，并在尾部保留仍持有的旧 ID：

```text
Datas: [1, 132, 0, 0, 0, 0]
Datas: [2, 2, 132, 0, 0, 0, 0]
```

非主视角的弃牌堆路径按两阶段结算：

- 移动消息只增加目标手牌数量，并创建 `CardCount` 个匿名手牌占位。弃牌堆的实体、顺序、数量和牌堆身份账本均保持不变。
- 匿名手牌只保留一个小型 FIFO，记录座位、实体引用和来源事件，用于核对相邻消息并在积压或乱序时告警。
- 角色数据先与该座位的上次当前快照比较，只处理尚未确认的新增 `CardID`；已经进入弃牌堆等公共区的旧牌会从匹配快照中移除。快照缩短或顺序变化本身不视为异常，旧牌的删除由通用移动处理。弃牌堆路径确认新增 `CardIDs` 都是当前弃牌堆中的已知实体后，先退役对应匿名手牌，再以 `handMoveCount: 0` 执行正常的 `discard -> player.hand` 明牌移动；牌堆路径没有 pending 记录，则回退为普通明牌同步。因此弃牌堆只在确认具体身份时减少，目标手牌总数不会重复增加，身份账本也只提交一次真实移动。
- 主视角不重复消费角色数据，避免与移动消息中的真实 `CardIDs` 重复同步。

前置移动与角色数据的 FIFO 座位不符，或弃牌堆 pending 的实际身份无法精确定位时，不消费 FIFO 并告警。重复收到同一当前快照或只删除旧牌是空操作；缺少待结算记录时，兼容回退只同步当前快照的新增 `CardID`，以兼容牌堆获得和回放缺失前置移动的场景。

处理入口为 `src/handler/skills/GuiFu.js`；结算入口为 `TrackerController.settleTrackerPendingDiscardGain()`，缺少待结算记录时才使用 `TrackerController.revealTrackerCards()` 回退。

## 地图浮窗

初始消息（例如 `[12, 18, 0, 0]`）会创建可拖动的 HTML 地图浮窗。棋盘为
`250 × 250 px`，每个可走格为 `50 × 50 px`；不在 `cell` 中的格子不创建 DOM，
只保留其网格空间。浮窗宽度为 `264 px`，高度由内容自动撑开；额外空间用于地图名称、固定技能描述、
两条预设路线、动态路线和悬停奖励详情。

棋盘背景色为 `rgb(213, 175, 123)`。后续消息会更新当前位置、历史轨迹、动态最优路线，
并保持两条预设路线不变。

## 代码位置

- 消息路由：`src/logic.js`
- 3544 处理：`src/handler/skills/QiaoZhi.js`
- 3709 处理：`src/handler/skills/GuiFu.js`
- 协议解析与路线求解：`src/utils/peixiuRouteFeature.js`
- 地图浮窗：`src/ui/PeiXiuMapWindow.js`
- 地图配置：`src/config/SpellExtendConfig.js`
- 回归测试：`tests/utils/peixiuRouteFeature.test.js`
