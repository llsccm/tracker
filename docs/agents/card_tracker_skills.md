# 记牌器技能与协议特例（按需）

> 只有在处理暗置标记、观虚、整手牌交换、骋烈、诫厉、天候或相邻协议特例时才阅读本文。
> 常规 `Room` / `Card` / `Player` API 调用先查 [`tracker_api.md`](tracker_api.md)，协议字段样例先查
> [`docs/protocols/README.md`](../protocols/README.md)。新增技能临时状态前先查
> [`skill_state.md`](skill_state.md)，确认统一状态仓库中的 key 与访问入口。

## 技能插件与移动装饰器输入契约

- `MoveEventDraft.protocol` 直接引用最终 `patched` 的只读协议；`cardIDs` 初始复用其只读数组，技能分支直接读取数值，
  不再从 `getRaw(event)` 取字段并重复 `Number()` 转换。
- `RoomSkillPlugin.beforeNormalizeMove` 只修改 Controller 私有的 `patched`；原始宿主输入及 raw 快照不受影响。
  端点在最终事件归一化时解析；下书在成功提交后按领域手牌子区和来源/目标座位结算。
- 当前移动牌与数量以 `event.cardIDs` / `event.cardCount` 为准；`protocol` 保留装饰前的协议字段，
  `patchEvent()` 不因来源实体或候选推断而改写它。
- `event.raw` 与 `options.sourceEvent.raw` 引用同一份原始输入；后者随 `MoveOptions` 进入 Room，保留来源追溯。
- `Room.decorateMoveEvent()` 接收完整标准事件；领域直调仍使用 `Room.moveCards()`。
  使用技能、目标通知、选择回复和角色数据通过 `dispatchSkillProtocolEvent()` 输入已迁移插件，
  `SkillProtocolEvent` 的判别联合保持各协议字段语义，不套用移动契约。
- 默认插件集中注册于 `src/tracker/skill/registerHandlers.ts`；清议/联句、迁附、生墨、择行和
  佐练使用归一化前补牌，下书使用成功提交钩子。状态统一在 `tracker` scope；称象 UI 暂存仍在 Handler。
- 插件顺序、异常处理、defer、成功通知与销毁边界见 [`room.md`](room.md)；相关集成回归为
  `tests/tracker/skillLifecycle.test.ts` 和 `tests/tracker/skillCardPatches.test.ts`。

## 快速索引

| 场景                         | 协议或识别条件                                 | 主要实现 / 回归入口                                                          |
| ---------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| 诡伏相邻获得消息补全         | `SpellID=3709` + `DataID=3709`                 | `src/tracker/skill/GuiFu.ts`、`tests/tracker/roleData3709.test.ts`           |
| 下书明暗选择                 | `SpellID=361`                                  | `src/tracker/skill/XiaShu.ts`、`tests/tracker/xiaShu.test.ts`                |
| 反间展示与手牌移交           | `SpellID=713`、`MoveType=27`                   | `docs/protocols/PubGsCMoveCard-713.md`；现有列表解码条件不匹配该样例         |
| 问卦候选来源筛选             | `SpellID=780`、暗交牌 `MoveType=27` 后紧邻回堆 | `src/tracker/skill/WenGua.ts`；`tests/tracker/wenGuaCandidateSource.test.ts` |
| 权变牌堆顶观看与获得         | `SpellID=7011`、`MoveType=21/18`               | `docs/protocols/GsCRoleOptTargetNtf-7011.md`                                 |
| 暗置标记区候选               | `FromZone=5`、`ToZone=4`、全暗 `CardIDs`       | `RoomMovementHiddenMarks.handleHiddenMarkMove()`、`hiddenMarkCandidates`     |
| 观虚目标视角交换             | `SpellID=987/988`                              | `src/tracker/skill/GuanXu.ts`、`tests/tracker/guanXuExchange.test.ts`        |
| 整手牌交换                   | `MoveType=11` + `5<->10` + 整手张数            | `src/tracker/skill/HandExchange.ts`                                          |
| 骋烈其他视角的暗中交换与弃置 | `SpellID=3208`                                 | `src/tracker/skill/ChengLie.ts`、`tests/tracker/chengLie.test.ts`            |
| 诫厉观看与暂存               | `SpellID=3483`                                 | `handleRoleOptTargetNtf`、`tests/tracker/roleOptTargetNtf.test.ts`           |
| 天候私有观看与展示           | `SpellID=3903`                                 | `src/tracker/skill/TianHou.ts`、`tests/tracker/tianHouExchange.test.ts`      |
| 兴作牌底与手牌交换           | `SpellID=3776`                                 | `src/tracker/skill/XingZuo.ts`、`tests/tracker/xingZuo.test.ts`              |

