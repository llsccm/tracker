# 对局临时状态：`GameState.stateStore`

> 当新增技能临时状态、选择状态 key、排查跨协议状态串局，或需要理解 Game 与 Room 的状态关系时，
> 优先阅读本文。Room 的完整领域状态所有权见 [`room.md`](room.md)，技能协议细节见
> [`card_tracker_skills.md`](card_tracker_skills.md)。

## 结论

- `Game` 是供 handler、UI 和 tracker 跨模块通信的稳定单例门面，但它内部的数据只属于当前一局。
- `GameState` 使用唯一的私有 `stateStore` 保存所有对局临时状态，不再由 Room 维护独立 Map。
- `spell` 与 `tracker` 只是同一 Map 内的 key 命名空间，用于避免 handler 状态和记牌器推断状态碰撞，
  不代表不同生命周期。
- 新 Room 绑定、当前 Room 销毁、`GameState.init()`、`reset()` 和 `end()` 都会清空统一仓库，
  所有状态都不会带入下一局或新的 Room。
- Room 的 `readSkillState()` 等方法只是 `tracker` 命名空间的领域薄入口；tracker 代码不应直接导入
  全局 `Game`，以保留测试隔离和依赖注入能力。

## 状态模型

```text
Game（稳定单例门面）
└── GameState（当前一局）
    ├── Room（当前记牌器领域对象）
    ├── 回合、模式与座位状态
    └── stateStore（唯一临时状态 Map）
        ├── spell:*   handler / UI / 计数器
        └── tracker:* Card / 候选 / 约束 / 技能推断
```

`stateStore` 是实现细节，不对调用方暴露直接 Map 读写。GameState 负责状态生命周期，Room 只负责
记牌器领域行为和 `tracker` 状态访问语义。

## API

### GameState 通用入口

```ts
const state = game.readState<MyState>('spell', spellID)
const writableState = game.ensureState('spell', spellID, () => ({ count: 0 }))

game.setState('spell', spellID, { count: 1 })
game.deleteState('spell', spellID)
game.hasState('spell', spellID)
```

通用入口接受 `spell` 或 `tracker` scope。只读路径使用 `readState()`；只有确定开始新批次时才使用
`ensureState()` 或 `setState()`。

### handler / UI 兼容入口

```ts
const state = game.getSpellState<MyState>(spellID)
const writableState = game.ensureSpellState(spellID, () => ({ count: 0 }))
const spellSnapshot = game.getSpellStateSnapshot()

game.setSpellState(spellID, { count: 1 })
game.deleteSpellState(spellID)
```

这些方法统一委托到 `spell` scope，用于控制迁移范围并保持既有 handler 可读性。禁止恢复
`game.spellSpace[key]` 形式的无类型直接访问。

### tracker / Room 入口

```ts
const state = room.readSkillState<MyState>('example')
const writableState = room.ensureSkillState('example', () => ({ cards: [] }))

room.setSkillState('example', { cards: [] })
room.deleteSkillState('example')
room.hasSkillState('example')
```

这些方法统一委托到当前 GameState 的 `tracker` scope。`Room.skillState` 仅保留为 deprecated 的只读
兼容视图；新代码和测试都应优先使用明确的方法。

## 生命周期

| 事件                           | 统一状态仓库行为                         |
| ------------------------------ | ---------------------------------------- |
| 创建 `GameState`               | 初始化空仓库                             |
| `GameState.init()` / `reset()` | 清空当前全部 `spell` / `tracker` 状态    |
| 绑定新的 Room                  | Room 实例发生变化时清空全部状态          |
| 销毁当前绑定 Room              | `bindRoom(null)` 清空全部状态并解绑 Room |
| 销毁已经被替换的旧 Room        | 不影响当前 Room 的新状态                 |
| `GameState.end()`              | 立即清空全部状态，随后完成对局结束标记   |

断线、重进或协议重放如果需要创建新 Room，旧 `Card`、候选和约束引用已经失效，因此不会保留旧
tracker 状态；所需事实应由后续协议重新建立。

## Key 规则

