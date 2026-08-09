# 记牌器当前状态、设计背景与验证清单

> 💡 当你需要推进 `src/tracker/`、排查记牌器协议同步异常、理解旧链表模型与新版 Seats 约束设计差异、或补充记牌器测试时，请阅读本文档。常用调用方式先查 [`tracker_api.md`](tracker_api.md)；约束收敛、技能/协议特例与历史验证按需读取下方链接；应用级初始化、Room/View 挂载时序详见 [`lifecycle.md`](lifecycle.md)。

---

## 按需细节路由

| 关注方向 | 按需文档 | 触发场景 |
| --- | --- | --- |
| 约束收敛与不动点 | [`card_tracker_convergence.md`](card_tracker_convergence.md) | 修改 `resolveConstraints()`、`ConstraintGroup`、完整位置名额、观测手牌数排他，或排查过度收敛、欠收敛、空转与遍历量回归 |
| 技能与协议特例 | [`card_tracker_skills.md`](card_tracker_skills.md) | 暗置标记、观虚 `987/988`、整手牌交换、诫厉 `3483`、天候 `3903` 等 |
| 历史验证记录 | [`card_tracker_validation_history.md`](card_tracker_validation_history.md) | 追溯里程碑、旧测试数量、遍历基线或历史决策 |
| 回放历史证据 | [`replay.md`](replay.md) | 任务明确涉及 JSONL 回放、`tests/replay/` 或匿名槽回放决策 |

## 当前定位

- `src/tracker/` 是当前主动运行的记牌器与运行时状态核心；`Room` 是单局状态源，`src/tracker/view/` 直接渲染主面板节点，并通过 `CardLocationIndex` 读取公共区与玩家区域投影。
- 旧 `src/refactor/` 已更名并归并到 `src/tracker/`；旧 `src/context/` 主动实现已不存在。
- `src/handler/legacyMoveCard.js` 仍保留指向旧链表模型的历史代码，但**没有**经 `src/handler/index.js` 主动导出；不要把它视为可用运行路径。`src/handler/old/` 目录已不存在。
- `src/handler/PubGsCMoveCard.js` 仍承担协议预处理、位置归一化、`CardIDs` 修正、技能辅助结果、战法计数、卡牌标签等副作用；真正的卡牌状态移动通过 `src/tracker/runtime/browser.ts`（再导出 `bridge.ts`）提供的 `tracker`（实现位于 `runtime/trackerController.ts`）同步到当前 `Room`。
- `src/tracker/index.ts` 仅导出共享运行时状态（`globalConfig`、`globalState`、`rogueMap`、`UI`）、`user` 与 `Game`；底层核心对象从各自子模块直接导入。

---

## 当前核心模块边界

### `Room`

- 单局状态容器，持有 `cards`、`players`、公共 `zones`、`counter`、`pileIdentityLedger`、`constraintGroups`、`ambiguousKnownIndex`、`locationIndex`、`suspendedKnownCards`、技能处理器、移动事件处理器与视图脏变更记录。
- 构造时挂载 `publicZones`、`constraints`、`movement` 三个行为模块；这些模块只持有 `room` 引用，不拥有独立推断状态。
- 高频主入口保留在 `Room` 中，便于快速查看引用和主流程；低频阶段细节委托给挂载模块。
- `registerPlayers()` / `setMySeatID()` / `setFirstHand()` / `updateFixedViewIds()` 维护玩家集合、主视角座位与固定视图位序。
- `initDeck(cardIDs)` 创建等量匿名牌堆槽，将真实身份登记到 `deckIdentities` 与
  `unlocatedIdentities`，初始化 `PileIdentityLedger` generation 0、`CardCounter` 并重建
  `locationIndex`；真实 ID 首次揭示时才物化到实体。
