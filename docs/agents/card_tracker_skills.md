# 记牌器技能与协议特例（按需）

> 只有在处理暗置标记、观虚、整手牌交换、诫厉、天候或相邻协议特例时才阅读本文。
> 常规 `Room` / `Card` / `Player` API 调用先查 [`tracker_api.md`](tracker_api.md)，协议字段样例先查
> [`docs/protocols/README.md`](../protocols/README.md)。新增技能临时状态前先查
> [`skill_state.md`](skill_state.md)，确认统一状态仓库中的 key 与访问入口。

## 快速索引

| 场景 | 协议或识别条件 | 主要实现 / 回归入口 |
| --- | --- | --- |
| 下书明暗选择 | `SpellID=361` | `src/handler/skills/XiaShu.js`、`tests/tracker/xiaShu.test.ts` |
| 暗置标记区候选 | `FromZone=5`、`ToZone=4/8`、全暗 `CardIDs` | `RoomMovement.handleHiddenMarkMove()`、`hiddenMarkCandidates` |
| 观虚目标视角交换 | `SpellID=987/988` | `src/tracker/skill/GuanXu.ts`、`tests/tracker/guanXuExchange.test.ts` |
| 整手牌交换 | `MoveType=11` + `5<->10` + 整手张数 | `src/tracker/skill/HandExchange.ts` |
| 诫厉观看与暂存 | `SpellID=3483` | `handleRoleOptTargetNtf`、`tests/tracker/roleOptTargetNtf.test.ts` |
| 天候私有观看与展示 | `SpellID=3903` | `src/tracker/skill/TianHou.ts`、`tests/tracker/tianHouExchange.test.ts` |

## 下书明暗选择（SpellID=361）

- `GsCRoleOptTargetNtf` 同时给出 `Params` 展示牌和 `targetSeatID`；技能层直接记录二者，不通过
  `SeatID` / `SrcSeatID`、配对移动或卡牌当前 owner/候选反推目标。该通知只保存技能状态；配对的
  手牌同区 `PubGsCMoveCard` 继续由通用移动框架同步明牌。
- `CGsRoleSpellOptRep Type=22` 的 `Datas[0]=1` 表示取展示牌，后续已知牌移动沿用通用框架；
  `Datas[0]=2` 表示取暗牌。
- 暗牌分支先让通用随机转移建立“目标剩余 / 发动者获得”的数量约束并同步手牌数，再以
  `handMoveCount=0` 把展示牌确认回原目标手牌。展示牌填满目标剩余槽位后，其它牌的目标手牌分支
  会由通用约束删除：确定暗牌落定到发动者，候选槽获得发动者分支并保留其它原有分支。
- 下书不快照或重建既有 `ConstraintGroup`。通用转移负责失效旧的来源/目标手牌名额并创建本次转移
  约束，随后由展示牌确认触发统一收敛。
- 实测 `CGsRoleSpellOptRep` 选择回复固定早于后续取牌 `PubGsCMoveCard`。选择处理器只记录
  `choice/actorSeatID`；移动完成回调是唯一结算点，负责确认展示牌并清理技能状态。
- 协议样例：`docs/protocols/GsCRoleOptTargetNtf-361.md`。

## 暗置标记区候选流程

当协议出现 `FromZone=5`、`ToZone=4/8`、`CardIDs` 全暗且 `CardCount > 0` 时，记牌器会检查来源手牌是否存在明牌候选：

1. 若没有来源明牌，沿用普通暗牌占位移动逻辑。
2. 若存在来源明牌，由 `RoomMovement.handleHiddenMarkMove()` 接管默认暗牌移动，并通过
   `Room.readSkillState('hiddenMarkCandidates')` 访问统一状态仓库中的候选账本。
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

## 观虚目标视角交换（SpellID=987/988）

- 协议文档：`docs/protocols/GsCRoleOptTargetNtf-987.md`。
- 交换序列为 `1->10` 五张牌堆顶、`5->10` 目标手牌、两次跨 `FromID/ToID` 的
  `10->10`，再由 `10->1` / `10->5` 分别拆回；不是通用整手交换。
- `src/tracker/skill/GuanXu.ts` 以 `FromID/ToID` 维护牌堆侧与手牌侧逻辑桶，避免全局
  `exchange` 物理顺序把目标手牌误当成牌堆侧已知身份的物化端点。
