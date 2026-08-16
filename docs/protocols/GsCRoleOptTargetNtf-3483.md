# `GsCRoleOptTargetNtf` / `PubGsCMoveCard`：诫厉观看牌堆顶与目标部分手牌

## 消息用途

族钟繇发动诫厉（`SpellID = 3483`）时，会收到一组配对消息：

1. 发动者的 `GsCRoleOptTargetNtf` 提供牌堆顶卡牌 ID 和目标的**部分**手牌 ID；目标与其它座位只收到 `Params=[pileCount]`。
2. `PubGsCMoveCard` 描述牌堆顶卡牌在牌堆内的同区展示，不代表真实移动或随机洗入牌堆。

后续还有牌堆/手牌经交换区再分别回牌堆与回手牌的 `MoveType=11` 序列。
该序列按视角分流：发动者使用已有完整信息走默认移动；生产目标只定位自己换出手牌的回堆槽；
第三方视角不消费牌 ID 或移动物理实体，只在完整交换链结算后保留目标手牌/牌顶范围弱候选。
开发模式只放开目标视角的完整身份调试。

## 目标通知

```text
className: "GsCRoleOptTargetNtf"
SpellID: 3483
Type: 28
Param: 1
SeatID: 3
SrcSeatID: 3
targetSeatID: 4
Timeout: 30
Params: [4, 2, 81, 99, 124, 4, 91, 158]
```

| 字段           |                              示例 | 含义                                       |
| -------------- | --------------------------------: | ------------------------------------------ |
| `SpellID`      |                            `3483` | 诫厉                                       |
| `Type`         |                              `28` | 选择目标/区域的技能通知                    |
| `Param`        |                               `1` | 当前适配阶段；本技能在 `Param == 1` 时处理 |
| `SrcSeatID`    |                               `3` | 发动技能的座位                             |
| `targetSeatID` |                               `4` | 被查看手牌的目标座位                       |
| `Params`       | `[4, 2, 81, 99, 124, 4, 91, 158]` | 见下方拆分规则                             |

`Params` 布局：

```text
[pileCount, handCount, ...pileTopCardIDs, ...handCardIDs]
```

本例中：

- `pileCount = 4`，牌堆顶为 `[81, 99, 124, 4]`
- `handCount = 2`，目标座位 `4` 的手牌明牌片段为 `[91, 158]`
- 牌堆顶 `Params` / 同区展示 `CardIDs` 均为 **top-first**：第一项 `81` 是最顶牌，向内依次为 `99`、`124`、`4`
- **手牌片段是目标座位的部分手牌，不一定覆盖其全部手牌**；仅当本地整手数恰好等于 `handCount` 时才升级为 `fullHand`

上述完整 `Params` 只会下发给发动者。目标座位 `6` 以及其它座位实测收到：

```text
Param: 1
Params: [4]
SeatID: 7
SpellID: 3483
SrcSeatID: 7
Type: 28
targetSeatID: 6
```

当 `Param == 1` 时，当前主动适配：

1. 不论当前视角是否携带牌 ID，都用 `SrcSeatID / targetSeatID / Params[0]` 记录 `actorSeat / targetSeat / pileCount` 上下文。
2. 若 `Params.length > 2` 且 `pileCount > 0`，按协议实际携带的 ID 同步牌堆顶；协议已保证这只出现在发动者视角。
3. 若 `handCount > 0` 且 `targetSeatID` 不是公共占位座位 `255`，将
   `Params.slice(2 + pileCount, 2 + pileCount + handCount)` 同步为目标座位手牌明牌：
   - 默认按**部分手牌**处理（不带 `fullHand`）。
   - 若本地已观测手牌数等于 `handCount`，或无观测时本地手牌实体数等于 `handCount`，则按整手
     `fullHand: true` 同步，并写回该座位的观测手牌数。

说明：运行时不需要根据 `mySeatID` 再判断是否展示。`Params` 本身已是权限边界；
只有 `[pileCount]` 时不伪造任何牌面。

## 同区展示

```text
CardCount: 4
CardIDs: [81, 99, 124, 4]
FromID: 255
FromZone: 1
FromZoneParam: 0
MoveType: 21
SpellID: 3483
ToID: 255
ToZone: 1
ToZoneParam: 0
```

`FromZone = 1`、`ToZone = 1` 且两端 ID 都为 `255`，说明来源和目标都是牌堆。
结合 `SpellID = 3483` 与 `MoveType = 21`，该消息表示原地展示牌堆顶卡牌：