- `moveCards(cardIDs, toZone, options)` 是主动状态更新入口：
  - `cardIDs` 中大于 0 的 ID 视为已知物理牌。
  - `cardCount - knownIDs.length` 视为暗牌占位数。
  - 已知牌移入玩家区时清理公共区引用、确认明牌、绑定候选席位，并按需创建局部分组。
  - 暗牌移入玩家区时，从来源公共区、来源玩家候选手牌、显式 `sourceCards` 或游戏外兜底实体中取出占位牌，再绑定目标候选席位。
  - 手牌全暗移动到技能标记区时，如果来源手牌存在明牌，会由 `Room.skillState` 中的 `hiddenMarkCandidates` 账本接管：先记录完整位置候选，条件足够时再创建手牌/标记区的精确数量约束。
  - 从玩家手牌随机暗取到另一名玩家手牌时，在实体完整覆盖移动前来源手牌的前提下，让来源全部实体共同参与来源/目标手牌位置候选，包括已公开明牌、真实暗牌实体与按确定缺口补建的匿名实体，并用局部分组同时约束座位和完整手牌位置名额；只有明牌进入候选 UI。覆盖关系矛盾时保留默认未知移动路径作为保守回退。
  - 玩家暗牌回到牌堆、牌堆顶/底候选被摸走时，会通过 `locationCandidates(type: public)` 维护公共区候选位置，并经 `publicCandidates` 只读投影继续传播到玩家手牌候选。
  - 协议声明玩家来源明牌移入公共区但本地仍残留在牌堆/弃牌等公共 `Zone` 时，会优先用来源玩家暗占位回补旧公共区槽位；只有确认来源手牌已被本次移动清空时，才允许用来源确定明牌回补；同批已知牌不会互相充当回补占位。
  - 玩家来源明牌需要与暗占位交换身份时，优先使用已经确定属于来源位置的暗实体；只有不存在确定来源实体时，才解析跨座位暗候选，避免按实体数组顺序提前收敛随机手牌转移约束。未公开正 ID 暗实体若碰巧命中跨座位候选，会由确定来源暗实体接管原约束后再公开该 ID，不把内部身份占位当作位置确认事实。
  - 牌移入公共区时从旧约束组移除并加入目标公共 `Zone`；未知目标公共区退化为直接 `moveToPublicZone(toZone)`。
- `resolveConstraints()` 以不动点循环处理 owner 同步、局部 `ConstraintGroup`、观测手牌数排他与匿名手牌实体对账；具体分层语义、A2/E1/E2 增量机制、终止契约和扩展护栏按需见 [`card_tracker_convergence.md`](card_tracker_convergence.md)。
- `seats.size === 1` 只表示 owner 确定，不等于子区域确定；`seats` 是 `locationCandidates` 的座位级只读投影，若 `Card.subZoneCandidates` 仍有多个完整位置候选（例如 `A 手牌 / A 标记`），必须继续等待子区域约束收敛。
- `resolveConstraints()` 收敛后会暂停追踪候选席位过广的明牌，随后按 `dirtyCardEvents` 游标及 `dirtyPublicZones` 增量更新 `locationIndex`，根据 `constraintGroupsDirty` 标志增量更新或全量重建 `ambiguousKnownIndex`，增量更新 `CardCounter`，并同步玩家视图组。
- `syncViewGroups()` 基于 `locationIndex` 的投影数据，将推断状态差量同步到 `Player.knownHandCards`、`Player.candidateHandCards`、装备、判定与按 `spellID` 归类的 `Player.markCards`。
- `resolveEquipmentContainerLocationCandidates()` 将装备容器候选投影到当前装备承载座位的标记区；容器候选本身固定在装备实体上，装备迁移时无需重写候选 key。
- `syncObservedPlayerHandCount()` 用于同步外部观测到的手牌数量快照；它不是由候选牌反推手牌数，而是将协议事实写入 `Player.observedHandCount` 后触发房间级收敛，例如某席位手牌数归零时剔除该席位的手牌候选并保留装备容器候选。
- `shufflePile({ cardCount, identityMove })` 会把 `discard` 洗回 `pile`，只随机弃牌堆部分，保留原剩余牌堆的相对顺序；未提供协议张数时按本地可枚举牌堆处理。协议张数只用于核对物理槽，数量不足时告警且不虚构实体。洗牌事件先由 `PileIdentityLedger.applyMove()` 原子提交并返回旧世代/洗回身份过渡，再由 Room 重建物理区与 suspended 投影；物理层不再自行读取事务前的未决身份快照作为已生效事实。
- 开局 `2 -> 9` 有两种等价协议形态：弃牌堆数量为 `0`，或弃牌堆数量等于整副卡池身份数。两者都只做初始牌堆重建/对账，不关闭 generation 0，也不暂停尚未出现身份。只有部分弃牌洗回才视为真实世代切换。
- 真实弃牌洗回时，旧 cohort 中仍未出现的身份会转成 detached `suspendedKnownCards` 展示
  实体；它们可继续出现在现有公共候选投影中，但不占物理牌堆、手牌或 mark 槽。尚未物化的
  身份直接按最终 suspended 状态登记到身份索引、计数器和展示集合，不发送没有旧投影可清理的
  通用脏牌事件。若身份仍由玩家/mark 等正 ID 暗实体承载，原实体会原地匿名化并保留位置、
  座位、子区、SpellID、候选集合与 `hiddenMarkCandidates` 引用；弃牌区正 ID 实体也会在随机
  洗回前匿名化。再次出现同 ID 时恢复 suspended 身份并消费对应匿名槽。
