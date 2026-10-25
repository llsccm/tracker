# 统一移动端点结构迁移计划

状态：实施中；阶段一清点与契约已定稿，消费链路将在后续阶段切换。

目标：移动事件与 Room 使用显式的 `from` / `to` 端点表达来源和目标，消除座位、公共区域、
弹窗空间与位置字段之间的隐式优先级；保持现有取牌、候选、身份账本和协议处理行为。

相关契约：[Room](../agents/room.md)、[开发 API](../agents/tracker_api.md)、[牌与位置模型](../agents/card_player_model.md)、
[代码约定](../agents/conventions.md)、[测试策略](../agents/testing.md)。

### 阶段一清点结论

- 生产移动入口为 Controller 与 XiaShu 内部补偿；普通测试连同来源选择调用共 223 处。
  没有合法自定义公共区、玩家子区或空玩家目标调用。候选多目标出现在装备规则测试中，保留只读非空元组。
- 数字 `fromZone` 搭配 `fromSeatID` 的夹具按显式玩家座位迁移，不按协议区域解释。
  木牛全明快照夹具的 `fromZone: 700` 是历史空间伪座位，按其已验证的目标观测座位 7 改为 mark:700 来源。
  账本及非移动揭示 API 中的数字区域不属于旧移动入口。
- `fromZone: null` 且无玩家座位对应 unresolved。现有已知分支只查找已存在身份，不创建缺失身份；
  未知分支通过公共区查询的历史降级消费牌堆实际端点。新增领域回归固定两者差异。
- 弃牌来源附带座位的显式实体用例，统一声明 discard 并保留 sourceCards：去重、清理旧关系、
  数量不足补匿名实体。玩家显式来源不主动从公共区补足；公共显式来源按来源端点补足。
  现有来源类型与 sourceCards 足以表达这些差异，无需新增策略选项。
- 旧技能回调选择为：目标玩家 mark 使用目标标记空间；目标普通玩家区使用动作技能；
  目标非玩家且来源 mark 使用来源标记空间；其余使用动作技能。保持逐牌调用顺序。
  `knownMoveStages.test.ts` 固定 mark:414 配合动作 3389 的手牌与公共目标差异。
- 标记空间按既有非零 ZoneParam / 动作技能回退解析，最终协议 0 保留为 0；领域无空间显式用 null。
  共享类型使用本文草案字段名，执行选项显式列举于 MoveExecutionOptions，RoomMoveRequest 组合端点与执行选项。

## 1. 当前问题与边界

当前端点分散在 `NormalizedMoveEvent.toZone`、`MoveOptions`、`RoomMovementOptions` 和
`RoomMoveContext` 中：

- 来源使用 `fromZone`、`fromSeatID/fromSeat`、`fromSubZone`、`fromSpellID`、
  `fromPopupSpaceID`、`fromPosition`。
- 目标使用 `toZone`、`toSeatID/targetSeats`、`subZone`、`spellID`、`toPopupSpaceID`、`position`。
- `createMoveContext()` 还会从数字 `fromZone` 推导座位，缺省来源通常取牌堆；部分消费方法又将
  数字 `1/2` 与牌堆/弃牌堆比较。不能脱离调用路径，把同一个数字统一解释为协议区域或座位。
- `spellID` 同时参与端点标记空间、旧逐牌技能回调和来源追溯；直接改名会改变行为。
- `patchEvent()` 浅合并选项。未来端点对象如果也按字段合并，切换端点类型时会遗留旧字段。

此次统一处理移动描述及其消费者，不重做 `Card.locationCandidates`、`Player`、`Zone`、
`PileIdentityLedger` 或技能状态仓库。`255` 继续按原始协议区域解释，不建立公共玩家，不加入
`Room.players`、`seatIDs`、`Card.seats` 或 `owner`。

这也不是修复 `NaN` 的任务。合法来源不以 `NaN` 表示无座位；迁移以类型分支和入口约定消除
组合歧义，不新增基础数值的层层转换、静默兜底或针对契约外输入的测试。

