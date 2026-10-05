# 骋烈（SpellID=3208）：其他视角的暗中交换与标记弃置

## 样例范围

本文记录其他视角收到的一组完整 `PubGsCMoveCard` 消息。发动者为 0 号，后续获得暗标记的
座位依次为 1、6、7。只有最初的牌顶展示公开 `[99, 36, 109]`，其余十一条消息的
`CardIDs` 均为空，包括最后的标记弃置。

空 `CardIDs` 表示本条消息未公开身份，不表示没有移动，也不能抹掉先前已经观察到的牌顶身份。
本样例手牌进入交换区的数量为 1，不能仅凭这一条消息推定它是发动者的整手牌。

## 协议序列与含义

| 步骤 | FromZone / FromID | ToZone / ToID | CardCount | MoveType | 语义                                     |
| ---- | ----------------- | ------------- | --------: | -------: | ---------------------------------------- |
| 1    | `1 / 255`         | `1 / 255`     |         3 |       21 | 展示牌顶三张 `[99, 36, 109]`             |
| 2    | `1 / 255`         | `10 / 0`      |         3 |       11 | 牌顶三张进入交换区，本条不重复公开 ID    |
| 3    | `5 / 0`           | `10 / 0`      |         1 |       11 | 发动者的一张手牌进入交换区               |
| 4    | `10 / 0`          | `10 / 0`      |         1 |       11 | 暗中互换的第一条通知，目标位置为 `65280` |
| 5    | `10 / 0`          | `10 / 0`      |         1 |       11 | 暗中互换的第二条通知，目标位置为 `0`     |
| 6    | `10 / 0`          | `5 / 0`       |         1 |       11 | 交换后的一张牌进入发动者手牌             |
| 7    | `10 / 0`          | `4 / 1`       |         1 |       15 | 一张牌暗置到 1 号的骋烈标记区            |
| 8    | `10 / 0`          | `4 / 6`       |         1 |       15 | 一张牌暗置到 6 号的骋烈标记区            |
| 9    | `10 / 0`          | `4 / 7`       |         1 |       15 | 一张牌暗置到 7 号的骋烈标记区            |
| 10   | `4 / 1`           | `2 / 255`     |         1 |       15 | 1 号的骋烈标记弃置，未公开 ID            |
| 11   | `4 / 6`           | `2 / 255`     |         1 |       15 | 6 号的骋烈标记弃置，未公开 ID            |
| 12   | `4 / 7`           | `2 / 255`     |         1 |       15 | 7 号的骋烈标记弃置，未公开 ID            |

步骤 2、3 合计向交换区放入四张牌；步骤 4、5 的内部互换不改变这个总数；步骤 6 至 9
再按“一张手牌 + 三张标记”移出，最终交换区清空。

### 交换区内部互换

- 两条 `10 -> 10` 描述真实的暗中互换，不能因为区域编号相同就认定没有发生交换或只是动画。
  牌在交换区内部的逻辑归属已经变化，交换前的实体排列不能继续作为交换后去向的证据。
- 本样例两端的 `FromID/ToID` 都为 0，不能靠它们区分牌顶侧与手牌侧，更不能据此把所有牌
  认定为 0 号手牌。只有步骤 6 的 `ToZone=5` 明确表示回到手牌。
- `FromPosition=65282` 是随机/无序哨兵。步骤 2 根据骋烈技能事实取牌顶；不能把这个特例
  推广到后续所有交换区来源事件。
- `ToPosition=65280` 表示目标区顶端，`ToPosition=0` 表示目标区底端的零基插槽。
  步骤 5 的目标仍是交换区，不能解释为回到牌堆底，也不能从目标位置反推出暗牌 ID。
- 当前通用归一化会把这两条同区、同 ID、无可见牌面的消息标为 `noop`。这是运行时对通用
  搬运的分类，不是“技能没有产生业务变化”的协议结论。

通用公共区位置定义见 [`move-position.md`](move-position.md)。

## 完整消息

保留收到的字段、数值和顺序；控制台中的 `CardIDs: (3) [99, 36, 109]` 仅去掉数组长度显示
标记，以下用 YAML 文档分隔符区分十二条消息。