## 诡伏相邻获得消息补全（SpellID=3709）

- 协议约定：无 ID 的获得移动与角色数据相邻；当前持有列表将新增 ID 放在前面。
- `src/tracker/skill/GuiFu.ts` 使用 GameState `tracker` scope 的 `3709` key 暂存一条移动，
  牌堆与弃牌来源都不提前写入实体或数量。角色数据按前置 `CardCount` 取新增前缀，
  补齐 ID 后经 Controller 执行一次普通移动；技能不自行修改身份账本。
- 不维护 FIFO、历史快照或额外匿名手牌；不支持移动积压、跨座位乱序和分批揭示。
  用牌后、获得技能时等没有前置获得移动的角色数据忽略，不根据状态列表独立移动牌；
  失配或被下一条移动打断时告警清除暂存。
- 已携带 ID 的移动立即同步，主视角不重复处理角色数据。
- `guiFuPlugin` 接收所有前置移动及 `DataID=3709` 的角色数据，返回补全移动供 Controller 续交；
  `onDeckInitialized` 清理待配对状态，Controller 不包含技能 ID 或专用分支。
- 原始移动、相邻角色数据及 `raw` / `patched` 约定见
  [诡伏协议专页](../protocols/PubGsCMoveCard-3709.md)。

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
  `choice/actorSeatID`；`afterMoveCommitted` 是唯一结算点，负责确认展示牌并清理技能状态。
  移动失败、noop 或同区展示不结算，零增量确认直接使用 Room 并同步身份账本和公开 ID 通知。
- 协议样例：`docs/protocols/GsCRoleOptTargetNtf-361.md`。

## 反间展示与手牌移交（SpellID=713）

- 三条原始消息及可确认的字段含义见 `docs/protocols/PubGsCMoveCard-713.md`。
- 样例先由 5 号同区展示 `119`，再以 `MoveType=27` 移交给 1 号，最后由 1 号同区展示五张牌；展示列表包含 `119`。
- 样例中的 `MoveType=21` 都是 `5 -> 5` 同区展示；`MoveType=27` 是 `5 -> 5` 的跨座位移交，不应仅凭 Zone 相同视作无操作。
- 未接入的旧反间首项下标解码已删除；本样例是等长 CardID 列表，直接由当前移动与揭示流程处理。

## 问卦候选来源筛选（SpellID=780）

- `MoveType=27` 是跨技能通用的“主动交给”（`MOVE_TYPE.GIVE`）。
- 相关角色携带真实 ID 的交牌/回堆继续走通用已知牌移动。
- 第三方无正 ID 的单张交牌记录来源候选身份集合，紧邻回顶/回底时通过 `publicCandidateSource`
  限定公共候选来源，避免污染接收者原有明牌。空集合明确禁止扩散，不回退为接收者全部明牌。
- 对相关旧组的来源/接收者手牌数量约束保守失效，不建立精确公共区批次约束。交牌/回堆已确认相邻，
  仅按 `780` 注册处理器，不监听其它移动；数量、类型、座位等不匹配时保留通用处理。
- 完整批次名额、精确排除接收者候选及长链关联仍未实现。原始样例和精度边界见
  [问卦协议说明](../protocols/PubGsCMoveCard-780.md)。

