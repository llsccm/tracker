# 未知槽位匿名化与身份解耦计划

> 状态：已结束（G1 决定 NO-GO / 收缩；阶段 1 为终点，阶段 2–7 不执行）
> 日期：2026-07-19
> 适用范围：`src/tracker/`（`Room`、`Card`、`roomMovement/*`、`runtime/trackerController.ts`、索引与视图）、`tests/tracker/`、`docs/agents/*`
> 关系：本计划**重开**并具体化 [`anonymous-card-entity-optimization-plan.md`](anonymous-card-entity-optimization-plan.md) 第 7 阶段“槽位与身份彻底拆分”这一被 [`random-hand-transfer-and-anonymous-entity-implementation-report.md`](random-hand-transfer-and-anonymous-entity-implementation-report.md) 判为“暂不建议”的方向；区别见 §3。

---

## 0. 最终决策

- 阶段 0 的真实回放显示旧模型冲突修复路径高频触发，因此批准阶段 1 隔离 spike。
- 阶段 1 已完成匿名牌堆、`unlocatedIdentities`、`deckIdentities` 与按需物化，并通过自动化验证。
- 三段阶段 1 回放累计 263.309 秒，旧 G0 冲突站点与阶段 1 interop 均为零触发；遍历基线无回退。
- 阶段 1 生产源码仍为净增，未满足 G1 的“净删代码可观”条件。
- G1 最终决定 **NO-GO / 收缩**：保留阶段 0 的稳定负 ID 与阶段 1 的匿名牌堆，不推进手牌、标记、
  索引和视图的阶段 2–7 全面迁移。
- G0/G1 决策完成后，临时浏览器回放探针进入退役范围；通用 `recordTraversal` 与遍历基线继续保留。

详细数据见 [`anonymous-slot-stage-1-comparison.md`](anonymous-slot-stage-1-comparison.md)。除非出现新的非零
冲突证据或高频 interop，本计划不再重开；未来若需继续，应另立提案并重新量化收益。

下文保留立项时的现状描述、目标态与阶段设计，作为历史决策上下文，不代表阶段 2–7 仍是当前待办。

---

## 1. 摘要（TL;DR）

当前记牌器把“**未知槽位**”用**真实 id 实体**表示（牌堆、暗手牌都是从初始牌池借一个 `id>0` 的实体来占位）。这使“**这张牌是什么身份**”与“**某个物理槽被谁占用**”耦合在同一个对象上。协议一旦揭示“真牌 X 在某处”，而本地实体 X 正被别处的未知槽借用，就出现**同一真 id 出现在两处**的矛盾，只能靠不断增长的置换/回收/回补代码擦屁股（`swapKnownCardWithPublicSourcePlaceholder`、`recoverPlayerOccupiedIdentityForPublicReveal`、`insertUnknownPlaceholderIntoPile`、各种 `id===0` 兜底）。

**目标态**：未知槽位一律用**匿名占位**（`id<=0`、稳定负 `entityID`，基础设施已存在）；未揭示真牌的身份放进一个**未定位身份集** `unlocatedIdentities: Set<CardID>`；揭示时才把身份**物化**到某个匿名占位（或新建实体）并从集合移除。已知身份、位置待定的牌继续走 `locationCandidates` 候选模型（与本计划正交，不改）。

**收益**：整类“身份/槽位矛盾”消失 → 上述置换/回收/回补机器可随冲突源一起删除；守恒从“散落各处的隐式规则”变成“一个集中不变量 + DEV 断言”。

**成本诚实说明**：动的是记牌器核心链路（`initDeck`、known/unknown 移动拆分、三大索引、视图、暗置标记），且约 40 个测试用“真 id 暗牌”写死了当前耦合，需要重写。因此**强制先做牌堆 spike（阶段 1）量化收益**，在**决策门 G1** 决定是否全面推进；big-bang 一次性重写被明确禁止。

---

## 2. 背景与根因

### 2.1 现状事实（已核对代码）

- `Card.entityID = id > 0 ? id : room.allocateAnonymousEntityID()`（`Card.ts:85`）——稳定内部句柄；真实牌 `entityID===id`，匿名牌 `entityID` 为负（`Room.allocateAnonymousEntityID` = `anonymousEntitySeq--`，从 `-1` 起，`Room.ts:484`）。
- `Room.initDeck(cardIDs)`（`Room.ts:194`）用**真实 CardID** 铺满牌堆；牌堆实体从一开始就带真 id，尽管洗牌后位置/身份实际未知。
- `createExternalCards([], n)`（`Room.ts:488`）创建 `id=0`、负 `entityID` 的匿名占位，仅作**池枯竭兜底**。
- `isKnown` 语义（`Card.ts:90`）：“至少有一名玩家知道这张牌的物理 ID”。未知手牌 `isKnown=false`，但**实体仍带真 id**——这就是耦合。

