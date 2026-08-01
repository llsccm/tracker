# 记牌器当前状态、设计背景与验证清单

> 💡 当你需要推进 `src/tracker/`、排查记牌器协议同步异常、理解旧链表模型与新版 Seats 约束设计差异、或补充记牌器测试时，请阅读本文档。应用级初始化、Room/View 挂载时序详见 [`lifecycle.md`](lifecycle.md)。

---

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
- `resolveConstraints()` 当前包含三类收敛：
  - `Card.seats.size === 1` 时自动确认 `owner`。
  - 调用每个 `ConstraintGroup.resolve()` 做局部分组收敛。
  - 当某玩家确定明牌已占满已知手牌总数时，从仍包含该席位的候选手牌明牌中剔除该玩家席位。
- `resolveConstraints()` 的遍历已进行 A2/E1/E2 优化：
  - **A2（增量 player 快照）**：将入口与轮末的卡牌全量 `filter` 改为按 `Room.dirtyCardEvents` 游标增量维护的 `playerCardsSnapshot` 与 `playerCardsSnapshotSet`，消除每次重建快照的 O(N) 过滤成本。`import.meta.env.DEV` 下由 `assertPlayerSnapshotConsistency()` 断言增量与全量顺序及元素的一致性。
  - **E1（手牌槽增量重算）**：手牌槽统计按 seat 增量重算，首轮只计算有观测手牌数的座位，后续轮次只重算上一轮/本轮触碰座位并复用未变缓存。
  - **E2（跳过未触碰座位）**：收敛轮内 `Room.resolveTouchedSeats` 经 `notifyCardChanged()` 收集事件触碰过的座位；约束三首轮处理全部玩家，此后跳过上一轮与本轮至今都未触碰的座位。
- `seats.size === 1` 只表示 owner 确定，不等于子区域确定；`seats` 是 `locationCandidates` 的座位级只读投影，若 `Card.subZoneCandidates` 仍有多个完整位置候选（例如 `A 手牌 / A 标记`），必须继续等待子区域约束收敛。
- `resolveConstraints()` 收敛后会暂停追踪候选席位过广的明牌，随后按 `dirtyCardEvents` 游标及 `dirtyPublicZones` 增量更新 `locationIndex`，根据 `constraintGroupsDirty` 标志增量更新或全量重建 `ambiguousKnownIndex`，增量更新 `CardCounter`，并同步玩家视图组。
- `syncViewGroups()` 基于 `locationIndex` 的投影数据，将推断状态差量同步到 `Player.knownHandCards`、`Player.candidateHandCards`、装备、判定与按 `spellID` 归类的 `Player.markCards`。
- `resolveEquipmentContainerLocationCandidates()` 将装备容器候选投影到当前装备承载座位的标记区；容器候选本身固定在装备实体上，装备迁移时无需重写候选 key。
- `syncObservedPlayerHandCount()` 用于同步外部观测到的手牌数量快照；它不是由候选牌反推手牌数，而是将协议事实写入 `Player.observedHandCount` 后触发房间级收敛，例如某席位手牌数归零时剔除该席位的手牌候选并保留装备容器候选。
- `collectPlayerHandSlotCounts()` 支持传入目标座位集合；`resolveConstraints()` 内已按 seat 增量重算手牌槽统计，首轮只计算有观测手牌数的座位，后续轮次只重算上一轮/本轮触碰座位并复用未变缓存。该缓存只在一次 `resolveConstraints()` 调用内有效，依赖 `Room.resolveTouchedSeats` 的保守触碰集合。`Player.refreshUnknownCardCount()` 的兜底路径也会一次性收集 known/candidate，避免同一 seat 连扫两次。
- `shufflePile({ cardCount })` 会把 `discard` 洗回 `pile`，只随机弃牌堆部分，保留原剩余牌堆的相对顺序；未提供协议张数时按本地可枚举牌堆处理。协议张数仍是硬约束，但只用于核对物理槽，数量不足时告警且不虚构实体。洗牌身份判断以 `PileIdentityLedger.getUnresolvedIdentityIDs()` 为权威，不再读取正 ID 暗槽、CardCounter UNKNOWN/APPEARED 分类或本地代表顺序。
- 洗回弃牌、剩余牌堆和仍承载 cohort 未决身份的玩家/mark 正 ID 暗实体会原地匿名化为稳定负 `id/entityID`；实体对象、位置、座位、子区、SpellID、候选集合与 `hiddenMarkCandidates` 引用保持不变。ledger 已知仍在牌堆的身份与 `isKnown === true` 的牌顶/牌底公开边界保留正 ID。洗牌不再创建 detached identity、洗牌专用 suspended 身份、玩家/mark 匿名替身或手牌校验。
- `materialize()` 的公共 known 契约已切换为“匿名物理槽或端点中的同 ID 实体”：未定位身份
  不再覆盖其它正 ID 暗公共实体。outside/suspended 身份可接管匿名端点并直接恢复追踪，
  匿名槽退出公共区，不转移 suspended 名额；玩家暗手牌/mark 的旧式 interop 继续保留。
