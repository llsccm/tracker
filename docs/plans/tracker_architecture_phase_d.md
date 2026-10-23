# Phase D（P1-2）：区分玩家标记与临时弹窗，升级交换批次和数量约束

> 导航：[总览](tracker_architecture_refactoring_plan.md) · [Phase C](tracker_architecture_phase_c.md) · [Phase E](tracker_architecture_phase_e.md)
>
> 状态：已完成（2026-10-23）；分支 `codex/tracker-architecture-phase-d`，从包含 A/B 成果的 `dev` 开始。
> 按当前任务跳过 C 阶段，保留现有技能状态生命周期，不引入 `ProtocolSequence`。

## 执行边界与设计补充

- 顺序为 D2 → D1 → D3 → 技能清理。三项不依赖 C；命名批次只管理实体引用，不承担跨消息序列协调。
- 区间名额必须贯通求解、手牌容量、暗实体覆盖、名额扣减和更新幂等性。明牌容量读取上界；
  暗实体的必需覆盖读取下界，不能将一个可能的上界当作确定物理占用。
- 交换批次区分物理成员和逻辑候选引用：物理成员沿用 `Zone.cards` 顺序，逻辑候选不额外创建槽位；
  批次读面过滤已经离开交换区的引用，完成、失配与 Room 销毁均释放批次。
- 区域 `4` 是与座位关联的玩家标记存储，区域 `8` 是独立临时弹窗，区域 `10` 仍为交换区。
  弹窗使用独立完整位置类型和空间 key；候选保留原空间与手牌两种可能，
  来源确认先落定旧位置并扣减旧组名额，再执行移动或揭示。未知空间及不完整可见信息不推导精确分配。
- 玩家标记按 `seatID + ZoneParam` 定位，弹窗按 `spaceID` 定位；空间身份与动作技能、手牌获得技能分开。
  `414` 返回协议的 `FromZoneParam=414` 是来源空间，`SpellID=3389` 是动作技能，不建立空间别名。
- 先补领域回归，再运行本阶段全部验证门槛。不开启 UI 自动化，不执行回放专用命令。

## 1. 根因剖析

1. **`Zone('exchange')` 与 `Card.location` 的不变量裂痕**：
   - `src/tracker/skill/HandExchange.ts` 顶部注释明确写道：“逻辑暂存的候选牌 `location` 记为 `'exchange'`，但刻意不加入 `zones.get('exchange')`；因此按 `Zone` 成员统计的口径不会计入它们，按 `card.location` 统计的口径才会。”
   - 同时 `GuanXu.ts` 为了区分“牌堆侧进交换区”和“手牌侧进交换区”，在 `skillState` 里手写了另一套数组桶。这是因为 `Zone('exchange')` 只是一个单层 `Card[]`，没有原生的子批次（Batch/Bucket）概念。
2. **`ConstraintGroup` 只能表达等式名额，无法利用区间上下界**：
   - `ConstraintGroup.expectedSlotsByLocation` 类型为 `Map<string, number>`。
   - 在 `src/tracker/room/movement/hiddenMarks.ts`（如 2 明 2 暗暗置 2 张进标记区，`knownMarkMin = 0, knownMarkMax = 2`）或 `TianHou.ts`（`knownOutMin < knownOutMax`）中，当 `min !== max` 时无法建立 `ConstraintGroup`，导致 `computeHandSlotAllocation()` 计算单座位候选明牌容量上界时丢失了 `max` 上界限制（例如 3 明 2 暗暗置 1 张进标记区，留在手牌的明牌数在 `[2, 3]` 之间，标记区最多只能占 1 张明牌）。