- `CardIDs` 不应被当作随机位置的卡牌。
- 不应把卡牌从牌堆移出后再随机放回。
- 若协议已明确两端同区且位置一致，归一化会直接识别为同区展示；**不必**仅为 `3483` 强行加入
  `PILE_SAME_ZONE_SHOW_SPELL_IDS`。该白名单只服务于权变/观虚这类“协议位置字段为 RANDOM、需要强制改成牌顶”的场景。

当前实现注意：

- `PILE_SAME_ZONE_SHOW_SPELL_IDS = [7011, 987, 988]` 不纳入 `3483` 是预期策略，不是缺口。
- 先判断当前 3483 观看消息本身是否已足够明确；只有在实战里也出现 RANDOM 端点、导致无法识别同区展示时，才再考虑扩展白名单。

## 与观虚 / 权变的差异

| 项目         | 权变 `7011`                       | 观虚 `987` / `988`                    | 诫厉 `3483`                                                  |
| ------------ | --------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| 目标通知内容 | 仅牌堆顶 `Params`                 | `Params` 同时含牌堆顶与目标手牌       | `Params` 同时含牌堆顶与目标手牌                              |
| 手牌范围     | 无                                | 目标手牌片段（按 `handCount`）        | 目标**部分**手牌；`handCount` 不必等于目标全部手牌数         |
| 目标座位     | `targetSeatID = 255` 表示公共牌堆 | `targetSeatID` 是被查看手牌的玩家座位 | 同观虚；`targetSeatID` 是被查看手牌的玩家座位                |
| 移动消息     | 牌堆同区展示                      | 牌堆同区展示；手牌由目标通知揭开      | 观看阶段同样是牌堆同区展示；之后还有交换区暂存/回牌堆序列    |
| 后续移动     | 无本技能特化暂存链                | 无本技能特化暂存链                    | 牌堆与目标部分手牌进 `exchange(10)`，再分别回牌堆/回目标手牌 |

## 后续交换序列（已观测实战）

观看阶段之后，同一 `SpellID=3483` 会继续发出 4 条 `MoveType=11` 交换消息。
本例承接上文：发动者座位 `3`，目标座位 `4`，观看得到的牌堆顶为
`[81, 99, 124, 4]`，目标部分手牌为 `[91, 158]`。

### 1. 牌堆顶进入交换区

```text
CardCount: 4
CardIDs: [4, 124, 99, 81]
FromID: 255
FromZone: 1
FromZoneParam: 0
MoveType: 11
SpellID: 3483
ToID: 3
ToZone: 10
ToZoneParam: 0
```

| 字段                        | 含义                                                                      |
| --------------------------- | ------------------------------------------------------------------------- |
| `FromZone=1` / `FromID=255` | 来自公共牌堆                                                              |
| `ToZone=10` / `ToID=3`      | 进入交换区；`ToID` 是发动者座位，用作交换批次归属，不是牌堆 ID            |
| `CardIDs=[4, 124, 99, 81]`  | 与观看 top-first `[81, 99, 124, 4]` 为**整段逆序**；第一项不再是牌顶 `81` |
| `MoveType=11`               | 交换路径，不是同区展示                                                    |

顺序提醒：

- 观看/同区展示：`[81, 99, 124, 4]` → `81` 在牌堆顶
- 本条进交换区：`[4, 124, 99, 81]` → 同一集合，数组方向相反
- 后续交换消息的 `CardIDs` **不能**再按观看 top-first 解读；应把每条消息的数组顺序视为该次移动自身的协议顺序

### 2. 目标部分手牌进入交换区

```text
CardCount: 2
CardIDs: [91, 158]
FromID: 4
FromZone: 5
FromZoneParam: 0
MoveType: 11
SpellID: 3483
ToID: 3
ToZone: 10
ToZoneParam: 0
```

| 字段                      | 含义                                           |
| ------------------------- | ---------------------------------------------- |
| `FromZone=5` / `FromID=4` | 来自目标座位 `4` 的手牌                        |
| `ToZone=10` / `ToID=3`    | 同样进入发动者归属的交换区批次                 |
| `CardIDs=[91, 158]`       | 仅目标**部分**手牌；张数不必等于目标全部手牌   |
| `CardCount=2`             | 非整手，因此不能被 `HandExchange` 整手账本接管 |

此时交换区共 6 张：原牌堆 4 + 原目标手牌 2。

### 3. 交换区回牌堆

```text
CardCount: 4
CardIDs: [158, 91, 99, 81]
FromID: 3
FromZone: 10
FromZoneParam: 0
MoveType: 11
SpellID: 3483
ToID: 255
ToZone: 1
ToZoneParam: 0
```