## 2. 目标类型

共享端点类型放在 `src/tracker/types.ts`，必要的无状态转换放在
`src/tracker/helper/moveEndpoint.ts`。Room 的执行上下文继续放在
`src/tracker/room/movement/types.ts`。不要建立端点注册中心或新的运行时状态容器。

以下是目标契约草案；字段名在第一阶段定稿后统一使用：

```ts
type PlayerMoveArea =
  | { readonly subZone: 'hand' | 'equip' | 'judge' }
  | { readonly subZone: 'mark'; readonly markSpellID: SpellID | null }

type PlayerMoveEndpoint = Readonly<{
  type: 'player'
  seatID: SeatID
}> & PlayerMoveArea

type PublicMoveEndpoint = Readonly<{
  type: 'public'
  zone: 'pile' | 'discard' | 'process' | 'exchange' | 'exile'
  position: PublicPosition
}>

type PopupMoveEndpoint = Readonly<{
  type: 'popup'
  spaceID: number
}>

type OutsideMoveEndpoint = Readonly<{ type: 'outside' }>

type MoveEndpoint =
  | PlayerMoveEndpoint
  | PublicMoveEndpoint
  | PopupMoveEndpoint
  | OutsideMoveEndpoint

// 只承接真实的来源未定位语义及既有未知协议区诊断，不作为省略来源的默认值。
type UnresolvedMoveSource = Readonly<{ type: 'unresolved' }>

// 保留 Room 当前的多候选目标能力；这些座位是可能归属，不表示每人收到一份。
type PlayerCandidateTarget = Readonly<{
  type: 'playerCandidates'
  seatIDs: readonly [SeatID, SeatID, ...SeatID[]]
}> & PlayerMoveArea

type MoveSource = MoveEndpoint | UnresolvedMoveSource
type MoveTarget = MoveEndpoint | PlayerCandidateTarget

interface MoveRoute {
  readonly from: MoveSource
  readonly to: MoveTarget
}
```

类型语义：

- 玩家 `seatID: 0` 是正常座位；端点类型负责区分玩家与公共来源。
- 来源玩家是单个确定座位。多目标去重后一个座位使用 `player`，多个使用 `playerCandidates`；
  不将空数组转换为 `255`。第一阶段需清点空目标的实际调用，真实无位置状态单独建模，
  错误夹具修正调用，不让空目标造成物理牌脱离有效区域。
- `markSpellID` 是端点标记空间：协议 `0` 保留为 `0`，领域入口确有空空间语义时显式传 `null`。
  归一化完成后，消费方不再用动作技能 ID 猜测缺失的标记空间。
- 公共位置沿用 `PublicPosition` 和 `cardPositions.ts`，保留数字槽位、牌顶、牌底和随机等语义。
  不把位置压缩为少量枚举，也不将位置写入玩家座位。
- `outside` 与 `unresolved` 不相同：前者是明确游戏外来源，后者不能授予“游戏外新建身份”语义。
  `exile` 保留公共槽与既有特殊物化处理，不合并成 `outside`。
- 首轮只覆盖已支持的移动区域。若清点出真实自定义公共区或玩家子区，在定稿时显式补充；
  不因基础 `PublicZoneName/SubZone` 当前含 `string` 就为新端点加入任意字符串兜底。

### 与位置候选的关系

端点描述一次移动的输入，`LocationCandidate` 描述卡牌当前可能的位置。两者复用领域基础类型，
不直接互相充当参数：候选有 `count/label`、装备容器和交换批次令牌，端点有移动来源与取牌位置。

只在现有候选写入点做显式转换，例如将目标 `markSpellID` 映射为玩家位置候选的 `spellID`。
装备容器仍由 `equipmentMarks.ts` 与暗置标记组件按当前规则解析；不在协议归一化阶段伪造
`container` 端点。交换区批次仍由技能与 `ExchangeBatch` 管理。

## 3. 事件与 Room 入口

最终 `NormalizedMoveEvent` 顶层携带 `from`、`to`，保留 `protocol`、`raw`、事件类型、牌 ID、
数量与移动类型。`options` 只放执行选项，不再包含端点字段或顶层 `toZone` 的镜像。