3. **区域 4 与区域 8 共用玩家 mark 表示，弹窗缺少独立位置契约**：
   - 初版把两者都归一为玩家子区 `mark`，再根据座位是否有效分流；巧织、椒遇入弹窗使用 `ToID=255`，出弹窗使用技能空间 `FromID`，导致技能 ID 被放入 `fromSeatID`，下游不得不重新解释端点。
   - 初版弹窗牌借用 `location='player'`、`subZone='mark'` 与空 `seats` 表达，由 `unassignedMarkSpaces` 保存引用；这混淆了玩家存储区和临时区，也使其暗取难以复用完整位置约束。
   - 2026-10-22 的六组最小序列对照确认：巧织停用专用补充后，另一张明弃仍留下 1 张未知手牌及滞留标记明牌；椒遇停用颜色补牌后，另一组明弃仍留下 5 张未知手牌。相同巧织流程改为玩家标记区后，现有精确数量约束可以正确收敛。这是位置建模缺口，不需要为这两个全明场景另写求解算法。

## 2. 具体重构方案

### 步骤 D1：为 `RoomPublicZones` / `Zone` 增加命名子批次视图

在不破坏普通公共区 `Zone.cards` 读写的前提下，为 `exchange` 区提供原生的命名批次管理（`room.publicZones.getExchangeBatch(batchKey)`），让 `GuanXu`、`TianHou`、`XingZuo`、`HandExchange` 统一通过 `batchKey`（如 `${spellID}:pile`、`${spellID}:seat:${seatID}:${seq}`）存取交换批次，消除各技能文件重复实现的桶切片与回填逻辑。

### 步骤 D2：将 `ConstraintGroup` 扩展为支持 `{ min, max }` 区间名额

向后兼容现有的单数字输入（传入 `number` 时自动规整为 `{ min: count, max: count }`）：

```ts
// src/tracker/constraint/ConstraintGroup.ts
export interface SlotCountRange {
  readonly min: number
  readonly max: number
}

export type SlotCountInput = number | string | SlotCountRange
```

在 `ConstraintGroup.resolve()` 中：

1. **上界满额剔除（Upper-Bound Elimination）**：当某个位置 `location` 的确定牌数量 `lockedCount >= range.max`（即 `remainingMax === 0`）时，从本组其余候选牌中剔除该 `location`；
2. **下界强锁（Lower-Bound Locking）**：当本组所有候选牌的候选全集都被本组覆盖，且某个位置的候选牌数量 `candidateCards.length <= remainingMin`（其中 `remainingMin = Math.max(0, range.min - lockedCount)`）时，将这些候选牌直接锁定到该 `location`；
3. **手牌容量上界收紧**：在 `src/tracker/constraint/handSlotUsage.ts` 的 `countCandidateHandSlots()` 中，使用 `slot.remainingMax` 作为 `HandSlotBudget.count`，即可天然支持“半明半暗暗置/换牌”对候选明牌上界的紧缩，无需在 `hiddenMarks.ts` 中写额外的特判。

### 步骤 D3：独立建模弹窗区，保留玩家标记语义并收拢技能特例（已完成）

本项归入空间与数量约束重构。全明 `N` 张中暗取 `K` 张只需现有精确名额约束，实施不依赖
D2 的区间扩展，也不必等待 D1 的 exchange 批次容器；可作为独立变更先落地。

#### 通用模型与移动流程

- [x] 将区域 `8` 从玩家子区映射中移除，使用 `{ type: 'popup', spaceID }` 与 `popup:<spaceID>` 完整位置；确定实体使用 `Card.location='popup'`、`popupSpaceID`，不再借用空座位的玩家 mark。
- [x] 协议入弹窗按 `SpellID` 定位，出弹窗按 `FromID` 定位（`255` 时使用 `SpellID`）；归一为 `toPopupSpaceID/fromPopupSpaceID`。区域 `4` 保留座位和 `fromSpellID`，`ZoneParam` 优先于动作技能；删除 `414/3389` 空间别名互扫。
- [x] 通过 `RoomMovementCandidates.markStoredToHandCandidates()` 共用玩家标记和弹窗的暗取约束：全明 `N` 张暗取 `K` 张后，保留“原空间 / 目标手牌”候选，建立原空间 `N-K`、目标手牌 `K` 的数量约束。只更新一次手牌数量，不提前挑选具体明牌。
- [x] 剩余牌明弃、获得牌直接揭示或后续已知移动时，按实际来源扣减旧名额并触发通用收敛。`popupSpaces` 保存明牌、暗槽及未决候选引用；查询过滤失效引用，收敛尾部释放空空间。物化与身份置换保持原槽数量，并维护空间引用。
- [x] 弹窗跨区移动优先于通用 `MoveType=6` 展示分支，避免把牌堆来源误当成原地弹窗揭示；真正的弹窗揭示按空间原地物化，不增加手牌数或实体数量。日志与位置描述包含独立空间 ID。
- [x] 明暗混合、可见 ID 不完整或空间归属不明时保留保守语义，不套用全明精确分配；多个技能空间、连续批次及新 Room 之间不得串用状态。