- 内部存储 key 形式为 `spell:<key>` 或 `tracker:<key>`，调用方通过 scope API 访问，不手写完整前缀。
- 状态属于明确 SpellID 时可使用数字 key，例如迁附 `3750`、诫厉 `3483`、问卦 `780`。
- 多个 SpellID 共享状态或属于通用协议模式时使用可读字符串，例如 `duoQi`、
  `guanXuExchange`、`handExchangeBatches`。
- 字符串数字会规整为数字语义；不要把 `3483` 和 `'3483'` 当成两个 key。
- 同一个原始 key 可以分别存在于 `spell` 与 `tracker` scope，互不覆盖。
- 字符串 key 应描述账本职责，不使用临时函数名。

## `tracker` scope 当前使用清单

以下只统计当前主动运行代码。

| Key                    | 技能 / 协议                                                                 | 保存内容与用途                                                             | 实现与清理                                                                            |
| ---------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `hiddenMarkCandidates` | 通用暗置标记推断；覆盖普通标记、`414/3389` 兼容标记空间及木牛流马容器 `700` | 明牌候选、匿名占位、来源/目标座位、标记空间、数量范围与约束组关系          | `src/tracker/roomMovement/hiddenMarks.ts`；随候选结算维护，统一生命周期兜底清空       |
| `unassignedMarkSpaces` | `seatID=255` 等无席位弹窗/标记空间                                          | `spellID -> Card[]` 暗占位实体桶                                           | `src/tracker/roomMovement/hiddenMarks.ts`；取牌或实体移出时更新，统一生命周期兜底清空 |
| `3208`                 | 马承【骋烈】                                                                | 展示 ID、最终弃置 ID、发动者座位、展示前是否已有模糊明牌                   | `src/tracker/skill/ChengLie.ts`；最终弃置结算后删除                                   |
| `duoQi`                | 【狂魔】`3730` 与【夺炁】`3731` 共享                                        | 初始手牌归属、`Card` 实体归属、未决 CardID、发动记录及随机获得候选组       | `src/tracker/skill/DuoQi.ts`；初始化替换旧状态，统一生命周期兜底清空                  |
| `guanXuExchange`       | 黄承彦【观虚】`987/988`                                                     | 牌堆侧/手牌侧 exchange 逻辑桶、桶内 `Card` 引用与牌顶范围候选              | `src/tracker/skill/GuanXu.ts`；各 SpellID 桶结算后删除，全部为空时删除总账本          |
| `handExchangeBatches`  | 通用整手牌交换模式；完整实战样例为 `SpellID=121`，实现不绑定单一技能        | 按 SpellID 和原持有座位保存整手批次、`Card` 引用、候选批次令牌与恢复元数据 | `src/tracker/skill/HandExchange.ts`；单个 SpellID 结算后删分账，全部为空时删除总账本  |
| `3483`                 | 族钟繇【诫厉】                                                              | 观看上下文、目标/第三方交换批次、协议 ID 到匿名槽映射及目标手牌候选        | `src/tracker/skill/JieLi.ts`；结算完成或协议失配时删除                                |
| `qiaozhiSelection`     | 【巧织】`3544`                                                              | 展示 CardID、暗取数量和目标座位，用于最终差集推断                          | `src/tracker/skill/QiaoZhi.ts`；结算、可见结果到达或校验失败时删除                    |
| `tianHouExchange`      | 周群【天候】`3903`                                                          | 交换批次、原牌顶/原手牌 `Card` 引用、明牌换出范围与约束组 ID               | `src/tracker/skill/TianHou.ts`；结算、展示或异常清理时删除                            |
| `780`                  | 徐氏【问卦】                                                                | 当前被追踪的单张 `Card` 实体，供他人放回牌堆时复用                         | `src/tracker/skill/WenGua.ts`；目标牌回牌堆后删除                                     |

## `spell` scope 当前使用清单

