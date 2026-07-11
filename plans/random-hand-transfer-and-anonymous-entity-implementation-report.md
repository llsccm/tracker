# 随机手牌转移与匿名实体优化实施报告

> 状态：已实施
> 日期：2026-07-12
> 适用范围：`GsCRoleOptTargetNtf`、`src/tracker/`、`tests/tracker/`

## 1. 任务背景

本次任务始于界强识技能的目标手牌展示消息：

```text
className: GsCRoleOptTargetNtf
SpellID: 3876
targetSeatID: 2
Params: [137, 42, 46, 94, 118, 47, 96, 59]
```

该消息表示目标座位的完整手牌身份已知，需要按完整手牌展示同步到记牌器。

随后在以下随机手牌转移场景中发现了更深层的不确定性建模问题：

1. 2 号位原有 9 张手牌，其中 7 张明牌、2 张暗牌。
2. 2 号位通过暗牌协议随机转移 3 张手牌给 3 号位。
3. 协议只提供 `cardCount=3`，没有提供具体 `cardIDs`。
4. 旧实现传播 7 张明牌的 `{2,3}` 座位候选，却确定性地把两张暗牌实体先移动到 3 号位。
5. 后续完整手牌展示和具体明牌打出时，本地实体与真实身份不再对应，最终触发来源占位缺失和公共区残留修复日志。

问题的本质不是匿名占位创建得太晚，而是随机转移时无依据地假设“暗牌实体优先进入目标手牌”。

## 2. 最终设计

### 2.1 界强识完整手牌同步

`SpellID=3876` 复用现有完整手牌展示入口：

```js
revealPlayerHandCards(targetSeatID, Params, { fullHand: true })
```

因此协议参数会作为目标座位当前完整手牌输入，参与候选收敛和手牌实体同步。

### 2.2 匿名实体基线

匿名牌继续使用协议 ID `0`，但每个实体拥有唯一的负数内部标识：

```text
真实牌：id > 0，entityID = id
匿名牌：id = 0，entityID = -1/-2/...
```

约束稳定后，`Room` 按观测手牌数对账确定明牌、候选明牌和未知实体：

- 未知槽位实体不足时，创建匿名实体。
- 未知槽位减少时，优先将多余匿名实体释放到 `outside`。
- 候选槽位尚未精确覆盖时，不提前实体化不确定额度。
- 具体明牌来源协议出现但没有可用暗实体时，允许创建瞬时匿名实体完成身份置换。

### 2.3 随机暗牌转移采用全实体候选传播

随机转移不再确定性移动若干暗实体，而是让来源手牌的全部实体共同参与位置候选：

```text
转移前来源手牌总数：N
随机转移数量：K

全部 N 个实体的位置候选：来源手牌 / 目标手牌
来源精确槽位：N - K
目标精确槽位：K
```

本次复现场景对应：

```text
候选实体总数：9
2 号位精确槽位：6
3 号位精确槽位：3
```

参与候选的实体包括：

- 已公开身份的明牌实体；
- `isKnown=false` 的真实暗牌实体；
- 实体覆盖不足时补建的匿名实体。

只有明牌实体进入候选 UI。真实暗牌实体参与位置约束和后续身份置换，但不公开物理 ID。

### 2.4 接管与回退

候选传播只有在实体可以完整覆盖转移前来源手牌时才接管默认未知移动。

接管成功后设置：

```ts
context.skipUnknownMovement = true
```

这样不会再从来源手牌中确定性挑选暗实体搬到目标。

若手牌总数、转移数量与实体覆盖关系矛盾，候选方法返回空数组，保留原有未知移动路径作为保守回退。

### 2.5 混合约束组不改变公开状态

全实体约束组同时包含明牌和暗牌，因此必须保持：

```ts
known: false
```

`ConstraintGroup.known=true` 会确认组内所有实体为明牌，不适用于混合组。每张牌是否公开继续由自身 `isKnown` 决定。

## 3. 实施内容

### 3.1 协议与文档

- 为 `GsCRoleOptTargetNtf` 增加 `SpellID=3876`。
- 新增界强识协议说明文档。
- 更新记牌器代理文档中的匿名实体模型。
- 编写匿名实体与手牌槽位范围优化计划。

### 3.2 核心模型

- `Card` 增加稳定的 `entityID`。
- `Room` 增加匿名实体 ID 分配器。
- `Room.resolveConstraints()` 稳定后执行匿名手牌实体对账。
- 匿名实体释放时不影响真实暗牌实体。

### 3.3 移动与置换

- 随机手牌转移改为全来源实体候选传播。
- 使用移动上下文保存的来源手牌数快照，避免读取已经应用 delta 的转移后数量。
- 实体覆盖不足时仅补建确定存在的匿名槽位。
- 完整候选覆盖成功后跳过默认未知搬牌。
- 具体明牌来源缺少可用暗实体时，创建瞬时匿名实体并复用统一置换流程。
- 整手清空场景继续交由已有公共区残留替换逻辑处理。

### 3.4 日志

候选传播日志只展开已公开身份：

- 明牌输出 `id`、牌名和候选座位。
- 暗实体仅输出数量。
- 匿名实体诊断使用 `entityID`，便于跨事件追踪。

## 4. 测试覆盖

新增或扩展的回归覆盖包括：

