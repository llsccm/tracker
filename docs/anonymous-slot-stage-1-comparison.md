# 匿名牌堆阶段 1 对照报告

> 日期：2026-07-20
> 分支：`codex/anonymous-pile-spike-phase-1`
> 基线：`dev@c30be2d`
> 状态：已完成；G1 最终决定 NO-GO / 收缩

## 1. 实现范围

- `Room.initDeck` 不再用真实 ID 实体铺牌堆，改为等量匿名槽。
- `deckIdentities` 保存本局已发现的真实身份全集，作为身份守恒的稳定基准。
- `unlocatedIdentities` 保存尚未绑定到实体的身份，是 `deckIdentities` 的动态子集。
- 公共区端点和玩家来源的首次揭示统一通过 `materialize` 原地物化。
- `CardCounter` 为未定位身份建立静态牌面索引，并将其状态保持为 `UNKNOWN`。
- 手牌旧式真 ID 暗手牌模型仍由阶段 1 interop 兼容，触发时记录
  `anonymousSlot:materializePlayerIdentityInterop`。

## 2. 代码规模

以下统计来自 `git diff --numstat`，不含计划文档和本报告。

| 范围                       | 新增 | 删除 | 净变化 |
| -------------------------- | ---: | ---: | -----: |
| `src/tracker/`（7 个文件） |  323 |  201 |   +122 |
| 已有测试文件（7 个）       |  121 |   74 |    +47 |
| 测试夹具（1 个）           |   26 |    2 |    +24 |
| 新增阶段 1 测试（1 个）    |  105 |    0 |   +105 |

生产源码当前仍为净增，主要来自物化 API、身份守恒检查、CardCounter 身份注册和阶段 1
interop。阶段 1 只处理牌堆，尚未到后续集中删除手牌交换路径的阶段，因此不能仅凭净行数判定
最终收益。

## 3. 修复路径变化

| 路径                                           | 阶段 1 结果                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `recoverPlayerOccupiedIdentityForPublicReveal` | 运行时实现删除；由 `materializeExistingIdentityAtTarget` interop 接管旧式暗手牌占用 |
| `insertUnknownPlaceholderIntoPile`             | 运行时实现删除；匿名槽直接精确替换原牌堆槽                                          |
| `swapKnownCardWithPublicSourcePlaceholder`     | 仍为并存期兼容能力；匿名牌堆来源的新增测试中不再触发                                |

前两条旧名称仍存在于 `traversalStats` 的固定 G0 schema 中，用于让历史与新回放都能明确输出零值，
不代表运行时实现仍然存在。

## 4. 测试与冲突计数

- tracker 基线：33 个文件、250 项测试。
- 阶段 1：34 个文件、254 项测试，全部通过。
- 测试破坏面：修改 7 个测试文件，新增
  `tests/tracker/anonymousPileSpike.test.ts`，并调整 1 个通用 Room 夹具。
- 新增覆盖：匿名牌堆初始化、未知摸牌、牌堆端点物化、游戏外身份扩展，以及同一身份的
  牌顶/牌底候选分支传播。
- 匿名牌堆明牌来源用例中，公共区 swap、玩家占用 recover、牌堆占位插入均为零触发。
- 旧式真 ID 暗手牌被公共区揭示的兼容用例中，interop 计数为 1 次。

## 5. 遍历与性能

- `tests/tracker/traversalBaseline.test.ts` 及其快照无变化。
- 阶段 1 未新增高频全牌池遍历。
- 新增 interop 计数按兼容事件记录一次，不扫描完整牌池。
- 自动化执行耗时只受本机负载影响，本报告不将单次 Vitest 构建时间作为性能结论。

## 6. 真实回放快照

用户提供了三段长生命周期统计快照；回放来源、局号及是否覆盖完整一局未标注。

| 样本 | 日期         |   持续时间 | 总调用数 | 总访问量 | G0 调用/访问 |
| ---- | ------------ | ---------: | -------: | -------: | -----------: |
| 1    | `2026-07-19` | 102,183 ms |    1,786 |   42,753 |        0 / 0 |
| 2    | `2026-07-19` |  54,590 ms |      179 |    4,971 |        0 / 0 |
| 3    | `2026-07-19` | 106,536 ms |      615 |   18,590 |        0 / 0 |
| 合计 | -            | 263,309 ms |    2,580 |   66,314 |        0 / 0 |

### 样本 1 站点

