# 协议回放诊断与效率优化计划

> 状态：**Phase 0 / Phase 1 已实施；Phase 2–4 待评估**  
> 日期：2026-08-08（2026-08-09 更新实施结论）  
> 适用范围：`tests/replay/tracker/`、`src/tracker/runtime/`、`src/tracker/Room.ts`、`src/tracker/ConstraintGroup.ts`  
> 触发案例：真实回放中卡牌 10/129 应同时成为 2、7 号位候选，但旧约束组在后续收敛中删除了卡牌 10 的 7 号位候选。

本计划只解决**回放诊断能力与回放效率**，不改变记牌器的候选推理语义。候选模型本身的修复和回归仍以 `src/tracker/roomMovement/candidates.ts` 及其测试为准。

---

## 1. 一句话结论

当前回放器是“从协议重建最终状态并做结构一致性检查”，不是“定位第一次领域语义偏差的诊断器”。它有三个直接后果：

1. 候选语义错误不会自动失败，只能人工比较最终状态。
2. Trace 模式保存每条协议的完整 Room 快照，产生大量与目标卡牌无关的上下文。
3. 找到异常后仍需从开局重新翻协议，无法按卡牌、座位、约束来源或 `seq` 范围定向回放。

目标状态是：**先报告第一个错误变化，再按需展开相关协议和约束来源；默认输出与目标规模成正比，而不是与整局牌池成正比。**

---

## 2. 当前基线与证据

### 2.1 真实回放基线

当前本地真实回放文件包含 111 条协议，约 21.5 KB。实测（2026-08-09 复核，与设计时记录一致）：

| 模式 | 输出规模 | 说明 |
| --- | ---: | --- |
| 默认模式 | 4562 B / 219 行 | 只输出最终摘要，不给出候选变化过程 |
| `DXC_TRACKER_REPLAY_TRACE=1` | 2.39 MB / 116819 行 | 111 条逐条完整 Room 状态，约放大 525 倍 |

Trace 模式下，`TrackerProtocolReplayer.replay()` 对每条协议都创建前后快照；前置快照多数情况下不会进入报告，只为潜在异常保留，属于重复成本。

### 2.2 这次错误需要的因果链

本次问题至少需要同时观察以下事件：

```text
seq 85   7 -> 2 的整手随机转移，创建旧约束组
seq 100  卡牌 129 被明牌揭示，从旧组中退出
seq 111  2 -> 7 的再次随机转移，为 10/129 增加新候选
         旧组仍保留“7 号位手牌槽位 = 0”，收敛时误删卡牌 10 的 7 号位候选
```

当前失败上下文只保留失败点附近的协议窗口；约束快照没有输出 `sourceEvent`、创建序号或失效序号，因此无法从报告直接得到这条因果链。

### 2.3 代码层面的现状

> 下列条目记录的是**实施前**的基线，用于说明每项改动解决的是什么问题。
> 除标注为“仍存在”的项以外，Phase 0 / Phase 1 已经处理，最新状态见 §5 与 §10。

- `tests/replay/tracker/helpers/protocolReplay/index.ts`
  - `TrackerProtocolReplayer.replay()` 只在抛异常时停止。
  - `createFailureStateBefore()` 异常时重新从头回放前缀。
  - `formatTrackerProtocolReplayReport()` 只压缩最终状态；逐条状态仍原样序列化。
- `tests/replay/tracker/helpers/protocolReplay/snapshot.ts`
  - 检查身份账本、公共区、卡牌索引、玩家快照。
  - 没有检查候选集合的领域语义，也没有输出卡牌变化 diff。
  - 移动协议会重建影子索引，诊断扫描没有接入回放性能统计。
- `tests/replay/tracker/helpers/protocolReplay/parser.ts`
  - 读取整个字符串并一次性构建协议数组。
  - 强制 `seq` 从 1 连续递增，截取区间后不能直接回放。
- `tests/replay/tracker/helpers/protocolReplay/types.ts`
  - 选项只有主视角、上下文长度、全量 Trace 等基础开关，没有 watch、范围、断点、断言和 checkpoint。
