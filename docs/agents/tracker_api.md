# 记牌器开发 API 速查

> 当你需要新增协议/技能、调整记牌器状态，或在测试中快速完成“读取手牌、揭示牌面、移动/补建实体”时按需阅读。
> 本文只列稳定的公开入口和少量必要低层原语；Room 状态所有权与行为模块边界见
> [`room.md`](room.md)，领域设计背景见 [`card_tracker.md`](card_tracker.md)，
> Card/Player/Zone 模型字段与不变量见 [`card_player_model.md`](card_player_model.md)，
> 匿名牌堆、cohort、物化与 suspended 的完整模型见
> [`card_tracker_anonymous_pile.md`](card_tracker_anonymous_pile.md)，生命周期见 [`lifecycle.md`](lifecycle.md)。

## 先选入口

浏览器运行时通常从 Controller 开始：

```ts
import { tracker } from '@/tracker/runtime/browser'

const room = tracker.getReadyTrackerRoom()
if (!room) return
```

测试需要隔离状态时，优先使用 `tests/tracker/helpers/room.ts` 的 `createTestRoom()`，不要在每个用例里
手写 Room、玩家和牌堆初始化。

| 目标 | 首选入口 | 说明 |
| --- | --- | --- |
| 消费真实协议移动 | `tracker.syncTrackerMove(msg, finalMove)` | 负责补字段、归一化并交给 `Room`；不要在 handler 中直接改牌。 |
| 读取当前局 | `tracker.getReadyTrackerRoom()` | 未开局、已销毁、断线状态或牌堆未就绪时返回 `null`。 |
| 写入技能确认的明牌 | `tracker.revealTrackerCards(target, cardIDs)` | 统一处理玩家区/公共区、物化和索引。 |
| 按旧协议 Zone 写入明牌 | `tracker.revealTrackerCardsInZone(protocolZone, cardIDs)` | 先做 Zone 映射，再复用上面的明牌路径。 |
| 直接编排测试或已归一化移动 | `room.moveCards(cardIDs, toZone, options)` | 所有普通移动的 Room 级主入口。 |

## 协议 CardID 输入约定

技能/协议模块消费消息中的 `cardIDs` 时，统一用 `getPositiveIDs()` 归一化
（定义于 `src/tracker/helper/cardIDs.ts`，经 `src/tracker/skill/moveEventUtils.ts`
重导出）：

- 丢弃 `0`、负数与 NaN，得到去重后的正数列表，并保留每个 ID 首次出现的顺序。
- 结果不保证稳定排序；需要稳定排序的调用方应在返回结果上显式排序。
- 上游协议约定 CardID 均为有限正整数，因此只按 `id > 0` 过滤，不逐项做
  `Number.isFinite` 判断（NaN 已由 `Number(id) || 0` 归一化为 `0` 丢弃）。若未来
  协议出现非有限 ID，应在协议入口统一拦截，而不是在消费热路径承担防御成本。
- `0` 仅表示匿名占位、不是稳定身份（见“只有数量、没有 CardID 的暗牌”），
  不要把 `0` 写入 `Card.id`。

## 获取某个角色的手牌

先确定你要的是“牌实体”“身份 ID”“候选可能性”还是“数量”。这些入口不能互相替代：

| 需求 | 调用方式 | 返回/语义 | 适合场景 |
| --- | --- | --- | --- |
| 确定归属的已知手牌实体 | `room.getPlayer(seatID)?.knownHandCards` | `Card[]`；只包含确定在该角色普通手牌中的明牌 | 视图、技能逻辑、需要继续调用 `Card` 方法 |
| 仍可能在该角色手牌中的已知牌 | `room.getPlayer(seatID)?.candidateHandCards` | `Card[]`；身份已知，但位置仍是手牌候选/模糊位置 | 候选展示、约束诊断 |
| 所有物理手牌实体（含匿名暗牌） | `room.getPlayer(seatID)?.cards.filter((card) => card.subZone === 'hand')` | `Card[]`；按 `Player.cards` 的动态关系读取 | 需要把匿名槽也纳入一次性归组；不要放在高频渲染循环 |
| 只要确定正 ID | `room.getPlayerHandCardIDs(seatID)` | `number[]`；默认 `knownOnly: true`、`includeCandidates: false`，只返回 `id > 0` | 协议兼容、旧 handler、低频查询 |
| 包含候选手牌的正 ID | `room.getPlayerHandCardIDs(seatID, { includeCandidates: true })` | `number[]`；仍只返回正 ID | 需要把模糊明牌也列入 ID 集合 |
| 放宽 `isKnown` 过滤 | `room.getPlayerHandCardIDs(seatID, { knownOnly: false, includeCandidates: true })` | `number[]`；匿名实体仍会因负 ID 被过滤 | 只在确实需要“已出现身份”集合时使用 |
| 高频读取的增量投影 | `room.locationIndex.knownHandBySeat.get(seatID) ?? []` | `Card[]`；索引维护的确定手牌桶 | 视图/高频派生计算；只读，不要直接修改数组 |
| 高频读取手牌候选投影 | `room.locationIndex.candidateHandBySeat.get(seatID) ?? []` | `Card[]`；索引维护的候选手牌桶 | 候选按钮或局部重绘 |
| 一致的全玩家区快照 | `room.refreshPlayerSnapshot()` | 所有 `location === 'player'` 的 `Card[]` | 一次性批处理；返回后再按座位/子区归组 |

