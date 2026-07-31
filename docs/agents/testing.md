# 测试与验证策略

> 当你需要为改动选择验证命令、补充回归测试、理解现有测试布局，或做手工验收时，请阅读本文档。
>
> 记牌器领域风险与特殊边界见 [`card_tracker.md`](card_tracker.md)；命令执行细节见 [`commands.md`](commands.md)。

---

## 当前测试版图

- 测试运行器：Vitest（`vitest.config.js`）
- 环境：`node`
- 包含范围：`tests/**/*.test.{js,ts}`
- 覆盖率配置：默认关注 `src/tracker/**/*.{js,ts}`，排除 `src/tracker/view/**`
- 现状：
  - 已有较完整的记牌器单元/回归：`tests/tracker/`
  - 已有少量运行时与外围工具测试：`tests/runtime/`、`tests/utils/peixiuRouteFeature.test.js`
  - **没有**通用 `pnpm test` 脚本；记牌器专用脚本是 `pnpm test:tracker`（只跑 `tests/tracker`）
  - **没有**浏览器 E2E / 用户脚本注入自动化

### 主要目录

| 路径                     | 覆盖重点                                              |
| ------------------------ | ----------------------------------------------------- |
| `tests/tracker/`         | Room 移动、候选、收敛、Controller、脏渲染、遍历基线等 |
| `tests/tracker/helpers/` | 测试夹具与 noop runtime/view                          |
| `tests/runtime/`         | 宿主运行时适配、窗口关闭与对局结束 UI 生命周期        |
| `tests/utils/`           | 非 tracker 工具逻辑，如裴秀路线                       |

### 现有 tracker 回归主题（按文件名归类）

- 导入边界：`room.import.test.ts`、`state-user.import.test.ts`
- 控制器与协议路由：`trackerController.test.ts`、`moveCardRoutes.test.ts`、`moveEventNormalizer.test.ts`
- 候选与位置：`locationCandidates.test.ts`、`publicCandidates.test.ts`、`publicFieldCandidates.test.ts`、`locationIndex.test.ts`、`cardLocationIndexIncremental.test.ts`
- 约束与收敛：`convergenceTermination.test.ts`、`resolveConstraintsIncrementalIndex.test.ts`、`ambiguousKnownIndexIncremental.test.ts`
- 暗牌 / 标记 / 随机转移：`hiddenMarkCandidates.test.ts`、`randomTransferLifecycle.test.ts`、`handCountObservation.test.ts`、`playerHandMirror.test.ts`
- 局流与技能副作用：`gameFlowState.test.ts`、`spellEffects.test.ts`、`roleOptTargetNtf.test.ts`
- 视图与展示：`viewDirtyRender.test.ts`、`pileDisplayOrder.test.ts`、`suitGlyph.test.ts`
- 性能护栏：`traversalBaseline.test.ts`
- 计数器：`cardCounter.test.ts`
- 日志：`moveEventLogging.test.ts`

---

## 常用命令

```sh
pnpm test:tracker
pnpm typecheck:tracker
pnpm typecheck
pnpm lint
pnpm build
pnpm build:prod
```

补充：

- 跑全部 Vitest 匹配文件（含 `tests/utils`）：

```sh
pnpm exec vitest run
```

- 单文件 / 关键字：

```sh
pnpm exec vitest run tests/tracker/locationCandidates.test.ts
pnpm exec vitest run -t "shuffle"
```

- 更新遍历基线快照（仅在解释清楚数字变化后）：

```sh
pnpm exec vitest run tests/tracker/traversalBaseline.test.ts -u
```

- 覆盖率（可选，关注 tracker 核心）：

```sh
pnpm exec vitest run --coverage
```

Windows 本机执行时遵循 [`commands.md`](commands.md) 与 Serena 本机记忆；仓库文档不绑定具体 Shell 细节。

---

## 何时跑什么