### 2.2 冲突是如何产生的

“未知槽借真 id 实体”导致真 id 被**提前**绑定到物理槽。之后任一路径断言了同一真 id 的真实位置，就矛盾：

| 冲突场景                                   | 现有修复路径                                                       | 根因                 |
| ------------------------------------------ | ------------------------------------------------------------------ | -------------------- |
| 揭示牌堆顶=真牌 67，但 67 被某玩家暗槽借用 | `recoverPlayerOccupiedIdentityForPublicReveal`（PR #41 新增）      | 暗槽不该认领 67      |
| 协议称明牌 X 来自公共区，但本地 X 在别处   | `swapKnownCardWithPublicSourcePlaceholder`                         | X 被提前定位         |
| 协议称明牌 X 来自玩家区，但本地 X 在别处   | `swapKnownCardWithPlayerSourcePlaceholder` / `swapCardWithUnknown` | 同上                 |
| 暗占位回牌堆时盖住已确认牌顶明牌段         | `insertUnknownPlaceholderIntoPile`（PR #41 新增）                  | 占位与明牌争同一端点 |

这些代码**几乎全部**是在为“真 id 被塞进未知槽”兜底。情况越多、分支越多——即当前“越来越多的冲突”。

### 2.3 为什么现在重开这个方向

`random-hand-transfer-...report.md` §6 判定阶段 7（槽位/身份拆分）“暂不建议”，理由是“局部约束已够、控制改动与成本”。该判断在当时成立。但 PR #41 又叠加了两条新修复路径（`recoverPlayerOccupiedIdentityForPublicReveal`、`insertUnknownPlaceholderIntoPile`）与交换批次的 `handMoveCount` 解耦——说明**冲突面仍在扩张**，边际维护成本在上升。故值得用一个**便宜的 spike**重新量化“继续打补丁 vs 一次性解耦”的性价比。

---

## 3. 与现有计划的关系与区别

| 维度     | `anonymous-card-entity-optimization-plan.md`（旧）       | 本计划（新）                                                                  |
| -------- | -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 切入点   | **手牌槽位范围**（`HandSlot`/range），牌堆仍是真 id 实体 | **未知槽位全面匿名化**（牌堆 + 手牌 + 标记），身份进独立集合                  |
| 对牌堆   | 不改牌堆表示                                             | **牌堆改为匿名占位 + 未定位身份集**（核心）                                   |
| 揭示     | 仍走置换/回收                                            | 改为**物化**，删除置换/回收                                                   |
| 阶段 7   | 列为研究方向，report 判“暂不建议”                        | 本计划即该方向的**可执行具体化**，但以“匿名槽优先”而非“HandSlot 对象优先”落地 |
| 候选模型 | 复用                                                     | 复用（正交，不改）                                                            |

**本计划不取代旧计划的阶段 1–6**（provenance、匿名池、range 对账等），它们与本计划可并存；本计划只吸收其“阶段 0 全实体候选传播”的已完成成果作为前置事实。

---

## 4. 目标 / 非目标

### 4.1 目标

1. **消除“身份/槽位矛盾”整类问题**：未知槽无身份，揭示不再制造矛盾。
2. **删除/收敛修复机器**：置换、占用回收、牌顶占位插入等路径随冲突源消失而删除或降级为单一物化。
3. **集中守恒不变量**：以 `unlocatedIdentities` + 计数为中心，配 DEV 断言，替代散落规则。
4. **消除 `id=0` 碰撞**：匿名占位统一用**负 id**（= `entityID`），修掉视图 key / 去重 / 测试里成片的 `id===0` 特判。
5. **行为保持**：每阶段以现有 234 项测试为回归护栏；对用户可见行为零回退。

### 4.2 非目标

- **不**引入全局二分匹配 / 通用 SAT 约束求解器（沿用 `ConstraintGroup` 局部约束）。
- **不**改候选模型（`locationCandidates` / `ConstraintGroup`）的语义。
- **不**追求“重构一切”——已知身份的牌继续是真 id 实体。
- **不**做协议解析层的重写（top-first/逆序/同区展示等协议怪癖不在本计划范围）。
- 阶段 7（独立 `HandSlot` 对象）仍为**可选研究**，默认 YAGNI。

