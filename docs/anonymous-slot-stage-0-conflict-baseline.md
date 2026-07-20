# 阶段 0 冲突频次基线

> 状态：历史归档；G0 曾决定 GO，后续 G1 已决定 NO-GO / 收缩
> 日期：2026-07-19
> 基准分支：`dev`
> 基准提交：`ac41259`
> 实施分支：`codex/anonymous-slot-stage-0`
> 关联提案：`anonymous-slot-identity-decoupling-plan.md`

## 1. 结论

阶段 0 已完成自动化基线：匿名占位改为稳定负 `id/entityID`，五条冲突修复/兜底路径已接入可收集的 `recordTraversal` 站点，DEV 守恒观测只告警不抛错。

现已完成一局真实回放采集：273.337 秒内五条 G0 路径累计成功修复 125 次，约 27.44 次/分钟，明显不属于“几乎不触发”。因此 G0 判定为 **GO**：进入阶段 1 牌堆 spike；这只批准隔离 spike，不代表提前通过后续 G1。

## 2. 测试基线

| 项目             | 阶段 0 前 | 阶段 0 后 |
| ---------------- | --------: | --------: |
| tracker 测试文件 |        29 |        33 |
| tracker 测试用例 |       234 |       250 |
| 结果             |  全部通过 |  全部通过 |

阶段 0 与真实回放采集控制共新增 16 项测试：匿名身份与守恒观测 5 项、冲突频次基线 5 项、长生命周期会话与浏览器控制 6 项。

## 3. 自动化冲突频次

以下数字来自 `tests/tracker/anonymousSlotBaseline.test.ts` 的单路径确定性场景。每个场景只触发目标路径一次，用于冻结计数语义，不代表真实牌局概率。

| 插桩站点                                                     | calls | visited | 场景含义                                          |
| ------------------------------------------------------------ | ----: | ------: | ------------------------------------------------- |
| `anonymousSlot:swapKnownCardWithPublicSourcePlaceholder`     |     1 |       1 | 已知身份不在协议公共来源时，用来源占位回补旧位置  |
| `anonymousSlot:swapKnownCardWithPlayerSourcePlaceholder`     |     1 |       1 | 玩家来源已知身份用暗占位完成位置交换              |
| `anonymousSlot:recoverPlayerOccupiedIdentityForPublicReveal` |     1 |       1 | 公共揭示回收被玩家暗槽占用的真实身份              |
| `anonymousSlot:insertUnknownPlaceholderIntoPile`             |     1 |       1 | 暗占位回牌堆并保护牌顶明牌段                      |
| `anonymousSlot:createExternalCardsFallback`                  |     1 |       3 | 一次兜底创建 3 个匿名占位；`visited` 表示创建张数 |

本节数据用于冻结当时的计数语义。G0/G1 决策现已结束，不再要求继续采集这些临时站点。

## 4. 回放采集状态

DEV 浏览器控制接口与固定 G0 五站点只为阶段 0/1 决策采集服务。阶段 1 已完成三段对照回放，
G1 最终决定 NO-GO / 收缩；运行时探针、固定 G0 schema 与对应测试现已清理。

历史采集结果继续保留在本文件与
[`anonymous-slot-stage-1-comparison.md`](anonymous-slot-stage-1-comparison.md) 中，避免删除探针后丢失决策依据。

## 5. 真实回放冲突频次

### 5.1 采集信息

| 项目          | 值                         |
| ------------- | -------------------------- |
| 日期          | `2026-07-19`               |
| 采集时长      | 273.337 秒（约 4.56 分钟） |
| 最终状态      | `active=false`             |
| 回放来源/局号 | 用户尚未提供               |

### 5.2 G0 五站点结果

| 插桩站点                                                     |   calls | visited | 占 G0 calls | 每分钟 calls |
| ------------------------------------------------------------ | ------: | ------: | ----------: | -----------: |
| `anonymousSlot:swapKnownCardWithPublicSourcePlaceholder`     |       1 |       1 |        0.8% |         0.22 |
| `anonymousSlot:swapKnownCardWithPlayerSourcePlaceholder`     |      65 |      65 |       52.0% |        14.27 |
| `anonymousSlot:recoverPlayerOccupiedIdentityForPublicReveal` |       0 |       0 |        0.0% |         0.00 |
| `anonymousSlot:insertUnknownPlaceholderIntoPile`             |      59 |      59 |       47.2% |        12.95 |
| `anonymousSlot:createExternalCardsFallback`                  |       0 |       0 |        0.0% |         0.00 |
| **合计**                                                     | **125** | **125** |    **100%** |    **27.44** |

本次所有 G0 站点均以 `visited=1` 的成功修复调用累计，因此合计 `calls` 与 `visited` 相同。结果表示成功执行的修复动作次数，不等同于 125 条互相独立的协议消息；同一协议批次可能按牌触发多次。

全量 traversal 会话共记录 `calls=1900`、`visited=43340`。G0 的 125 次调用约占全量站点调用数的 6.58%；用于 G0 裁决时只比较固定五站点，不把索引、约束和计数器的常规遍历混入冲突频次。

## 6. 遍历基线变化

现有 `traversalBaseline` 五个场景中，前四个业务场景总遍历量不变。主动匿名对账场景新增显式兜底计数：

- 新增 `anonymousSlot:createExternalCardsFallback`: `calls=2 visited=3`。
- `total` 从 `visited=57` 变为 `visited=60`。
- 这 3 次不是新增扫描，而是原有匿名实体创建动作被显式计数；其余索引、收敛与全量扫描站点数字不变。

## 7. G0 决策

**结论：GO，进入阶段 1 牌堆 spike。**

依据：

1. 一局约 4.56 分钟的真实回放触发 125 次修复，已排除“修复路径几乎不触发、痛点被高估”的 G0 止步条件。
2. 主要压力集中在玩家来源身份置换（65 次）与匿名占位插回牌堆（59 次），两者合计占 99.2%，与阶段 1 先验证牌堆匿名化的方向直接相关。
3. 公共区来源置换只触发 1 次，占用回收与外部匿名兜底未触发；阶段 1 对照报告应分别观察各站点变化，不能只看五站点总数。

后续执行结果：阶段 1 隔离 spike 已完成，三段对照回放中固定五站点均为零，且生产源码仍为净增。
G1 最终决定 NO-GO / 收缩，保留匿名牌堆，不推进阶段 2–7；详见阶段 1 对照报告。