| 字段                        | 含义                                                                       |
| --------------------------- | -------------------------------------------------------------------------- |
| `FromZone=10` / `FromID=3`  | 从发动者归属的交换区批次取出                                               |
| `ToZone=1` / `ToID=255`     | 回到公共牌堆                                                               |
| `CardIDs=[158, 91, 99, 81]` | **混合来源**：`158/91` 原属目标手牌，`99/81` 原属牌堆顶；协议直接给出正 ID |

### 4. 交换区回目标手牌

```text
CardCount: 2
CardIDs: [124, 4]
FromID: 3
FromZone: 10
FromZoneParam: 0
MoveType: 11
SpellID: 3483
ToID: 4
ToZone: 5
ToZoneParam: 0
```

| 字段                       | 含义                                 |
| -------------------------- | ------------------------------------ |
| `FromZone=10` / `FromID=3` | 仍从发动者交换区批次取出             |
| `ToZone=5` / `ToID=4`      | 回到目标座位 `4` 手牌                |
| `CardIDs=[124, 4]`         | 原牌堆顶中的 2 张；协议直接给出正 ID |

### 张数守恒与结果

```text
观看：pileTop=[81, 99, 124, 4], handPartial=[91, 158]
回牌堆 4 张： [158, 91, 99, 81]
回手牌 2 张： [124, 4]
合计 6 = 4 + 2
```

本例结果可理解为：

- 目标手牌 `91/158` 与牌堆 `99/81` 进入牌堆
- 牌堆 `124/4` 进入目标手牌
- 发动者座位 `3` 不持有这批牌，只作为交换区 `ToID/FromID` 批次键

### 协议推理要点

1. 四条消息都是 `MoveType=11`，且本样例 **全部给出正 `CardIDs`**，不是全暗路径。
2. 进交换区时 `ToID`、出交换区时 `FromID` 都是发动者座位；不能把 `FromZone=10` 的 `FromID` 当玩家来源座位。
3. 回出方向是**拆分**的：一部分 `10 -> 1`，一部分 `10 -> 5`；不是“暂存手牌整批回牌堆”。
4. 回牌堆/回手牌的 `CardIDs` 都是混合重排后的选择结果，不能假设仍按进区批次原样返回。
5. **数组顺序会翻转或重排，不能跨消息复用“第一项=牌顶”假设**：
   - 观看/同区展示：`[81, 99, 124, 4]` 是 top-first，`81` 为牌顶
   - 牌堆进交换区：`[4, 124, 99, 81]` 是同一 4 张的逆序
   - 回牌堆：`[158, 91, 99, 81]` 已混入手牌来源，既非原 top-first，也非单纯逆序
   - 回手牌：`[124, 4]` 是原牌堆子集，顺序也不再绑定观看数组下标
6. 因此后续交换适配必须：
   - 用正 ID 集合做身份追踪
   - 对每条 `PubGsCMoveCard` 单独解释其 `CardIDs` 顺序
   - 不要把观看阶段数组直接 reverse 后当成回牌堆/回手牌结果

## 目标本人视角：Type 53 在隐藏回堆前给出交换选择

目标本人视角还观测到以下一张牌交换序列：

```text
牌堆进入交换区：CardIDs=[118,156,39,110]
目标手牌进入交换区：CardIDs=[48]
CGsRoleSpellOptRep：Type=53, Datas=[7,6,1,48,1,110]
交换区回牌堆：CardCount=4, CardIDs=[]
交换区回目标手牌：CardIDs=[110]
```

Type 53 的 `Datas` 布局为：

```text
[actorSeat, targetSeat, handCount, ...handToPileCardIDs, pileCount, ...pileToHandCardIDs]
```

本例表示：发动者座位 `7`、目标座位 `6`、目标手牌 `48` 换入牌堆、牌堆牌 `110` 换入目标手牌。
因此隐藏的 `10 -> 1` 到达前已经可以确定：`48` 应回到 `110` 的原牌堆槽位。实际牌序 top-first 为：

```text
[48,39,156,118]
```

但生产目标视角只能保留：

```text
[48, ?, ?, ?]
```

`39/156/118` 在本视角中仍由匿名物理槽承载，不进入 `cardIndex` 或牌堆已知身份集。

同一布局在目标座位 `4` 视角还观测到两张交换：

```text
牌堆进入交换区：CardIDs=[4,124,99,81]
目标手牌进入交换区：CardIDs=[91,158]
CGsRoleSpellOptRep：Type=53, Datas=[3,4,2,91,158,2,124,4]
交换区回牌堆：CardCount=4, CardIDs=[]
交换区回目标手牌：CardIDs=[124,4]
```

Type 53 的两组卡牌 ID 按下标逐项配对，而不是两个无序集合：

- `handToPile[0]=91` 替换 `pileToHand[0]=124` 的原牌堆槽位
- `handToPile[1]=158` 替换 `pileToHand[1]=4` 的原牌堆槽位

