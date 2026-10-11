# 诡伏（SpellID=3709）：相邻移动与角色数据配对

诡伏可以从牌堆或弃牌堆获得牌。非主视角可能先收到无 `CardIDs` 的获得移动，
随后由相邻的 `GsCUpdateRoleDataExNtf` 补充身份。本页统一记录两种来源的样例、
角色数据格式、配对约定及 `raw` / `patched` 的区别。

## 协议识别

| 消息                     | 关键字段                                                  | 含义                       |
| ------------------------ | --------------------------------------------------------- | -------------------------- |
| `PubGsCMoveCard`         | `SpellID=3709`、`MoveType=18`、`FromZone=1/2`、`ToZone=5` | 从牌堆或弃牌堆获得手牌     |
| `GsCUpdateRoleDataExNtf` | `DataID=3709`、`SeatID` 为被同步角色                      | 当前仍持有的诡伏牌身份列表 |

已携带真实 ID 的移动立即走普通移动管线。主视角获得消息已携带 ID，不重复消费角色数据。

## 原始移动样例

### 从牌堆获得

以下为非主视角收到的原始移动；此时只能知道座位 2 获得一张牌，尚不知道具体身份。

```yaml
CardCount: 1
CardIDs: []
FromID: 255
FromPosition: 65282
FromZone: 1
FromZoneParam: 0
MoveType: 18
SpellID: 3709
ToID: 2
ToPosition: 65280
ToZone: 5
ToZoneParam: 0
```

- `FromZone=1` 表示牌堆；`FromID=255` 是公共区占位，不是来源玩家座位。
- `FromPosition=65282` 表示随机来源，没有可据此确定身份的牌顶或牌底端点。
- `ToZone=5`、`ToID=2` 表示座位 2 的手牌；`CardCount=1` 是本次获得张数。
- `CardIDs=[]` 不代表没有移动，而是这条消息尚未公开身份。

### 从弃牌堆获得

已有弃牌堆来源样例的关键字段如下；与牌堆来源的区别是 `FromZone=2`。

```yaml
CardCount: 1
CardIDs: []
FromID: 255
FromPosition: 65282
FromZone: 2
MoveType: 18
SpellID: 3709
ToID: 2
ToPosition: 65280
ToZone: 5
```

弃牌身份已公开，不能在缺少本次获得 ID 时随意选择一张弃牌移走；等待角色数据补全后精确移动。

## 角色数据：当前持有状态，不是获得事件

`GsCUpdateRoleDataExNtf` 的 `DataID=3709` 表示诡伏当前持有状态，`SeatID` 为被同步的角色。
它不只在获得诡伏牌时发送，还会在诡伏牌被使用后、角色获得技能时更新。

| 触发场景                                 | 记牌器处理                                   |
| ---------------------------------------- | -------------------------------------------- |
| 获得诡伏牌，前面有待配对的无 ID 获得移动 | 以该移动为获得事实，角色数据只用于补齐身份   |
| 诡伏牌被使用后的状态更新                 | 不产生移动；用牌及后续弃置由各自移动消息同步 |
| 获得技能时的状态更新                     | 不视为获得牌，不补建手牌，也不创建待配对移动 |

**是否处理取决于有无前置待配对获得移动，不取决于 `Datas` 是否含有正 ID 或数量是否变化。**
没有待配对移动时，角色数据不修改卡牌实体、手牌数量或身份账本；其中的列表也不是角色的完整手牌。

`Datas` 格式为：

```text
[当前持有数量, ...当前仍持有的诡伏牌ID, ...补位零]
```

它不是本次新增牌的独立列表。与获得移动配对时，新获得的 ID 在前面，仍持有的旧 ID 保留在尾部：

```yaml
# 第一次获得后：当前持有 132
Datas: [1, 132, 0, 0, 0, 0]
```

```yaml
# 再获得一张后：新牌 2 在前，仍持有的旧牌 132 在后
Datas: [2, 2, 132, 0, 0, 0, 0]
```

对于第二条角色数据，若前置移动 `CardCount=1`，只取身份列表的第一项 `[2]` 补齐移动，
不能把 `[2,132]` 都视为本次获得。`Datas[0]` 的当前持有数量与移动的 `CardCount` 含义不同。

