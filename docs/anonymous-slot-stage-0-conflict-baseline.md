# 阶段 0 冲突频次基线

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

后续真实回放采集时，应使用 DEV 浏览器控制接口开启长生命周期会话；它会跨越整局回放累计所有 `recordTraversal` 站点的 `calls/visited`，不需要改动回放入口。

## 4. 真实回放采集步骤

1. 使用开发模式启动并安装用户脚本：

   ```sh
   pnpm dev
   ```

2. 打开目标页面，在浏览器 DevTools Console 确认接口存在：

   ```js
   window.__DXC_TRAVERSAL__
   ```

   该接口只在 `pnpm dev` 的 Vite 开发服务器脚本中安装；`pnpm build` 与 `pnpm build:prod` 生成的构建产物都不会暴露它。

3. 开始播放一局完整真实回放前，清空并启动本次会话：

   ```js
   window.__DXC_TRAVERSAL__.start()
   ```

4. 播放完整回放。需要中途检查时执行：

   ```js
   window.__DXC_TRAVERSAL__.snapshot()
   ```

5. 回放结束后停止并复制最终 JSON：

   ```js
   copy(JSON.stringify(window.__DXC_TRAVERSAL__.stop(), null, 2))
   ```

6. 记录快照中的 `g0.totals` 与 `g0.sites`。`g0.sites` 固定包含以下五个站点，即使没有触发也会显式输出 `calls=0, visited=0`：

   ```text
   anonymousSlot:swapKnownCardWithPublicSourcePlaceholder
   anonymousSlot:swapKnownCardWithPlayerSourcePlaceholder
   anonymousSlot:recoverPlayerOccupiedIdentityForPublicReveal
   anonymousSlot:insertUnknownPlaceholderIntoPile
   anonymousSlot:createExternalCardsFallback
   ```

   其中 `g0.sites['anonymousSlot:createExternalCardsFallback'].visited` 是实际创建的匿名牌张数，不是扫描访问数。

7. 一局结束后若要继续采集下一局，先再次执行 `start()`；它会清空上一局并重新计时。若只想清空当前会话并继续，也可执行：

   ```js
   window.__DXC_TRAVERSAL__.reset()
   ```

   页面触发 `Exit()` 时会卸载接口，之后新的 `Init()` 会重新安装。建议每局使用一个独立 JSON 文件保存快照，并同时记录回放来源、局号、日期和版本/提交。

## 5. 真实回放冲突频次

### 5.1 采集信息

| 项目          | 值                         |
| ------------- | -------------------------- |
| 开始时间 UTC  | `2026-07-19T08:40:16.248Z` |
| 结束时间 UTC  | `2026-07-19T08:44:49.585Z` |
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

后续动作：

1. 补录本次回放来源、局号和版本/提交元数据。
2. 阶段 1 隔离 spike 继续使用相同回放，比较五站点前后次数、遍历量和代码净增减。
3. 是否全面推进阶段 2–6，仍由 G1 对照报告决定。