- `RoomMovement.resolveKnownMoveCards()` 只在本次协议 `cardCount` 覆盖的公共端点范围内分配
  匿名槽，不能扫描整副牌堆绕过正 ID 暗端点；指定 CardID 已存在于来源区时仍精确消费同 ID
  实体。匿名端点按协议顺序分配后不回塞，避免后续身份错占前一张牌的物理位置。
- DEV 三模型只读 observer 已接入牌堆初始化、协议移动与显式区域揭示。基线断言覆盖牌堆内
  全部正 ID 槽，generation/cohort 分别维护影子账本；旧采集器漏掉正 ID 暗槽，因此
  「只有观星局才有断言」的结论和 `maxDisplayedCandidateCount=161` 均已作废。observer 不修改
  `Room`、UI 或索引状态。
- 匿名公共区取牌在协议无 CardIDs 时只消费暗槽，跳过牌顶/牌底已知明牌；RANDOM 只决定
  匿名物理代表，不产生身份推断。任意位置匿名获取按通用 B15 处理，不绑定 3644：旧批次
  合并为全局未决并等待后续展示，记录为 `anonymous-pile-draw`，不计边界风险或实际降级；
  给出 CardIDs 时仍精确扣所属身份。
- 当前 3 个独立新口径样本累计 686 个事件，baseline/generation/cohort epoch 为 152/644/967，
  exposure 总数为 10821/0/843，按事件归一为 15.77/0/1.23，确认矛盾均为 0。前两局边界
  明细中 B6 风险 11 次、实际降级 0 次；B15 两次已重判为正常匿名失效。第 3 局缺少边界
  明细，只计入三模型汇总。Phase 1 observer 保留为机会性采样，不再设置 5 局硬门槛。
- Phase 2 已于 2026-08-01 判定生产身份账本迁移 GO；Phase 3 双写、Phase 4 洗牌身份权威和
  Phase 5 known 物化切换均已完成。`PileIdentityLedger` 负责 cohort 世代与洗牌未决身份，
  `Room` 负责匿名物理槽和公开边界。cohort 新 UI 暂缓；Phase 6 仍冻结，后续审计迁移期剩余
  兼容、诊断与 observer 开关。玩家/mark 的通用 `suspendedKnownCards` 语义保留。
- 178 事件历史样本已用新口径复核：真实 UI 候选峰值为 1，cohort-cardinality 仍为 5 条、
  并发峰值 2、单 belief 候选峰值 1；baseline/generation/cohort epoch 为 0/161/161，三路
  exposure 均为 0。该回放只作回归证据，不计入上述独立实战样本。

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
- `CardCounter`：基于 `Room.cards` 生成 `CardInstance` 查询副本，建立名称、花色、点数、类型倒排索引，并根据 `Card.location` 同步牌堆、玩家、弃牌、销毁四类状态。状态桶已从全量 `update()` 改为增量同步：`Room.markCounterDirty()` / `CardCounter.markDirty()` 收集状态变化牌，getter 在无新变化时复用干净缓存；`createExternalCards()` 会显式注册新牌，避免依赖全量扫描补建倒排索引。
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