- `materialize()` 的公共 known 契约已切换为“匿名物理槽或端点中的同 ID 实体”：未定位身份
  不再覆盖其它正 ID 暗公共实体。outside/suspended 身份可接管匿名端点并直接恢复追踪，
  匿名槽退出公共区，不转移 suspended 名额；玩家暗手牌/mark 的旧式 interop 继续保留。
- `RoomMovement.resolveKnownMoveCards()` 只在本次协议 `cardCount` 覆盖的公共端点范围内分配
  匿名槽，不能扫描整副牌堆绕过正 ID 暗端点；指定 CardID 已存在于来源区时仍精确消费同 ID
  实体。匿名端点按协议顺序分配后不回塞，避免后续身份错占前一张牌的物理位置。
- 匿名公共区取牌在协议无 CardIDs 时只消费暗槽，跳过牌堆中全部已知身份实体，不因其位于
  牌顶、牌底或中间而撤销 `knownPileIdentityIDs`；RANDOM 只决定匿名物理代表并按需合并暗
  cohort 边界，不产生已知身份失效推断。任意位置匿名获取按通用 B15 处理，不绑定 3644；
  后续协议给出 CardID 时再精确移出对应身份并按实际牌堆数量对账。
- 牌堆身份迁移 Phase 2–6 已完成。`PileIdentityLedger` 是不可关闭的生产身份权威；旧 DEV
  三模型 observer、控制台报告入口、固定统计 schema、双写比较与 ledger 开关均已删除。
  `Room` 负责匿名物理槽、公开边界和 suspended 展示实体，cohort 分组 UI 经最终裁决不接入。

### `Room` 行为模块

- `RoomMovement` 位于 `src/tracker/roomMovement.ts`，负责 `moveCards()` 的阶段细节：来源取牌、已知牌解析、候选传播、公共区候选位置传播、暗牌占位移动、已知牌落区和公共组合约束创建。
- `RoomConstraints` 位于 `src/tracker/roomConstraints.ts`，负责约束组维护、实体牌解析、稳定列表同步、基于 `locationIndex` 的视图组同步以及候选席位过广时的暂停追踪。
- `RoomPublicZones` 位于 `src/tracker/roomPublicZones.ts`，负责公共区一致性检查、公共区牌序读取、玩家手牌 ID 查询以及旧辅助兼容的 zoneID 读面。
- `protocolZones.ts` 负责把协议区域编号映射为新版公共区与玩家子区；`MoveEventNormalizer` 只做分类与字段映射，不直接修改 `Room` 状态。`FromID` / `ToID` 的含义依赖具体 `FromZone` / `ToZone`，不能一律当作座位 ID：例如 `FromZone=8` 弹窗标记回牌堆时，`FromID` 可能是技能/标记空间 ID；`FromZone=1` 牌堆来源时，`FromID=255` 可能只是牌堆/无座位占位。
- `Room.moveCards()`、`Room.resolveConstraints()`、`Room.shufflePile()`、`Room.getPublicZone()` 是高频核心入口，应优先留在 `Room` 中；新增内部辅助方法时优先放入对应行为模块，再由 `Room` 暴露必要的薄入口。