Room 的目标调用形态：

```ts
room.moveCards(cardIDs, {
  from: { type: 'public', zone: 'pile', position: POSITION_TOP },
  to: { type: 'player', seatID: 2, subZone: 'hand' },
  cardCount: 2,
  moveType: MOVE_TYPE.DRAW
})

room.moveCards(cardIDs, {
  from: { type: 'player', seatID: 0, subZone: 'mark', markSpellID: 414 },
  to: { type: 'player', seatID: 0, subZone: 'hand' },
  triggerSpellID: 3389
})
```

`RoomMoveRequest` 组合 `MoveRoute` 与非端点执行选项。`from/to` 必填；旧调用的缺省牌堆、
手牌、顶部位置在迁移调用点时显式写出。新入口不接受数字 `fromZone`，不再调用 `parseInt`
猜测来源。有重复且稳定的场景时可提供小型工厂，不重建可选字段大对象。

保留 `cardCount`、`handMoveCount`、`sourceCards`、匿名化选项、公共候选选项、数量约束、
`pileIdentityCardIDs`、`pileIdentityEvent` 等现有业务语义。本次不顺带统一协议数量与实体数量：
交换技能已经允许二者不同。

### 技能 ID 的分离

| 信息 | 目标位置 | 迁移要求 |
| --- | --- | --- |
| 原始动作技能 | `event.protocol.SpellID`；领域直调使用 `triggerSpellID` | 协议事件派生该值，不能被目标标记空间覆盖 |
| 来源标记空间 | `from.markSpellID`，仅 mark 分支 | 按 `FromZoneParam` 和既有协议回退规则解析一次 |
| 目标标记空间 | `to.markSpellID`，仅 mark 分支 | 按 `ToZoneParam` 和既有协议回退规则解析一次 |
| 手牌获得来源 | `gainSpellID` | 保留 `undefined` 表示保留原值、`null` 表示无技能来源的区别 |
| 旧逐牌技能回调选择 | 从端点与动作信息按原有规则派生 | 不把所有 `context.spellID` 机械替换成 `triggerSpellID` |

迁移 `knownPlacement.ts` 时逐一确认 `Room.skillHandlers` 的分发与 `Card.bindCandidates()`
所需值，保留逐牌回调顺序。若旧回调仍需按端点选择技能，将该选择封装为无状态规则并验证；
不保留可由多个模块分别改写的通用 `spellID` 镜像。

### 上下文与派生事实

`RoomMoveContext` 保存唯一的 `from/to`，继续保存移动前手牌快照及阶段执行结果。
`sourceHandSeat`、`targetHandSeat` 可作为有明确用途的派生值保留：只有确定玩家手牌端点才有值；
多个候选目标不能任意选择一个座位扣增手牌数。

删除通用的 `fromSeat/fromZone/fromSubZone/targetSeats/sourceIsOutside` 等存储镜像。
需要座位数组的候选算法可局部读取端点生成数组；现有只接收确定座位的低层算法不必全部改成
接收整个端点，也不因重构增加全牌池遍历。

## 4. 协议归一化与技能补丁

`normalizeMoveEndpoints()` 继续是协议端点解析的唯一位置，返回完整 `MoveRoute`。
入口 `raw/patched` 分工和允许修正的协议字段范围保持不变。

| 当前输入 | 目标表达与行为 |
| --- | --- |
| 玩家手牌/装备/判定来源 | 单玩家端点，原样使用协议座位 |
| 玩家标记区 | 单玩家 mark 端点，来源和目标各自解析标记空间 |
| 公共区 `FromID/ToID = 255` | 公共或 outside 端点，不填玩家座位 |
| 来源 `FromZone = 8` | popup；`FromID = 255` 时沿用 `SpellID`，否则使用 `FromID` |
| 目标 `ToZone = 8` | popup；空间沿用当前 `SpellID` 规则，不擅自改用 `ToID` |
| 交换区的 `FromID/ToID` | 物理端点为 exchange；原始 ID 仍在 protocol 中供技能定位逻辑桶 |
| 未知来源协议区 | 显式 unresolved，保留既有告警与已知/未知取牌分支的行为 |
| 未知目标协议区 | 继续沿用当前 process 降级与告警；调整诊断策略另立任务 |