## 暗置标记区候选流程

木牛流马的三条相邻原始协议及 ZoneParam 语义见 [木牛流马协议说明](../protocols/PubGsCMoveCard-700.md)。装备本体迁座只处理装备自身；随后附属 mark700 协议才迁移内部牌、账本与投影，不得将空 CardIDs 当成空容器快照。

装备容器规则集中在 `src/tracker/room/movement/equipmentMarks.ts`：区分目标座位观测与真实空间迁移，
解析容器位置、生成稳定装备记录键并识别完整可见快照。规则只读上下文与显式传入的观测座位，
不读取 `HiddenMarkState`；`hiddenMarks.ts` 仍独占 `muniuMarkSeat` 的写入及通用记录/占位/约束协调。
零张通知不建立座位观测，普通手牌暗置可以更新观测但不接管空间迁移；现有
`sourceSeat:muniu:161` 记录键与 `hidden_mark_` 约束组前缀保持不变。

当协议出现 `FromZone=5`、`ToZone=4`、`CardIDs` 全暗且 `CardCount > 0` 时，记牌器会检查来源手牌是否存在明牌候选：

1. 若没有来源明牌，沿用普通暗牌占位移动逻辑。
2. 若存在来源明牌，由 `RoomMovementHiddenMarks.handleHiddenMarkMove()` 接管默认暗牌移动，并通过
   `Room.readSkillState('hiddenMarkCandidates')` 访问统一状态仓库中的候选账本。
3. 账本记录来源座位、当前投影目标座位、`spellID`、候选明牌、已确认手牌/标记牌，以及本次暗置的明牌落入标记区数量范围。这里的 `spellID` 表示标记空间 ID：协议区域 `4` 优先取 `ZoneParam || SpellID`；木牛流马（木马）的标记空间 ID 固定为 `700`。普通标记账本 ID 为 `sourceSeat:targetSeat:spellID`；唯一可迁座的木牛流马使用 `sourceSeat:muniu:161`，不同来源手牌分别记账，承载座位变化不改变账本或约束组 ID。
4. 先将候选明牌投影为完整位置候选：保留原有 `A 手牌 / B 手牌` 等候选，再追加目标标记位置。普通标记追加 `目标座位 标记`；木马追加装备容器候选 `container:equipment:161:700`，再由索引按 mark700 协议记录的空间座位显示到玩家标记区。尚未观察到标记协议时，才以装备位置作初始兜底。这一步不会丢掉既有跨角色候选。
5. 候选全集只剩 `来源手牌 / 目标标记` 时，创建 `ConstraintGroup.expectedSlotsByLocation` 区间约束；全明时上下界相等，支持 N 选 K。普通标记与木马容器共用完整位置名额。
6. 后续某张候选明牌明确从同一标记空间进入弃牌区时，确认它占用该标记区名额；明确从来源手牌移动时，确认它占用手牌名额。普通标记要求座位与标记 ID 同时匹配；木马标记 `700` 若 `markID` 一致但座位变化，会先把账本的当前投影座位重定向，再继续使用同一个装备容器候选收敛。装备本体 `6 -> 6` 不迁移内部牌；收到来源与目标标记 ID 都为 `700` 的跨座位 `mark -> mark` 协议后，才迁移标记实体、暗占位与候选账本，并同步精确约束的座位读面，不重命名或合并账本。`hiddenMarkCandidates.muniuMarkSeat` 记录该空间的显式观测座位，使两条协议之间的候选投影也留在旧座位。候选明牌与来源标记占位置换时，优先选用该候选所属账本的可用占位，避免消耗另一来源的占位后又触发本账本重复回收。
7. 技能 `414` 的标记牌返回手牌时，`FromZoneParam=414` 始终标识来源存储空间，`SpellID=3389` 只表示本次返回动作。按 `fromSpellID=414` 精确查询，不在 `414/3389` 间互扫；普通手牌的获得来源独立记录为 `gainSpellID=3389`。
8. 洗牌发现承担 cohort 未决身份的正 ID 暗标记实体时，会将同一实体原地匿名化为稳定负 `id/entityID`；标记位置、候选集合及 `hiddenMarkCandidates` 中的对象引用保持不变，不再暂停原实体或创建替身。
9. 来源手牌被完整揭示时，`Room.moveCards()` 会在 `resolveKnownMoveCards()` 之前调用 `resolveHiddenMarkCandidatesFromFullHandReveal()`：未出现在完整手牌快照中的弱候选会先确认到标记空间，再让已知牌物化读取修正后的匿名手牌槽。这个前置时序仍是当前运行时契约。
10. 正 ID 确认占用标记名额后，`reconcileMarkSpace(record, reason)` 按账本累计暗置额度统一回收溢出的匿名标记占位；`hiddenCount` 不是当前标记区容量，牌离开造成不足时不会在这里补造实体。无论目标是普通 player mark 还是木马装备容器，只要占位来自来源手牌，就必须挤回 `sourceSeat` 手牌，不能丢到 `outside`；只有全明装备容器快照清零后、失去手牌物理背书的孤儿占位由 `clearHiddenMarkPlaceholdersForObservedSnapshot()` 独立移出玩家区。
11. 区间约束负责上下界消元，不替代完整手牌揭示、容器观察快照及孤儿占位清理。部分揭示中“未出现”仍不是负向证据。

