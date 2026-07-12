# `GsCUpdateRoleDataExNtf`：裴秀地图状态更新

## 消息用途

`DataID = 4022` 对应裴秀地图的实时状态更新。消息记录地图 ID、当前位置和已经绘制的
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

## 地图浮窗

初始消息（例如 `[12, 18, 0, 0]`）会创建可拖动的 HTML 地图浮窗。棋盘为
`250 × 250 px`，每个可走格为 `50 × 50 px`；不在 `cell` 中的格子不创建 DOM，
只保留其网格空间。浮窗宽度为 `264 px`，高度由内容自动撑开；额外空间用于地图名称、固定技能描述、
两条预设路线、动态路线和悬停奖励详情。

棋盘背景色为 `rgb(213, 175, 123)`。后续消息会更新当前位置、历史轨迹、动态最优路线，
并保持两条预设路线不变。

## 代码位置

- 消息路由：`src/logic.js`
- 协议解析与路线求解：`src/utils/peixiuRouteFeature.js`
- 地图浮窗：`src/ui/PeiXiuMapWindow.js`
- 地图配置：`src/config/SpellExtendConfig.js`
- 回归测试：`tests/utils/peixiuRouteFeature.test.js`