未知来源已有归一化测试；落到 Room 后，已知牌与未知牌的历史处理并不相同。
第一阶段须记录并用现有状态结果明确这种差异，迁移时集中保留，不能把所有未知来源一律当作
outside 或 pile，也不借机扩大默认牌堆回退的适用范围。

`MoveEventPatch` 可修改 `from/to`，每次替换完整端点；禁止 `Partial<MoveEndpoint>` 与跨类型
字段深合并。未提供端点时沿用原对象，提供时整体替换。执行选项继续按已有规则浅合并。
端点及嵌套座位数组只读；调用方不能改写共享端点对象。

技能只改取牌位置时，在收窄 `from.type === 'public'` 后用展开创建新公共端点。宴戏、观虚等
技能修正后的物理位置保存在 `from.position`，原协议位置仍留在 `protocol/raw` 供追溯。

## 5. 必须保持的行为

| 场景 | 保持项 | 主要实现与现有验证入口 |
| --- | --- | --- |
| 普通摸牌与回牌堆 | 顶/底顺序、随机候选、暗牌不越过不允许消费的明牌端点 | `sources.ts`、`knownSources.ts`；`pileDisplayOrder.test.ts`、`anonymousPileSpike.test.ts` |
| 弃牌未知获得 | `MoveType=18` 和进入玩家区的 `MoveType=15` 补匿名实体；显式来源去重与数量补足 | `sources.ts`；`discardGain.test.ts` |
| 玩家区明牌置换 | 确定来源、同批隔离、旧公共槽回补，不凭数组顺序裁决随机来源 | `knownPlacement.ts`；`knownMoveStages.test.ts`、`knownDiscardConfirm.test.ts` |
| popup 出入及显式实体 | 空间隔离、取牌摘账本、置换后回补账本 | `popupSpaces.ts`、`sources.ts`；`popupProtocol.test.ts`、`popupCandidates.test.ts` |
| 标记回手牌 | 来源空间 414 与动作技能 3389 分离；跨子区候选不提前落定 | `hiddenMarks.ts`；`hiddenMarkCandidates.test.ts`、`markToHandAmbiguous.test.ts` |
| 木牛流马 | 装备本体移动不提前迁移内部牌，等待 mark 空间迁座通知 | `equipmentMarks.ts`；`equipmentMarks.test.ts`、`muniuMarkTransfer.test.ts` |
| 交换区技能 | 物理区、批次令牌、嵌套批次、协议手牌变化量分别保留 | `GuanXu.ts`、`JieLi.ts`、`HandExchange.ts`；`guanXuExchange.test.ts`、`jieLiExchange.test.ts`、`handExchange.test.ts` |
| 随机转移与多目标 | 候选目标不等同于多份移动；移动前手牌事实与子区约束保持 | `candidates.ts`；`randomTransferLifecycle.test.ts`、`equipmentMarks.test.ts` |
| 游戏外与 exile | 明确游戏外新建和公共匿名槽物化仍走不同规则 | `knownSources.ts`、`identity.ts`；`anonymousPileSpike.test.ts` |
| 揭示、洗牌和 noop | 保留各自入口、是否真实移动及通知条件；不统一强行走普通移动 | `trackerController.ts`；`trackerController.test.ts`、`moveCardRoutes.test.ts` |

### 不能机械消除的混合来源

`discardGain.test.ts` 覆盖了 `fromZone: 'discard'` 同时带 `fromSeatID` 或显式 `sourceCards`
的调用，也验证了弃牌获得不会消费附带座位所指的手牌、标记或弹窗实体。

