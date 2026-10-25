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

| 目标                       | 首选入口                                                  | 说明                                                                                  |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 消费真实协议移动           | `tracker.syncTrackerMove(patched, raw)`                   | 直接消费完整 `patched`，`raw` 只作追溯；不再合并局部补丁，不要在 handler 中直接改牌。 |
| 读取当前局                 | `tracker.getReadyTrackerRoom()`                           | 未开局、已销毁、断线状态或牌堆未就绪时返回 `null`。                                   |
| 写入技能确认的明牌         | `tracker.revealTrackerCards(target, cardIDs)`             | 统一处理玩家区/公共区、物化和索引。                                                   |
| 按协议 Zone 写入明牌       | `tracker.revealTrackerCardsInZone(protocolZone, cardIDs)` | 先做 Zone 映射，再复用上面的明牌路径。                                                |
| 直接编排测试或已归一化移动 | `room.moveCards(cardIDs, toZone, options)`                | 所有普通移动的 Room 级主入口。                                                        |

## PubGsCMoveCard 完整输入契约

交换区技能可用 `room.publicZones.getExchangeBatch(batchKey)` 取得命名视图，`stage(cards)` 登记待入区成员，
`cards` 读取当前物理成员，`candidateCards` 读取逻辑候选，`transferTo(target, cards, position)` 调整批次归属，
结算后调用 `deleteExchangeBatch(batchKey)`。这些 API 不代替 `Room.moveCards()` 的物理移动与身份事务。

数量约束通过 `room.createConstraintGroup({ cards, expectedSlotsByLocation })` 提交：值仅接受数字
或 `{ min, max }`，运行时统一为区间。弹窗位置为 `{ type: 'popup', spaceID }`，不能使用伪座位。
建组入口与 `ConstraintGroup` 共用 `ConstraintGroupOptions`：`cards` 只接受实体数组，
`candidateSeats` 只接受座位数组，分组标识统一用 `id`。不接收 `cardIDs`、`seatID`、
`subZone`、`spellID` 或 `combinationID`；查牌及位置写入在建组前完成，候选座位只作为分组快照。

弹窗入区使用 `room.moveCards(ids, 'popup', { fromZone: 'pile', toPopupSpaceID: 35, cardCount })`；出区使用 `fromZone: 'popup', fromPopupSpaceID: 35` 并明确目标。玩家标记继续使用 `toSeatID/subZone: 'mark'/spellID`，来源空间通过 `fromSpellID` 表达。`414` 标记返回时来源仍为 `414`，不能用动作技能 `3389` 查找标记空间。
巧织暗取通过弹窗与手牌的数量约束保留候选，剩余牌明弃后确认入手身份；角色数据通知不参与揭示，移动自带正 ID 时直接确认。

读取当前确定手牌的获得技能用 `card.gainSpellID`；候选分支用 `card.getHandGainSpellID(seatID)`。
`Room.moveCards()` 的 `gainSpellID` 可显式提供来源，默认从获得协议读取；同座位揭示省略该参数时保留已有来源。
日志分别输出 `spellID` 与获得来源 `gainSpellID`；标记归属以完整位置为准，普通手牌位置不使用 `spellID`。巧织确认入手后为普通手牌，`gainSpellID` 为 `3544`。

`RawMoveCardEvent` 的 12 个核心字段全部必填：

- `CardCount`、`CardIDs`。
- `FromID`、`FromPosition`、`FromZone`、`FromZoneParam`。
- `ToID`、`ToPosition`、`ToZone`、`ToZoneParam`。
- `MoveType`、`SpellID`。

除 `CardIDs` 是只读数字数组外，其余核心字段都是数字；不接受数字字符串、单个 CardID 或
`null` 参数。无技能和无区域参数用 `0` 表示。`CardCount` 是实际移动张数，不能由数组长度回推：
暗牌移动可以是 `CardCount: 2`、`CardIDs: []`。公开数组顺序必须保留。

`FromID/ToID` 的含义取决于区域，`255` 可表示公共区或无座位；不要把它们限制为玩家座位。
位置保留数字语义，例如牌顶 `65280`、随机 `65282`、牌底 `0` 和具体索引；不能把区域、位置或
移动类型限制成少量样例值。
`SrcSeatID`、`Label`、`isSend` 是可选附加信息。