---

## 5. 术语与模型

- **真实实体（located identity）**：`id>0` 的 `Card`，身份已定位。已知位置或“已知身份+位置候选”。
- **匿名占位（anonymous placeholder）**：`id<=0`、`entityID<0` 的 `Card`。**不认领任何真 id**，只占一个物理槽。是未知槽的唯一表示。
- **未定位身份集 `unlocatedIdentities: Set<CardID>`**：全牌集中尚未定位到任何真实实体的真 id。初始 = 整副牌；随揭示/发牌逐步缩小。
- **物化 `materialize(cardID, target)`**：把一个 `unlocatedIdentities` 中的真 id 赋给 target 处的某个匿名占位（占位升级为真实实体，`id/entityID` 改为该真 id、`isKnown=true`），并从集合移除；target 无可用占位时新建实体。
- **候选（candidate）**：已知身份、位置待定，继续由 `locationCandidates` 表达（不变）。

模型关系：

```
身份未知           → 匿名占位（id<=0, entityID<0），不入身份索引
已知身份、位置待定 → 真实实体 + 多个 locationCandidates
已知身份、位置确定 → 真实实体，收敛
未揭示真牌的身份   → 只存在于 unlocatedIdentities 集合，无实体
```

---

## 6. 核心不变量（配 DEV 断言）

- **I1 身份守恒**：`{已定位真 id} ⊎ unlocatedIdentities === 全牌集`；同一 id 不得既有真实实体又在 `unlocatedIdentities`。
- **I2 槽位守恒**：每个区域实体数 === 该区域应有牌数（明牌 + 匿名占位）；牌堆实体数 === 牌堆剩余张数。
- **I3 匿名无身份**：`id<=0` 实体不得进入按真 id 的 `cardIndex`、`AmbiguousKnownIndex`、明牌视图；不得 `confirmKnown()`。
- **I4 揭示单调**：`materialize` 只把 id 从 `unlocatedIdentities` 移到“已定位”，不逆向；命中“已定位于别处且为已知”的真矛盾时 → DEV 抛错 + 保守对账。
- **I5 候选正交**：候选身份收敛只作用于真实实体；匿名占位不参与候选身份推理（只参与数量/位置占位）。

---

## 7. 目标态设计（关键结构与操作）

### 7.1 数据结构

```ts
// Room
unlocatedIdentities: Set<CardID> // 未定位真 id
// 可选：locatedIndex 复用现有 cardIndex（仅收 id>0）
```

### 7.2 关键操作

- `initDeck(deck)`：`unlocatedIdentities = new Set(deck)`；牌堆填入 `deck.length` 个**匿名占位**（不再是真 id 实体）。
- `drawUnknownToHand(seat, k)`：从牌堆取 k 个匿名占位，绑定为 seat 暗手牌；**不**赋真 id。
- `materialize(cardID, target)`：见 §5；统一供所有揭示入口调用。
- `revealPileTop/Bottom(ids)`：对每个 id 调 `materialize(id, pileEndpoint)`；无 swap/recover。
- `revealHand(seat, ids, {fullHand})`：对每个 id 调 `materialize(id, seatHand)`。
- `assertConservation()`（DEV）：校验 I1/I2。

### 7.3 与现有移动路径的衔接

- `moveUnknownCardsForContext` 的 `takeSourceCards`：来源为牌堆/暗手牌时取匿名占位（已接近现状，只是不再带真 id）。
- `moveKnownCardsForContext`：来源明牌若在 `unlocatedIdentities` 中 → 先 `materialize` 到来源区再移动；不再走“别处偷实体”的 swap。

---

## 8. 分阶段实施

> 每阶段：独立分支/可回滚提交；以全量 `pnpm test:tracker` 为护栏；阶段间有明确产出与（部分）决策门。旧行为在并存期用开关或 interop 层兜底。

### 阶段 0：地基与度量探针（低风险，独立可交付）

**目标**：不改核心行为，先把“匿名负 id”与“冲突度量”落地，为 spike 提供基准。

**工作项**