迁移这些调用时，声明来源设为 discard，显式选牌仍放在 `sourceCards`。需要保留的“取显式实体、
移除旧关系、数量不足补匿名牌”属于来源选择策略，不继续用伪玩家端点控制。先对照每个用例的
物理区成员、身份和张数决定是否需要一个小范围的执行选项；只有存在不可由端点与现有选项推导的
真实差异时才新增该选项，并在阶段一写明调用方与语义。不建立通用取牌策略框架。

数字 `fromZone` 的现有夹具也逐个核对实际行为与测试意图。不能把所有 `1` 改成 pile 或
把所有 `2` 改成 discard；一个测试若在验证玩家来源，应改成明确玩家端点。不能以删除混合字段
为理由删掉原有的状态守恒断言。

### 身份账本边界

`RoomIdentity.commitPileIdentityForMove()` 当前优先使用 `pileIdentityEvent.protocol` 的区域、
数量与技能事实；领域直调才从上下文推导账本区域。迁移后保留这条优先级：物理执行端点可被技能
修正，但不能因此覆盖账本需要的原始协议事实。`pileIdentityCardIDs` 仍优先于协议牌 ID。

公共取牌位置改读 `from.position/to.position`；领域账本区域从端点类型派生，玩家座位不转换为
协议 Zone 数字。洗牌世代事务仍先于物理重建，普通移动仍保留身份提交与最终收敛边界。

## 6. 分阶段实施

各阶段完成后保持可编译、可测试。类型增加可以先提交；实际消费切换必须覆盖对应完整链路。
不同时运行两套移动逻辑，也不双写新旧端点。

### 阶段一：清点与契约定稿

- 清点 `types.ts`、`room/movement/types.ts`、`Room.moveCards()`、Controller 揭示入口、
  技能 `patchEvent()` 和直接调用的测试夹具。
- 将调用分类为协议端点、数字座位旧入口、显式实体来源、未定位来源、多候选目标。
  核实自定义区域、非玩家标记空间、空目标以及数字 `fromZone` 的真实调用需求。
- 固化上述混合来源、未知协议区和旧技能回调的行为；补测仅针对迁移必须保留而现有测试未覆盖
  的领域差异。复用现有夹具，不为每个字段映射重复写测试。
- 定稿 `MoveSource/MoveTarget/RoomMoveRequest`、标记字段和旧入口映射清单，再添加共享类型。

完成条件：本文未决的输入形态均有明确处理或已确认无合法调用；不靠实施时随意 fallback 补齐。

### 阶段二：Room 内部切换

- 新增 `moveCards(cardIDs, request)` 签名，旧三参数签名暂经一个集中适配器转换到新请求。
  新旧签名由参数结构明确区分，不允许一个请求同时包含两套字段。
- 旧适配器只接收现存调用，按阶段一清单处理缺省与混合语义；不新增对非法输入的兼容。
- 在一个完整变更中切换 `context.ts`、`RoomMovement`、来源查询与选牌、已知/未知落区、
  候选传播、暗置标记、装备规则以及 `RoomIdentity` 的端点读取。
- 内部方法只消费新端点。必要的旧技能回调选择作为纯派生规则保留，不存储旧上下文副本。
- 日志摘要改为输出 `from/to` 与有用的派生事实，保持协议和领域请求可追溯。

完成条件：旧入口和新入口进入同一条执行管线，端点在 Room 内只有一份权威描述；本阶段回归通过。

### 阶段三：协议、Controller 与技能切换

- `NormalizedMoveEvent` 改为顶层 `from/to`，删除事件端点旧字段；同步更新 normalizer、
  `patchEvent()`、技能读写及注册分发使用的类型。
- Controller 普通移动直接调用新 Room 入口，`showTrackerCards()`、
  `revealTrackerCards()`、`revealTrackerCardsInZone()` 内部构造新请求。
  非移动揭示 API 的对外签名不顺带重做，转换集中在 Controller 边界。
- 技能私有的交换桶 ID、标记观测和原始协议谓词继续读取协议；已经是领域端点判断的代码改读
  新结构，不在技能内重新解析协议端点。
- 更新事件摘要和来源修正日志；端点补丁完整替换并保留原始事件不变。