### `Card`

- 继承 `BaseCard`，通过 `CardConfig` 单例取得牌名、花色、点数、类型等展示元数据。
- 保存物理位置与推断状态：`location`、`subZone`、`isKnown`、`spellID`、`turn`、`round`、`phase`、`owner`、`locationCandidates`、`suspended`、`combinationID`；`seats`、`subZoneCandidates`、`publicCandidates` 是从 `locationCandidates` 或确定位置派生的兼容读面。
- 匿名暗牌使用稳定负 `id/entityID`，不再使用 `id=0`；每个匿名实体拥有递减负数的唯一内部句柄。`Room.resolveConstraints()` 稳定后会按玩家观测手牌数、确定明牌和候选明牌主动对账匿名手牌实体；缺失时补建，过量时仅把匿名实体释放到 `outside`。存在未被精确槽位约束覆盖的候选手牌时不会提前实体化；若后续具体明牌移动协议证明该牌来自此手牌，则按该事实创建瞬时匿名实体完成身份交换并回补明牌原位置。
- `bindCandidates()` 只绑定候选席位，默认不确认明牌；`bindTo()` 是默认确认明牌的便捷入口。
- `locationCandidates` 是完整位置候选唯一主模型，可同时表达玩家区候选、公共区候选与装备容器候选；`subZoneCandidates`、`publicCandidates` 与 `seats` 均为只读兼容投影，外部写入必须通过 `setLocationCandidates()` 或保留的兼容方法转发。
- `subZoneCandidates` 表达玩家区完整位置候选（三元组 `seatID/subZone/spellID`），用于同一张明牌可能处于多个玩家或多个玩家子区域的情况，例如 `A 手牌 / B 手牌 / A 标记`。
- `publicCandidates` 只表达牌堆顶/底等不确定公共候选位置；确定公共区位置仍由 `Card.location` 与公共 `Zone` 顺序共同表达。
- 装备容器候选使用 `type: 'container'`、`containerType: 'equipment'`、`cardID` 与 `spellID` 描述，例如木马区候选固定为 `container:equipment:161:700`；它不直接同步到 `seats` 或 `owner`，只在投影层按装备当前位置显示到玩家标记区。
- `setSeats()` 是旧写入口的兼容层：有完整位置候选时只过滤 `locationCandidates` 的玩家位置，无候选但出现多座位时会生成同一子区的玩家位置候选；只有完整位置候选也只剩一个时，才会落定具体 `subZone`。
- `moveToPublicZone()` 会清理 `subZone`、`seats`、`owner`、`combinationID`、`spellID`；移入 `exile` 时会重置 `isKnown`。
- `syncOwnerFromSeats()` 会在候选席位、owner 或 resolved seat 变化时调用 `Room.notifyCardChanged()` 记录视图脏变更。席位或候选变更事件（`card-seats-changed`、`card-location-resolved`、`card-location-candidates-changed`）均携带 `previousSeats`（变更前席位集合）：候选收缩时被移除的座位只在该字段可见，收敛跳过与脏渲染判定都应依赖它。
- `getLocationDescription()` 优先处理暂停追踪状态，再走 `AmbiguousKnownIndex.describe()`，最后退化为牌堆、弃牌堆、销毁、交换/处理区或玩家子区域描述。

### `Player`

- 由 `Room` 持有，记录 `seatID`、`fixedViewId`、观测到的手牌总数标记、`observedHandCount` 与 `unknownCardCount`。
- `knownHandCards` 与 `candidateHandCards` 不直接由外部写入，主要由 `Room.syncViewGroups()` 根据全局卡牌池差量同步。
- `refreshUnknownCardCount()` 使用 `observedHandCount - 确定手牌明牌数 - 模糊明牌期望槽位数` 计算暗牌额度。
- `getCandidateHandSlotCount()` 优先读取相关 `ConstraintGroup.expectedSlotsBySeat`，没有显式期望时按候选明牌数量退化计算。
- `getCandidateHandSlotCount()` 同时读取主模型 `ConstraintGroup.expectedSlotsByLocation` 与兼容模型 `expectedSlotsBySubZone` 中的 `hand` 名额，避免 `A 手牌 / A 标记` 候选被算成确定手牌或漏算手牌槽位。
- `markCards` 以 `spellID -> Card[]` 形式保存标记区卡牌，供多个技能标记区并存的后续视图渲染使用。