1. **匿名占位改负 id**：`createExternalCards` 生成的占位 `id` 从 `0` 改为其负 `entityID`；新增 `hasRealIdentity(card) = card.id > 0` / `isAnonymous(card)` 辅助；把散落的 `card.id === 0` 判定改为 `isAnonymous(card)`（保持等价）。
2. **冲突/修复计数插桩**：给 `swapKnownCardWithPublicSourcePlaceholder`、`swapKnownCardWithPlayerSourcePlaceholder`、`recoverPlayerOccupiedIdentityForPublicReveal`、`insertUnknownPlaceholderIntoPile`、`createExternalCards` 兜底各加 `recordTraversal`/计数。
3. **DEV 观测断言（只告警不抛）**：加 `assertConservation()` 骨架（I1/I2），在 `resolveConstraints` 尾部 DEV 下运行、仅 `warn`。
4. 冻结基线：记录当前 `traversalBaseline` 与 234 项测试。

**文件**：`Room.ts`、`roomMovement/sources.ts`、`runtime/trackerController.ts`、`view/cardButton.ts`（`id===0` → `isAnonymous`）、`tests/tracker/*`（`id===0` 断言改辅助）。

**完成标准**：全量测试绿；`typecheck:tracker`/`lint`/`build` 绿；产出一页《冲突频次基线》（各修复路径在现有测试 + 一局真实回放中触发次数）。

**决策门 G0**：若冲突频次基线显示修复路径几乎不触发 → 说明痛点被高估，可在此**止步**（仅保留负 id 与断言收益）。

### 阶段 1：牌堆 spike（核心验证，隔离分支）

**目标**：仅牌堆改为“匿名占位 + `unlocatedIdentities`”，量化收益与破坏面。手牌/标记暂不动，用 interop 层桥接。

**工作项**

1. `Room` 增 `unlocatedIdentities`，`initDeck` 改为填匿名占位、集合置为整副牌。
2. 抽牌从牌堆取匿名占位。
3. 牌堆揭示（观虚/权变/鹰视/诫厉同区展示）改走 `materialize`；**删除牌堆相关的 recover/占位插入**。
4. interop：暗手牌暂仍可能带真 id（旧路径），`materialize` 命中“真 id 已被暗手牌借用”时走临时兼容分支（打点，便于阶段 4 清除）。
5. `CardCounter` 牌堆剩余 = `unlocatedIdentities ∩ 牌堆语义`（或 deckSize − located）。

**测试**：`pileDisplayOrder`、`trackerController`、`pubGsCMoveCard`、`roleOptTargetNtf` 全过（可能需按新语义改断言）；新增《牌堆匿名化对照》快照。

**完成标准**：牌堆相关测试绿；产出《对照报告》：删除/新增净行数、被改测试数、冲突计数下降幅度、性能（遍历基线）变化。

**决策门 G1（关键）**：依据对照报告决定：

- **GO**：净删代码可观、无新增高频遍历、破坏面可控 → 推进阶段 2–6。
- **NO-GO / 收缩**：把负 id + 牌堆匿名化作为终点，保留手牌旧模型；关闭后续阶段。

### 阶段 2：抽牌/发牌路径匿名化

**目标**：所有未知入手/入区一律匿名占位，杜绝新的真 id 提前绑定。

**工作项**：`moveUnknownCardsForContext`/`takeSourceCards` 未知路径产出匿名占位；`markRandomHandTransferCandidates` 等复用（候选仍作用于已公开明牌真实体）。

**测试**：`locationCandidates`、`randomTransferLifecycle`、`hiddenMark` 相关全过。

**完成标准**：未知移动路径不再产生 `id>0` 的“未揭示”实体；测试绿。

### 阶段 3：揭示统一为物化

**目标**：把所有揭示入口收口到单一 `materialize`，删除公共区占用回收。

**工作项**

1. `revealTrackerCards`/`revealTrackerCardsInZone`/同区展示 → 统一调 `materialize`。
2. **删除 `recoverPlayerOccupiedIdentityForPublicReveal`**（冲突源已消）。
3. `materialize` 命中“已定位于别处且已知”的真矛盾 → DEV 抛错 + 保守对账（记录，不静默）。

**测试**：`trackerController`（占用回收相关用例改为物化语义）、`roleOptTargetNtf`、`pubGsCMoveCard`。

**完成标准**：占用回收路径删除后测试绿；矛盾断言仅在人造矛盾用例触发。

### 阶段 4：暗手牌与暗置标记匿名化

**目标**：暗手牌槽、暗置标记槽改为匿名占位，删除来源置换。

**工作项**

