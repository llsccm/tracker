# `CGsRoleSpellOptRep`：技能操作回复

## 消息用途

`CGsRoleSpellOptRep` 携带技能操作结果。`Datas` 的具体语义由 `SpellID` 和 `Type`
共同决定，不能脱离技能上下文统一解释。

当前已确认的消息包括：

| `SpellID` | `Type` | 技能 | `Datas` 语义            |
| --------: | -----: | ---- | ----------------------- |
|    `7009` |   `30` | 鹰视 | 本次看到的牌堆顶卡牌 ID |
|    `4021` |      - | 裴秀 | 地图 ID 和起始格        |

## 鹰视：观看牌堆顶

### 消息示例

```text
className: "CGsRoleSpellOptRep"
SpellID: 7009
Type: 30
SeatID: 2
Datas: [158, 2, 63, 125]
data_count: 4
```

字段说明：

| 字段         |                示例 | 含义                                  |
| ------------ | ------------------: | ------------------------------------- |
| `SpellID`    |              `7009` | 鹰视                                  |
| `Type`       |                `30` | 鹰视返回牌堆顶观看结果                |
| `SeatID`     |                 `2` | 执行技能的座位 ID；不作为卡牌所属区域 |
| `Datas`      | `[158, 2, 63, 125]` | 本次看到的牌堆顶卡牌 ID               |
| `data_count` |                 `4` | `Datas` 的元素数量                    |

`Datas` 按牌堆顶向内排列，第一项是最顶牌；本例中 `158` 位于牌堆顶。

处理时将 `Datas` 作为牌堆可见牌同步给记牌器，并将对应实体定位到牌堆顶。牌仍位于
牌堆，不会被移动到玩家区域；相同牌组已经位于牌堆顶时，重复消息不会再次重排。

代码位置：

- 消息路由：`src/logic.js`
- 鹰视协议处理：`src/handler/CGsRoleSpellOptRep.js`
- 牌堆明牌同步：`src/tracker/runtime/trackerController.ts` 的 `revealTrackerCardsInZone`

## 裴秀：地图选择回复

`SpellID = 4021` 对应裴秀的地图技能回复。己方收到该消息后，可根据 `Datas`
取得本局地图 ID 和起始格，并从 `SpellExtendConfig.PeiXiuCellDic` 读取地图配置。

## 技能消息示例

```text
className: "CGsRoleSpellOptRep"
SpellID: 4021
SeatID: <裴秀的座位 ID>
Datas: [12, 18]
data_count: 2
```

`Datas[0] = 12` 表示地图 ID，对应 `PXcell.cellID = '12'`；`Datas[1] = 18`
表示本次地图的起始格。仅当 `SeatID === Game.myID` 时，需要为己方绘制裴秀地图。

## `PXcell` 配置示例

```js
{
  cellID: '12',
  name: '雍州',
  cell: '1,6,7,12,14,15,17,18,19,22,23,24',
  precell: '18',
  spcell: '24,3,1,2|15,1,2|17,1,1|7,2,1',
  reward: '26,73|7,54|15,52|17,53|24,51'
}
```

| 字段      | 含义                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------- |
| `cellID`  | 地图 ID；与 `Datas[0]` 对应                                                                         |
| `name`    | 地图名称                                                                                            |
| `cell`    | 地图包含的格子 ID，以逗号分隔                                                                       |
| `precell` | 配置中的默认起始格；本例与 `Datas[1]` 均为 `18`                                                     |
| `spcell`  | 特殊格配置，各项以竖线分隔，项内依次为格子 ID、效果和效果参数                                       |
| `reward`  | 奖励配置，各项以竖线分隔，项内依次为奖励位置标识、奖励 ID；位置 `26` 表示 `cell` 自身拥有的奖励技能 |

`spcell` 中的 `24,3,1,2` 表示到达格子 `24` 后触发 3 号效果，并按方向 `1`
（红桃、向左）强制移动 `2` 格，即依次经过 `23`、`22`，最终停在格子 `22`。

本例的奖励映射如下：

| 奖励位置 | 奖励 ID | 含义                       |
| -------: | ------: | -------------------------- |
|     `26` |    `73` | `cell` 自身拥有的奖励技能  |
|      `7` |    `54` | 到达格子 `7` 时对应的奖励  |
|     `15` |    `52` | 到达格子 `15` 时对应的奖励 |
|     `17` |    `53` | 到达格子 `17` 时对应的奖励 |
|     `24` |    `51` | 到达格子 `24` 时对应的奖励 |

`26` 并非地图格子，因此不会出现在 `cell` 列表中，也不应作为路线中的普通奖励格处理。

## `PXreward` 配置示例

```js
{
  ID: 73,
  name: '雍州',
  desc: '你可以摸两张牌，然后将手牌弃至手牌上限。'
}
```

奖励 ID `73` 对应 `reward` 中的 `26,73`，表示雍州 `cell` 自身拥有的奖励技能，可通过
`SpellExtendConfig.PeiXiuBonus.get(73)` 取得完整奖励信息。

## 配置读取示例

```js
const spellExtendConfig = SpellExtendConfig.GetInstance()
const [mapID, startCell] = Datas
const mapConfig = spellExtendConfig.PeiXiuCellDic.get(Number(mapID))
const reward = spellExtendConfig.PeiXiuBonus.get(73)
```

## 代码位置

- 消息路由及裴秀分支：`src/logic.js`
- 配置加载：`src/config/ConfigManager.js`
- 配置索引：`src/config/SpellExtendConfig.js`
- 地图配置解析与路线计算：`src/utils/peixiuRouteFeature.js`