### 计数与“已知”不要混淆

- `player.observedHandCount` 是协议或移动事件给出的手牌总数，不是从现有 `Card` 反推的结果。
- `player.unknownCardCount` 是收敛后仍需要匿名槽覆盖的数量。
- `player.getKnownHandSlotCount()` 和 `player.getCandidateHandSlotCount()` 返回的是占用槽位数，不是
  `Card[]` 长度；候选分组可能一张实体占用多个逻辑槽位。
- `knownHandCards`、`candidateHandCards` 和 `locationIndex` 会在 `resolveConstraints()` 后同步。刚调用底层
  `bindCandidates()` 后若要立即读取稳定投影，应显式调用 `room.resolveConstraints()`。
- `room.getPlayer(seatID)` 在座位尚未注册时实际可能返回 `undefined`，调用方应保留可选链/判空。

## 往角色手牌中加入卡牌

### 协议/技能路径（推荐）

已经有真实 CardID、并且消息语义是“明牌进入玩家区”时，调用 Controller：

```ts
tracker.revealTrackerCards(
  {
    type: 'player',
    seatID,
    subZone: 'hand',
    fromZone: 'pile',
    handMoveCount: ids.length
  },
  ids
)
```

若消息是“整手快照”而不是新增摸牌，应让来源仍是同一玩家，并避免再次增加总数：

```ts
tracker.revealTrackerCards(
  {
    type: 'player',
    seatID,
    subZone: 'hand',
    fullHand: true,
    handCount,
    handMoveCount: 0
  },
  fullHandCardIDs
)
```

普通协议消息不应手工拼上面这段语义，而应把原始消息交给
`tracker.syncTrackerMove(msg, finalMove)`；Controller 会根据来源区、`CardIDs`、`cardCount` 和
`handMoveCount` 选择已知牌与匿名牌路径。

### 直接编排 Room 移动（测试或已经归一化的内部路径）

```ts
room.moveCards(ids, 'player', {
  seatID,
  subZone: 'hand',
  fromZone: 'pile',
  cardCount: ids.length,
  handMoveCount: ids.length,
  sourceEvent: { type: 'example' }
})
```

`cardCount` 表示这次移动需要覆盖的物理牌数；`handMoveCount` 表示协议手牌总数的变化量。候选身份只
移动逻辑账本、不移动物理实体时，两者可以不同。

### 只有数量、没有 CardID 的暗牌

用长度表示未知牌，`0` 只是“匿名牌输入”，不是稳定身份：

```ts
room.moveCards(Array.from({ length: count }, () => 0), 'player', {
  seatID,
  subZone: 'hand',
  fromZone: 'pile',
  cardCount: count,
  handMoveCount: count
})
```

Room 会从来源端点取现有匿名实体；来源不足时才补建匿名占位，并通过约束收敛到目标座位。不要把
`0` 写入 `Card.id`，也不要直接向 `room.cards`、`player.knownHandCards` 或 `locationIndex` 的桶数组
`push`。

### 测试中的低层补建

只在测试夹具或确实代表“游戏外新实体”时使用：

```ts
const [placeholder] = room.createExternalCards([], 1)
placeholder.bindCandidates([seatID], 'hand', null, { known: false })
room.resolveConstraints()
```

`createExternalCards()` 创建的正 ID 默认仍是 `isKnown: false`；需要公开身份时优先走
`room.materialize(cardID, target)` 或 `tracker.revealTrackerCards()`，不要为已存在的身份再次
`createExternalCards([cardID])`，否则会产生重复实体。

## 手牌揭示

### 已知 ID 揭示到玩家区

公开入口是 `tracker.revealTrackerCards()`：

```ts
tracker.revealTrackerCards(
  { type: 'player', seatID, subZone: 'hand', fromZone: 'pile' },
  cardIDs
)
```

- `type: 'player'` 必须带有效 `seatID`；`255` 表示无席位技能空间，不应当成角色座位。
- `subZone` 可为 `hand`、`equip`、`judge` 或 `mark`；`mark` 通常还要带 `spellID`。
- `fullHand: true` + `handCount` 表示这是整手快照，Controller 会先同步总数，再解析已知牌；部分揭示不要
  误加 `fullHand`。
- `fromSeatID`/`fromSubZone` 用于“从另一名角色或标记区取牌”；来源未知时不要猜成 `pile`，让
  `syncTrackerMove()` 根据协议归一化。

