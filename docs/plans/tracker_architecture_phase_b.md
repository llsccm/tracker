# Phase B（P0-2）：统一“三轨分裂”的技能扩展管线

> 导航：[总览](tracker_architecture_refactoring_plan.md) · [Phase A](tracker_architecture_phase_a.md) · [Phase C](tracker_architecture_phase_c.md)
>
> 状态：已完成，执行记录与验证结果见下文。

## 执行方案（2026-10-22）

本节为 Phase B 的实施依据，优先于下方初版接口草案。

### 分支与交付顺序

- Phase A 当前位于本地 `codex/room-pile-identity-transactions` 的 `01c0cab`，其父提交为
  `origin/dev` 的 `b97902e`，尚未推送。Phase B 从该 Phase A 提交创建
  `codex/tracker-skill-lifecycle`，完整继承 A1/A2 的事务与 detached 身份改动。
- 本地 `dev` 另有两条不属于本次重构的提交，不作为本阶段起点。无需先推送、合并或重写 Phase A。
- 本阶段本地实现与验证已完成。后续发布时先合入 Phase A，再让 Phase B 指向 `dev`；若采用
  squash 合入 Phase A，使用 `git rebase --onto origin/dev 01c0cab codex/tracker-skill-lifecycle`
  迁移仅属于 B 的提交。执行前应确认远端已包含 A 的最终实现且工作区干净。
- 逻辑审阅顺序为 B1 插件契约、B2 Controller 编排、B3 技能与协议写入者迁移；依赖链上的
  中间提交可以联合审阅，最终仅交付通过完整验证的实现。

### B1：单一注册表与明确生命周期

- 在 `RoomMoveEvents` 引入 `RoomSkillPlugin`，覆盖 `beforeNormalizeMove`、`decorateMove`、
  `afterMoveCommitted`、`onCardsRevealed`；补充类型化 `onProtocolEvent` 和 `onDeckInitialized`，
  以承接非移动消息写入状态、诡伏续交和牌堆重建清理。
- 插件按唯一 `id` 注册，重复注册直接报错。每阶段通配插件先执行，再按协议 SpellID、领域
  SpellID 顺序匹配；同一插件匹配多个 ID 也只执行一次。无技能归属的揭示与重建通知广播。
- 既有 `registerMoveEventHandler` 保留为装饰阶段适配入口，默认技能统一注册为插件；低层
  `registerSkillHandler` 的单牌定位能力保持独立，销毁时统一清理注册表。
- `defer` 立即停止本次管线；前置/协议异常终止当前输入并交由 Controller 记录，装饰异常延续
  现有保留上一事件策略；提交后通知分别隔离异常，避免一个插件阻断其他通知与渲染。

### B2：Controller 只编排通用阶段

- Controller 拷贝原始消息及 CardIDs，冻结独立 raw 快照；对私有 patched 副本进行端点归一化、
  技能补牌和混合明暗校验，最后只构造一次标准事件。Handler 和直调 Controller 获得一致的输入语义。
- 普通移动返回成功后才触发 `afterMoveCommitted`；展示、范围揭示和洗牌完成后也进入成功通知，
  技能自行按事件类型缩小适用范围。`noop`、延迟、来源失败和异常均不触发成功通知。
- 明牌通知在领域/账本落定后执行；显式 reveal 同样只在成功后通知。保留 Phase A 的提交次序，
  不在 Controller 恢复牌堆账本快照或重复提交。
- 以 `dispatchSkillProtocolEvent` 接收使用技能、目标通知、选择回复、角色数据四类输入。诡伏
  插件返回待续交的 raw/patched 移动，由 Controller 走同一管线；移除技能专用 Controller 方法、
  import 和重建时的技能 ID 判断。
- `Room.moveCards()` 仍是领域事务 API；不把原始协议插件隐式套在内部补偿移动上。Room 层可
  单独使用各阶段入口，完整协议集成通过 Controller 验证。

### B3：同时迁移技能的读取者与写入者

- 清议/联句、迁附、生墨、择行、椒遇、下书移至 `src/tracker/skill/`；佐练合并到已有文件。
  所有这些技能的暂存状态改用 Room 的 `tracker` scope，非移动消息入口同步迁移，复制协议数组
  防止状态与宿主消息共享可变引用。