移动入口只提取上述核心字段及 `SrcSeatID`、`Label`、`isSend` 组成只读 `raw`；不携带
`className`、`id`、`DataCount`、`isResume` 等消息信封字段。身份数组独立复制并冻结，再创建
独立的 `patched`。入口过滤不解释技能编码的牌列表；位置归一化只修改两个 Position。
特殊区域、局流及技能处理共享同一份 `patched`，不另存可写的顶层协议字段。所有补丁完成后才检查明暗与数量，沿用异常牌列表清空、协议张数保留的降级策略。
响应器直接读取 `patched`，不预先派生端点字段。最终提交时 Controller 才调用
`normalizeMoveEvent(patched, raw)`；其私有 `normalizeMoveEndpoints()` 只解析一次座位、区域和标记空间。
标准事件的 `protocol` 和 `cardIDs` 直接引用最终 `patched` 及其数组，不再复制或拼接协议。
提交后协议及事件牌列表只读；技能装饰需要变更牌列表时，通过 `patchEvent()` 提供新数组。
未经过补丁的完整消息可单参数调用 `syncTrackerMove(message)`，此时 `raw` 默认就是该消息。
测试简写使用 `tests/tracker/helpers/trackerController.ts` 的 `protocolMove()` 构造完整消息；
覆盖项使用 `Partial<RawMoveCardEvent>`；生产 `PatchedMoveCardFields` 是完整协议，仅 `CardIDs`、
`FromPosition` 和 `ToPosition` 可写，不覆盖数量、区域、端点 ID、区域参数、移动类型、技能 ID 或附加信息。

`NormalizedMoveCardFields` 是完整原始协议的只读视图，`Room.decorateMoveEvent()` 只接受完整
`NormalizedMoveEvent`，不再补造缺失的 `protocol`。领域直调使用已有的
`room.moveCards(cardIDs, toZone, options)`；导入记录的检查留在导入边界。
`moveCards()` 只接收 `readonly CardID[]`，单张牌也传 `[cardID]`；匿名移动传 `[]`，
实际移动张数由 `options.cardCount` 指定，不支持单个数字 ID。Room 不修改传入数组。
移动事件与 `Room.moveCards()` 的目标座位统一使用 `toSeatID`，与 `fromSeatID` 对称；
公共区目标不设置 `toSeatID`，不把协议占位 `255` 当成玩家。移动参数不兼容旧 `seatID` 名称。
玩家查询、注册、位置候选以及 `revealTrackerCards()` 等非移动 API 的 `seatID` 保持不变。
`validateMoveEvent()` 也只接收完整协议，负责未知区域和数量一致性诊断，不承担缺字段补全。
`options.spellID` 在玩家/标记端点按区域规则映射；纯公共区移动保留协议 `SpellID`（包括无技能的 `0`），
不会因没有玩家端点而丢成 `undefined`。原始触发技能始终可从 `event.protocol.SpellID` 读取，
来源标记空间仍由 `options.fromSpellID` 单独表示。
技能 `MoveEventPatch` 只修改 `type`、`cardIDs`、`cardCount` 和 `options`，不覆盖
`protocol` 或 `raw`。

### 来源座位与 `NaN` 边界

`protocol/MoveEventNormalizer.ts` 的 `normalizeMoveEndpoints()` 仅在玩家区来源时将协议数字
`FromID` 原样写入 `fromSeatID`；公共区来源不设置该字段，弹窗使用 `fromPopupSpaceID`。
`room/movement/context.ts` 的 `createMoveContext()` 优先使用显式 `fromSeatID`；没有显式座位时，
公共区名或 `null` 得到 `fromSeat: null`，领域直调使用的数字座位得到相应座位。
`RoomMovementUnknownPlacement.move()` 将该值原样传给 `RoomMovementSources.takeSourceCards()`。
当前符合协议与领域约定的调用不会产生 `fromSeat: NaN`；无座位也不使用 `NaN` 表达。

这不是 TypeScript `number` 的运行时保证：人为传入 `fromSeatID: NaN` 会直接透传；传入全空白
`fromZone` 时，`Number(fromZone)` 为 `0` 而 `parseInt(String(fromZone))` 为 `NaN`。
这些输入违反当前端点语义，不构成消费路径新增防御的依据。`takeSourceCards()` 的两处
`fromSeat != null` 只区分有无来源座位，保留该判断；周边既有 `Number.isNaN()` 也不证明合法输入可达。
若出现真实协议或合法调用反例，应先定位产生位置并更新入口契约，再决定修复范围。

## 协议 CardID 输入约定

技能/协议模块需要提取消息中的真实牌身份时，统一从 `src/tracker/helper/cardIDs.ts`
直接导入 `getPositiveIDs()`：