| 站点                                           | 调用数 | 访问量 |
| ---------------------------------------------- | -----: | -----: |
| `handSlotCounts:collectBySeat`                 |    312 | 24,664 |
| `resolveConstraints:constraint3:exclusion`     |    325 |  6,634 |
| `reconcileAnonymousHandCards:group`            |    203 |  4,601 |
| `resolveConstraints:constraint1`               |    204 |  4,601 |
| `ambiguousKnownIndex:rebuild`                  |      5 |    805 |
| `cardCounter:update`                           |    178 |    430 |
| `locationIndex:applyDirty`                     |    178 |    236 |
| `resolveConstraints:playerSnapshotIncremental` |    204 |    237 |
| `ambiguousKnownIndex:applyDirty`               |    174 |    223 |
| `locationIndex:rebuild`                        |      1 |    161 |
| `resolveConstraints:playerSnapshot`            |      1 |    161 |
| `shufflePile:classify`                         |      1 |      0 |

### 样本 2 站点

| 站点                                           | 调用数 | 访问量 |
| ---------------------------------------------- | -----: | -----: |
| `handSlotCounts:collectBySeat`                 |     30 |  2,251 |
| `resolveConstraints:constraint3:exclusion`     |     19 |    630 |
| `reconcileAnonymousHandCards:group`            |     22 |    610 |
| `resolveConstraints:constraint1`               |     23 |    610 |
| `cardCounter:update`                           |     18 |    218 |
| `ambiguousKnownIndex:rebuild`                  |      1 |    161 |
| `locationIndex:rebuild`                        |      1 |    161 |
| `resolveConstraints:playerSnapshot`            |      1 |    161 |
| `ambiguousKnownIndex:applyDirty`               |     19 |     45 |
| `locationIndex:applyDirty`                     |     19 |     45 |
| `resolveConstraints:playerSnapshotIncremental` |     24 |     45 |
| `handExchange:playerHand`                      |      1 |     34 |
| `shufflePile:classify`                         |      1 |      0 |

### 样本 3 站点

| 站点                                           | 调用数 | 访问量 |
| ---------------------------------------------- | -----: | -----: |
| `handSlotCounts:collectBySeat`                 |    114 | 10,082 |
| `resolveConstraints:constraint3:exclusion`     |     73 |  2,205 |
| `reconcileAnonymousHandCards:group`            |     74 |  2,126 |
| `resolveConstraints:constraint1`               |     76 |  2,126 |
| `cardCounter:update`                           |     62 |    487 |
| `ambiguousKnownIndex:rebuild`                  |      2 |    322 |
| `locationIndex:rebuild`                        |      2 |    322 |
| `resolveConstraints:playerSnapshot`            |      2 |    322 |
| `ambiguousKnownIndex:applyDirty`               |     62 |    158 |
| `locationIndex:applyDirty`                     |     62 |    158 |
| `resolveConstraints:playerSnapshotIncremental` |     80 |    158 |
| `handExchange:playerHand`                      |      4 |    124 |
| `shufflePile:classify`                         |      2 |      0 |

三段顶层 `sites` 中均没有任何 `anonymousSlot:*` 站点，展开的 `g0` 快照也直接确认五个站点
及其合计均为 `calls: 0, visited: 0`：

- G0 五个旧冲突/兜底站点均为 `calls: 0, visited: 0`。
- `anonymousSlot:materializePlayerIdentityInterop` 为 `calls: 0, visited: 0`。
- 三段样本均未因匿名牌堆触发旧修复路径，也没有触发旧式暗手牌身份 interop。
- 样本 2、3 合计覆盖五次 `handExchange:playerHand`，该路径未引发匿名槽冲突修复。
- 主要访问量仍集中在既有手牌计数与约束收敛路径；没有发现阶段 1 新增的高频遍历。

## 7. 自动化验证

- `pnpm lint`
- `pnpm exec prettier --check <本次改动文件>`
- `pnpm test:tracker`
- `pnpm typecheck:tracker`
- `pnpm build`
- `pnpm build:prod`
- `git diff --check`

以上命令均通过。

## 8. G1 结论

当前证据：

- 自动化回归全部通过，遍历基线无变化。
- 三段累计 263.309 秒的真实回放样本中，旧冲突路径与阶段 1 interop 均为零触发。
- 生产源码净增 122 行，尚未达到“净删代码可观”的 GO 条件。
- 回放来源、完整性及观虚、权变、鹰视、诫厉、同区展示覆盖情况未知。

依据计划中的 G1 标准，最终决定 **NO-GO / 收缩**：保留阶段 1 的匿名牌堆作为终点，不推进阶段
2 至阶段 6。该决定不是因为性能或正确性回退，而是三段样本显示冲突路径低频，同时阶段 1
仍为净增代码，全面迁移的收益证据不足。

G0/G1 回放采集至此结束，临时浏览器回放探针进入退役范围。历史统计保留在本报告中；后续只有
出现新的非零旧冲突或高频 interop，并能证明继续迁移可带来可量化净删除时，才另立提案重新评估。