- `src/tracker/runtime/protocolRecordingRules.ts` / `protocolRecorder.ts`
  - 通过 allowlist 投影协议，未保留原始事件、录制版本、时间和过滤/丢弃统计。**（仍存在，属 Phase 4）**
  - 未识别协议或投影异常不会形成可查询的“录制不完整”报告。**（仍存在，属 Phase 4）**
- `src/tracker/Room.ts`
  - 已有 `cardChangeEvents`、`dirtyCardEvents` 和变更 `reason`，但回放报告没有导出这些信息。
- `src/tracker/ConstraintGroup.ts`
  - 已有 `sourceEvent`，但回放约束快照未包含来源及生命周期信息。
- `tests/replay/tracker/helpers/protocolReplay/handlers.ts`
  - 回放维护一套独立的协议分发与特判逻辑，与生产路由存在漂移风险。**（仍存在，属 Phase 4）**

---

## 3. 目标与非目标

### 3.1 必须达到的目标

1. **首个语义偏差可定位**：给定卡牌/座位断言，报告第一个违反断言的 `seq`、协议、原因和约束来源。
2. **上下文按相关性裁剪**：默认只输出 watched cards、相关座位、相关约束组及其来源事件。
3. **回放范围可控**：支持 `fromSeq` / `toSeq`、checkpoint、自动二分和最小化。
4. **结构检查与领域检查分层**：快速模式适合日常定位，深度模式用于完整一致性审计。
5. **录制可解释**：明确哪些协议被记录、过滤、降级或丢失，避免“成功但不完整”。
6. **真实案例进入回归闭环**：脱敏最小回放 fixture 在 CI 中执行，并包含候选语义断言。

### 3.2 非目标

- 不在本计划中重写 `Room` 的候选推理模型。
- 不默认保存所有原始协议或完整浏览器对象；原始数据只作为可选诊断旁路。
- 不一开始引入新的全局约束求解器、HandSlot 模型或牌堆身份模型。
- 不以“遍历次数下降”作为唯一性能结论；必须同时记录 wall-clock 和各阶段耗时。
- 不把本地计划文档当作运行时契约；完成后的稳定行为仍需回写 `docs/agents/`。

---

## 4. 目标架构

### 4.1 三档回放模式

| 模式 | 默认用途 | 状态检查 | 输出 |
| --- | --- | --- | --- |
| `fast` | 日常回归和长回放 | 基础计数、生命周期、必要的增量断言 | 单行事件摘要 + 最终摘要 |
| `watch` | 定位某张牌/某个座位的首次偏差 | 只对 watched 对象及相关约束做语义检查 | 候选/约束 diff、来源链、首错断点 |
| `deep` | 发布前或疑难问题审计 | 当前完整一致性检查 + 影子索引重建 | 可选完整快照，明确标记高成本 |

`DXC_TRACKER_REPLAY_TRACE=1` 作为兼容入口保留，但映射为显式的 `deep + fullSnapshot`，不再作为推荐的日常诊断方式。

### 4.2 定向诊断选项

新增 `TrackerProtocolReplayOptions` 字段，名称可在实现阶段微调，但语义应保持稳定：

```ts
interface ReplayDiagnosticOptions {
  mode?: 'fast' | 'watch' | 'deep'
  fromSeq?: number
  toSeq?: number
  watchCardIDs?: number[]
  watchSeatIDs?: number[]
  contextBefore?: number
  contextAfter?: number
  stopOn?: 'first-semantic-mismatch' | 'first-structural-error' | 'never'
  captureFullSnapshots?: boolean
  assertions?: ReplayAssertion[]
}
```

CLI/环境变量只是入口适配层，不能把诊断能力锁死在环境变量上。测试应直接使用 TypeScript API。

### 4.3 候选变化事件

每次 watched card 发生可观察变化时，生成紧凑事件：