- 诡伏的配对、解析与重建清理归插件所有；夺炁的装饰、提交和公开 ID 观察使用同一插件管线。
  本阶段只收口既有序列行为，不提前实施 Phase C 的通用中断协调器。
- 下书在成功手牌转移后检查来源、目标与选择，使用 Room 零增量确认展示牌并同步账本/通知；
  保留已有随机转移约束及其他候选位置，不再依赖 Handler 回调或浏览器单例。
- 称象仅保留 Handler 的 UI 状态采集；`PubGsCMoveCard` 移除 `afterMoveCallbacks` 和推断补牌，
  保留局流、计数、特殊区域及称象 UI 副作用。其他阶段的协议路由重构不混入本次变更。

### 验收与验证

- 插件顺序、重复注册、跨 ID 去重、defer、异常隔离、销毁/新局隔离与重建清理。
- Controller 直接输入即可补牌；宿主/raw/patched 入参不被修改，技能信息在归一化前生效。
- 覆盖成功/失败/noop/展示/洗牌的通知边界，保留诡伏全部配对、夺炁和下书领域回归；新增
  非 UI 集成场景，迁移旧 Handler 推断测试，不新增或扩展 UI 自动化。
- 运行 `pnpm test:tracker`、`pnpm typecheck:tracker`、`pnpm typecheck`、`pnpm lint`、
  `pnpm build`、`pnpm build:prod` 和 `git diff --check`；遍历基线预期不变。
- 同步 `docs/agents/room.md`、`skill_state.md` 与受影响技能说明。浏览器手工验收如未执行，
  在完成记录中明确标注，不把 Node 验证视为浏览器验收。

## 执行状态

- [x] B1：插件注册表与阶段契约；既有装饰入口适配至同一管线，默认技能改用插件。
- [x] B2：通用 Controller 管线与四类非移动协议输入；移除诡伏/夺炁专用 import、方法和重建判断。
- [x] B3：迁移技能及全部相关状态写入者，合并佐练，移除 Handler 移动后回调；保留称象 UI 状态采集。
- [x] 完整验证与文档同步：`pnpm test:tracker`（84 个文件、887 项）、`pnpm typecheck:tracker`、
      `pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm build:prod` 和 `git diff --check` 全部通过。
      遍历基线未变，未进行浏览器手工验收。

实施补充：入口过滤仍在 Handler，Controller 保留零张洗牌领域协议入口；位置规范化与补牌后的
明暗数量校验在 Controller 统一执行。旧 Controller 测试中混合明暗的建局夹具改用分别发牌或
暗摸后揭示；低层混合 ID 移动能力继续由 Room 领域测试覆盖。展示分支与显式揭示同样检查
Room 移动返回值，失败时不发送提交/明牌通知。下书通过失败后重试回归验证选择状态不会提前消费。

实现与分阶段方案一并提交至本地 `codex/tracker-skill-lifecycle` 分支，尚未推送远端。
以下初版代码仅保留为设计背景；当前契约以上述执行方案、完成记录和源码为准。

## 1. 根因剖析

目前记牌器对技能特例的处理散落在三个不同层级：

1. **第一轨（`src/handler/spellEffects.js` + `src/handler/skills/*`）**：在 `PubGsCMoveCard.js` 中对 `patched.CardIDs` 原地修改（如 `ChengXiang.ts`、`QingYiLianJu.ts`、`QianFu.ts`、`ShengMo.ts`、`ZeXing.ts`、`ZuoLian.ts`、`JiaoYu.ts`、`XiaShu.ts`），状态存在 `GameState` 的 `spell` 命名空间。
2. **第二轨（`src/tracker/skill/*`）**：通过 `Room.registerMoveEventHandler` 装饰 `NormalizedMoveEvent`，状态存在 `GameState` 的 `tracker` 命名空间。
3. **第三轨（`TrackerController` 硬编码）**：在 `syncTrackerMove` 和 `revealTrackerCards` 里直接 import 并调用 `deferGuiFuMove`、`commitDuoQiMove`、`observeDuoQiKnownCardIDs`。

这导致：

