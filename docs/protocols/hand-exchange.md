# `PubGsCMoveCard`：整手牌经交换区互易

## 消息用途

`MoveType = 11`（交换）会把双方整手牌先暂存到协议交换区
`FromZone/ToZone = 10`（`exchange`），再按批次回到对方手牌。

`SpellID = 121` 是完整实战示例；记牌器实现按**协议模式**识别，不绑定单一技能 ID。
其他技能只要走同一组 `5->10 / 10->5` 整手序列（`CardIDs` 可为空或包含正 ID），也会复用同一套账本。

关键点：

- 进交换区与回手牌时，对侧常为全暗 `CardIDs=[]`；己方视角也可能给整手正 ID。两种都要能接管。
- 回手牌时 `FromID` 表示**原持有者批次**，不是目标座位；目标座位在 `ToID`。
- 交换区 `FromZone=10` 时，`FromID` 不能当座位解释；记牌器必须用进区时登记的批次账本回填 `sourceCards`。
- 账本按 `SpellID` 隔离，避免两个交换技能并发时串批。

记牌器实现入口：

- 归一化：`normalizeMoveEvent()` / `protocolZones`（`10 -> exchange`）
- 装饰：`src/tracker/skill/HandExchange.ts`（`decorateHandExchange`）
- 注册：经 `decorateGenericMove`（`*` 处理器）统一接入
- 落状态：`Room.moveCards()`；手牌进交换区时用 `sourceCards` 搬走暗实体，用 `cardIDs` 搬走已公开明牌

## 识别门槛（避免误伤）

只接管同时满足以下条件的路径：

1. `MoveType = 11`
2. `FromZone/ToZone` 为 `5->10` 或 `10->5`
3. 进区时 `CardCount` 等于该座位观测手牌数，或等于本地手牌实体数

`CardIDs` **允许有正 ID**：

- 常见于“本机视角的己方整手”协议直接给出全部手牌 ID。
- 装饰器会把协议正 ID 对应实体 `confirmKnown()`，再登记整批。
- 对侧若仍是 `CardIDs=[]`，继续按暗实体批次处理。

因此以下路径**不会**被整手交换接管：

- 佐练等“先亮 1 张，再 `5->10` 单张暂存”的路径（张数不是整手）
- 诫厉等“手牌进交换区后回牌堆”的路径（目标不是 `ToZone=5`；协议见 `docs/protocols/GsCRoleOptTargetNtf-3483.md`）
- 骋烈等交换区到标记区/手牌的特化路径（由各自技能装饰器处理）

## 场景前提（示例，SpellID=121）

| 座位 | 交换前手牌          | 说明                       |
| ---- | ------------------- | -------------------------- |
| 4    | 4 张暗牌            | 本地仅有暗实体，无公开 ID  |
| 5    | 4 张暗牌 + 4 张明牌 | 明牌 ID：`106, 14, 68, 67` |

交换后期望：

| 座位 | 交换后手牌                     |
| ---- | ------------------------------ |
| 4    | 原 5 号的 8 张（含 4 明 4 暗） |
| 5    | 原 4 号的 4 张暗牌             |

## 完整协议序列（示例）

### 0. 前置：5 号获得 4 张明牌（非交换本体）

```text
CardCount: 4
CardIDs: [106, 14, 68, 67]
FromID: 3
FromZone: 5
FromZoneParam: 0
MoveType: 27
SpellID: 120
ToID: 5
ToZone: 5
ToZoneParam: 0
```

这一步只解释示例初始态：5 号手牌变为 4 暗 + 4 明。整手交换从下一步开始。

### 1. 4 号整手牌进入交换区

```text
CardCount: 4
CardIDs: []
FromID: 4
FromZone: 5
FromZoneParam: 0
MoveType: 11
SpellID: 121
ToID: 4
ToZone: 10
ToZoneParam: 0
```

| 字段                      | 含义                                                      |
| ------------------------- | --------------------------------------------------------- |
| `FromZone=5` / `FromID=4` | 来源是 4 号手牌                                           |
| `ToZone=10` / `ToID=4`    | 目标是交换区；`ToID` 可回指原持有者，不表示座位间直接转手 |
| `CardIDs=[]`              | 全暗；必须按 4 号当前手牌实体整批搬走                     |
| `CardCount=4`             | 与 4 号观测手牌数一致，表示整手清空                       |

记牌器动作：

1. 收集 4 号手牌全部实体（本例 4 张暗牌）。
2. 向账本 `bySpell[121].batches[4]` 压入 `{ cards, cardCount: 4 }`。
3. 修正 `sourceCards` 为这 4 张暗实体，`cardIDs` 仍为空。
4. `moveCards` 将实体移入 `exchange`，并扣减 4 号观测手牌数。