### 从旧协议 Zone 揭示

协议已经提供 `zone/id/pos` 时直接使用适配入口：

```ts
tracker.revealTrackerCardsInZone(
  { zone: 1, id: 255 },
  cardIDs
)
```

玩家区 Zone 会映射为 `type: 'player'`；公共区 Zone 会映射为 `type: 'public'`。牌堆 Zone（协议 `zone: 1`）
在未给 `pos` 时按“数组第一项是牌顶”解释，并可重新定位牌堆端点；不要把该数组顺序当作所有协议的通用
顺序。

## 牌堆/公共区揭示

### 按具体端点揭示

```ts
tracker.revealTrackerCards(
  {
    type: 'public',
    zoneName: 'pile',
    position: 'top',
    reposition: true,
    // 外部数组按牌顶 -> 牌底排列时设置为 true。
    cardIDsTopFirst: true
  },
  cardIDs
)
```

`reposition` 只在协议确实给出端点事实时开启；普通公共区明牌不要为了“看起来顺序一致”强行重排。
牌堆端点返回值可用：

```ts
const topFirst = room.getPublicEndpointCards('pile', count, 'top')
const bottomFirst = room.getPublicEndpointCards('pile', count, 'bottom')
```

`room.zones.get('pile')?.cards` 的内部顺序是牌底到牌顶；`getPublicEndpointCards()` 返回始终是端点向内。

### 只知道范围、不知道具体槽位

这类“牌堆顶前 N 张”揭示应保留候选，不要调用 `Zone.add()` 重排牌堆。优先让归一化移动带上：

```ts
publicCandidateReveal: { zone: 'pile', position: 'top', count: N }
```

该字段由 `TrackerController.syncTrackerMove()` 的归一化事件路径消费；不要直接调用 `room.moveCards()` 并
期待它单独完成范围揭示。技能已有专用 decorator 时，跟随对应技能模块，不要绕过 Controller 自己写
`locationCandidates`。

## 读取与修改公共区

- 读取某区实体：`room.getPublicZone('discard').cards`。
- 读取某区正 ID：`room.publicZones.getPublicZoneCardIDs('discard')`；牌堆快捷入口是
  `room.publicZones.getPileCardIDs()`。
- 读取某张牌的位置摘要：`room.publicZones.getCardLocationInfo(cardID)`。
- 普通移动：`room.moveCards()`；它会处理来源端点、匿名槽、候选传播、约束和索引。
- 只有整区初始化/洗牌才使用 `zone.replaceAll(cards)`；低层 `zone.add(cards, position)` 只适合已知的
  单区落点测试。不要用 `zone.add()` 代替协议移动，否则可能漏掉身份账本和手牌总数变化。

## 身份与候选低层原语

| 原语 | 用途 | 注意 |
| --- | --- | --- |
| `room.findCardsByIDs(ids)` | 从 `cardIndex` 找现有实体 | 找不到不会自动创建。 |
| `room.materialize(cardID, target?)` | 将真实身份绑定到匿名槽 | 保留目标槽的位置/候选；公共区正 ID 不能覆盖其它正 ID 实体。 |
| `card.confirmKnown()` | 标记物理牌面已公开 | 不负责移动到目标区。 |
| `card.bindTo(seats, subZone, spellID?)` | 绑定确定玩家/子区并默认明牌 | 适合低层夹具；生产协议优先用 `moveCards`/Controller。 |
| `card.bindCandidates(seats, subZone, spellID?, { known: false })` | 建立隐藏或模糊候选 | 调用后通常要 `room.resolveConstraints()`。 |
| `card.setLocationCandidates(candidates, reason)` | 替换完整位置候选 | 技能/候选模块专用；普通 handler 不应直接维护。 |

匿名牌的 `id/entityID` 使用稳定负数；`isKnown` 与真实身份是两件事。正 ID 不自动代表“已对所有视角公开”。

## 变更后的收尾

1. 让 Controller/Room 完成一次收敛后再读取 `knownHandCards` 或 `locationIndex`。
2. 新增 `Room.moveCards()` 路线时补 `tests/tracker/` 回归，并评估遍历基线。
3. 只改文档无需构建；改动源码时按 [`testing.md`](testing.md) 选择 `pnpm test:tracker`、类型检查、lint 和 build。

## 快速检索

先用 `rg` 找候选符号，再用 Serena 做符号级读取/引用追踪；只有二者不适合或不可用时才退回 PowerShell：

```text
rg -n "getPositiveIDs|getPlayerHandCardIDs|knownHandCards|candidateHandCards" src tests
rg -n "revealTrackerCards|revealTrackerCardsInZone|moveCards" src tests
```

核心源码入口：`src/tracker/Room.ts`、`src/tracker/Player.ts`、`src/tracker/Card.ts`、
`src/tracker/Zone.ts`、`src/tracker/runtime/trackerController.ts`、`src/tracker/roomPublicZones.ts`。