## 暗置标记区候选流程

当协议出现 `FromZone=5`、`ToZone=4/8`、`CardIDs` 全暗且 `CardCount > 0` 时，记牌器会检查来源手牌是否存在明牌候选：

1. 若没有来源明牌，沿用普通暗牌占位移动逻辑。
2. 若存在来源明牌，由 `RoomMovement.handleHiddenMarkMove()` 接管默认暗牌移动，并在 `Room.skillState.get('hiddenMarkCandidates')` 中记录候选账本。
3. 账本记录来源座位、当前投影目标座位、`spellID`、候选明牌、已确认手牌/标记牌，以及本次暗置的明牌落入标记区数量范围。这里的 `spellID` 表示标记空间 ID：协议 `zone 4` 按旧 `Zone` 规则优先取 `ZoneParam || SpellID`，`zone 8` 优先取 `SpellID || ZoneParam`；木牛流马（木马）的标记空间 ID 固定为 `700`。
4. 先将候选明牌投影为完整位置候选：保留原有 `A 手牌 / B 手牌` 等候选，再追加目标标记位置。普通标记追加 `目标座位 标记`；木马追加装备容器候选 `container:equipment:161:700`，再由索引按 161 当前装备座位显示到玩家标记区。这一步不会丢掉既有跨角色候选。
5. 当范围 `knownMarkMin === knownMarkMax` 且候选全集只剩 `来源手牌 / 目标标记` 时，创建 `ConstraintGroup.expectedSlotsByLocation` 精确约束，并同步可镜像的 `expectedSlotsBySubZone`，支持 4 选 1、4 选 2、4 选 3 等 N 选 K。木马容器候选只参与 `expectedSlotsByLocation`，不生成 `expectedSlotsBySubZone` 镜像。
6. 后续某张候选明牌明确从同一标记空间进入弃牌区时，确认它占用该标记区名额；明确从来源手牌移动时，确认它占用手牌名额。普通标记要求座位与标记 ID 同时匹配；木马标记 `700` 若 `markID` 一致但座位变化，会先把账本的当前投影座位重定向，再继续使用同一个装备容器候选收敛。161 木马被其他技能移动时，即使本次协议 `spellID` 不是 700，也会通过装备物理牌 ID 识别并迁移容器投影。
7. 技能 `414` 的标记牌暗置回手牌时，返回协议可能使用 `3389` 作为 `SpellID`；同样由 `3389` 触发的标记也会以 `3389` 返回。因此从标记区按暗牌数量取源牌时，`414` 与 `3389` 作为兼容标记空间互扫，避免明牌仍残留在 `414` 标记区。
8. 洗牌发现承担 cohort 未决身份的正 ID 暗标记实体时，会将同一实体原地匿名化为稳定负 `id/entityID`；标记位置、候选集合及 `hiddenMarkCandidates` 中的对象引用保持不变，不再暂停原实体或创建替身。
9. 来源手牌被完整揭示时，`Room.moveCards()` 会在 `resolveKnownMoveCards()` 之前调用 `resolveHiddenMarkCandidatesFromFullHandReveal()`：未出现在完整手牌快照中的弱候选会先确认到标记空间，再让已知牌物化读取修正后的匿名手牌槽。这个前置时序仍是当前运行时契约。
10. 正 ID 确认占用标记名额后，`reconcileMarkSpace(record, reason)` 统一回收溢出的匿名标记占位。无论目标是普通 player mark 还是木马装备容器，只要占位来自来源手牌，就必须挤回 `sourceSeat` 手牌，不能丢到 `outside`；只有全明装备容器快照清零后、失去手牌物理背书的孤儿占位由 `clearHiddenMarkPlaceholdersForObservedSnapshot()` 独立移出玩家区。
11. `ConstraintGroup.expectedSlotsByLocation` 继续只承载精确数量约束。弱记录的范围求解与容器对称增强已经评估并暂缓：部分揭示的“未出现”不是负向证据，完整揭示又必须先于已知牌物化，观察快照还包含实体物化与孤儿清理，现阶段引入通用范围求解器不能替代这些局部流程。