- 宿主协议保证 CardID 为数字；`0` 表示未公开身份，正数表示真实身份。
- `getPositiveIDs()` 过滤 `0`，得到去重后的真实身份列表，并保留每个 ID 首次出现的顺序。
- 结果不保证按数值排序；需要按数值排序的调用方应在返回结果上显式排序。
- 不要对 CardID 逐项执行 `Number()`、`Number.isFinite()` 或 `Number.isInteger()`；协议中的
  单值/数组形态仅在确实支持该形态的其他协议入口统一；移动消息的 `CardIDs` 固定为数组。
  若真实协议样例推翻该契约，应更新入口类型与解析测试，不在
  各消费路径添加假设性兼容。
- `0` 仅表示匿名占位、不是稳定身份（见“只有数量、没有 CardID 的暗牌”），
  不要把 `0` 写入 `Card.id`。

## 获取某个角色的手牌

先确定你要的是“牌实体”“身份 ID”“候选可能性”还是“数量”。这些入口不能互相替代：

| 需求                           | 调用方式                                                                           | 返回/语义                                                                       | 适合场景                                           |
| ------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------- |
| 确定归属的已知手牌实体         | `room.getPlayer(seatID)?.knownHandCards`                                           | `Card[]`；只包含确定在该角色普通手牌中的明牌                                    | 视图、技能逻辑、需要继续调用 `Card` 方法           |
| 仍可能在该角色手牌中的已知牌   | `room.getPlayer(seatID)?.candidateHandCards`                                       | `Card[]`；身份已知，但位置仍是手牌候选/模糊位置                                 | 候选展示、约束诊断                                 |
| 所有物理手牌实体（含匿名暗牌） | `room.getPlayer(seatID)?.cards.filter((card) => card.subZone === 'hand')`          | `Card[]`；按 `Player.cards` 的动态关系读取                                      | 需要把匿名槽也纳入一次性归组；不要放在高频渲染循环 |
| 只要确定正 ID                  | `room.getPlayerHandCardIDs(seatID)`                                                | `number[]`；默认 `knownOnly: true`、`includeCandidates: false`，只返回 `id > 0` | 协议兼容、旧 handler、低频查询                     |
| 包含候选手牌的正 ID            | `room.getPlayerHandCardIDs(seatID, { includeCandidates: true })`                   | `number[]`；仍只返回正 ID                                                       | 需要把模糊明牌也列入 ID 集合                       |
| 放宽 `isKnown` 过滤            | `room.getPlayerHandCardIDs(seatID, { knownOnly: false, includeCandidates: true })` | `number[]`；匿名实体仍会因负 ID 被过滤                                          | 只在确实需要“已出现身份”集合时使用                 |
| 高频读取的增量投影             | `room.locationIndex.knownHandBySeat.get(seatID) ?? []`                             | `Card[]`；索引维护的确定手牌桶                                                  | 视图/高频派生计算；只读，不要直接修改数组          |
| 高频读取手牌候选投影           | `room.locationIndex.candidateHandBySeat.get(seatID) ?? []`                         | `Card[]`；索引维护的候选手牌桶                                                  | 候选按钮或局部重绘                                 |
| 一致的全玩家区快照             | `room.refreshPlayerSnapshot()`                                                     | 所有 `location === 'player'` 的 `Card[]`                                        | 一次性批处理；返回后再按座位/子区归组              |

### 计数与“已知”不要混淆

- `player.observedHandCount` 是协议或移动事件给出的手牌总数，不是从现有 `Card` 反推的结果。
- `player.unknownCardCount` 是观测总数扣除确定明牌和候选明牌容量上界后的未知额度，可能已由暗实体覆盖。
- `player.getKnownHandSlotCount()` 返回确定明牌数量；`player.getCandidateHandSlotCount()` 返回单座位候选
  明牌容量上界，同一身份在该座位最多计一次，不能把各座位上界相加当作全局确定身份数。
