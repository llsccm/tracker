# Tracker 测试分类

按主要测试目标归档，跨主题文件保留完整用例，不重复复制到多个目录。

| 目录 | 范围 |
| --- | --- |
| `convergence/` | 通用位置候选、手牌观测与槽位约束、暗标记/弹窗候选、随机转移、收敛终止与增量一致性 |
| `skills/` | 具体技能及装备技能的完整流程、技能插件注册与生命周期、技能补牌和副作用 |
| `messages/` | 游戏消息解析与分发、Controller 入口、移动归一化和输入契约、开局/轮次/阶段/重连及洗牌协议数量 |
| `identity/` | 匿名身份、身份守恒、牌堆身份账本及事务、弃牌获得与回堆身份 |
| `movement/` | Room 移动路线、已知牌确认与阶段顺序、来源查询、公共端点、交换批次与移动工具 |
| `projection/` | 位置索引及增量同步、玩家快照、计数器 |
| `runtime/` | 导入边界、状态重置、日志、协议录制、开发断言与遍历基线 |
| `view/` | 既有视图渲染、手牌镜像、公共候选展示、牌堆顺序、座位标签与花色测试 |
| `helpers/` | 跨目录共用的 Room、Controller、候选与 noop runtime/view 夹具 |

## 交叉主题的归属

- 具体技能优先按技能归类：木牛流马的候选收敛与原始协议迁座均在 `skills/`；
  夺炁角色数据、诡伏相邻消息补全也随技能保留。
- 通用整手交换由技能插件实现，放在 `skills/handExchange.test.ts`；
  不针对技能的交换批次模型放在 `movement/exchangeBatches.test.ts`。
- 跨技能的消息入口按消息归类：`roleOptTargetNtf.test.ts`、`roleSpellOptRep.test.ts` 放在 `messages/`。
- 通用候选收敛放在 `convergence/`；位置索引、身份账本和展示分别放在 `projection/`、`identity/` 和 `view/`。
- 牌堆顺序文件同时覆盖物理顺序与展示，整体保留在 `view/pileDisplayOrder.test.ts`；
  回堆身份与目标位置放在 `identity/pileReturnPosition.test.ts`。
- `runtime/` 中的协议录制测试覆盖录制规则与存储，不包含独立的协议回放测试。
- 遍历护栏位于 `runtime/traversalBaseline.test.ts`，只在说明遍历量变化后更新内联快照。
- 按主要主题保留混合文件；新增非 UI 用例优先加入对应主题的已有文件。
  `view/` 仅整理既有测试，仍禁止新增或扩展 UI 自动化测试。

## 运行

```sh
# 全部 tracker 回归与牌堆身份契约，自动包含上述子目录
pnpm test:tracker

# 按主题运行
pnpm exec vitest run tests/tracker/convergence
pnpm exec vitest run tests/tracker/skills
pnpm exec vitest run tests/tracker/messages
pnpm exec vitest run tests/tracker/identity
pnpm exec vitest run tests/tracker/movement
pnpm exec vitest run tests/tracker/projection
pnpm exec vitest run tests/tracker/runtime
pnpm exec vitest run tests/tracker/view
```

验证门槛、UI 测试禁令与夹具规范见 [测试与验证策略](../../docs/agents/testing.md)。