| 改动范围                                                   | 最低验证                                                        |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| 仅文档 / 注释                                              | 无需构建与测试                                                  |
| 普通 `src/` 代码（非 tracker 高风险）                      | `pnpm lint` + `pnpm build`                                      |
| `src/tracker/` 或 `tests/tracker/`                         | `pnpm lint` + `pnpm build` + `pnpm test:tracker`                |
| TS 类型契约、`tsconfig*`、ESLint TS 覆盖、tracker 类型迁移 | `pnpm typecheck:tracker`；需要确认全仓入口时再 `pnpm typecheck` |
| `tests/utils/` 或非 tracker 测试                           | `pnpm exec vitest run`（或对应文件）+ 适用 lint/build           |
| 发布配置、打包参数、用户脚本元信息、核心协议高风险路径     | 额外 `pnpm build:prod`                                          |
| 修改 `html/iframe.html` / 远端配置加载                     | 本地 dev 注入验收 + 确认远端部署流程                            |
| Serena 记忆                                                | `serena memories check`                                         |

CI（`.github/workflows/ci.yml`）在 `dev` / `main` 的 PR 与 push 上会跑：`lint`、`typecheck`、`test:tracker`、`build`；`main` 的 push 额外 `build:prod`。本地提交前尽量对齐，避免只靠 CI 兜底。

---

## 什么时候必须补测试

优先补自动化测试，而不是只写“本地看过”：

1. **记牌器状态机**
   - `Room.moveCards()` 新路线或边界组合
   - 候选模型：`locationCandidates` / 公共候选 / 座位投影
   - `resolveConstraints()` 收敛、触碰座位、终止条件
   - 洗牌、暗占位、暂停追踪、暗置标记账本
   - 随机手牌转移、跨座位候选
2. **协议归一化**
   - `MoveEventNormalizer`、zone 映射、特殊 `FromID` / `MoveType`
   - handler 预处理改变 tracker 输入语义时
3. **增量索引 / 性能路径**
   - `CardLocationIndex`、`AmbiguousKnownIndex`、player 快照
   - 任何新增全牌池扫描：必须 `recordTraversal(...)` 插桩，并更新 `traversalBaseline` 场景
4. **可见但可单测的纯逻辑**
   - 计数器、展示顺序、花色 glyph、裴秀路线求解
5. **回归过的 bug**
   - 每个已修复的协议/收敛缺陷，尽量留最小复现测试

可以先不强制自动化、但需要手工验收的：

- 真实浏览器注入、Tampermonkey 权限/匹配
- iframe HTML 布局、拖拽、快捷键手感
- 远端 `Config_w.sgs` / HTML 资源加载
- 录像 UI 与宿主页面耦合行为

### 匿名槽回放决策记录

匿名槽阶段 0/1 的 G0、G1 回放采集已经结束，最终决定为 NO-GO / 收缩：保留匿名牌堆，不推进
阶段 2–7。临时浏览器回放探针与固定 G0 五站点 schema 已从运行时移除。

历史决策、阶段 0 冲突基线与阶段 1 对照数据已合并到本地归档
[`plans/anonymous-entity-and-slot.md`](../../plans/anonymous-entity-and-slot.md)
（该目录被 `.gitignore` 忽略）。通用性能变更仍必须使用
`recordTraversal(...)` 和 `tests/tracker/traversalBaseline.test.ts` 维护自动化遍历护栏。

### 牌堆身份纯模型

`tests/tracker/pileGenerationPool.test.ts` + `tests/tracker/helpers/pileGenerationPoolModel.ts`
并排维护三个不接生产状态的模型：当前正 ID 暗槽基线、全局世代滚动、批次候选集合 +
`remainingPileCount`。目标测试当前为 57 例。

建模范围：计划 §5.3.2 枚举的 B8–B11（潜伏、伊籍机捷、骋烈/天辩/宴戏、特殊装备牌）
由各自的特殊路径实现，不在本纯模型内，因此没有对应事件类型，批次消费也只有牌顶方向。

必须保持的结论：

- 活动卡池大小与物理牌堆槽数不等是合法状态；不得把两者等量当作身份守恒条件。
- active pool 表示“仍保留牌堆来源可能性”，不是“确定仍在牌堆”。全局世代模型未显示的
  active 身份若后来被 oracle 证明已离开牌堆，应记为 `omittedOutsidePileIDs`，不是模型
  `falseNegativeIDs`。
- `runCohortPoolModel()` 不分配 CardID ↔ 匿名槽，只维护每个批次的候选身份集合与在牌堆
  数量。暗摸减少批次基数；按来源揭示收紧集合/基数；洗回身份在牌底侧建立新批次。