```ts
interface ReplayCardChange {
  seq: number
  className: string
  cardID: number
  previous: {
    location: string | null
    seats: number[]
    candidates: string[]
    combinationID: string | number | null
  }
  next: {
    location: string | null
    seats: number[]
    candidates: string[]
    combinationID: string | number | null
  }
  reason?: string
  constraintGroupIDs?: string[]
}
```

**实施结论（对原设计的修正）**：`Room.cardChangeEvents` 是上限 100 条的环形缓冲，`detail` 结构由各调用点自定，既不携带变更前后的候选集合，也没有与协议 `seq` 的对应关系，直接拿来做 diff 并不可靠。因此实现改为：

- **前后候选 diff 完全在回放器一侧计算**：每条协议前后各取一次 watched card 的只读投影（`location` / `subZone` / `seats` / `locationCandidates` key / `combinationID` / 所属约束组），比较得到增删。
- **变更原因复用 `Room.dirtyCardEvents`**：它带单调 `seq`，回放器只按自己的游标读取本条协议区间内的事件，取 `detail.type` + `detail.reason` 作为 `reason` 摘要；一旦被 `DIRTY_CARD_EVENT_LIMIT` 截断会计数并标记 tainted，不静默丢失。

这样 `src/tracker/` **零改动**，天然满足“诊断埋点不得改变收敛时序”这条风险控制。

### 4.4 约束组来源与生命周期

约束组快照至少增加：

- `sourceEvent` 的结构化摘要（协议 class、移动类型、SpellID、来源/目标座位）。
- `createdAtSeq`、`lastUpdatedAtSeq`。
- `invalidatedAtSeq` 或明确的有效代次。
- 与卡牌变化事件的反向引用。

不保存无限历史；只保留当前组和 watched card 相关的有限 provenance。旧组被清理时，保留一条轻量 tombstone，便于解释“候选为何被删除”。

**实施结论（对原设计的修正）**：生命周期字段不写进 `ConstraintGroup`，而是由回放器维护一张按组 ID 的旁路表——首次出现记 `createdAtSeq`，签名变化记 `lastUpdatedAtSeq`，从 `room.constraintGroups` 消失记 `invalidatedAtSeq` 并转为 tombstone。淘汰时优先丢弃“已失效且与 watched card 无关”的记录，丢弃数量进入 tainted 原因。同样是 `src/tracker/` 零改动。

### 4.5 紧凑输出格式

默认报告改为事件摘要，不输出完整牌堆和全部身份列表。例如：

```text
seq=111 class=PubGsCMoveCard card=10
candidate player:7:hand removed
reason=constraintGroup:expectedLocation
group=group_17 originSeq=85
```

需要机器处理时提供 JSON 输出；需要人工审阅时提供文本输出。完整快照只在明确要求时写入单独文件，不混入主报告。

---

## 5. 分阶段实施计划

### Phase 0：建立回放性能与完整性基线 ✅ 已完成

**目标**：先知道慢在哪里、回放是否完整，再做优化。

工作项：

1. 在回放报告中增加阶段计时：解析、协议应用、收敛、一致性检查、索引重建、快照、格式化。
2. 增加计数器：协议数、完整性检查次数、影子索引重建次数、完整快照次数、扫描卡牌数、约束轮数。
3. 将当前真实案例制作成脱敏 fixture，不依赖被 Git 忽略的 `replays/`。
4. 固定当前基线：111 条协议、最终候选、默认输出体积、Trace 输出体积。

验收（实测）：

- `pnpm replay:tracker` 直接输出阶段耗时与计数，例如
  `耗时(ms)：parse=0.85 apply=142.0 consistency=9.27 indexRebuild=1.27 snapshot=1.02 assert=0.27 wallClock=155.4`、
  `计数：consistencyChecks=109 indexShadowRebuilds=10 protocols=111 resolveRoundsMax=2`。
- 脱敏 fixture 落在 `tests/replay/tracker/fixtures/hand-transfer-reveal-retransfer.jsonl`（111 条，仅重写 `user_temp_id`），
  由 `tests/replay/tracker/handTransferReveal.fixture.test.ts` 断言 `10/129 -> seats [2, 7]`。