1. 暗手牌绑定用匿名占位（`bindCandidates` 保持，但实体无真 id）。
2. 暗置标记（`hiddenMarks`）同步匿名化。
3. **降级/删除** `swapKnownCardWithPlayerSourcePlaceholder`、`swapCardWithUnknown`、`swapKnownCardWithPublicSourcePlaceholder` 为“物化”单一路径。
4. **交换批次简化**：`skill/HandExchange.ts` 中暗实体天然无真 id，`sourceCards` 路径不再担心真 id 冲突；复核 `handMoveCount` 解耦是否可简化。

**测试**：`handExchange`、`hiddenMark`、`pileDisplayOrder` 全过；`insertUnknownPlaceholderIntoPile` 场景改为“物化不与占位争端点”。

**完成标准**：三条 swap 路径删除或收敛为一处；测试绿。

### 阶段 5：集中守恒不变量 + 删死代码

**目标**：把 DEV 断言从 warn 升为 throw；清除已死修复分支与 `id===0` 残留。

**工作项**

1. `assertConservation()`（I1–I4）DEV 下 `throw`；接入 `traversalBaseline` 护栏。
2. 删除阶段 1 interop 兼容分支与所有已无触发的修复路径（按阶段 0 计数确认零触发再删）。
3. `insertUnknownPlaceholderIntoPile` 合并进牌堆排序辅助（若仍需保护牌顶明牌段）。

**完成标准**：DEV 断言零误报；死代码删除；净行数下降；测试绿。

### 阶段 6：索引 / 视图 / 计数适配与测试重写

**目标**：全面切到 entityID 语义，重写耦合测试。

**工作项**

1. 视图 key 用 `entityID`（`id=0` 碰撞已消）；`CardLocationIndex`/`AmbiguousKnownIndex` 已排除匿名，复核无回归。
2. 牌堆残量、暗牌计数按 `unlocatedIdentities`/计数导出。
3. **重写耦合测试**：把 `bindHiddenHand([201,202])` 这类“真 id 暗牌”断言改为“数量 + 已定位身份 + `unlocatedIdentities`”断言。
4. 更新 `docs/agents/card_tracker.md`、`overview.md` 模型描述。

**完成标准**：`typecheck`/`test:tracker`/`lint`/`build:prod` 全绿；文档同步。

### 阶段 7（可选研究）：槽位与身份对象彻底拆分

**目标**：评估是否需要独立 `HandSlot`/`Slot` 对象。默认 **YAGNI**——阶段 1–6 若已消除冲突且守恒集中，则不做。仅当出现阶段 1–6 无法覆盖的残余不确定性再评估。

---

## 9. 文件级改动地图

| 文件                                            | 阶段   | 改动                                                                                     |
| ----------------------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| `src/tracker/Room.ts`                           | 0/1/5  | `unlocatedIdentities`、`initDeck` 匿名化、`materialize`、`assertConservation`、匿名负 id |
| `src/tracker/Card.ts`                           | 0      | `isAnonymous`/`hasRealIdentity` 辅助；匿名 `id` 取负 `entityID`                          |
| `src/tracker/roomMovement/sources.ts`           | 1/3/4  | 未知取占位、删除/收敛 swap、`insertUnknownPlaceholderIntoPile` 合并                      |
| `src/tracker/roomMovement.ts` / `candidates.ts` | 2      | 未知移动产匿名占位；候选传播复核                                                         |
| `src/tracker/runtime/trackerController.ts`      | 1/3    | 揭示统一 `materialize`；删 `recoverPlayerOccupiedIdentityForPublicReveal`                |
| `src/tracker/CardCounter.ts`                    | 1/6    | 牌堆残量按 `unlocatedIdentities`/计数导出                                                |
| `src/tracker/skill/HandExchange.ts`             | 4      | 暗实体无真 id 后简化；复核 `handMoveCount`                                               |
| `src/tracker/view/*`                            | 6      | key 改 `entityID`；`id===0` → `isAnonymous`                                              |
| `docs/agents/card_tracker.md`,`overview.md`     | 6      | 模型描述更新                                                                             |
| `tests/tracker/*`                               | 各阶段 | 断言从“真 id 暗牌”改为“计数 + 已定位 + 未定位集”                                         |

---

## 10. 测试矩阵（每阶段必过）