完成条件：生产协议移动不经过旧 Room 适配器；正常移动、揭示、延期、noop 与洗牌回归通过。

### 阶段四：领域调用与测试夹具迁移

- 迁移剩余 Room 直调、技能内部补偿、公共 API 示例和非 UI 测试，明确原先隐含的来源与位置。
- `protocolMove()` 继续构造完整原始协议，不接受领域端点代替协议字段；低层测试使用新 Room 请求。
- 只修改受影响的测试构造与有价值的语义断言，保持既有文件风格，不整体重排测试。
- 跨玩家与公共区候选继续验证完整 `LocationCandidate`，不能只检查端点对象相等。

完成条件：生产代码与普通测试均无旧移动入口调用；旧接口使用量为零。

### 阶段五：删除过渡层与更新当前文档

- 删除旧签名、适配器、`SourceZoneInput` 等不再使用的类型及端点镜像。
  `types.ts` 的旧 `MoveContext` 当前只有声明，删除前再次确认引用。
- 为新移动请求和补丁显式列出实际使用的执行选项，收窄现有宽泛索引签名，避免已删除的端点字段
  继续通过 `[key: string]: unknown` 被静默接受；不扩大到无关协议或配置类型。
- 检索旧字段时按语义判断：原始协议、身份账本事件、非移动揭示 API、技能状态或确定座位算法
  中的同名字段不属于端点迁移残留，不做全仓文本替换。
- 更新 `tracker_api.md`、`room.md`、必要的协议说明与本文状态；来源座位文档中的旧路径说明
  改成新端点契约。现行 API 文档只在实际切换后更新。

完成条件：没有旧参数兼容通道、没有双份可写端点，通过最终验证并完成手工验收。

## 7. 验证与验收

本计划文档变更检查内容、路径引用并运行 `git diff --check`，无需 Prettier 格式化、格式检查或构建。

后续每个涉及 tracker 的实现阶段运行：

```sh
pnpm lint
pnpm typecheck:tracker
pnpm typecheck
pnpm test:tracker
pnpm build
```

Room 核心、协议链路切换与最终交付额外运行 `pnpm build:prod`。开发时可先跑表中相关测试，
阶段结束再执行完整门槛；检查通过且无新变化时不重复运行。

重点验收：

1. 公共端点无玩家座位，popup 保留独立空间，玩家座位 `0` 正常移动。
2. 补丁从公共区改为玩家区、或修改公共位置时，不遗留另一端点类型字段，不修改原事件。
3. 弃牌获得、显式来源、标记迁座、交换批次与玩家来源置换的实体、牌序、身份和数量与迁移前一致。
4. 移动前手牌快照、候选约束、身份账本提交及收敛顺序保持一致；多目标不重复计算移动张数。
5. 没有因端点读取引入全牌池扫描；`traversalBaseline` 不无解释更新，新增扫描必须按现有规则插桩。
6. 手工检查摸牌、弃牌、标记回手、弹窗取牌、交换区回手的面板数量、公共牌序和日志来源。
   不新增或扩展 DOM、布局、点击等 UI 自动化测试。
7. 不主动读取或运行回放目录；若后续实施范围明确涉及回放，届时按 `replay.md` 独立处理。

## 8. 风险控制与完成定义

最大风险是把当前分支优先级误当成冗余字段，导致取错实体、少清理空间账本或改写身份事件。
先固定状态结果，再切换表示；发现不一致时停留在当前阶段定位，不增加隐式兼容分支使测试通过。

各阶段使用独立、可回退的提交。回退整个阶段及其调用变更，避免只恢复旧字段而留下新消费者。
不增加运行时功能开关或影子移动，因为两套写路径可能重复消费实体。

最终应同时满足：端点语义只定义一次，生产链路只传递新结构，旧移动字段和适配器已删除，
既有领域结果及性能护栏保持，当前 API 文档与实现一致。收益以消除歧义和重复解析衡量，
不承诺本次重构提高推断能力或修复尚未证实的协议问题。