```yaml
# 1. 展示牌顶三张
CardCount: 3
CardIDs: [99, 36, 109]
FromID: 255
FromPosition: 65280
FromZone: 1
FromZoneParam: 0
MoveType: 21
SpellID: 3208
ToID: 255
ToPosition: 65280
ToZone: 1
ToZoneParam: 0
---
# 2. 牌顶三张进入交换区
CardCount: 3
CardIDs: []
FromID: 255
FromPosition: 65282
FromZone: 1
FromZoneParam: 0
MoveType: 11
SpellID: 3208
ToID: 0
ToPosition: 65280
ToZone: 10
ToZoneParam: 0
---
# 3. 发动者的一张手牌进入交换区
CardCount: 1
CardIDs: []
FromID: 0
FromPosition: 65282
FromZone: 5
FromZoneParam: 0
MoveType: 11
SpellID: 3208
ToID: 0
ToPosition: 65280
ToZone: 10
ToZoneParam: 0
---
# 4. 暗中互换的第一条通知
CardCount: 1
CardIDs: []
FromID: 0
FromPosition: 65282
FromZone: 10
FromZoneParam: 0
MoveType: 11
SpellID: 3208
ToID: 0
ToPosition: 65280
ToZone: 10
ToZoneParam: 0
---
# 5. 暗中互换的第二条通知
CardCount: 1
CardIDs: []
FromID: 0
FromPosition: 65282
FromZone: 10
FromZoneParam: 0
MoveType: 11
SpellID: 3208
ToID: 0
ToPosition: 0
ToZone: 10
ToZoneParam: 0
---
# 6. 交换后的一张牌回到发动者手牌
CardCount: 1
CardIDs: []
FromID: 0
FromPosition: 65282
FromZone: 10
FromZoneParam: 0
MoveType: 11
SpellID: 3208
ToID: 0
ToPosition: 65280
ToZone: 5
ToZoneParam: 0
---
# 7. 暗置到 1 号的骋烈标记区
CardCount: 1
CardIDs: []
FromID: 0
FromPosition: 65282
FromZone: 10
FromZoneParam: 0
MoveType: 15
SpellID: 3208
ToID: 1
ToPosition: 65280
ToZone: 4
ToZoneParam: 3208
---
# 8. 暗置到 6 号的骋烈标记区
CardCount: 1
CardIDs: []
FromID: 0
FromPosition: 65282
FromZone: 10
FromZoneParam: 0
MoveType: 15
SpellID: 3208
ToID: 6
ToPosition: 65280
ToZone: 4
ToZoneParam: 3208
---
# 9. 暗置到 7 号的骋烈标记区
CardCount: 1
CardIDs: []
FromID: 0
FromPosition: 65282
FromZone: 10
FromZoneParam: 0
MoveType: 15
SpellID: 3208
ToID: 7
ToPosition: 65280
ToZone: 4
ToZoneParam: 3208
---
# 10. 1 号的骋烈标记匿名弃置
CardCount: 1
CardIDs: []
FromID: 1
FromPosition: 65282
FromZone: 4
FromZoneParam: 3208
MoveType: 15
SpellID: 3208
ToID: 255
ToPosition: 65280
ToZone: 2
ToZoneParam: 0
---
# 11. 6 号的骋烈标记匿名弃置
CardCount: 1
CardIDs: []
FromID: 6
FromPosition: 65282
FromZone: 4
FromZoneParam: 3208
MoveType: 15
SpellID: 3208
ToID: 255
ToPosition: 65280
ToZone: 2
ToZoneParam: 0
---
# 12. 7 号的骋烈标记匿名弃置
CardCount: 1
CardIDs: []
FromID: 7
FromPosition: 65282
FromZone: 4
FromZoneParam: 3208
MoveType: 15
SpellID: 3208
ToID: 255
ToPosition: 65280
ToZone: 2
ToZoneParam: 0
```

## 当前记牌策略与边界

当前实现是其他视角下的近似记账，不是对暗中交换结果的精确还原：

1. 步骤 1 按牌顶顺序展示身份；步骤 2 即使没有 ID，仍按实际牌顶端点取三张实体，并把其中
   已知身份写入 `chengLieDiscardQueue`，通过 `pileIdentityCardIDs` 同步移出牌堆的身份。
2. 交换区使用一个公共 `exchange` 容器，未细分牌顶侧和手牌侧逻辑桶。当前处理器跳过
   `noop` 和交换区内部的实体替换，把身份不确定性的处理延后到无 ID 的跨区移出之前。
   这不否认步骤 4、5 发生了暗中互换，也不授权后续使用交换前顺序确认去向。
3. 步骤 6 首次无 ID 离开交换区时，正 ID 实体由匿名占位替换。队列中的展示身份暂存到
   `outside`；其它正 ID 实体暂停追踪。随后的一张手牌和三张暗标记只承接物理数量，
   不把展示 ID 硬绑到某个座位的手牌或标记。
4. 步骤 10 至 12 仍没有公开弃牌身份。当前约定按每条弃置张数，从队列中消费仍处于
   `outside` 的可用身份，回填到弃牌区并提交身份账本；队列耗尽后删除。
5. 后续非 `noop` 消息若携带显式正 ID，以显式身份为准，并从待近似弃置队列中移除对应 ID，
   防止后续重复使用。

在没有额外显式身份消息的本例中，当前策略最终会把三张展示牌近似记入弃牌账本。
但协议并未证明它们就是三个实际弃置身份：其中某张可能已经通过暗中互换进入发动者手牌。
因此不能把 `[99, 36, 109]` 与座位 `1、6、7` 逐项对应，也不能用当前弃牌回填结果反证真实
交换关系。若要精确追踪双方内部归属，需要另建批次或候选模型，不能只靠全局交换区顺序。

`3208` 必须绕过通用 `HandExchange`：本技能涉及牌顶、部分手牌和标记的交换分配，
即使步骤 3 恰好换出了发动者整手，也不属于双方整手牌互易。

## 实现与现有回归入口

- `src/tracker/skill/ChengLie.ts` 的 `decorateChengLieMove`：牌顶取牌、离区前匿名化和待弃置队列。
- `src/tracker/runtime/moveEventHandlers.ts`：注册 `3208` 处理器，并通过
  `HAND_EXCHANGE_EXCLUDED_SPELL_IDS` 绕过通用整手交换。
- `src/tracker/MoveEventNormalizer.ts` 的 `normalizeMoveEvent` / `inferEventType`：展示、同区
  `noop` 和跨区移动分类。
- `src/tracker/runtime/protocolRules.ts` 的 `PILE_RANDOM_AS_TOP_SPELL_IDS`：骋烈牌堆来源的
  RANDOM 按牌顶解释。
- `tests/tracker/chengLie.test.ts`：已有全明、部分明牌、全暗牌顶的完整链路，以及后续身份
  再次出现、洗牌和身份账本一致性验证。

临时状态的所有权与清理见 [`../agents/skill_state.md`](../agents/skill_state.md)。