示例：

- 4 明 0 暗，暗置 1 张：普通标记形成 `A 手牌 = 3`、`A 标记 = 1` 的精确约束；木马形成 `A 手牌 = 3`、`container:equipment:161:700 = 1` 的精确约束。
- 4 明 0 暗，暗置 3 张：形成 `A 手牌 = 1`、`A 标记 = 3` 的精确约束。
- 2 明 2 暗，暗置 2 张：只记录这 2 张明牌可能在标记区；由于 `knownMarkMin=0`、`knownMarkMax=2`，不会创建强约束。
- 若一张牌原本是 `A 手牌 / B 手牌`，暗置到 A 标记后会变成 `A 手牌 / B 手牌 / A 标记`；排除 B 后仍是 `A 手牌 / A 标记`，不会因为 owner 确定而误判具体区域。

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

## 协议文档索引

- 总入口：`docs/protocols/README.md`（按消息 className / SpellID / 通用模式定位专页）。

## 整手牌交换（通用协议模式）

- 协议文档：`docs/protocols/hand-exchange.md`（以技能 121 为完整示例）。
- 装饰器：`src/tracker/skill/HandExchange.ts`，经 `decorateGenericMove`（`*`）统一接入，不绑定单一 SpellID。
- 识别门槛：`MoveType=11` + `5<->10` + 整手张数；允许己方整手正 `CardIDs`，避免误伤佐练/诫厉等非整手路径。
- 手牌进 `exchange` 时按 `SpellID + FromID` 登记整批实体；同座位嵌套交换使用后进先出的批次栈，明确空手时也登记零张屏障批次；回手时 `FromID` 是原持有者批次键，目标座位看 `ToID`。
- 多位置手牌候选使用唯一批次令牌逐分支置换，不归入先处理座位；候选模式通过 `handMoveCount` 同步协议整手数，通过 `cardCount` 只搬运确定实体，避免候选实锤和匿名实体重复占槽。
- 候选批次回到己方且 `CardIDs` 完整覆盖整手时，正 ID 直接确认对应候选，未出现的候选排除该批次分支。
- 暗实体占位仍随物理批次移动；回到己方并由正 ID 揭示时，真实身份若尚在其它公共区，使用 exchange 暗实体回填原槽位后再把真实身份移入手牌，避免占位残留或重复计数。
- 明牌回填 `cardIDs`，暗实体回填 `sourceCards`；明暗混合批次不共用 `combinationID`。

## 诫厉观看与交换区暂存（SpellID=3483）

- 协议文档：`docs/protocols/GsCRoleOptTargetNtf-3483.md`。
- 观看阶段 `Params` 布局与观虚同类：`[pileCount, handCount, ...pileTop, ...handPartial]`；手牌片段默认是部分手牌，仅当 `handCount` 恰好等于目标整手数时 `fullHand`。
- 观看/同区展示的牌堆序列是 **top-first**（例：`[81, 99, 124, 4]`，`81` 为顶）；后续交换 `CardIDs` 可能整段逆序或混合重排（例进交换区 `[4, 124, 99, 81]`），不能跨消息沿用“第一项=牌顶”。
- 配对 `PubGsCMoveCard` 为牌堆同区展示（`FromZone=ToZone=1`、`MoveType=21`、两端 `255`）；`CardIDs` 即牌堆顶 top-first 序列。
- 目标通知主动路径：`handleRoleOptTargetNtf` 在 `Param == 1` 时写入 `expectedPileCount`，并同步牌堆顶与目标手牌片段。回归见 `tests/tracker/roleOptTargetNtf.test.ts`。
- 后续交换序列已文档化：`1->10`（牌堆）+ `5->10`（部分手牌）后拆回 `10->1` / `10->5`；旧 `decorateJieLi` **暂不挂上**，默认走通用移动路径。
- `PILE_SAME_ZONE_SHOW_SPELL_IDS` **不需要**仅为 `3483` 扩展；该白名单只修正权变/观虚的 RANDOM 端点。诫厉应先判断消息本身是否已明确为同区展示。
- 不走整手交换账本：`HandExchange` 识别门槛会排除诫厉的非整手、回牌堆路径。