### 2. 5 号整手牌进入交换区

```text
CardCount: 8
CardIDs: []
FromID: 5
FromZone: 5
FromZoneParam: 0
MoveType: 11
SpellID: 121
ToID: 5
ToZone: 10
ToZoneParam: 0
```

| 字段          | 含义                                    |
| ------------- | --------------------------------------- |
| `FromID=5`    | 来源是 5 号手牌                         |
| `CardCount=8` | 4 暗 + 4 明，整手清空                   |
| `CardIDs=[]`  | 协议仍全暗，但本地已知其中 4 张明牌身份 |

记牌器动作：

1. 收集 5 号手牌全部实体（4 明 + 4 暗）。
2. 写入 `bySpell[121].batches[5]`。
3. 修正：
   - `cardIDs = [106, 14, 68, 67]`（本地已公开明牌）
   - `sourceCards = 4 张暗实体`
   - `cardCount = 8`
4. 明牌走 known 路径进入 `exchange` 且保留 `isKnown`；暗牌走 unknown 路径进入 `exchange`。

此时交换区共 12 张，双方手牌观测数应为 0。

### 3. 原 5 号批次回到 4 号手牌

```text
CardCount: 8
CardIDs: []
FromID: 5
FromZone: 10
FromZoneParam: 0
MoveType: 11
SpellID: 121
ToID: 4
ToZone: 5
ToZoneParam: 0
```

| 字段                  | 含义                                          |
| --------------------- | --------------------------------------------- |
| `FromZone=10`         | 来自交换区                                    |
| `FromID=5`            | **原持有者批次键**，对应进区时的 `batches[5]` |
| `ToID=4` / `ToZone=5` | 目标是 4 号手牌                               |
| `CardCount=8`         | 取回原 5 号那一整批                           |

记牌器动作：

1. 用 `SpellID + FromID=5` 读取批次，筛仍在 `exchange` 的实体。
2. 回填：
   - 明牌进 `cardIDs`
   - 暗实体进 `sourceCards`
3. 移入 4 号手牌；明牌保持公开，暗牌保持未公开。
4. 删除该批次。

### 4. 原 4 号批次回到 5 号手牌

```text
CardCount: 4
CardIDs: []
FromID: 4
FromZone: 10
FromZoneParam: 0
MoveType: 11
SpellID: 121
ToID: 5
ToZone: 5
ToZoneParam: 0
```

与步骤 3 对称：`FromID=4` 取批次，落到 `ToID=5` 手牌，然后清理账本。

## 记牌器推理规则

### 批次账本

```text
Room.ensureSkillState('handExchangeBatches', createInitialState) -> {
  bySpell: {
    [spellID]: {
      batches: {
        [fromSeat]: [
          {
            batchID: string,
            cards: Card[],
            cardCount: number,
            hasCandidateAlternatives: boolean,
            fromSeat,
            spellID
          }
        ]
      }
    }
  },
  candidateRecords: Map<Card, {
    spellID: SpellID | null,
    subZone: SubZone | null
  }>,
  nextBatchSeq: number
}
```

`createInitialState` 返回上方 `handExchangeBatches` 账本结构，供首次进入交换时初始化。

- 进交换区（`5 -> 10`）时按 `SpellID + FromID` 登记。
- 同一座位在结算中再次参与交换时，批次按栈保存；回手牌（`10 -> 5`）时按
  `SpellID + FromID` 后进先出，不按交换区当前物理顺序猜测。
- 已明确观测为空手的座位仍登记零张空批次，防止内层空手回牌误消费外层尚未结算的批次。
- 手牌候选不直接归入先处理座位的实体批次，而是在唯一候选主模型
  `Card.locationCandidates` 中把对应位置临时替换为 `{ type: 'outside', zone: 'exchange', batchID }`；
  回手时再把该批次候选替换为 `ToID` 手牌位置。
- `candidateRecords` 只保存恢复兼容读面所需的 `spellID` / `subZone` 元数据，不复制候选集合；
  交换期间通用约束消除的候选因此不会被旧快照恢复。
- 某 SpellID 的全部批次都取回后清理该技能账本；全部清空后删除房间级 key。

### 候选牌置换

候选牌表示“身份已知，但原持有座位尚未确定”。交换时必须对每个候选位置分别应用座位置换，
不能把整张牌归给先进入交换区的一方：