原牌堆 top-first 为 `[81,99,124,4]`，实际回堆后为 `[81,99,91,158]`，目标手牌获得
`[124,4]`。生产目标视角只保留 `[?, ?, 91, 158]`；运行时按配对关系建立短期
`protocol pile ID -> anonymous slot` 映射，不将 `81/99/124/4` 预先物化为牌堆明牌。

这组消息全部属于目标角色视角，不能依赖发动者或其它角色视角补齐回堆 `CardIDs`。
`CGsRoleSpellOptRep.SeatID=7` 仍是发动者，不是需要消费该消息的视角；运行时仅当
`Room.mySeatID === targetSeat`（本例为座位 `6`）时解析并写入诫厉批次。发动者座位 `7` 和其它座位
不处理这条 `3483 / Type 53` 选择结果。

## 当前 `decorateJieLi` 策略

旧装饰器曾与实战序列有这些冲突：

| 旧装饰假设                                                 | 已观测实战                                          |
| ---------------------------------------------------------- | --------------------------------------------------- |
| 牌堆进交换区依赖 `FromPosition=RANDOM`，且常按全暗处理     | 本序列直接给正 `CardIDs`，且未见依赖 RANDOM 分支    |
| 手牌进交换区后主要等待“全暗回牌堆”，用 `stagedCards` 补 ID | 回牌堆/回手牌都已给正 ID；回牌堆还是手牌+牌堆混合集 |
| 只特化 `10 -> 1` 回牌堆                                    | 实战还有 `10 -> 5` 回目标手牌                       |
| 把暂存理解成“手牌批次原样回放”                             | 发动者在交换区完成重选/重排后拆回两个目标区         |

当前主动策略：

1. `handleRoleOptTargetNtf` 从完整或纯计数 `Params` 统一记录 `actorSeat / targetSeat / pileCount`；只有协议实际携带 ID 时才同步牌面。
2. 发动者不建立 JieLi 推断批次，直接走默认已知移动。
3. `handleRoleSpellOptRep` 只在当前 `mySeatID` 等于 Type 53 的 `targetSeat` 时解析选择结果；发动者和其它座位直接忽略。
4. 生产目标视角将 `1 -> 10` 泄露的牌堆 ID 改成匿名 `sourceCards`，Type 53 只把目标手牌替换到匹配槽位。`pileIdentityCardIDs` 只写目标原手牌与技能前已合法公开的身份。
5. 后续 `10 -> 5` 只校验其明牌与 Type 53 的 `pileToHandCardIDs` 一致，再执行正常入手移动并清理批次。
6. 开发模式的目标视角允许物化完整牌堆槽，用于调试隐藏回堆结果。
7. 第三方视角把四条交换移动归一为物理 `noop`；只有完整观察到 `1 -> 10`、`5 -> 10`、`10 -> 1`、`10 -> 5` 后，才为交换开始时仍可能位于目标手牌的明牌追加“牌堆顶前 pileCount 张”候选。原有位置分支全部保留，不消费消息中的 `CardIDs`，也不建立精确数量约束；仅有观看消息或链路中断时不修改候选。
8. 整手交换通用账本（`HandExchange`）显式排除 `3483`，避免目标恰好只有一张手牌时误判为整手互换。

## 代码位置

- 目标通知与部分手牌明牌：`src/handler/GsCRoleOptTargetNtf.js`（`SpellID = 3483`）
- 牌堆同区展示端点归一化：`src/handler/PubGsCMoveCard.js` 的 `normalizeMovePosition` / `PILE_SAME_ZONE_SHOW_SPELL_IDS`
- 同区展示识别：`src/tracker/MoveEventNormalizer.ts` 的 `isSameZoneShowEvent`
- Type 53 目标视角分发：`src/handler/CGsRoleSpellOptRep.js`
- 目标视角交换装饰：`src/tracker/skill/JieLi.ts`
- 移动装饰注册：`src/tracker/runtime/moveEventHandlers.ts` 的 `registerDefaultMoveEventHandlers`
- 相关排除说明：`docs/protocols/hand-exchange.md`（诫厉不走整手交换账本）

## 已知适配缺口

1. 生产目标视角的匿名牌堆槽、Type 53 位置配对、隐藏回堆与最终入手已有回归；发动者默认精确移动、第三方目标手牌/牌顶范围弱候选也已覆盖。
2. 字段不完整的结算分支会回退默认移动；交换序列中断或重复时仍可继续补充超时清理、诊断与恢复策略。
3. 边缘约束仍待用新版 `ConstraintGroup` 精细化；见 `docs/agents/card_tracker.md` 未完成项。