示例：

- 4 明 0 暗，暗置 1 张：普通标记形成 `A 手牌 = 3`、`A 标记 = 1` 的精确约束；木马形成 `A 手牌 = 3`、`container:equipment:161:700 = 1` 的精确约束。
- 4 明 0 暗，暗置 3 张：形成 `A 手牌 = 1`、`A 标记 = 3` 的精确约束。
- 2 明 2 暗，暗置 2 张：两张明牌在手牌和标记区的名额都是 `[0,2]`，保留候选。
- 3 明 2 暗，暗置 1 张：明牌手牌名额 `[2,3]`，标记名额 `[0,1]`；一张明牌确认从标记离开后，其余明牌排除该标记位置。
- 若一张牌原本是 `A 手牌 / B 手牌`，暗置到 A 标记后会变成 `A 手牌 / B 手牌 / A 标记`；排除 B 后仍是 `A 手牌 / A 标记`，不会因为 owner 确定而误判具体区域。

## 标记区暗交手牌后的来源确认（SpellID=3658）

- `3657` 标记区有两张明牌，`3658` 暗交一张时，保留原标记区与目标手牌的双边候选。
- 后续 `FromZone=5` 的弃牌按完整手牌位置确认来源；不能依据代表字段 `subZone=mark` 或
  单独的 `seats` 投影把整批来源改成标记区。候选身份不应消耗同批未知身份需要的匿名槽。
- 原始协议、装备与手牌分别移出的顺序及回归入口见
  [标记区暗交与手牌弃置](../protocols/PubGsCMoveCard-3658.md)。

## 临时弹窗空间（巧织 3544、椒遇 3571）

- 协议区域 `8` 独立映射为 `popup`，不属于玩家 `mark`。进入时按 `SpellID` 定位空间；移出时按 `FromID` 定位（`255` 时使用 `SpellID`）。领域移动使用 `toPopupSpaceID` / `fromPopupSpaceID`，不使用伪座位。实体登记在 `popupSpaces`；完整位置为 `{ type: 'popup', spaceID }`，
  key 为 `popup:<spaceID>`，不把技能 ID 或 255 投影成玩家座位。