- 影子索引重建进入 `indexRebuild` 计时与 `indexShadowRebuilds` 计数，不再静默执行；
  deep 模式实测 `indexRebuild=33.6ms / 206.6ms`（约 16%），fast/watch 降到 0.3–1.3ms。

### Phase 1：候选 watch、diff 与领域断言（P0）✅ 已完成

**目标**：把“最终状态不对”变成“seq X 的哪一次变化不对”。

工作项：

1. 实现 watched card/seat 过滤和候选前后 diff。
2. 导出 `reason`、`constraintGroupID`、`sourceEvent` 摘要。
3. 增加可编程断言，例如：

   ```ts
   expectCardSeatsAt(111, 10, [2, 7])
   expectCardSeatsAt(111, 129, [2, 7])
   ```

4. 首次违反断言时立即停止，并输出相关事件的因果闭包，而不是固定最近 5 条协议。
5. 将 `ignored` / `partial` 变成带原因和影响对象的结构化状态；出现不完整输入时标记 replay tainted。

验收（实测）：

- `DXC_TRACKER_REPLAY_WATCH_CARDS=10,129 pnpm replay:tracker` 一次回放输出 8 条变化，
  完整覆盖计划 §2.2 的因果链：`seq 85`（7→2 整手随机转移，收敛落定 2 号位）、
  `seq 100`（129 明牌揭示进入 2 号位）、`seq 111`（2→7 再次转移，两张牌各 `+candidate player:2:hand:none` 与 `player:7:hand:none`）。
  报告总量 6654 B / 263 行。
- 断言失败会真的失败：`handTransferReveal.fixture.test.ts` 用一条故意写错的
  `expectCardSeatsAt('final', 10, [2])` 验证 `success=false` 且产出因果闭包，
  `protocolReplayDiagnostics.test.ts` 另外验证定点断言对应 `seq` 未出现时按“断言未被求值”计为违反。
- `ignored` / `partial` 归并为结构化 `report.nonApplied`（含 `affectedCardIDs` / `affectedSeatIDs`），
  `partial > 0`、索引检查降级、`toSeq` 截断、watch 日志超限都会写入 `diagnostics.taintReasons`。

**未做**：`fromSeq` 需要前缀状态，依赖 Phase 3 的 checkpoint，本轮只实现 `toSeq`。

### Phase 2：范围回放、快照降级与上下文裁剪（P1）⏳ 部分完成

**目标**：让长回放按相关范围运行，默认不生成全量快照。

工作项：

1. 支持 `fromSeq` / `toSeq`；内部允许非 1 起始序号，保留原始 `seq`，不要求用户重编号。
2. 默认只保存 delta 和最终摘要；前置状态只在断点附近按需捕获。
3. 只在 dirty 变化或 checkpoint 执行深度索引检查。
4. 将 `contextSize` 拆成协议上下文和状态上下文，分别限制大小。
5. 增加“只输出相关座位/卡牌/约束”的 compact formatter。
6. parser 支持流式读取或至少按文件偏移建立 seq 索引，避免每次完整 `split`。

本轮已完成 2（默认不再逐条建快照；失败前状态只在 `captureFullSnapshots` 时给出，取消前缀重复回放）、
3（`mode` 控制影子索引检查节奏，fast 全跳、watch 每 16 条、deep 逐条，且收尾必补一次全量核对）、
4（`contextBefore` / `contextAfter` 拆分）、5（compact formatter）；
1 只做了 `toSeq`（parser 已放开“必须从 seq=1 开始”，截取片段可直接回放）；6 的流式解析未做。

验收（实测）：

- 111 条案例 watch 输出 6654 B，远低于 32 KB 上限，且含完整因果链。
- 默认不再生成逐条快照；`fullSnapshots` 计数可直接核对。
- `toSeq=60` 截断与“先过滤到 seq ≤ 60 再完整回放”的最终状态逐字节一致（fixture 测试覆盖）。
- fast / watch / deep 三档最终状态逐字节一致（fixture 测试覆盖）。