1. 界强识完整手牌消息同步。
2. 匿名实体使用稳定且唯一的负数 `entityID`。
3. 观测手牌存在未知槽位时主动补建匿名实体。
4. 未知槽位减少时只释放多余匿名实体。
5. 明牌从未知手牌打出时完成身份置换并回补旧公共位置。
6. 仅有跨座位明牌候选时，具体来源事实可创建瞬时匿名实体。
7. 9 张来源手牌中 7 明 2 暗、随机转移 3 张时：
   - 9 个实体全部保留 `{2,3}` 候选；
   - 约束组为 2 号位 6 槽、3 号位 3 槽；
   - 两张暗牌不会提前固定到 3 号位；
   - 3 号位候选 UI 只展示 7 张明牌。
8. 洗牌和暂停追踪场景下，匿名手牌槽位仍可正确补齐。

## 5. 验证结果

实施完成后执行：

```text
pnpm test:tracker
pnpm typecheck:tracker
pnpm lint
pnpm build
pnpm build:prod
git diff --check
```

结果：

- tracker 测试：22 个测试文件、168 项测试全部通过。
- tracker TypeScript 类型检查通过。
- ESLint 检查通过。
- development 构建通过。
- production 构建通过。
- Git 差异空白与换行检查通过。

新增注释后又执行了目标测试、类型检查和 lint，全部通过。

## 6. 已知边界与后续方向

当前方案仍然是“物理实体 + 位置候选 + 局部数量约束”，没有拆分独立的手牌槽位对象。此边界是刻意的：现有局部约束已能修复本次随机转移错误，同时保持改动范围与运行成本可控。**不建议**引入全局二分匹配或通用约束求解器，也不建议推进 [`anonymous-card-entity-optimization-plan.md`](anonymous-card-entity-optimization-plan.md) 的阶段 7（独立 `HandSlot` 对象拆分）。

### 6.1 独立复核结论（2026-07-12）

对照代码逐条复核，第 2–4 节核心声明均属实；独立执行 `pnpm test:tracker`（22 文件 / 168 项全绿）与 `pnpm typecheck:tracker`（无错误）通过。复核另发现两点：

- **性能（已修 2026-07-12）**：`Room.reconcileAnonymousHandCards()` 过去在每次 `resolveConstraints()` 尾部（`Room.ts:1156`）对每个 `hasObservedHandCount` 玩家各做一次全量 `this.cards.filter(...)`，即每条移动 O(玩家数 × 全牌数) 的隐藏扫描，且 `traversalBaseline` 未插桩。已改为在函数入口一次性按归属座位归组 `playerCardsSnapshot`（`resolveConstraints` 增量维护、成员严格等于 `location==='player'`），再按 seat 做 O(1) 查表，整体降为 O(玩家区牌数)，并加 `recordTraversal('reconcileAnonymousHandCards:group', …)` 显式插桩。注：原建议的”改用 `CardLocationIndex` 按 seat 投影”不可行——该索引的 `projectCard()` 刻意排除 `isKnown!==true` 的暗手牌（只投影可展示的明牌），取不到”未知手牌”；故改用 player 快照归组。无观测玩家时入口 early-return，早期对局零新增成本。`traversalBaseline.test.ts` 新增第 5 场景（两名已观测玩家、快照 3 张 → 归组 visited=3、补齐 3 个匿名实体）显式护栏化；旧 4 场景新增的该站点 visited 是被”显性化”的真实（更小）扫描量，非新增开销。
- **文档（已修）**：`bridge.ts` 路径与职责已更正——正确路径 `src/tracker/runtime/bridge.ts`（`TrackerController` facade），移动同步/明牌输入实现位于 `runtime/trackerController.ts`，随机手牌转移候选构建位于 `roomMovement/candidates.ts`；已同步 `CLAUDE.md` 与 `docs/agents/{card_tracker,overview,lifecycle}.md`。

### 6.2 后续方向（按优先级/风险重排）

沿用旧编号，重排为：

1. **已完成（2026-07-12）**：⑤ 长链路端到端回归落地于 `tests/tracker/randomTransferLifecycle.test.ts`（转移→局部展示→打明牌→完整展示→收敛，inline snapshot 锁定终态）；上述 reconcile 全量扫描改造 + 基线场景同批完成。全量 `pnpm test:tracker`（23 文件 / 170 项）、`typecheck:tracker`、`lint`、`build:prod` 全绿，`git diff --check` 通过。
2. **④ 已获真实反例，升级为”应做”（中风险）**：⑤ 跑出的收敛反例——seat3 完整手牌 `[42,46,47]` 占满其 3 个观测槽后，两张暗牌 130/131 仍保留不可能的 seat3 候选（`seats=[2,3]`）；计数层正确（seat2 unknown=2 / seat3 unknown=0）但 `seats` 投影未做全局消除。这正是”候选 range 被压成点值 + 局部约束组不跨组消除”的直接后果。新测试已用 `★` 注释锁定该”当前行为”。推进 ④（候选槽上下界与 `unknownCardCount` 拆分）时应以”该反例收敛为 `seats=[2]`”为验收目标。
3. **其后（纯行为保持重构）**：③ 将身份置换（`moveKnownCardsForContext` 多分支交换）收口为单一原子操作；靠现有测试 + 遍历基线兜底。
4. **降级**：① provenance 只做最小版（`reason` + `sourceEvent`），砍掉 16 条 bounded history（YAGNI），仅在实际调试需要时落地；② 正式匿名复用池暂缓或跳过——手牌规模极小属过早优化，且与①稳定溯源存在张力。

阶段映射见 [`anonymous-card-entity-optimization-plan.md`](anonymous-card-entity-optimization-plan.md) 第 15.1 节。