## 天候私有观看与单牌展示（SpellID=3903）

- 协议文档：`docs/protocols/GsCRoleOptTargetNtf-3903.md`。
- `Type=28` 的 `Params` 为
  `[pileCount, handCount, ...pileTopCardIDs, ...mainViewHandCardIDs]`；只按 `pileCount`
  同步牌堆顶，主视角手牌片段不重复写入记牌器。
- `Type=29` 的 `Params` 为 `[seatID, ...pileTopCardIDs]`；首项是展示者座位号，不是卡牌
  ID，后续三项按 top-first 同步为发动者可见的牌堆顶。
- 两种消息的有效牌面参数只下发给发动者，并要求 `Param=0`、`targetSeatID=255`；
  其他角色可能收到空 `Params`。
- 其他视角的交换消息 `CardIDs` 全空，序列为 `1->10`、`5->10`、两次 `10->10`、
  `10->5`、`10->1`。`src/tracker/skill/TianHou.ts` 按批次区分原牌顶与原手牌匿名实体，
  两条 `10->10` 只视为动画消息。
- 原手牌确定明牌建立“发动者手牌 / 牌堆顶前 x 张”候选。明牌换出数量范围为
  `knownOutMin=max(0,x-(N-K))`、`knownOutMax=min(x,K)`；仅上下界相等时建立精确完整位置约束。
- 配对的 `PubGsCMoveCard` 同区展示（`MoveType=21`、牌堆两端 `255`）只亮牌顶三张中的一张，
  **不能**确定是第几张。基础归一保持 `noop`，再由天候装饰器转换为公共区范围揭示：
  命中原手牌候选时收紧到牌顶前 `x` 张，否则建立牌顶前三候选；`x=1` 时即确定牌顶。
  范围揭示不绑定具体匿名牌堆槽，也不重排牌堆。不要把 `3903` 并入
  `PILE_SAME_ZONE_SHOW_SPELL_IDS` 或 `PILE_RANDOM_AS_TOP_SPELL_IDS`。
- 回归：`tests/tracker/roleOptTargetNtf.test.ts`、`tests/tracker/pubGsCMoveCard.test.ts`、
  `tests/tracker/moveEventNormalizer.test.ts`、`tests/tracker/trackerController.test.ts`、
  `tests/tracker/tianHouExchange.test.ts`。

## 已知未完成项