- **牌堆**：初始化、抽牌、洗牌、观虚/权变/鹰视/诫厉揭示、同区展示、重复揭示幂等、牌顶/牌底明牌段保护。
- **手牌**：普通暗牌、明牌打出、完整手牌展示、随机转移（7 明 2 暗转 3）、整手交换（含共享候选、嵌套、中断批次）。
- **公共区**：明牌来源纠正、弃牌/流放、身份物化 vs 旧置换等价性。
- **标记/暗置**：`hiddenMark`、装备标记、无席位技能空间。
- **守恒**：DEV `assertConservation` 在所有上述路径零误报；人造矛盾用例触发断言。
- **性能**：`traversalBaseline` 不因匿名化引入新高频全量扫描（新增站点需显性化并说明）。

---

## 11. 验证命令（每阶段）

```sh
pnpm exec vitest run tests/tracker/<改动相关>.test.ts   # 快速定向
pnpm test:tracker                                       # 全量 tracker 回归
pnpm typecheck:tracker
pnpm lint
pnpm build
pnpm build:prod        # 阶段 1、5、6 及最终
git diff --check       # 空白/换行
```

---

## 12. 风险与缓解

| 风险                                | 说明                           | 缓解                                                          |
| ----------------------------------- | ------------------------------ | ------------------------------------------------------------- |
| R1 迁移打断核心链路                 | 动 `initDeck`/移动拆分/索引    | **强制分阶段** + interop 层 + G1 决策门；big-bang 禁止        |
| R2 守恒新 bug                       | 隐式守恒改显式，可能漏更新集合 | 集中 `assertConservation`（先 warn 后 throw）+ 全路径测试矩阵 |
| R3 `cardIndex.get(realID)` 假设失效 | 未定位真牌无实体               | 复用现有 `findCardsByIDs`“缺失→按需创建”先例；调用点审计清单  |
| R4 测试重写量大                     | ~40 处真 id 暗牌断言           | 阶段 6 集中机械重写；断言更贴近真实信息结构                   |
| R5 性能回归                         | `materialize`/守恒断言开销     | 断言仅 DEV；`traversalBaseline` 护栏；牌堆残量用计数而非扫描  |
| R6 与暗置标记账本冲突               | 标记有独立空间账本             | 阶段 4 单独处理；标记匿名化与手牌匿名化对齐                   |
| R7 收益不及预期                     | 冲突实际触发少                 | G0/G1 决策门用**实测计数**而非直觉决定是否推进                |

---

## 13. 提交与回滚策略

- 每阶段 ≥1 个原子提交，`feat(tracker)`/`refactor(tracker)`/`test(tracker)` 前缀，中文正文。
- 阶段 1 在**独立分支**完成并出对照报告后再合并；G1 NO-GO 时直接弃分支，仅保留阶段 0。
- 每阶段合并前全量校验（§11）绿；`dist/` 不提交。
- 回滚粒度 = 单阶段提交；interop 层保证并存期任一阶段可单独 revert。

---

## 14. 验收标准（全计划）

1. 未知槽位无真 id；`unlocatedIdentities` 与实体计数满足 I1–I4，DEV 断言零误报。
2. `recoverPlayerOccupiedIdentityForPublicReveal` 与至少两条 `swap*` 路径被删除或收敛为单一 `materialize`。
3. `id===0` 特判从生产与测试清除，视图 key 用 `entityID`。
4. 全量 `pnpm test:tracker` 绿（含重写后的计数/身份断言）；`typecheck:tracker`/`lint`/`build:prod` 绿。
5. `docs/agents/card_tracker.md` 模型章节更新为匿名槽 + 未定位身份集。
6. 净代码行数下降（以“删除的修复分支”为主要指标），`traversalBaseline` 无非预期上升。

---

## 15. 推荐执行顺序与决策门

```
阶段 0（负 id + 度量 + 断言骨架）── G0：冲突几乎不触发？→ 止步
   ↓ 否
阶段 1（牌堆 spike，隔离分支，出对照报告）── G1：GO / NO-GO
   ↓ GO
阶段 2 → 3 → 4 → 5 → 6（逐段删修复机器、集中守恒、重写测试）
   ↓
阶段 7（可选研究，默认 YAGNI）
```

- **G0/G1 用实测数据决定**，避免凭直觉全面重写。
- 阶段 0 与阶段 1 即使后续 NO-GO 也各自独立有价值（负 id 消碰撞、牌堆语义更诚实）。

> 备注：本计划聚焦“未知身份 → 匿名槽”。“已知身份、位置待定”继续由候选模型承载，二者正交；PR #41 的整手交换候选账本（`skill/HandExchange.ts`）在阶段 4 后可进一步简化，但不在关键路径上。