- 批次模型不一定降低扁平候选按钮数量。两周期夹具最终宽度为 10，但保留 `{6,7}/0`、
  `{1..5}/0`、`{8,9,10}/1` 三个精确关系，且没有具体身份牌堆断言错误。
- `projectCohorts()` 把批次投影成 `all-in-pile` / `none-in-pile` / `partial` 三类可读
  陈述。其中 `none-in-pile` 是扁平投影无法表达的一类，也是批次模型的主要信息收益；
  前两类都是对用户的确定陈述，必须用 `evaluateCohortProjection()` 逐组过 oracle。
- `k=0` 只是不满足普通自动补牌的超量摸牌前置条件；显式回收或未知原因的 `2 -> 9` 仍是
  独立事件，不能笼统称为协议非法。
- oracle 必须验证初始牌序身份全集、洗回排列、自动补牌触发条件和物理槽上限；基线模型
  不得用空 `pop()` 静默生成匿名槽。

真实回放没有服务器隐藏牌序，只能采集同一有效 belief epoch 内由后续协议证实的错误断言/
投影遗漏下界，以及未决风险集合、暴露事件数和持续时间；不得直接命名为完整假阴性率。

### belief epoch 与只读 observer

- `tests/tracker/helpers/pileBeliefEpoch.ts`：纯模型侧的 epoch 采集 schema（13 例回归）。
- `src/tracker/observer/beliefEpochObserver.ts`：Phase 1 报告汇总、三路 epoch 与
  cohort-cardinality 采集。
- `src/tracker/observer/pileIdentityModelComparison.ts`：当前 UI、generation、cohort
  三模型只读影子状态与候选差异。
- 两个 observer 测试文件合计 44 例。实现**只读 `Room`，不写 Room / 视图 / 索引**，
  并由 `import.meta.env.DEV` 限定在测试环境。

必须保持的结论：`revealFromHand` 证明某身份在暗区，但暗摸本身就能合法带走牌堆任意一张，
因此断言与证据之间隔着匿名消费时**不能**判定模型错误。证据分两层：

```text
confirmedContradictionCount    epoch 仍有效时被证伪 —— 无合法解释
explainedContradictionCount    epoch 已失效后被证伪 —— 存在合法解释
```

前者在多数序列里恒为 0，这是「下界」的真实含义，不是「模型没有错」。

读数入口：`import.meta.env.DEV` 只在 **serve** 模式为真（`pnpm build --mode development`
同样会剔除 observer），因此对局验证必须用 `pnpm dev`，控制台执行 `__trackerBeliefReport()`。
当前阶段只验证测试环境，不执行生产产物字符串检索。

基线断言必须覆盖牌堆内全部 `id > 0` 的身份绑定槽，包括洗回后的正 ID 暗槽；稳定负 ID
匿名槽才不产生具体身份断言。旧采集器只统计 `isKnown === true`，所以「只有观星局才有
in-pile 断言」和「四局中三局无断言」均已作废。

`metrics.maxDisplayedCandidateCount` 必须使用与 UI 等价的纯只读候选选择逻辑，不能读取
`pile.cards.length`。旧值 `161` 是物理牌堆峰值，不是候选按钮数。

为覆盖暗槽，observer 另采集 `cohort-cardinality` 批次基数断言，载体是
`Card.publicCandidates` 的牌堆端点，不依赖 `isKnown`。两类断言共用同一套失效语义。
`maxCohortCandidateCount - declaredCount` 就是分组投影要压缩的模糊度。

报告必须包含：

- `modelMetrics.baseline/generation/cohort`：三路 epoch、矛盾与风险 exposure。
- `modelComparison.metrics`：三路候选峰值、cohort 扁平宽度/分组数、批次降级与
  unsupported 计数。
- `modelComparison.snapshot`：generation/cohort 相对当前 UI 的增删差异与批次分组。
- `modelComparison.degradations`：每条降级除序号与原因外，必须保留事件类型、来源/目标区、
  位置、牌数、CardIDs、MoveType、SpellID 与事件后牌堆张数，确保真实报告可直接回到协议
  分类；另保留 `boundaryRisk`、`boundaryDegraded` 与合并前后组数。风险事件数与实际分组
  下降次数必须分别统计。匿名任意位置取牌可记录在该数组中用于协议审计，但必须使用
  `boundaryRisk=false`、`boundaryDegraded=false`，不能因 cohort 数量归一化就算作信息损失。

