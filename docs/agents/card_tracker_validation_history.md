# 记牌器验证历史（按需）

> 只有在追溯历史里程碑、旧遍历基线、某次重构完成范围或当时实际执行的校验时才阅读本文。
> 当前任务应执行哪些校验，以 [`testing.md`](testing.md) 和 [`card_tracker.md`](card_tracker.md) 的现行规则为准；
> 下列测试数量与基线数字都是当时快照，不是永久预期值。

## 时间线

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
- 2026-07-20：匿名牌堆阶段 1 完成；牌堆槽与身份解耦，G1 最终决定 NO-GO / 收缩，阶段 2–7 不执行，临时真实回放探针退役；决策归档按需见 [`replay.md`](replay.md)。
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
- 2026-08-02：收口牌堆身份模型评审反馈：非牌堆公共区无 CardIDs 移动恢复消费实际端点，
  纯模型统一身份归一化、空弃牌洗牌索引与固定 seed 事件覆盖，并明确阶段纯模型长期保留。
  洗牌遍历基线记录匿名生产路径 197、历史已物化对照 308；Prettier、`git diff --check`、
  `pnpm test:tracker`（49 个文件、426 项）、`pnpm typecheck:tracker`、`pnpm typecheck`、
  `pnpm lint`、`pnpm build`、`pnpm build:prod` 全部通过。
- 2026-08-02：洗牌新建的 detached suspended 身份改为按最终状态直接注册，避免没有旧投影
  可清理的实体进入通用脏事件流；`Zone.replaceAll()` 不再重复改写已在本区关系中的卡牌状态，
  `CardCounter` 同步推进显式注册实体的尾部游标。匿名生产洗牌基线由 197 降至 12，历史
  已物化对照由 308 降至 160；`pnpm test:tracker`（49 个文件、427 项）、
  `pnpm typecheck:tracker`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm build:prod`
  全部通过。

## 维护约定

- 新的里程碑验证记录追加到本文，不再扩写 `card_tracker.md`。
- 当前测试入口、最低验证集或命令发生变化时更新 [`testing.md`](testing.md)，不要只修改历史记录。
- 涉及真实协议录制、JSONL 回放或匿名槽 G0/G1 决策证据时，转读 [`replay.md`](replay.md)。