- 确定弹窗牌的 `Card.location='popup'`、`popupSpaceID` 表达空间，`subZone/spellID/owner` 为空；含手牌分支的未决身份继续保留完整候选。空间引用在收敛尾部清理，空空间释放；新 Room 不复用旧成员。
- 技能 `35` 的匿名五张暂存、四张回顶、一张回底复用原实体，回堆位置遵循 `ToPosition`，不能从随机来源或本地数组次序猜出身份。协议回归见 `tests/tracker/popupProtocol.test.ts`。
- 全明 N 张暗取 K 张时建立原空间 N-K、目标手牌 K 的精确名额；默认管线保留候选，剩余明弃或
  已知手牌来源使候选自动收敛。不同空间隔离，明暗混合及旧批未决时不套用全明分配。
- 巧织不消费 `DataID=3544` 角色数据通知；暗取身份由通用数量约束在剩余牌明弃后确认，主视角移动自带正 ID 时直接确认，无需专用插件或私有差集状态。
- 椒遇不保存颜色选择、不回填 CardIDs；剩余组明弃后确认获得组。主视角正 ID 直接走明确移动。
- 巧织默认协议、角色数据不干预候选及获得来源回归集中在 `qiaoZhi.test.ts`；通用空间隔离见 `popupCandidates.test.ts`。

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
- 观虚通过 `room.publicZones.getExchangeBatch(batchKey)` 管理两侧成员；批次按底 -> 顶
  保存，`transferTo()` 复用通用插槽语义，不另行定义位置坐标。
- `POSITION_BOTTOM/POSITION_TOP` 与有效普通数值都是确定位置，不叠加弱候选；只有
  `ToPosition` 缺失、越界或为 `POSITION_RANDOM` 时才降级为“牌顶前 N 张”公共范围候选。
  发动者主视角的回堆 `CardIDs` 若完整覆盖整桶，同样保留该精确信息，避免覆盖
  `handleRoleOptTargetNtf` 已建立的牌顶顺序。
- 牌堆逻辑桶与公共 `Zone` 都按 bottom-first 保存；空或不完整 `CardIDs` 回堆时可直接作为
  `sourceCards`，避免技能层再次反转而破坏协议顺序。
- `987/988` 显式绕过 `HandExchange`；即使目标恰好只有一张手牌，也不能把这条技能路径误判为
  双方整手互换。回归见 `tests/tracker/guanXuExchange.test.ts`。

## 宴戏（7017）

- 协议与实现取舍见 [`../protocols/PubGsCMoveCard-7017.md`](../protocols/PubGsCMoveCard-7017.md)。
- `src/tracker/skill/YanXi.ts` 用先获得对方手牌识别成功批次；非国战随后连续取两次当前牌顶，国战成功保留随机来源。
- 无成功批次时，公开 ID 走普通已知移动；没有真实 ID 则只匿名化移动前牌顶两槽中的明牌，放弃范围候选精度，不影响更深处明牌。
- Room 的 `anonymizeCards` 流水线同步释放实体定位与 `PileIdentityLedger` 已定位牌堆身份，保留数量和身份全集；不要仅修改 `isKnown`。
- 状态使用 `tracker` scope 的 `7017`，见 [`skill_state.md`](skill_state.md)；测试见 `tests/tracker/yanXi.test.ts`。

## 整手牌交换（通用协议模式）

- 协议文档：`docs/protocols/hand-exchange.md`（以技能 121 为完整示例）。
- 装饰器：`src/tracker/skill/HandExchange.ts`，经 `decorateGenericMove`（`*`）统一接入，不绑定单一 SpellID。
- 识别门槛：`MoveType=11` + `5<->10` + 整手张数；允许己方整手正 `CardIDs`，避免误伤佐练/诫厉等非整手路径。
- 手牌进 `exchange` 时按 `SpellID + FromID` 登记整批实体；同座位嵌套交换使用后进先出的批次栈，明确空手时也登记零张屏障批次；回手时 `FromID` 是原持有者批次键，目标座位看 `ToID`。
- 多位置手牌候选使用唯一批次令牌逐分支置换，不归入先处理座位；候选模式通过 `handMoveCount` 同步协议整手数，通过 `cardCount` 只搬运确定实体，避免候选实锤和匿名实体重复占槽。
- 候选批次回到己方且 `CardIDs` 完整覆盖整手时，正 ID 直接确认对应候选，未出现的候选排除该批次分支。
- 暗实体占位仍随物理批次移动；回到己方并由正 ID 揭示时，真实身份若尚在其它公共区，使用 exchange 暗实体回填原槽位后再把真实身份移入手牌，避免占位残留或重复计数。
- 明牌回填 `cardIDs`，暗实体回填 `sourceCards`；明暗混合批次不共用 `combinationID`。