匿名公共区取牌的生产回归必须覆盖：协议无 CardIDs 时只消费 `isKnown !== true` 的暗槽；
牌顶或牌底已有明牌时跳过明牌；规则按来源位置与 CardIDs 可见性处理，不绑定某个 SpellID。
协议给出 CardIDs 时仍精确移动对应身份。

真实对局已进入多局采样。178 事件历史样本用最新口径重跑后，
`totalCohortBeliefCount=5`、`maxConcurrentCohortBeliefCount=2`、
`maxCohortCandidateCount=1` 仍可证明 cohort 入口已触发；真实 `maxDisplayedCandidateCount=1`，
baseline/generation/cohort 的 epoch 为 0/161/161，三路 exposure 均为 0。该回放不计入独立
实战样本，旧基线指标、`verdict` 与 `maxDisplayedCandidateCount=161` 仍不得沿用。

首局修正口径冒烟共 445 事件：当前 UI 候选两路峰值均为 7；baseline/generation/cohort
分别产生 152/317/317 个 epoch，风险 exposure/event 为 24.32/0/1.89。cohort 扁平候选
峰值 161、最多 10 组，说明分组成本受控但扁平宽度没有改善。旧 observer 曾把两次
`SpellID=3644` RANDOM 匿名取牌记为实际降级；当前按通用 B15 语义重判为正常
`anonymous-pile-draw` 失效，不绑定 3644，也不计风险/降级。因此本局计数为 4 次 B6 边界
风险、0 次实际分组合并，unsupported 为 0。

第 2 局共 101 个事件，baseline/generation/cohort 的 epoch 为 0/166/285，三路 exposure/event
均为 0；current/generation/cohort 扁平候选峰值为 0/0/166，cohort 最多 1 组。此时
`maxBelievedInPileCount=166`，所以 166 的扁平宽度表示整批身份都确定在堆，不是 166 份歧义。
本局 7 次 B6 风险全部为 `1 -> 1`、未降级。前两局已知边界记录累计为 B6 风险 11 次、
实际降级 0 次；B15 两次只作正常匿名失效记录。

第 3 个独立样本共 140 个事件，无 belief、矛盾或 exposure；baseline/generation/cohort epoch
为 0/161/365，`maxBelievedInPileCount` 为 0/161/161。三局累计 686 个事件，三路 epoch 为
152/644/967，exposure 总数为 10821/0/843，按事件归一为 15.77/0/1.23，确认矛盾均为 0。
第 3 局缺少 `modelComparison.metrics/degradations`，不计入边界事件汇总。

手气卡 B6 的主视角可能给出具体 CardIDs，其他视角为空；两者都只证明牌返回牌堆，不证明
位于牌顶。协议预处理与 tracker 装饰必须统一把目标位置标为 `POSITION_RANDOM`，并继续用
`resetKnownToUnknown` 匿名化。

后续改为机会性采样：遇到牌堆交互时仍分别保存边界风险、实际降级与协议上下文，但不设置
必须完成若干局的硬门槛。样本少、洗牌少或牌堆交互低频不能单独构成 NO-GO。

当前测试契约与阶段闸门见
[`docs/pile-identity-cohort-plan.md`](../pile-identity-cohort-plan.md)；历史推演归档于
[`docs/pile-generation-identity-pool-plan.md`](../pile-generation-identity-pool-plan.md)。

---

## 编写测试的约定

- 新测试放在与主题接近的现有文件；新主题再开 `tests/<area>/*.test.ts`
- 优先复用 `tests/tracker/helpers/`，避免每个用例重复搭 Room / Controller
- 测试名写清场景与期望，例如“洗牌 cardCount 大于本地枚举时保持匿名占位账本”
- 断言关注**可观察状态**：owner、locationCandidates、手牌额度、公共区顺序、脏集合、遍历计数；少断言实现细节私有字段
- 不要依赖真实 DOM / Laya；需要视图时用 helper 中的 noop 或最小 stub
- 保持与源码一致的风格：2 空格、LF、单引号、无分号（Prettier）
- Style Guide 同样适用于测试：优先 `const`、early return、避免别名导入
- 不为了过测试削弱生产断言；必要时拆“可注入依赖”而不是删护栏