- 1、2 号交换：候选 `{1 手牌, 2 手牌}` 仍为 `{1 手牌, 2 手牌}`。
- 1、2 号交换：候选 `{1 手牌, 3 手牌}` 变为 `{2 手牌, 3 手牌}`。
- 存在嵌套交换时，每个候选位置依次经过对应 `batchID`，因此可组合外层与内层置换。
- 回到己方的整手若 `CardIDs` 覆盖 `CardCount`，出现的候选直接确认到己方；未出现的候选删除该
  批次分支，并由剩余位置继续收敛。

候选身份只在逻辑账本中迁移，不重复创建物理实体。此时移动参数分为：

- `cardCount`：本次真正搬运的确定实体数。
- `handMoveCount`：协议声明的牌数，用于同步来源与目标的观测手牌总数。

这样候选实体不会把协议张数从 `2` 错误扩大为本地可枚举候选数 `3`，也不会为了候选槽位创建
多余匿名实体。

### 实体占位牌

玩家手牌中的暗实体（包括稳定负 `id/entityID` 的匿名实体）仍属于确定的物理批次：

1. 进交换区时写入 `sourceCards`，同一实体随批次进入 `exchange`。
2. 回到暗手牌时继续作为暗实体绑定到接收座位。
3. 回到己方且协议给出完整正 `CardIDs` 时，正 ID 作为身份揭示证据：
   - 真实身份若仍在牌堆、弃牌等其它公共区，用 `exchange` 中的暗实体回填原公共区槽位；
   - 真实身份再进入己方手牌并标记为已知；
   - 原暗实体不会残留在 `exchange`，也不会与真实身份重复占用手牌槽。

### 为什么不能走默认路径

| 默认行为                      | 本技能下的问题                               |
| ----------------------------- | -------------------------------------------- |
| 手牌全暗移出只取暗实体        | 5 号整手 8 张时会漏掉 4 张明牌               |
| 交换区回手只按 Zone 顶/底取牌 | 两批混在同一 `exchange` 中，顺序不等于批次   |
| 把 `FromID` 当座位            | `FromZone=10` 时 `FromID` 是批次键/原持有者  |
| 把暗实体正 ID 塞进 `cardIDs`  | `id>0` 会被当成 known，错误公开暗牌          |
| 明暗同批共用 `combinationID`  | known 约束组会 OR 合并后 `confirmKnown` 暗牌 |
| 把共享候选归给先处理座位      | `{1,2}` 会被错误收敛为单一接收座位           |
| 用候选实体数覆盖协议张数      | 会多扣手牌并创建额外匿名实体                 |

### 正确修正策略

1. **手牌 -> 交换区**
   - 仅当张数匹配整手时接管；`CardIDs` 可为空或包含正 ID。
   - 以 `FromID` 收集该座位当前手牌实体全集。
   - 确定实体进入物理批次；多位置候选改写为逻辑 `batchID`，不归入单一来源。
   - 已公开明牌写入 `cardIDs`。
   - 未公开实体写入 `options.sourceCards`。
   - 无候选时保持 `cardCount` 为协议整手数；有候选时用 `handMoveCount` 保留协议整手数。
2. **交换区 -> 手牌**
   - 用 `SpellID + FromID` 找回进区批次。
   - 只取仍在 `exchange` 的批次实体。
   - 同样拆成 `cardIDs`（明）+ `sourceCards`（暗）。
   - 把该批次候选令牌恢复为 `ToID` 手牌候选，并与其它未移动候选位置合并。
   - 目标座位只用 `ToID`。

## 验收要点

- 交换完成后：
  - 4 号手牌实体 = 原 5 号 8 张；其中 `106/14/68/67` 仍为明牌。
  - 5 号手牌实体 = 原 4 号 4 张暗牌；不得因交换被标成 known。
- 交换区在序列结束后为空。
- `hasSkillState('handExchangeBatches')` 在两批回手后返回 `false`。
- 观测手牌数：4 号 `8`，5 号 `4`（若进区前已正确观测）。
- 交换双方共享候选不被实锤；仅涉及一名交换者的候选只置换该座位分支。
- 己方收到完整明牌手牌时，候选会根据“出现/未出现”证据收敛到确定座位。
- 玩家暗实体回到己方后由完整正 ID 完成身份置换，处理区不残留匿名占位。
- 任意其它 SpellID 只要协议模式相同，结果应一致。

## 相关代码

- `src/tracker/skill/HandExchange.ts`
- `src/tracker/runtime/moveEventHandlers.ts`（`decorateGenericMove` 调用）
- `src/tracker/protocolZones.ts`（`EXCHANGE = 10`）
- `tests/tracker/handExchange.test.ts`