- 含明牌 ID 的分桶与桶间转移先用 `Room.probeMaterialize()` 只读预演整批身份对应关系，
  张数和桶容量全部通过后才确认或物化；失败校验不能改写实体、`cardIndex` 或身份账本。
- 牌堆侧已知身份尚未定位时，直接物化到该桶匿名实体；空 `CardIDs` 的整批回牌堆仍按桶
  携带本地已知换出手牌，因此不会 `known-fallback/createExternal`，也不会把该牌遗留在交换区。
- `ToPosition` 是 `PubGsCMoveCard` 的通用位置语义，详见 `docs/protocols/move-position.md`；
  普通非负小整数按公共区底 -> 顶顺序表示零基精确插槽，`0` 与 `POSITION_BOTTOM` 一致。
- 观虚只因全局 `exchange` 无法表达牌堆侧/手牌侧两个归属而保留逻辑桶；桶内同样按底 -> 顶
  保存，并复用 `insertCardsAtProtocolPosition()`，不能在技能内另行定义位置坐标。
- `POSITION_BOTTOM/POSITION_TOP` 与有效普通数值都是确定位置，不叠加弱候选；只有
  `ToPosition` 缺失、越界或为 `POSITION_RANDOM` 时才降级为“牌顶前 N 张”公共范围候选。
  发动者主视角的回堆 `CardIDs` 若完整覆盖整桶，同样保留该精确信息，避免覆盖
  `handleRoleOptTargetNtf` 已建立的牌顶顺序。
- 牌堆逻辑桶与公共 `Zone` 都按 bottom-first 保存；空或不完整 `CardIDs` 回堆时可直接作为
  `sourceCards`，避免技能层再次反转而破坏协议顺序。
- `987/988` 显式绕过 `HandExchange`；即使目标恰好只有一张手牌，也不能把这条技能路径误判为
  双方整手互换。回归见 `tests/tracker/guanXuExchange.test.ts`。

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
- 协议已隔离视角：发动者收到完整 `[pileCount, handCount, ...IDs]`，目标与其它座位只收到 `Params=[pileCount]`。`handleRoleOptTargetNtf` 不再自行判断展示权限，只有消息实际携带 ID 时才同步牌面。
- `handleRoleOptTargetNtf` 在两种 `Params` 形态下都记录 `actorSeat / targetSeat / pileCount` 上下文。生产目标运行槽位推断；`import.meta.env.DEV` 只放开目标视角的完整身份调试。
- 后续交换序列为 `1->10`（牌堆）+ `5->10`（部分手牌）后拆回 `10->1` / `10->5`。
- 目标手牌进入交换区后，`CGsRoleSpellOptRep Type=53` 的 `Datas` 为 `[actorSeat,targetSeat,handCount,...handToPile,pileCount,...pileToHand]`。仅当 `Room.mySeatID === targetSeat` 时记录；发动者和其它座位不消费该消息。
- 生产目标视角把牌堆进交换区的泄露 ID 改为匿名物理槽；Type 53 只建立短期 `protocol ID -> slot` 映射，将目标原手牌放回对应槽位。例如 `48` 位于原 `110` 槽位，其它三个槽仍匿名，不展示 `[39,156,118]`。
- 发动者仅走默认已知牌移动，不建立 JieLi 推断批次。第三方视角将 3483 的物理观看/交换事件归一为 `noop`，但在确认 `1->10`、`5->10`、`10->1`、`10->5` 完整结算后，为当时仍可能位于目标手牌的明牌追加“牌堆顶前 pileCount 张”公共弱候选；原有其它位置分支全部保留，不建立精确 N 选 K 约束。`3483` 显式绕过 `HandExchange`。
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

## 相关入口

- 当前记牌器架构、风险与未完成项：[`card_tracker.md`](card_tracker.md)
- 技能状态所有权与当前使用清单：[`skill_state.md`](skill_state.md)
- 常用方法调用速查：[`tracker_api.md`](tracker_api.md)
- 协议样例索引：[`docs/protocols/README.md`](../protocols/README.md)
- 测试选择与验证分层：[`testing.md`](testing.md)