### Phase 3：checkpoint、二分和最小化（P1）⛔ 未开始

**目标**：把“从 111 条里找首个错误”缩短为对数次回放。

工作项：

1. 在牌堆初始化、洗牌、关键移动后建立 checkpoint。
2. checkpoint 包含版本、GameState、Room 必要状态和恢复校验码。
3. 对可执行的语义断言提供自动二分，定位最早违反断言的 `seq`。
4. 在二分结果上做依赖裁剪：保留目标卡牌、相关约束组、来源事件和必要前置协议。
5. 输出最小 fixture 草稿，供开发者确认后加入回归测试。

验收：

- 对 10,000 条协议的单一断言，定位次数从 O(N) 降到 O(log N) 级别（不计首次建立 checkpoint）。
- 最小化结果仍能稳定复现同一首错 `seq`。
- checkpoint 恢复失败时自动回退完整回放，不改变正确性。

### Phase 4：录制完整性、生产 parity 与 CI 闭环（P1/P2）⏳ 部分完成

**目标**：避免“回放成功但录制缺信息”，并防止真实组合路径再次回归。

工作项：

1. 为录制文件增加 schema/version、代码版本、协议规则版本、录制开始/结束信息和视角元数据。
2. 记录被过滤协议的计数与原因；投影异常不能只写控制台警告。
3. 提供可选 raw payload sidecar；默认仍使用脱敏投影。
4. 对生产路由和回放路由建立 parity 测试，优先共享归一化与应用入口。
5. 将当前案例缩减为 `tests/replay/tracker/fixtures/` 下的最小 JSONL，并在 CI 运行语义断言。
6. CI 同时运行回放 helper 测试和至少一份真实脱敏 fixture；不要只运行被 runner 排除的合成测试。

本轮已完成 5（脱敏 fixture 进入 `tests/replay/tracker/fixtures/`）和 6（CI 增加 `pnpm test:replay`，
同时跑 helper 测试和真实脱敏 fixture 的语义断言）；1–4（录制 schema/version、被过滤协议统计、
raw sidecar、生产 parity）未做，仍属录制侧改造。

验收（实测）：

- 回放报告能回答“未完整应用了哪些协议、是否存在不完整输入”（`report.nonApplied` + `diagnostics.taintReasons`）；
  “哪些协议在录制阶段就被过滤掉了”仍需录制侧改造，本轮未覆盖。
- 生产与回放的 parity fixture 未做。
- 候选回归已在 CI 可见，不依赖开发者本地 `replays/`。

---

## 6. 性能与上下文验收指标

以下指标作为实施闸门；若真实样本扩大，应按同一口径重新记录，不直接复制绝对数：

| 指标 | 当前基线 | 目标 | 实测结果 |
| --- | ---: | --- | --- |
| 默认报告是否包含逐条完整状态 | 否 | 保持否 | 否（仅 `captureFullSnapshots` 时输出） |
| watch 报告体积（当前 111 条案例） | 无专用模式 | ≤ 32 KB | 6654 B ✅ |
| full trace 相对默认输出 | 约 525 倍 | 仅显式 deep 模式启用 | `TRACE=1` 映射为 deep + fullSnapshot ✅ |
| 首个语义错误定位 | 人工比较终态 | 一次 watch 回放直接给出 `seq` | 断言违反直接给出 `seq` + 因果闭包 ✅ |
| 失败前缀重复回放 | 有 | 取消；复用当前状态或 checkpoint | 已删除 `createFailureStateBefore()` ✅ |
| 深度影子索引重建 | 每个移动协议 | fast/watch 模式按间隔或 checkpoint 执行 | deep 138 次 / watch 10 次 / fast 2 次 ✅ |
| 录制完整性可见性 | 无丢弃统计 | 报告 dropped/partial/tainted | `nonApplied` + `taintReasons` ✅（录制侧过滤统计仍缺） |
| 真实案例 CI 覆盖 | 无 | 至少 1 个脱敏回放 + 领域断言 | CI 增加 `pnpm test:replay` ✅ |