### `Zone`

- 只承载公共逻辑区域的有序 `Card[]`，例如 `pile`、`discard`、`process`、`exile`。
- `add()` 支持按位置插入；`remove()` / `removeCard()` 负责从公共区移除实体牌。
- 公共区不表达玩家手牌、装备、判定或标记区所有权；这些由 `Card.location === 'player'` 与 `Player` 选择器表达。

### `ConstraintGroup`

- 表达一次移动、分配、展示或模糊明牌事件形成的局部候选包。
- `cards` 是原生 `Set<Card>`，使用 `.has()` / `.delete()` / `.size` 与迭代能力维护组内实体牌。
- `candidateSeats` 只约束本组卡牌。
- `expectedSlotsBySeat` 只做“某席位在本组内锁定数量达到期望值后，从本组其他候选牌剔除该席位”的收敛。
- `expectedSlotsByLocation` 是完整位置层面的主数量约束，可约束玩家区、公共区与装备容器位置；迁移期会与旧 `expectedSlotsBySubZone` 保持兼容镜像，但容器候选没有子区镜像。
- `expectedSlotsBySubZone` 做玩家子区域层面的数量约束，例如一组 4 张明牌中 `A 手牌 = 3`、`A 标记(某 spellID) = 1`；它不能被 `seats.size === 1` 替代。
- 不把“同组”解释为“同 owner”，避免多人分配、洗牌后明牌、交换临时区等场景过度收敛。

### 其它核心对象

- `AmbiguousKnownIndex`：替代旧 `Zone.obj.unknown` 的部分展示语义，跟踪跨座位候选、完整位置候选、装备容器候选与公共候选的明牌；用于 `Card.getLocationDescription()` 的优先反查。已改为增量维护：通过事件流游标进行单牌增量更新，仅在约束组结构变化（`Room.constraintGroupsDirty === true`）时回退全量 `rebuild()`。容器候选展示时按当前装备承载座位展开。
- `CardLocationIndex`：提供确定手牌、候选手牌、装备、判定、标记与公共区分组；`RoomConstraints.syncViewGroups()` 和公共区视图读取该索引，避免渲染阶段现场高频分类。已改为增量维护：消费 `dirtyCardEvents` 事件流游标进行投影增量更新，公共区变化通过 `Room.dirtyPublicZones` 变更集局部重算。在游标断档时自动回退全量 `rebuild()`。装备容器候选会先投影成当前承载座位的标记区，再进入玩家视图。
- `CardCounter`：基于 `Room.cards` 生成 `CardInstance` 查询副本，建立名称、花色、点数、类型倒排索引，并根据 `Card.location` 同步牌堆、玩家、弃牌、销毁四类状态。状态桶已从全量 `update()` 改为增量同步：`Room.markCounterDirty()` / `CardCounter.markDirty()` 收集状态变化牌，getter 在无新变化时复用干净缓存；`createExternalCards()` 会显式注册新牌并推进连续已注册的尾部游标，避免后续更新再次扫描同一批实体。
- `MoveEventNormalizer`：将原始 `PubGsCMoveCard` 字段归一为标准事件包，依赖 `protocolZones.ts` 处理 `FromZone`、`ToZone`、玩家子区与 `CardIDs` 等字段。
- `gameState.ts` / `Game.ts`：`GameState` 承载纯对局状态与生命周期；`BrowserGameState`（`Game.ts`）承接 DOM/Laya 钩子。仍可继续收紧兼容层。
- `src/tracker/runtime/bridge.ts` + `browser.ts`：装配并导出 `tracker` 单例（`TrackerController`）；浏览器代码通常从 `runtime/browser` 导入。单局构建、移动同步（`syncTrackerMove`）、明牌输入（`revealTrackerCards`，含界强识 `fullHand`）与视图调度的实现位于 `runtime/trackerController.ts`；随机手牌转移等候选构建位于 `roomMovement/candidates.ts`。
- `src/tracker/view/`：直接操作主文档节点渲染统计、公共区、玩家手牌、查询面板和按钮；`dirtyRenderState.ts` 按脏集合局部重绘，`trackerVisibility` 控制显隐。