- 尚未完整恢复旧版 `cardManager.pack()` 链表推理承载的所有不确定性语义；宴戏、权变、诫厉等技能仍需要用新版 `ConstraintGroup` 做进一步精细化。
- 诫厉观看阶段目标通知已同步牌堆顶与手牌片段；仍缺：交换默认路径实测/回归，以及按实战序列重写交换装饰（旧 `decorateJieLi` 暂不挂）。
- 主动运行路径不再依赖 `cardManager.findKZ()`；遗留文件中残留的旧 `cardManager` / `Zone` 引用需要后续清理或删除。
- 技能处理器目前仍是偏单牌回调，可能需要向批量拦截器演进。
- 已有 `pnpm test:tracker` 的 Node/Vitest 回归覆盖导入边界、Controller、位置候选、公共候选、位置索引、暗置标记、脏渲染与遍历基线等；仍需补齐更多 `Room.moveCards()` 组合路线与浏览器运行时验证。
- `CardLocationIndex`、`Room.notifyCardChanged()` 与 `view/dirtyRenderState.ts` 已接入：面板与玩家手牌可按脏集合局部重绘；仍可继续收紧边界场景与高频刷新策略。
- 牌堆身份迁移 Phase 6 尚未开始：需要审计迁移期剩余正 ID 暗公共假设、诊断与 observer
  开关，并单独裁决是否接入 cohort 分组 UI。

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
- `expectedSlotsBySubZone` 只应在候选全集已经收窄到相关完整位置时创建，避免把仍包含其他角色候选的牌过度收敛。
- `CardLocationIndex` 默认按脏牌事件和脏公共区增量维护，事件游标断档时回退全量重建；新增卡牌区域、玩家子区或变更事件时必须同步更新索引投影、脏事件捕获与视图组同步逻辑。
- 收敛轮内新增的席位或候选变更路径，必须经 `setSeats()` / `setLocationCandidates()` / `resolveLocationCandidate()` 三个捕获点之一发出携带 `previousSeats` 的事件，否则约束三的 E2 跳过会漏处理受影响座位；轮内新增改变 `card.location` 的路径必须让收敛循环的 `changed` 置真，否则 A1 快照不会重建（开发构建由 `assertPlayerSnapshotConsistency()` 兜底告警）。
- 若新增会影响手牌槽 known/candidate 计数的收敛路径，必须确保相关座位进入 `Room.resolveTouchedSeats`；E1 会复用未触碰座位的手牌槽统计缓存。
- 新增或修改 `this.cards.filter(...)` 等全牌池扫描前，必须先判断能否改用现有增量快照、索引、脏事件集合，或在入口一次性归组后复用结果；尤其避免把全牌池扫描放进玩家、约束组或收敛轮循环中，意外放大为 O(玩家数 × 全牌数) 或更高复杂度。若确认全量扫描确有必要，必须使用 `recordTraversal(...)` 对该扫描站点显式插桩，并在 `tests/tracker/traversalBaseline.test.ts` 中新增或更新对应场景与内联快照，使后续遍历量增长可见且可解释；不得以未插桩的隐藏扫描绕过基线护栏。
- [`tests/tracker/traversalBaseline.test.ts`](../../tests/tracker/traversalBaseline.test.ts) 的内联快照是遍历量回归护栏：结构性优化使数字下降属预期（`vitest run -u` 刷新），无关改动使数字上升需要先解释原因再更新快照。
- 匿名槽 G0/G1 真实回放已经完成并决定 NO-GO / 收缩；临时浏览器回放探针已退役。历史数据见本地归档 [`plans/anonymous-entity-and-slot.md`](../../plans/anonymous-entity-and-slot.md)。
- 初始牌堆初始化后，`pile.cards` 顺序应独立于 `room.cards`。
- 摸暗牌、摸明牌时手牌额度及状态维护应保持准确。
- 洗牌时协议 `cardCount` 与本地可枚举牌堆不一致属于高风险路径：需要确认 cohort generation 滚动、匿名实体数量、剩余牌堆相对顺序、牌顶/牌底公开明牌保留、玩家/mark 原对象与账本引用，以及数量不足时只告警而不补槽。
- 公共 known 物化必须限定在协议 `cardCount` 端点范围；除来源区中的同 ID 实体外只能消费
  匿名槽，不能穿透正 ID 暗端点寻找更深处匿名槽，也不能把 displaced 身份转成 suspended。
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

## 最近验证记录