#### 技能清理边界

- [x] 清理 `src/tracker/skill/QiaoZhi.ts` 的旧差集装饰器及 `qiaozhiSelection` 状态说明。该装饰器已不在默认注册表中，仅由旧测试显式注册；将有价值的回归迁移到默认管线，覆盖通用收敛。
- [x] 保留 `GsCUpdateRoleDataExNtf(DataID=3544)` 给出的明确身份事实，将 `src/handler/skills/QiaoZhi.ts` 的薄揭示逻辑收口到通用技能协议入口。继续使用零手牌增量揭示，避免重复计数；不再建立巧织私有差集状态。
- [x] 通用收敛回归通过后，移除 `src/tracker/skill/JiaoYu.ts` 的颜色暂存、标记牌扫描及 `CardIDs` 回填，并清理 `registerHandlers.ts` 中相应插件和状态测试。
- [x] 椒遇接受“剩余组明弃后才确定获得组”的确认时机；此前显示候选。若后续另有需求要求按颜色选择立即确认，应将选择事实作为通用约束输入单独设计，不恢复技能专属补牌扫描。
- [x] 同步 `docs/agents/skill_state.md`、`card_tracker_skills.md`、相关协议说明与 API 文档，删除失效入口引用，明确玩家标记区、临时弹窗区与交换区的边界。

#### 协议分类与保留边界

| 场景                     | 来源与目标                             | 必须保持的语义                                                              |
| ------------------------ | -------------------------------------- | --------------------------------------------------------------------------- |
| 技能 `35`                | 牌堆 → `popup:35` → 四张回顶、一张回底 | 暗牌槽复用，弹窗 `5→1→0`，目标位置按 `ToPosition`；不从本地数组顺序猜测身份 |
| 巧织 `3544`、椒遇 `3571` | 牌堆/处理区 → popup → 手牌/弃牌        | 全明暗取保留两侧名额，剩余明弃或明确身份通知触发收敛                        |
| 集运 `3657`、转交 `3658` | 玩家 mark:3657 → 他人手牌              | 来源空间 `3657`，动作与获得来源 `3658`；不串用同技能弹窗                    |
| `414` 存储、`3389` 返回  | 装备/手牌 → 玩家 mark:414 → 同座位手牌 | 区域始终为 `414`；整区返回保留原有身份信息，不查询 mark:3389                |
| 木牛流马 `700`           | 玩家标记及装备附属容器                 | 保留装备本体与后续标记通知的两阶段迁座，内部牌不随装备本体提前移动          |
| 骋烈 `3208`              | exchange → 各玩家 mark:3208 → 弃牌     | 保留现有近似弃牌队列；本次不把展示 ID 精确绑定到各目标标记                  |

弹窗的生命周期由成员移动和候选收敛决定，不按超时或 UI 关闭强制清空。当前按空间 ID 管理，
没有新增同技能嵌套发动的批次标识；混合明暗暗取、隐蔽重排及骋烈交换关系不承诺完整精确还原。

#### 验收条件

