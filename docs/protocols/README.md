# 协议文档索引

> 定位记牌器相关协议样例与适配说明时，从本页跳转。只写路径与符号名，不绑源码行号。

## 怎么找

1. 先按**消息 className** 找大类。
2. 同一 className 下再按 **SpellID / 场景** 找专页。
3. 通用协议模式（不绑单一技能）单独放在“通用模式”。

## 通用模式

| 文档                                   | 协议 / 模式               | 场景                                                 | 关键识别                                               |
| -------------------------------------- | ------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| [`move-position.md`](move-position.md) | `PubGsCMoveCard` 目标位置 | 公共区顶、底、随机与普通数值精确插槽                 | `ToPosition` 通用解析；普通整数按目标区底端零基定位     |
| [`hand-exchange.md`](hand-exchange.md) | `PubGsCMoveCard` 整手交换 | 双方整手牌经 `exchange(10)` 互易；示例 SpellID=`121` | `MoveType=11` + `5<->10` + 整手张数；不绑单一 SpellID  |

## `GsCRoleOptTargetNtf`

| 文档                                                         |       SpellID | 场景                                             | 关键识别                                                                           |
| ------------------------------------------------------------ | ------------: | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| [`GsCRoleOptTargetNtf-361.md`](GsCRoleOptTargetNtf-361.md)   |         `361` | 下书：展示目标部分手牌后选择取明牌或暗牌        | `targetSeatID` 直接给出目标；暗牌分支在通用转移后确认展示牌留在原座位              |
| [`GsCRoleOptTargetNtf-987.md`](GsCRoleOptTargetNtf-987.md)   | `987` / `988` | 观虚：观看并交换牌堆顶 + 目标手牌                | 按 `FromID/ToID` 维护 exchange 逻辑桶；桶内复用通用 `ToPosition` 位置语义           |
| [`GsCRoleOptTargetNtf-3483.md`](GsCRoleOptTargetNtf-3483.md) |        `3483` | 诫厉：观看牌堆顶 + 目标部分手牌，后续交换拆回    | 生产目标只定位自己回堆槽；第三方仅保留目标手牌/牌顶范围弱候选 |
| [`GsCRoleOptTargetNtf-3876.md`](GsCRoleOptTargetNtf-3876.md) |        `3876` | 界强识：目标全部手牌明牌                         | `Params` 全是手牌 ID，`fullHand`                                                   |
| [`GsCRoleOptTargetNtf-3903.md`](GsCRoleOptTargetNtf-3903.md) |        `3903` | 天候：发动者私有观看，其他视角匿名换牌及单牌展示 | `Type=28/29` 分别解析；匿名交换建立手牌/牌顶候选；单牌收敛牌顶前三范围             |
| [`GsCRoleOptTargetNtf-7011.md`](GsCRoleOptTargetNtf-7011.md) |        `7011` | 权变：观看牌堆顶                                 | `targetSeatID=255`；`Params` 即牌堆顶；配对同区展示 `MoveType=21`                  |

## `CGsRoleSpellOptRep`

| 文档                                             | SpellID | 场景                                                   | 关键识别                            |
| ------------------------------------------------ | ------: | ------------------------------------------------------ | ----------------------------------- |
| [`CGsRoleSpellOptRep.md`](CGsRoleSpellOptRep.md) |  多技能 | 技能操作回复；含鹰视看牌堆顶、嚣翻看牌堆底、裴秀地图等 | `Datas` 语义依赖 `SpellID` + `Type` |

## `GsCUpdateRoleDataExNtf`

| 文档                                                     | DataID | 场景             | 关键识别                                             |
| -------------------------------------------------------- | -----: | ---------------- | ---------------------------------------------------- |
| [`GsCUpdateRoleDataExNtf.md`](GsCUpdateRoleDataExNtf.md) | `8` | OPT_DATA_ADD_SPELL_EFFECT | `SeatID` 为目标；`Datas=[3730,技能拥有者座位]` |
| [`GsCUpdateRoleDataExNtf.md`](GsCUpdateRoleDataExNtf.md) | `3544` | 巧织暗取牌       | `Datas=[cardID,0]`；非主视角将牌面物化到目标普通手牌 |
| [`GsCUpdateRoleDataExNtf.md`](GsCUpdateRoleDataExNtf.md) | `3709` | 诡伏弃牌堆随机获得 | `Datas=[count,...cardIDs,...]`；非主视角延迟到角色数据再移动真实弃牌 |
| [`GsCUpdateRoleDataExNtf.md`](GsCUpdateRoleDataExNtf.md) | `4022` | 裴秀地图状态更新 | `Datas=[mapID,currentCell,historyCount,...]`，仅己方 |

## 相关代码入口

| 协议 / 模式              | 处理入口                                | 状态 / 装饰                                             |
| ------------------------ | --------------------------------------- | ------------------------------------------------------- |
| `GsCRoleOptTargetNtf`    | `src/handler/GsCRoleOptTargetNtf.js`    | `tracker.revealTrackerCards` / `Room.ensureSkillState`  |
| `GsCUpdateRoleDataExNtf` | `src/handler/GsCUpdateRoleDataExNtf.js` | OPT_DATA_ADD_SPELL_EFFECT 8 / 巧织 3544 / 诡伏 3709 / 裴秀 4022 状态更新 |
| `PubGsCMoveCard`         | `src/handler/PubGsCMoveCard.js`         | `src/tracker/MoveEventNormalizer.ts` → `Room.moveCards` |
| 整手交换                 | 经 `decorateGenericMove`                | `src/tracker/skill/HandExchange.ts`                     |
| 诫厉目标视角交换         | 经 `SpellID=3483` 装饰                  | `src/tracker/skill/JieLi.ts`                            |
| `CGsRoleSpellOptRep`     | `src/handler/` 技能回复相关处理器       | 见专页                                                  |
| 裴秀地图                 | `src/handler/GsCRoleOptTargetNtf.js` 等 | `src/ui/PeiXiuMapWindow.js` / 路线工具                  |

## 维护约定

- 新增协议样例时：在 `docs/protocols/` 建专页，并回填本索引。
- 文件名优先短、稳：通用模式用场景名（如 `hand-exchange.md`）；技能专页可用 `消息-SpellID.md`。
- 文档互链与 `docs/agents/card_tracker.md` 中的协议入口保持同步。
- 仓库文档不绑定源码行号。