---

## 生命周期接入点

> 应用级 INIT/EXIT 与时序图见 [`lifecycle.md`](lifecycle.md)。此处只列记牌器关键协议。

- `decodeGsClientUserSeatFlagNtf -> handleRecordStartGame()`：**当前主动开局路径**。注册新局前先执行 `resetSeatUIs()` 清理上一局，再 `initTrackerRoom()` → `registerTrackerPlayers(seatinfo, user.userID)`，并重置、裁剪座位覆盖层容器。
- `GsCModifyUserseatNtf -> handleStartGame()`：函数仍导出，但 `logic.js` 中分发**当前注释未调用**；恢复时同样走 Room 创建与玩家注册。
- `GsCFirstPhaseRole` / `MsgGameShowFigure(Figure===1)` → `tracker.setTrackerFirstHand()`：写入 `firstID` 并更新固定视角；主视角与先手都确定后计算座位位置，但容器保持隐藏，首轮开始时再显示。
- `MsgGamePlayCardNtf -> readyTrackerGame() -> initTrackerDeck()`：初始化物理牌池并完整 `view.mount`。
- `PubGsCMoveCard -> handleMoveCard() -> syncTrackerMove()`：预处理后同步到 `Room.moveCards()` / `shufflePile()`。
- `MsgGameTurnNtf`：`handleGameTurn` 在首轮先隐藏主视角，再显示已完成定位的其他座位，之后推进 `Game` 轮次并处理轮级战法 Laya 状态，最后 `scheduleTrackerRender`。容器重置与人数裁剪在玩家注册后完成。
- `GsCGamephaseNtf`：`handleGamePhase` 以 `SeatRoundState` 编排玩家阶段；
  `Game.enter` 只推进纯状态，回合结果 DOM 清理、阶段文案与战法 Laya 重置留在
  handler。
- `MsgGameOver` / `ClientLeavetableRep -> destroyTrackerRoom()`：先 `view.unmount()`，再销毁 `Room`。

---

## 技能与协议特例（按需）

常规记牌器开发不需要加载技能协议细节。遇到以下任一场景时，再阅读
[`card_tracker_skills.md`](card_tracker_skills.md)：

- 暗置标记区候选（包括普通标记与木牛流马装备容器）。
- 观虚目标视角交换（`SpellID=987/988`）。
- 整手牌交换、诫厉观看与交换区暂存（`SpellID=3483`）。
- 天候私有观看与单牌展示（`SpellID=3903`）。

通用协议字段与位置语义仍以 [`docs/protocols/README.md`](../protocols/README.md) 及其专页为准。

---

## 历史设计背景

### 旧版链表模型

旧版底层记牌器使用 `Card` / `CardManager` / `Zone` / `Qcard` 协作：

- `Card` 以物理 ID 表达具体卡牌，使用 `key` 表达确认或未知分组；`prev` / `next` 双向链表保存身份层叠历史。
- `CardManager` 维护 `key -> Set<Card>` 节点池、未知分组标签池，以及 `pack()` / `unpack()`。
- `Zone.obj[zoneID]` 是全局静态区域存储，覆盖牌堆、弃牌堆、手牌、装备、判定、标记、弹窗、回收区等。
- `Qcard` 使用代理和 `CardInstance` 静态副本驱动查询 UI 变色。

旧 `pack()` 会为多张已知牌生成负数 `key`，把当前身份压入 `next` 链表，让外部引用保持不变但表现为未知分组。旧 `unpack()` 在分组只剩单节点、同区或下一层 key 相同等条件下逐层拆开，并回收分组标签。

旧 `Zone.obj['unknown']` 保存“物理 ID 已知但当前位置被折叠进未知分组”的尾节点；旧 `knownCards` 明牌区通过 `cardManager.findKZ()` 递归反查所有可能 Zone 与 key，再用 `Zone.name()` 格式化为悬浮提示。