## 当前处理流程

实现以无 ID 的获得移动与角色数据相邻为基准：

1. 暂存一条待补全移动，分别保留原始协议 `raw` 和已有预处理结果 `patched`。
   此时不增加手牌数、不创建匿名手牌，也不改变来源区、约束或身份账本。
2. 相邻角色数据到达后，核对目标座位及获得张数；弃牌来源还需精确命中对应已知弃牌实体。
3. 按前置 `CardCount` 取新增 ID 前缀，只补入 `patched.CardIDs`，保持 `raw` 不变。
4. 清除暂存，通过 `TrackerController.syncTrackerMove(raw, patched)` 提交一次普通明牌移动。
   来源区、手牌数、约束、索引和身份账本均由通用管线更新。

无需 FIFO、历史快照差量、额外匿名手牌、占位退役或 `handMoveCount: 0` 补偿。

## `raw` 与 `patched` 的日志语义

- `raw` 始终表示最初收到的 `PubGsCMoveCard`，不能含有角色数据随后补出的身份。
- `patched` 表示真正交给移动管线的输入，合并已有位置等预处理结果以及诡伏补充的 ID。
- 不能把补全后的消息作为 `syncTrackerMove()` 的原始参数重新传入，否则日志会错误地显示
  `raw.CardIDs` 与 `patched.CardIDs` 都是补出的 ID，丢失协议原本未公开身份的事实。

以上牌堆样例若随后确认获得的是 `2`，补全提交时的日志应当呈现以下区别（仅摘录关键字段）：

```yaml
raw:
  CardCount: 1
  CardIDs: []
  FromPosition: 65282
  FromZone: 1
  SpellID: 3709
  ToID: 2
  ToZone: 5
patched:
  CardCount: 1
  CardIDs: [2]
  FromPosition: 65282
  FromZone: 1
  SpellID: 3709
  ToID: 2
  ToZone: 5
```

若已有预处理修改了位置字段，同样只在 `patched` 中体现；原始字段和原始 `CardIDs` 数组不应被改写。

## 配对边界与状态生命周期

- 只暂存一条移动，不支持移动积压、跨座位乱序或一次获得分批揭示。
- 没有待配对移动的角色数据直接忽略，包括用牌后更新、获得技能时更新、重复通知、快照缩短和清空；
  不根据这些状态变化猜测获得或使用，不修改手牌数，也不补建手牌。
- 座位、张数或弃牌来源失配时告警并清除暂存，不做部分结算。
- 下一条移动到达而前一条仍未配对时，告警丢弃旧暂存，再处理新移动，不尝试跨消息恢复。
- 状态使用 GameState 的 `tracker` scope、数字 key `3709`，只保存单条移动的 `raw` / `patched`，
  不保存卡牌实体引用。配对消费、失配、后续移动打断、牌堆重新初始化和单局生命周期都会清理状态。
- 领域约定：洗牌后的暂停追踪身份在场上，不作为诡伏从当前牌堆获得的候选；
  不为该技能构造“从牌堆获得暂停追踪身份”的场景，也不扩展通用身份模型。

## 代码与验证

- 移动预处理入口：`src/handler/PubGsCMoveCard.js`。
- 角色数据入口：`src/handler/skills/GuiFu.ts` 的 `parseGuiFuCardIDs()`、`handleGuiFu()`。
- 配对状态与补全：`src/tracker/skill/GuiFu.ts` 的 `deferGuiFuMove()`、`completeGuiFuMove()`。
- 运行时连接：`src/tracker/runtime/trackerController.ts` 的 `syncTrackerMove()`、
  `syncTrackerGuiFuRoleData()`；`Room` 和通用移动模块不包含诡伏专属分支。
- 回归：`tests/tracker/roleData3709.test.ts`，覆盖相邻配对、累计列表前缀、数量与身份守恒、
  用牌后及获得技能时的独立状态更新、重复及失配通知、生命周期，以及 `raw` / `patched` 日志和输入不被改写。
- 相关入口：[协议索引](README.md)、[角色扩展数据](GsCUpdateRoleDataExNtf.md)、
  [技能状态仓库](../agents/skill_state.md)。