| Key             | 技能 / 功能                    | 保存内容与用途                                      | 实现与清理                                                                                                    |
| --------------- | ------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `三板斧`        | 山河图/战法【三板斧】          | 出杀累计次数，运行时按模运算更新战法展示            | `GameRuntime.shaCounter()`（`src/runtime/gameAdapter.js`）；`GameState` 读写计数状态，统一生命周期清空         |
| `手到擒来`      | 战法【手到擒来】               | 当前己方回合内用牌次数                              | `GameRuntime.useCounter()`（`src/runtime/gameAdapter.js`）；`GameState` 读写计数状态，己方回合结束时归零       |
| `神龙摆尾`      | 战法【神龙摆尾】               | 累计摸牌张数                                        | `GameRuntime.drawCounter()`（`src/runtime/gameAdapter.js`）；`GameState` 读写计数状态，统一生命周期清空         |
| `多多益善`      | 战法【多多益善】               | 当前己方回合内摸牌事件次数                          | `GameRuntime.drawCounter()`（`src/runtime/gameAdapter.js`）；`GameState` 读写计数状态，己方回合结束时归零       |
| `3090`          | 【博图】                       | 当前轮次的发动计数                                  | `src/handler/PubGsCUseSpell.js`；`GameState.setTurn()` 删除                                                   |
| `2143`          | 国战【乱击】                   | 本阶段已使用牌的花色集合，用于花色提示              | `src/handler/PubGsCUseSpell.js`；进入新的个人回合时删除                                                       |
| `361`           | 【下书】                       | 展示 CardID、真实目标座位、发动者选择和座位         | `src/handler/skills/XiaShu.js`；配对手牌移动完成后删除                                                        |
| `441` / `3492`  | 【称象】/【界称象】            | 处理区展示的 CardID，供后续目标通知绘制点数组合     | `src/handler/spellEffects.js`、`src/handler/GsCRoleOptTargetNtf.js`；消费后删除                               |
| `3488`          | 蔡瑁【佐练】                   | 各来源座位展示的 CardID 与 exchange 暂存栈顶 CardID | `src/handler/skills/ZuoLian.js`；字段随交换阶段删除，统一生命周期兜底清空                                     |
| `3157` / `3511` | 夏侯玄【清议】/李婉【联句】    | 其它视角先看到的完整 CardID，供后续全暗移动回填     | `src/handler/PubGsCUseSpell.js`、`src/handler/spellEffects.js`；匹配移动消费后删除                            |
| `3571`          | 郭照【椒遇】                   | 用户选择对应的红/黑颜色集合                         | `src/handler/GsCUpdateRoleDataExNtf.js`、`src/handler/skills/JiaoYu.js`；统一生命周期清空                     |
| `3750`          | 谋许攸【迁附】                 | 控顶阶段的 CardID 顺序，供后续暗牌回堆移动回填      | `src/handler/PubGsCUseSpell.js`、`src/handler/spellEffects.js`；回堆回填后删除，统一生命周期兜底清空          |
| `4022`          | 裴秀【尽览】及地图/手牌镜像 UI | 地图协议、路线求解、预设路径和手牌花色镜像状态      | `src/handler/GsCUpdateRoleDataExNtf.js`、`src/ui/PeiXiuHandMirror.js`；进入裴秀选技能阶段或统一生命周期时删除 |

`src/handler/skills/YanXi.js` 仍包含 `getSpellState()` 读取，但对应 `7016/7017` 注册当前已注释，
不计入主动运行清单。`src/logic.js` 中注释掉的 `hpColor` 旧逻辑同样不计入。

## 新增状态检查清单

1. 状态是否只属于当前一局？若需要跨局持久化，应使用配置或其它持久化模块，而不是 stateStore。
2. 调用来自 handler/UI，还是 tracker 推断？据此选择 `spell` 或 `tracker` scope，避免 key 碰撞。
3. 只读路径是否使用不会创建状态的 `readState()` / `readSkillState()`？
4. 正常结算、异常协议和统一生命周期兜底是否都有清理路径？
5. 多个 SpellID 是否确实应共享一个字符串 key，还是应按数字 key 隔离？
6. 状态是否持有旧 Room 的 `Card`、候选或约束？新 Room 建立后不得继续使用这些引用。
7. 新增或移除状态后，是否同步更新本文当前使用清单？

## 相关入口

- `src/tracker/Game.ts`：统一 `stateStore`、通用 API、兼容 spell API 与生命周期清理。
- `src/tracker/Room.ts`：tracker scope 的领域薄入口和只读兼容视图。
- [`room.md`](room.md)：Room 状态所有权和生命周期。
- [`card_tracker_skills.md`](card_tracker_skills.md)：技能与协议特例。
- [`lifecycle.md`](lifecycle.md)：Game、Room 与浏览器运行时的创建/销毁时序。