性能优化不能只看 `recordTraversal()` 数字；应同时报告各阶段 wall-clock。现有增量索引计划已经证明，遍历数量和实际耗时可能不成比例，因此本计划把阶段计时放在 Phase 0。

---

## 7. 测试策略

### 7.1 单元测试

- `ReplayCardChange` 前后候选 diff 的幂等性、排序和匿名牌处理。
- watch 过滤不改变未过滤状态。
- `fromSeq/toSeq` 与完整回放状态一致。
- `ignored`、`partial`、`tainted` 的分类和累计。
- checkpoint 保存/恢复与完整回放等价。
- compact formatter 不展开全牌堆列表。

### 7.2 回放回归

- 当前 10/129、2/7 真实案例。
- “整手转移 → 中途揭示一张牌 → 再次随机转移”组合路径。
- 录制开始过晚、断线重连、未支持协议和投影字段缺失。
- 多局协议连续写入时的 session 分段。

### 7.3 性能回归

- 111 条真实 fixture：默认、watch、deep 三档对比。
- 1,000 / 10,000 条合成协议：内存、解析、快照和索引重建次数。
- 有/无 checkpoint 的二分定位耗时。

涉及 `src/tracker/` 或回放驱动代码时，按 `docs/agents/testing.md` 执行适用的 `pnpm test:tracker`、`pnpm test:replay`、类型检查、lint 和 build。

---

## 8. 风险与控制

| 风险 | 控制措施 |
| --- | --- |
| 诊断埋点改变收敛时序 | 只读采集；不得在事件回调中修改候选或约束。增加开启/关闭对照测试。 |
| provenance 无限增长 | 只保存 watched card 相关链和有限长度 tombstone；默认有上限。 |
| checkpoint 序列化遗漏隐藏状态 | 加版本号和恢复后 deep consistency；失败自动回退全量回放。 |
| 过滤过度导致误判 | 保留 dropped/partial 统计；tainted 状态禁止报告“确定正确”。 |
| 回放与生产继续漂移 | 优先共享归一化/应用入口，增加 parity fixture。 |
| 原始协议泄露隐私 | raw sidecar 默认关闭，导出前脱敏用户 ID、隐藏牌信息和账号字段。 |
| 只为单个案例过度设计 | Phase 1 先实现通用 watch/diff/assertion，checkpoint 和最小化必须通过长回放基线后再做。 |

---

## 9. 建议实施顺序与决策门

### 第一优先级（必须先做）

1. Phase 0 性能/完整性埋点。
2. Phase 1 watch + 候选 diff + 领域断言。
3. 将当前真实案例纳入脱敏 fixture。

如果这三项完成后，定位时间已经从“人工翻完整 Trace”降到一次命令，则再决定是否投入 checkpoint/二分；不要先实现复杂状态序列化。

### 第二优先级（长回放确实出现瓶颈时）

1. Phase 2 范围回放和 compact 输出。
2. Phase 3 checkpoint、二分和最小化。

### 第三优先级（回归和长期维护）

1. Phase 4 录制 schema、完整性报告和 parity。
2. CI 真实 fixture 与文档更新。

### 明确不采用的方向

- 默认开启全量 Trace。
- 通过扩大最近协议上下文数量解决因果定位。
- 将所有原始协议无筛选地写入回放文件。
- 只增加更多最终状态字段，而不记录变化原因和来源。

---

## 10. 预计改动面

### 回放与诊断（本轮实际改动）

新增：

- `tests/replay/tracker/helpers/protocolReplay/metrics.ts`（阶段计时与计数）
- `tests/replay/tracker/helpers/protocolReplay/watch.ts`（watched card 只读投影、diff、约束 provenance）
- `tests/replay/tracker/helpers/protocolReplay/assertions.ts`（可编程领域断言与内置断言工厂）
- `tests/replay/tracker/helpers/protocolReplay/reportFormat.ts`（compact formatter，从 `index.ts` 拆出）
- `tests/replay/tracker/fixtures/hand-transfer-reveal-retransfer.jsonl`（脱敏真实录制）
- `tests/replay/tracker/handTransferReveal.fixture.test.ts`
- `tests/replay/tracker/protocolReplayDiagnostics.test.ts`