- 2026-06-21：完成底层记牌器从 `src/refactor/` 至 `src/tracker/` 的最后更名与架构巩固，清理了 `shadow` 相关命名，整体实现成为唯一的记牌器运行基准。
- 2026-06-26：`11d988a` 之后已引入 `trackerController` 可测试化拆分、位置候选迁移、公共候选与暗置标记候选回归测试；后续 tracker 变更应优先跑 `pnpm test:tracker` 与 `pnpm typecheck:tracker`。
- 2026-06-30：`dd2696c` 强化洗牌堆与暗置标记同步：洗牌支持协议牌堆张数、id=0 暗占位补齐、正 ID 差集暂停追踪、暗标记占位账本迁移，并补充玩家来源明牌残留公共区的占位回补测试。
- 本次 P1-1/P1-2 完成候选系统收敛：`locationCandidates` 成为唯一候选主模型，`subZoneCandidates`、`seats`、`publicCandidates` 均为只读兼容投影；补齐洗牌、暗置标记与 `resolveConstraints()` 边界回归测试。
- 2026-07-02：`resolveConstraints()` 落地遍历优化 P0（A1 入口 player 快照 + E2 跳过未触碰座位），配套 `traversalStats.ts` 插桩与四场景遍历基线测试；基线场景遍历量下降 11%–32%。
- 2026-07-02：落地 P1-D：`CardCounter` 改为增量同步与 getter 干净缓存，四个遍历基线场景相对优化前累计下降 36%–49%；`CardLocationIndex` 与 `AmbiguousKnownIndex` 仍保持全量重建。
- 2026-07-03：落地 P1-E1：手牌槽统计按 seat 增量重算，四个遍历基线场景相对优化前累计下降 38%–57%；洗牌场景不涉及玩家手牌槽，收益主要来自前三类手牌变更/排他场景。
- 2026-07-03：落地 Step 1-3：`CardLocationIndex` 增量维护（`applyDirtyCardEvents` / `applyCardChange` / `refreshPublicZones`）。常规摸牌、暗牌分配、排他触发、洗牌等高频场景全量重建降为增量更新。四个场景 visited 遍历数进一步下降。
- 2026-07-04：落地 Step 6：`AmbiguousKnownIndex` 增量维护。消费 `dirtyCardEvents` 进行单牌增量更新，仅在约束组结构变化时全量 rebuild。
- 2026-07-05：落地 Step 7 / A2：`resolveConstraints()` 的 player 快照增量维护，彻底消除入口与轮末 `filter((card) => card.location === 'player')` 的 O(N) 全量扫描，在高频移动中归零。遍历基线 visited 数分别下降至：常规摸牌 48（降76%）、暗牌分配 52（降68%）、排他触发 60（降72%）、洗牌 80（降60%）。
- 2026-07-05：完成测试重构与合并，抽取 `locationCandidates` 与 `trackerController` 公共测试辅助，精简测试冗余，提升测试维护性。

- 2026-07-15：文档对齐代码结构——去除文档行号锚点；开局路径以 `handleRecordStartGame` 为主、`GsCModifyUserseatNtf` 分发暂注释；`GameState` 纯状态与 `BrowserGameState` 钩子拆分；视图脏渲染与 `trackerVisibility` 已落地。
- 2026-07-20：匿名牌堆阶段 1 完成；牌堆槽与身份解耦，G1 最终决定 NO-GO / 收缩，阶段 2–7 不执行，临时真实回放探针退役。决策归档见 [`plans/anonymous-entity-and-slot.md`](../../plans/anonymous-entity-and-slot.md)。
- 2026-08-01：牌堆身份批次模型 Phase 4 完成，`PileIdentityLedger` 接管洗牌未决身份，删除
  `remainingPileIdentityIDs`、CardCounter 洗牌分类、detached identity、洗牌专用 suspended
  身份和玩家/mark 替身；暗区正 ID 实体改为原地匿名化并保留对象引用。Prettier、
  `git diff --check`、`pnpm test:tracker`（51 个文件、469 项）、`pnpm typecheck:tracker`、
  `pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm build:prod` 全部通过；洗牌遍历基线为 49。
- 2026-08-01：牌堆身份批次模型 Phase 5 完成，公共 known 只物化匿名槽或确认端点同 ID，
  删除正 ID 暗公共身份挤出与 displaced/suspended 名额转交；公共来源候选收紧到协议
  `cardCount` 范围。新增正 ID 暗端点拒绝覆盖、同 ID 确认和 suspended 身份恢复回归；
  `PileIdentityLedger.ts` 同步补充 cohort、降级、守恒与事务边界注释。Prettier、
  `git diff --check`、`pnpm test:tracker`（51 个文件、471 项）、`pnpm typecheck:tracker`、
  `pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm build:prod` 与 `serena memories check` 全部通过。