- `computeHandSlotAllocation(room)`（`src/tracker/constraint/handSlotUsage.ts`）一次返回各座位的确定明暗占用、
  候选容量、暗实体覆盖、展示额度和匿名补缺；匿名补位使用它的结果，不再另写数量算法。
  未观测总数或无法安全对账时，匿名补缺为 `null`，以 `canReconcileAnonymous` 判断是否可以补位。
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
    toSeatID: seatID,
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
    toSeatID: seatID,
    subZone: 'hand',
    fullHand: true,
    handCount,
    handMoveCount: 0
  },
  fullHandCardIDs
)
```

普通协议消息不应手工拼上面这段语义，而应把原始消息交给
`tracker.syncTrackerMove(patched, raw)`；Controller 会根据来源区、`CardIDs`、`cardCount` 和
`handMoveCount` 选择已知牌与匿名牌路径。

### 直接编排 Room 移动（测试或已经归一化的内部路径）

```ts
room.moveCards(ids, 'player', {
  toSeatID: seatID,
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
room.moveCards(
  Array.from({ length: count }, () => 0),
  'player',
  {
    toSeatID: seatID,
    subZone: 'hand',
    fromZone: 'pile',
    cardCount: count,
    handMoveCount: count
  }
)
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
tracker.revealTrackerCards({ type: 'player', seatID, subZone: 'hand', fromZone: 'pile' }, cardIDs)
```

- `type: 'player'` 必须带有效 `seatID`；`255` 表示无席位技能空间，不应当成角色座位。
- `subZone` 可为 `hand`、`equip`、`judge` 或 `mark`；`mark` 通常还要带 `spellID`。
- `fullHand: true` + `handCount` 表示这是整手快照，Controller 会先同步总数，再解析已知牌；部分揭示不要
  误加 `fullHand`。
- `fromSeatID`/`fromSubZone` 用于“从另一名角色或标记区取牌”；来源未知时不要猜成 `pile`，让
  `syncTrackerMove()` 根据协议归一化。

### 从协议 Zone 揭示

协议已经提供 `zone/id/pos` 时直接使用适配入口。`zone`、`id` 必须是数字，`spellID` 可省略或传
数字/`null`；不再接受旧 `zoneID` 字符串。公共牌堆的 `id` 使用 `255`：

```ts
tracker.revealTrackerCardsInZone({ zone: 1, id: 255 }, cardIDs)
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

领域层使用 `room.revealPublicCandidates(cardIDs, publicLocationCandidate)`，由 Room 同步身份候选和账本。
未物化身份登记在 `detachedKnownCards`，不会增加 `Room.cards` 或改变牌堆顺序；后续精确揭示会在
原匿名槽上物化并回收载体。读取全部身份候选时使用 `trackedCards`，统计物理实体时继续使用 `cards`。

## 读取与修改公共区

- 读取某区实体：`room.getPublicZone('discard').cards`。
- 读取某区正 ID：`room.getPublicZone('discard').cards.filter((card) => card.id > 0).map((card) => card.id)`。
  牌堆包含匿名槽，正 ID 列表不代表全部剩余身份，不能用它计算完整牌堆分布。
- 读取某张牌的位置摘要：`room.publicZones.getCardLocationInfo(cardID)`。
- 普通移动：`room.moveCards()`；它会处理来源端点、匿名槽、候选传播、账本提交、约束和索引，调用方无需再补交移动账本。
- 只有整区初始化/洗牌才使用 `zone.replaceAll(cards)`；低层 `zone.add(cards, position)` 只适合已知的
  单区落点测试。不要用 `zone.add()` 代替协议移动，否则可能漏掉身份账本和手牌总数变化。

## 身份与候选低层原语

| 原语                                                              | 用途                        | 注意                                                        |
| ----------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------- |
| `room.findCardsByIDs(ids)`                                        | 从 `cardIndex` 找现有实体   | 找不到不会自动创建。                                        |
| `room.materialize(cardID, target?)`                               | 将真实身份绑定到匿名槽      | 保留目标槽的位置/候选；公共区正 ID 不能覆盖其它正 ID 实体。 |
| `card.confirmKnown()`                                             | 标记物理牌面已公开          | 不负责移动到目标区。                                        |
| `card.bindTo(seats, subZone, spellID?)`                           | 绑定确定玩家/子区并默认明牌 | 适合低层夹具；生产协议优先用 `moveCards`/Controller。       |
| `card.bindCandidates(seats, subZone, spellID?, { known: false })` | 建立隐藏或模糊候选          | 调用后通常要 `room.resolveConstraints()`。                  |
| `card.setLocationCandidates(candidates, reason)`                  | 替换完整位置候选            | 技能/候选模块专用；普通 handler 不应直接维护。              |

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

核心源码入口：`src/tracker/Room.ts`、`src/tracker/model/Player.ts`、`src/tracker/model/Card.ts`、
`src/tracker/model/Zone.ts`、`src/tracker/runtime/trackerController.ts`、`src/tracker/room/publicZones.ts`。