修改：

- `tests/replay/tracker/helpers/protocolReplay/types.ts`、`index.ts`、`snapshot.ts`、`parser.ts`、`handlers.ts`
- `tests/replay/tracker/protocolReplay.runner.js`、`protocolReplay.test.ts`
- `.github/workflows/ci.yml`（新增 `pnpm test:replay`）

### 运行时最小埋点

**本轮 `src/tracker/` 零改动。** 候选 diff 与约束 provenance 都在回放器一侧只读采集，
现有 `Room.dirtyCardEvents`（带单调 `seq`）与 `ConstraintGroup.sourceEvent` 已经够用。

只有在下列情况下才需要真正的运行时埋点，且必须保持只读、可关闭、有限长度：

- `src/tracker/runtime/protocolRecorder.ts` / `protocolRecordingRules.ts`：录制 schema/version 与被过滤协议统计（Phase 4 剩余项）。
- `src/tracker/Room.ts` / `Card.ts`：若 `DIRTY_CARD_EVENT_LIMIT` 截断在长回放中变成常态，再考虑为诊断提供独立的可关闭事件通道。

---

## 11. 关联回归背景

历史上已经分别修复过：

- 随机手牌转移的全实体候选模型。
- 目标槽位填满后的候选收敛。
- 已有完整位置候选时 `addSeat()` 未真正追加目标座位。

本次真实回放是“连续转移 + 中途揭示 + 再次转移”的组合路径，旧单测没有覆盖完整事件序列；同时真实 `replays/` 不进入 CI，导致修复没有被该组合样本持续验证。

因此本计划把“最小真实回放 + 语义断言 + CI”视为诊断系统的组成部分，而不是可选的测试附属物。

---

## 12. 当前状态与下一步

当前状态：**Phase 0、Phase 1 已实施并通过；Phase 2 部分完成；Phase 3 未开始；Phase 4 只完成 fixture 与 CI 闭环。**

### 怎么用

```sh
# 日常回归（默认 watch 档，含阶段耗时与计数）
pnpm replay:tracker

# 定向定位某几张牌
DXC_TRACKER_REPLAY_WATCH_CARDS=10,129 pnpm replay:tracker
DXC_TRACKER_REPLAY_WATCH_SEATS=7 DXC_TRACKER_REPLAY_TO_SEQ=111 pnpm replay:tracker

# 档位与完整快照
DXC_TRACKER_REPLAY_MODE=fast|watch|deep pnpm replay:tracker
DXC_TRACKER_REPLAY_TRACE=1 pnpm replay:tracker   # = deep + fullSnapshot，输出 2.39 MB，仅用于疑难审计

# 写回归时直接用 TypeScript API，不要把能力锁死在环境变量上
new TrackerProtocolReplayer({
  mode: 'watch',
  watchCardIDs: [10, 129],
  assertions: [expectCardSeatsAt('final', 10, [2, 7])]
})
```

### 下一步决策门

Phase 0 + Phase 1 已经把定位成本从“人工翻 2.39 MB Trace”降到“一条命令 + 6.6 KB 因果链”，
按 §9 的决策门，**先不投入 checkpoint / 二分**。等出现下列信号之一再启动 Phase 3：

- 真实回放规模超过约 1000 条协议，`apply` 阶段耗时成为主导且需要反复定位；
- 需要 `fromSeq` 从中间起播（当前只支持 `toSeq`）；
- watch 日志或约束 provenance 频繁触发上限（`taintReasons` 会显式提示）。

Phase 4 剩余的录制 schema/version、被过滤协议统计与生产 parity 属于录制侧改造，
可以独立于本计划推进；完成后按 `docs/agents/` 的要求回写稳定行为。