- 蔡瑁【佐练】（`3488`）被迫同时存在 `src/handler/skills/ZuoLian.ts` 和 `src/tracker/skill/ZuoLian.ts` 两个同名文件；
- `src/handler/skills/JiaoYu.ts` 在 Handler 层直接调用 `context.game.room?.refreshPlayerSnapshot()` 越界查询记牌器内部快照；
- Node 侧对 `Room` 或 `TrackerController` 做集成测试时，如果不特意走 `handleMoveCard()`，就会丢失第一轨的技能修正。

## 2. 具体重构方案

### 步骤 B1：扩展 `RoomMoveEvents` 为全生命周期钩子注册表

在 `src/tracker/room/moveEvents.ts` 中，将单一的 `decorateMoveEvent` 扩展为四阶段流水线接口：

```ts
// src/tracker/room/moveEvents.ts
export interface RoomSkillPlugin {
  readonly id: string
  readonly spellIDs?: readonly (SpellID | '*')[]
  /** 阶段 1：归一化前拦截原始/预处理协议（承接诡伏 3709 暂存、迁附/清议/联句/椒遇 CardIDs 补全） */
  beforeNormalizeMove?: (
    patched: PatchedMoveCardFields,
    raw: Readonly<RawMoveCardEvent>,
    room: Room
  ) => 'defer' | void
  /** 阶段 2：归一化后修饰标准移动事件（现有 MoveEventHandler） */
  decorateMove?: MoveEventHandler
  /** 阶段 3：Room.moveCards 及身份账本落定后的后置钩子（承接下书 361 结算、夺炁 commitDuoQiMove） */
  afterMoveCommitted?: (event: NormalizedMoveEvent, room: Room) => void
  /** 阶段 4：明牌确认或移动公开 ID 后的通知钩子（承接夺炁 observeDuoQiKnownCardIDs） */
  onCardsRevealed?: (cardIDs: readonly CardID[], room: Room) => void
}
```

### 步骤 B2：剥离 `TrackerController` 中的特定技能耦合

修改 `src/tracker/runtime/trackerController.ts`：

- 删除对 `DuoQi` 与 `GuiFu` 的直接 import；
- 在 `syncTrackerMove()` 中依次调用：
  1. `if (readyRoom.beforeNormalizeMove(patched, raw) === 'defer') return`
  2. `const normalizedEvent = normalizeMoveEvent(patched, raw)`
  3. `const event = readyRoom.decorateMoveEvent(normalizedEvent)`
  4. 执行移动/洗牌/展示分支
  5. `readyRoom.afterMoveCommitted(event)`
  6. `readyRoom.notifyCardsRevealed(event.cardIDs)`
- 在 `revealTrackerCards()` 尾部统一调用 `readyRoom.notifyCardsRevealed(ids)`。

### 步骤 B3：迁移 `src/handler/skills/*` 至 `src/tracker/skill/` 并合并同名技能

- 将 `QingYiLianJu.ts`（`3157/3511`）、`QianFu.ts`（`3750`）、`ShengMo.ts`（`3434`）、`ZeXing.ts`（`3854`）、`JiaoYu.ts`（`3571`）、`XiaShu.ts`（`361`）迁入 `src/tracker/skill/`，统一使用 `room.readSkillState` / `room.setSkillState`（`tracker` scope）。
- 将 `src/handler/skills/ZuoLian.ts` 合并进 `src/tracker/skill/ZuoLian.ts`，彻底消除双文件跨 scope 维护。
- **保留边界**：仅负责纯小抄 UI 绘制的【称象】（`441/3492` -> `drawChengXiang`）留在 `src/handler/`，因为它不参与记牌器状态推断。
- 完成后，`src/handler/PubGsCMoveCard.js` 中的 `afterMoveCallbacks` 与 `applySpellEffect` 可简化为纯 UI 副作用触发。

## 3. 提交拆分与验证命令

- **PR 1**：`refactor(tracker): introduce Room lifecycle hooks for skill plugins`
- **PR 2**：`refactor(tracker): decouple GuiFu and DuoQi from TrackerController`
- **PR 3**：`refactor(tracker): migrate handler card-patching skills into tracker skill layer`
- **验证门槛**：
  ```sh
  pnpm test:tracker
  pnpm typecheck:tracker
  pnpm lint
  pnpm build
  ```