- 巧织：两张明牌进入弹窗区，暗取一张、另一张明弃；不依赖旧差集装饰器或角色数据通知也能确认入手身份，且弹窗结算后无残留。
- 巧织直接身份通知：分别覆盖在剩余牌明弃前、后到达，以及主视角移动已带正 ID；手牌数不重复增加，揭示后不遗留多余匿名标记占位。
- 椒遇：明牌进入处理区后进入弹窗区，暗取一组、剩余组明弃；关闭颜色补牌后仍正确确认获得组。覆盖不同组大小、弃牌分批到达以及选取消息已带正 ID。
- 技能 `35`：五张匿名牌暂存后四张回顶、一张回底，原牌堆未移出部分保持顺序，总实体数不变且空间释放；弹窗原地揭示不创建伪玩家或重复实体。
- `414/3389`：一张已知装备与三张暗手牌存入同座位 mark:414，四张全部返回；明确来源 `414`，获得来源 `3389`，查询 `3389` 不命中 `414` 标记。
- 保护现有玩家标记区暗交回归（如 `3658`）、多个技能空间隔离、后续手牌移动及木牛流马暗置；已确认手牌不得残留原技能标记字段或描述。
- 通过默认 Controller 管线验证实体数量、手牌观测数、候选名额、匿名占位清理与 Room/ledger 一致性；不以仅账本断言通过代替位置与身份断言。

## 3. 原建议提交拆分与验证命令

- **PR 1**：`feat(tracker): support [min, max] slot range constraints in ConstraintGroup`
- **PR 2**：`refactor(tracker): unify exchange batch buckets across GuanXu, TianHou, and HandExchange`
- **PR 3**：`refactor(tracker): separate popup spaces from player marks and converge hidden gains`
- **PR 4**：`refactor(tracker): retire QiaoZhi and JiaoYu inference patches`
  - PR 4 依赖 PR 3 的默认管线回归通过；巧织明确身份通知继续作为协议输入保留。
- **验证门槛**：
  - 运行 `pnpm test:tracker`、`pnpm typecheck:tracker`、`pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm build:prod` 与 `git diff --check`。
  - 重点检查 `tests/tracker/traversalBaseline.test.ts` 的遍历计数快照；新增全牌池扫描需按仓库规则插桩并解释变化。
  - 不新增 UI 自动化测试；浏览器手工验收确认候选到确定手牌的展示时机，未执行时明确记录。

## 4. 实施结果与验证记录

- D2：名额统一保存 `SlotCountRange`；数字和数字字符串输入仍兼容。上下界消元、旧组扣减、
  更新幂等、候选容量与暗实体覆盖已贯通；单值公共端点和容器候选计入确定占用。
  暗实体本身仍有区间歧义时暂停匿名补位，避免重复承担物理槽。
- D1：新增 `model/ExchangeBatch.ts`，由 `Zone('exchange')` 持有。
  观虚、天候、兴作、整手交换仅保存批次 key 和各自协议状态，统一读写实体成员；
  逻辑候选通过 `candidateCards` 单独读取。物理移动后清理离区成员，整区重建/Room 销毁释放引用。
- D3：区域 `4` 保留玩家标记，区域 `8` 独立为 `popup:<spaceID>`；弹窗实体位置、移动端点、
  来源物化、旧组名额扣减、候选描述、计数器及揭示入口已贯通。`popupSpaces.ts` 替代旧无席位标记账本，
  收敛后清理空桶，身份互换迁移引用；已移除 `markSpellID.ts` 的 `414/3389` 空间别名。
- 已删除巧织旧差集装饰器及外围薄 handler、椒遇颜色补牌插件。巧织明确身份由默认
  `qiaoZhiReveal` 插件消费，零手牌增量；协议插件直接修改卡牌后由 Controller 调度刷新。
- 新增 `exchangeBatches.test.ts`、`popupCandidates.test.ts`、`popupProtocol.test.ts`；扩展区间名额、混合明暗暗置、
  天候与巧织默认管线回归；旧数字名额断言同步为区间。未新增或扩展 UI 自动化测试。
- 验证全部通过：`pnpm test:tracker`（87 文件、912 项）、`pnpm typecheck:tracker`、`pnpm typecheck`、
  `pnpm lint`、`pnpm build`、`pnpm build:prod`、`git diff --check`。
- 现有遍历基线快照保持不变；新增空间/批次操作只遍历局部成员，没有新增全牌池扫描。
- 浏览器手工注入验收未执行；需要在实际游戏中确认椒遇“剩余组明弃后确定”的展示时机。
  回放专用命令未执行；C 阶段的跨消息协调器保持待实施。