旧模型的问题是数据模型与 DOM 渲染深度耦合、双向链表与 `swap` 维护成本高、技能逻辑硬编码在 Zone 内、静态全局状态容易污染下一局、ZoneID 字符串格式不统一。

### 早期 Seats 方案

早期重构方案把旧链表模型替换为“物理牌 + 候选席位 + 局部约束”：

- `Card` 保存物理身份、公开状态、当前位置、玩家子区域和 `seats` 候选集合。
- `Player` 维护普通明牌、模糊明牌与暗牌额度。
- `Room` 成为顶层生命周期容器，持有玩家、公共区、物理牌池、计数器与约束收敛器。
- 公共 `Zone` 只承载牌堆、弃牌、处理、回收等有序公共区。
- 技能与特殊移动语义通过事件装饰器或处理器接入，不再侵入底层 Zone。

当前实现已经落在这个方向上，但并不是早期方案中的“全局遍历剔除”模型：暗牌额度为 0 时的候选剔除限定在相关 `ConstraintGroup` 内，避免无边界全局消元导致过度收敛。

---

## 已知未完成项

- 尚未完整恢复旧版 `cardManager.pack()` 链表推理承载的所有不确定性语义；宴戏、权变、诫厉等技能仍需要用新版 `ConstraintGroup` 做进一步精细化。
- 诫厉观看阶段目标通知已同步牌堆顶与手牌片段；仍缺：交换默认路径实测/回归，以及按实战序列重写交换装饰（旧 `decorateJieLi` 暂不挂）。
- 主动运行路径不再依赖 `cardManager.findKZ()`；遗留文件中残留的旧 `cardManager` / `Zone` 引用需要后续清理或删除。
- 技能处理器目前仍是偏单牌回调，可能需要向批量拦截器演进。
- 已有 `pnpm test:tracker` 的 Node/Vitest 回归覆盖导入边界、Controller、位置候选、公共候选、位置索引、暗置标记、脏渲染与遍历基线等；仍需补齐更多 `Room.moveCards()` 组合路线与浏览器运行时验证。
- `CardLocationIndex`、`Room.notifyCardChanged()` 与 `view/dirtyRenderState.ts` 已接入：面板与玩家手牌可按脏集合局部重绘；仍可继续收紧边界场景与高频刷新策略。
- cohort 分组 UI 已裁决不接入；若未来重新评估，应以独立产品需求启动，不要恢复迁移期
  observer 或双写状态。
- `tests/contracts/pile-identity/pileGenerationPoolModel.ts` 中的历史基线、世代、批次与真实牌序 oracle
  继续作为纯测试对照保留；Phase 6 退役的是运行时 observer，不是这些可证伪模型。

---

## 风险与验证清单

通用命令、补测约定与手工验收见 [testing.md](testing.md)。以下聚焦记牌器领域风险。

