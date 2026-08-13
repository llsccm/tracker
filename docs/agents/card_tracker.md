# 记牌器当前状态、设计背景与验证清单

> 💡 当你需要推进 `src/tracker/`、排查记牌器协议同步异常、理解旧链表模型与新版 Seats 约束设计差异、或补充记牌器测试时，请阅读本文档。Room 单局容器与行为模块边界先查 [`room.md`](room.md)；常用调用方式见 [`tracker_api.md`](tracker_api.md)；Card/Player/Zone 模型细节见 [`card_player_model.md`](card_player_model.md)；约束收敛、技能/协议特例与历史验证按需读取下方链接；应用级初始化、Room/View 挂载时序详见 [`lifecycle.md`](lifecycle.md)。

---

## 按需细节路由

| 关注方向 | 按需文档 | 触发场景 |
| --- | --- | --- |
| Room 单局容器与行为模块 | [`room.md`](room.md) | 修改 `Room.ts`、判断状态所有权、选择 Room/Movement/Constraints/PublicZones 落点，或排查单局主流程 |
| Card / Player / Zone 模型 | [`card_player_model.md`](card_player_model.md) | 排查牌实体字段、玩家区投影、公共区顺序，或新增子区/装备容器/标记区 |
| 匿名牌堆与身份账本 | [`card_tracker_anonymous_pile.md`](card_tracker_anonymous_pile.md) | 匿名物理槽、`PileIdentityLedger`、cohort/generation、`unlocated`/`suspended` 分区、物化、洗牌身份守恒 |
| 约束收敛与不动点 | [`card_tracker_convergence.md`](card_tracker_convergence.md) | 修改 `resolveConstraints()`、`ConstraintGroup`、完整位置名额、观测手牌数排他，或排查过度收敛、欠收敛、空转与遍历量回归 |
| 技能与协议特例 | [`card_tracker_skills.md`](card_tracker_skills.md) | 暗置标记、观虚 `987/988`、整手牌交换、诫厉 `3483`、天候 `3903` 等 |
| 历史验证记录 | [`card_tracker_validation_history.md`](card_tracker_validation_history.md) | 追溯里程碑、旧测试数量、遍历基线或历史决策 |
| 回放历史证据 | [`replay.md`](replay.md) | 任务明确涉及 JSONL 回放、`tests/replay/` 或匿名槽回放决策 |

## 当前定位

- `src/tracker/` 是当前主动运行的记牌器与运行时状态核心；`Room` 是单局状态源，`src/tracker/view/` 直接渲染主面板节点，并通过 `CardLocationIndex` 读取公共区与玩家区域投影。
- `src/handler/legacyMoveCard.js` 仍保留指向旧链表模型的历史代码，但**没有**经 `src/handler/index.js` 主动导出；不要把它视为可用运行路径。
- `src/handler/PubGsCMoveCard.js` 仍承担协议预处理、位置归一化、`CardIDs` 修正、技能辅助结果、战法计数、卡牌标签等副作用；真正的卡牌状态移动通过 `src/tracker/runtime/browser.ts`（再导出 `bridge.ts`）提供的 `tracker`（实现位于 `runtime/trackerController.ts`）同步到当前 `Room`。
- `src/tracker/index.ts` 仅导出共享运行时状态（`globalConfig`、`globalState`、`rogueMap`、`UI`）、`user` 与 `Game`；底层核心对象从各自子模块直接导入。

---

## 当前核心模块边界

### `Room`

- `Room` 是单局状态权威和稳定门面，持有玩家、公共区、物理实体、身份分区、约束、派生索引、
  技能/移动处理器与视图脏状态。
- 构造时挂载 `movement`、`constraints`、`publicZones` 三个行为模块；高频入口保留在 Room，
  低频阶段细节委托给模块，模块不拥有第二套推断状态。
- 生命周期主入口是 `registerPlayers()`、`initDeck()`、`moveCards()`、`resolveConstraints()`、
  `shufflePile()` 与 `destroy()`；生产 `initDeck()` 只创建匿名物理槽，真实身份由身份分区和
  `PileIdentityLedger` 管理。
- 普通协议先经 `TrackerController` 归一化，再由 Room 更新物理状态、候选与手牌数事实；
  `resolveConstraints()` 作为稳定投影边界，同步位置索引、模糊明牌索引、玩家视图组、计数器与守恒断言。
- Room 的状态所有权、生命周期、写入管线、行为模块落点、核心不变量与故障路由统一见
  [`room.md`](room.md)；移动 API 示例见 [`tracker_api.md`](tracker_api.md)，约束和匿名身份细节分别见
  [`card_tracker_convergence.md`](card_tracker_convergence.md) 与
  [`card_tracker_anonymous_pile.md`](card_tracker_anonymous_pile.md)。

### `Room` 行为模块

- `RoomMovement` 位于 `src/tracker/roomMovement.ts`，负责 `moveCards()` 的阶段细节：来源取牌、已知牌解析、候选传播、公共区候选位置传播、暗牌占位移动、已知牌落区和公共组合约束创建。
- `RoomConstraints` 位于 `src/tracker/roomConstraints.ts`，负责约束组维护、实体牌解析、稳定列表同步、基于 `locationIndex` 的视图组同步以及候选席位过广时的暂停追踪。
- `RoomPublicZones` 位于 `src/tracker/roomPublicZones.ts`，负责公共区一致性检查、公共区牌序读取、玩家手牌 ID 查询以及旧辅助兼容的 zoneID 读面。
- `protocolZones.ts` 负责把协议区域编号映射为新版公共区与玩家子区；`MoveEventNormalizer` 只做分类与字段映射，不直接修改 `Room` 状态。`FromID` / `ToID` 的含义依赖具体 `FromZone` / `ToZone`，不能一律当作座位 ID：例如 `FromZone=8` 弹窗标记回牌堆时，`FromID` 可能是技能/标记空间 ID；`FromZone=1` 牌堆来源时，`FromID=255` 可能只是牌堆/无座位占位。
- `Room.moveCards()`、`Room.resolveConstraints()`、`Room.shufflePile()`、`Room.getPublicZone()` 是高频核心入口，应优先留在 `Room` 中；新增内部辅助方法时优先放入对应行为模块，再由 `Room` 暴露必要的薄入口。

### `Card` / `Player` / `Zone`

模型字段、候选主模型、投影关系和修改护栏统一见
[`card_player_model.md`](card_player_model.md)。此处只保留记牌器流程最常引用的结论：

- `Card.locationCandidates` 是完整位置候选唯一主模型；`seats`、`subZoneCandidates` 与
  `publicCandidates` 都是兼容投影，`seats.size === 1` 只表示 owner 确定，不等于子区域确定。
- 匿名暗牌使用稳定负 `id/entityID`；`isKnown` 与真实身份是两件事，正 ID 不自动代表已公开。
- `Player.knownHandCards`、`candidateHandCards`、`equipCards`、`judgeCards` 与 `markCards`
  由 `Room.syncViewGroups()` 同步，不直接由外部写入。
- `Zone` 只承载公共逻辑区的有序 `Card[]`；玩家手牌、装备、判定或标记区所有权由
  `Card.location === 'player'` 与 `Player` 选择器表达。

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
- `Game.ts`：`GameState` 承载纯对局状态与生命周期，`Game` 是浏览器运行时单例实例。
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