### 遍历基线特别规则

- `tests/tracker/traversalBaseline.test.ts` 是性能回归护栏，不是普通业务断言
- 结构性优化导致数字下降：可更新快照，并在 PR 说明收益场景
- 无关改动导致数字上升：先解释原因；不能无说明地 `-u`
- 新增必要全量扫描：先问能否改增量；若必须全量，插桩 + 基线场景同步落地

领域风险细则仍以 [`card_tracker.md`](card_tracker.md) 的「风险与验证清单」为准。

---

## 建议的测试分层

```text
L0 静态检查     lint / typecheck
L1 单元回归     tests/tracker + tests/utils
L2 构建产物     pnpm build / build:prod
L3 手工注入验收 浏览器 / 微端真实页面
```

当前仓库自动化主要覆盖 L0–L2 中的 tracker 与构建；L3 仍靠开发者手工。

---

## 手工验收清单

改到对应能力时，至少覆盖相关项。不必每次全做，但 PR 应写明做了哪些。

### 脚本注入与壳

- [ ] 匹配站点可注入；排除站点不注入
- [ ] 刷新后无重复面板 / 无残留 DOM
- [ ] 主窗口可显示、隐藏、拖拽；显隐快捷键有效
- [ ] 窗口缩放后座位覆盖与面板位置仍可用

### 记牌器核心

- [ ] 开局/录像开局后座位与主视角正确
- [ ] 摸牌、弃牌、置入装备/判定区后计数与展示正确
- [ ] 暗牌移动后候选合理，不出现错误 owner 实锤
- [ ] 洗牌后牌堆张数、顶底候选、暗标记账本不漂
- [ ] 玩家来源明牌残留公共区时占位回补正确
- [ ] 手牌暗置标记区的多选一/多选多场景保守可收敛
- [ ] 对局结束或离桌后状态清理，不开下一局串数据
- [ ] 高频出牌时面板无明显闪烁或节点丢失

### 外围能力

- [ ] 斗地主：先手/身份相关展示与记牌不互相覆盖错误
- [ ] 山河图：提示与城市/商店信息可显示
- [ ] 裴秀：地图窗口、路线与花色统计与协议输入一致
- [ ] 聊天过滤：重复/跑马灯等过滤开关行为符合设置
- [ ] 本地设置项修改后可持久化，并触发预期刷新

### 发布相关

- [ ] `pnpm build:prod` 产出 `daxiaochao.user.js` / `daxiaochao.meta.js`
- [ ] 用户脚本 version、match、updateURL/downloadURL 符合预期（生产模式）

---

## PR 中如何写验证

沿用：

```md
## 验证

- 命令：`pnpm test:tracker`、`pnpm lint`、`pnpm build`
- 手工：开局摸牌、洗牌后顶底候选、主视角切换
- 未跑：`build:prod`（未改打包配置）
```

要求：

- 写实际跑过的命令，不写“应通过”
- 跳过项说明原因
- 修复类附复现路径与回归测试文件名
- 若更新了 `traversalBaseline` 快照，写清前后差异与原因

---

## 已知缺口（文档同步点）

以下是当前策略上的诚实缺口，后续补齐时应同步改本文件：

- 无通用 `pnpm test`；`test:tracker` 不包含 `tests/utils`
- 浏览器注入 / 用户脚本 E2E 未建立
- `Room.moveCards()` 组合路线与技能精细推断仍有覆盖空洞
- UI 视图层默认不在 coverage include 的核心关注内
- 外围功能（聊天、山河图、设置）自动化很少，主要靠手工

---

## 相关文档

- [`conventions.md`](conventions.md)：何时 lint/build/typecheck，以及 PR 验证写法
- [`card_tracker.md`](card_tracker.md)：记牌器风险清单与领域回归重点
- [`lifecycle.md`](lifecycle.md)：开局、移动、结束等运行时路径
- [`environment.md`](environment.md)：脚本与环境入口
- [`commands.md`](commands.md)：终端执行约定