- `Room.moveCards()` 中 `fromSubZone` 是区分来源玩家子区的关键字段，手写调用若省略它仍可能误判。
- 解析 `PubGsCMoveCard` 时不要仅凭 `FromID` / `ToID` 推断座位；必须结合 `FromZone` / `ToZone`、`FromZoneParam` / `ToZoneParam`、`SpellID` 与归一化后的 `fromSubZone` / `spellID` 判断。已知边界包括 `FromZone=8, MoveType=7` 的 `FromID` 可能是技能空间 ID，以及 `FromZone=1, MoveType=6` 的 `FromID=255` 可能表示牌堆/无座位。
- `swapCardWithUnknown()` 等涉及暗牌置换的行为，内部直接改变状态较多，若后续 `Card` 扩展历史时间戳等字段，需统一收口。
- 部分基于差量同步的逻辑仍缺少覆盖率，重构时容易引发微小不一致。
- `locationCandidates(type: public)` 负责牌堆顶/底候选传播，和 `ConstraintGroup`、`AmbiguousKnownIndex` 的边界要保持清楚，避免把公共候选误收敛成确定 owner。
- `subZoneCandidates` 与 `seats` 都是 `locationCandidates` 的只读投影，边界要保持清楚：`seats` 只代表座位级投影，不能直接代表具体子区域。
- 装备容器候选不应写入 `seats` 或 `owner`；新增同类容器时，需要同步补充 `src/tracker/candidate/equipmentMarkContainer.ts` 的注册表、`resolveEquipmentContainerLocationCandidates()`、`CardLocationIndex` 投影和回归测试。
- 完整位置数量约束、`previousSeats` / `changed` 事件契约、触碰座位缓存与收敛循环扫描护栏统一见 [`card_tracker_convergence.md`](card_tracker_convergence.md)；违反其中任一边界都可能造成过度收敛、欠收敛、非终止或遍历量回归。
- `CardLocationIndex` 默认按脏牌事件和脏公共区增量维护，事件游标断档时回退全量重建；新增卡牌区域、玩家子区或变更事件时必须同步更新索引投影、脏事件捕获与视图组同步逻辑。
- [`tests/tracker/traversalBaseline.test.ts`](../../tests/tracker/traversalBaseline.test.ts) 的内联快照是遍历量回归护栏：结构性优化使数字下降属预期（`vitest run -u` 刷新），无关改动使数字上升需要先解释原因再更新快照。
- 生产 `Room.initDeck()` 只创建匿名牌堆槽；测试 helper 的 `materializeDeckIdentities: true` 是
  历史正 ID 暗槽对照，不代表生产。真实洗牌关闭 cohort 时仍会为过期未决身份创建 suspended
  展示实体，但未物化身份按终态直接注册，不应进入位置索引或玩家快照的通用脏事件流；遍历
  基线应分别记录匿名生产路径与已物化暗槽的必要匿名化成本。
- 匿名槽 G0/G1 真实回放已经完成并决定 NO-GO / 收缩；临时浏览器回放探针已退役。历史证据按需见 [`replay.md`](replay.md)。
- 初始牌堆初始化后，`pile.cards` 顺序应独立于 `room.cards`。
- 摸暗牌、摸明牌时手牌额度及状态维护应保持准确。
- 洗牌时协议 `cardCount` 与本地可枚举牌堆不一致属于高风险路径：需要确认 cohort generation 滚动、匿名实体数量、剩余牌堆相对顺序、牌顶/牌底公开明牌保留、玩家/mark 原对象与账本引用，以及数量不足时只告警而不补槽。
- 公共 known 物化必须限定在协议 `cardCount` 端点范围；除来源区中的同 ID 实体外只能消费
  匿名槽，不能穿透正 ID 暗端点寻找更深处匿名槽，也不能把 displaced 身份转成 suspended。
- 非牌堆公共区（`discard` / `process` / `exchange`）的无 CardIDs 移动必须消费实际端点实体；
  只有牌堆的非标准无 ID 获取才允许跳过已展示明牌并只取匿名槽。
- 玩家来源明牌残留公共区时，需要确认旧公共区槽位被占位修复，且同批已知牌不会被用作其它明牌的回补占位。
- `AmbiguousKnownIndex.describe()` 多候选位置展示应准确。
- 手牌暗置到标记区的 4 选 1 / 4 选 2 / 4 选 3、逐张明置、混有暗牌和叠加跨角色候选的场景应保持保守且可收敛。
- 公共区洗回或回收时状态清理应完整。
- 高频视图更新不应闪烁或丢节点。

---

## 操作注意

- 修改 `src/tracker/` 时保持 LF 换行。
- 修改文档无需运行构建测试。
- 修改记忆库后运行 `serena memories check`。
- 修改记牌器核心代码后运行 `pnpm test:tracker`、`pnpm typecheck:tracker`、`pnpm lint` 与 `pnpm build`；涉及发布、打包配置或高风险核心协议路径时再运行 `pnpm build:prod`。

---

## 验证历史（按需）

历史里程碑、当时的测试数量与遍历基线已移至
[`card_tracker_validation_history.md`](card_tracker_validation_history.md)。只有在追溯旧重构范围、
性能基线或某次实际校验结果时才读取；当前任务的验证命令始终以 [`testing.md`](testing.md) 为准。