## 骋烈其他视角的暗中交换与弃置（SpellID=3208）

- 完整十二条协议样例与字段含义见
  [`../protocols/PubGsCMoveCard-3208.md`](../protocols/PubGsCMoveCard-3208.md)。
- 最初 `1 -> 1` 展示牌顶三张，随后 `1/5 -> 10` 暂存；两条 `10 -> 10` 表示真实暗中互换，
  不能因通用归一化为 `noop` 就认定没有业务变化。后续 `10 -> 5/4` 分别回手和暗置标记，
  最后的 `4 -> 2` 弃置同样不公开 ID。
- 当前单一 `exchange` 容器不区分内部两侧；无 ID 离区前统一匿名化，不按交换前顺序确认
  目标身份。`chengLieDiscardQueue` 在标记弃置时按张数近似回填展示身份，不表示协议证明了
  具体标记或弃牌的真实身份。
- `3208` 显式绕过 `HandExchange`，即使参与交换的一张手牌恰好是发动者整手也不例外。
- 当前入口为 `decorateChengLieMove`；已有回归见 `tests/tracker/chengLie.test.ts`。

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
  `knownOutMin=max(0,x-(N-K))`、`knownOutMax=min(x,K)`；建立区间完整位置约束，手牌容量使用上界。
- 配对的 `PubGsCMoveCard` 同区展示（`MoveType=21`、牌堆两端 `255`）只亮牌顶三张中的一张，
  **不能**确定是第几张。基础归一保持 `noop`，再由天候装饰器转换为公共区范围揭示：
  命中原手牌候选时收紧到牌顶前 `x` 张，否则建立牌顶前三候选；`x=1` 时即确定牌顶。
  范围揭示不绑定具体匿名牌堆槽，也不重排牌堆。不要把 `3903` 并入
  `PILE_SAME_ZONE_SHOW_SPELL_IDS` 或 `PILE_RANDOM_AS_TOP_SPELL_IDS`。
- 回归：`tests/tracker/roleOptTargetNtf.test.ts`、`tests/tracker/pubGsCMoveCard.test.ts`、
  `tests/tracker/moveEventNormalizer.test.ts`、`tests/tracker/trackerController.test.ts`、
  `tests/tracker/tianHouExchange.test.ts`。

## 兴作牌底与手牌交换（SpellID=3776）

- 协议样例与各步含义见 `docs/protocols/PubGsCMoveCard-3776.md`。
- 兴作必定与目标全部手牌置换，`5 -> 10` 的 `CardCount` 表示目标整手张数，不做部分换牌推断。
- `1 -> 10` 的 RANDOM 来源按技能事实取真实牌底，保留已有明牌；后续按原牌底/原手牌批次拆回。
- 两条 `10 -> 10` 为动画通知，不重排实体；`3776` 显式绕过通用 `HandExchange`。
- 原手牌无 ID 回底时，已知牌只建立底部范围候选；身份账本通过 `pileIdentityCardIDs` 同步推断身份。

## 相关入口

- 当前记牌器架构、风险与未完成项：[`card_tracker.md`](card_tracker.md)
- 技能状态所有权与当前使用清单：[`skill_state.md`](skill_state.md)
- 常用方法调用速查：[`tracker_api.md`](tracker_api.md)
- 协议样例索引：[`docs/protocols/README.md`](../protocols/README.md)
- 测试选择与验证分层：[`testing.md`](testing.md)
