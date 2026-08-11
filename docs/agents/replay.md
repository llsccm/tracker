# 协议回放（按需）

> 只有在处理协议 JSONL 录制、`tests/replay/`、回放诊断或回放专用类型检查时才阅读本文。
> 普通 tracker 改动不需要加载本页，也不应默认运行回放命令。

## 范围与隔离

- 回放器只在 Node/Vitest 中运行，不提供浏览器按钮，也不会把历史协议注入真实对局。
- 每次回放创建隔离的 `GameState`、`TrackerController` 和 `Room`，按 `seq` 重建座位、牌堆、移动、看牌及
  关键技能状态。
- 回放入口与普通 tracker 回归分离：`pnpm test:tracker` 不包含 `tests/replay/`；除非用户明确要求，
  不运行 `pnpm test:replay`、`pnpm typecheck:replay` 或 `pnpm replay:tracker`。
- 本地录制放在 Git 忽略目录 `replays/`，不要把真实录制提交到仓库。

## 目录地图

| 路径 | 作用 |
| --- | --- |
| `tests/replay/tracker/protocolReplay.test.ts` | 纯夹具回放器的单元与诊断回归 |
| `tests/replay/tracker/protocolReplay.runner.js` | 读取本地 JSONL 并执行一次真实录制回放的 Vitest runner |
| `tests/replay/tracker/helpers/protocolReplay/index.ts` | `TrackerProtocolReplayer`、JSONL 回放编排和报告格式化 |
| `tests/replay/tracker/helpers/protocolReplay/parser.ts` | JSONL 解析、字段白名单、`seq` 连续性校验 |
| `tests/replay/tracker/helpers/protocolReplay/handlers.ts` | 支持的协议处理与回放状态变更 |
| `tests/replay/tracker/helpers/protocolReplay/snapshot.ts` | Room/玩家/公共区/约束快照与一致性断言 |
| `tests/replay/tracker/helpers/protocolReplay/types.ts` | 回放上下文、步骤、失败报告和快照类型 |
| `tests/replay/tsconfig.json` | 只覆盖 tracker 源码与回放 helper 的类型检查 |
| `vitest.replay.tests.config.js` | 只包含 `tests/replay/tracker/**/*.test.ts` 的回放单测配置 |
| `vitest.replay.config.js` | 只包含 `protocolReplay.runner.js` 的独立配置 |

测试目录的就地入口见 [`tests/replay/README.md`](../../tests/replay/README.md)。

## 命令

```sh
# 纯夹具回归（不读取本地录制）
pnpm test:replay

# 回放 helper 的类型检查
pnpm typecheck:replay

# 读取 replays/tracker-protocols.jsonl 并运行真实录制
pnpm replay:tracker
```

录制 runner 支持以下环境变量：

- `DXC_TRACKER_PROTOCOL_FILE`：覆盖默认 `replays/tracker-protocols.jsonl` 路径。
- `DXC_TRACKER_CURRENT_USER_ID`：录像无法从协议确定主视角时指定当前用户 ID。
- `DXC_TRACKER_REPLAY_TRACE=1`：输出每条协议应用后的状态；长录制会产生大量日志。
- `DXC_TRACKER_REPLAY_TO_SEQ`：传入回放器的 `toSeq`。
- `DXC_TRACKER_REPLAY_WATCH_CARDS`：传入回放器的 `watchCardIDs`。
- `DXC_TRACKER_REPLAY_WATCH_SEATS`：传入回放器的 `watchSeatIDs`。

PowerShell、编码和文件路径写法按 [`commands.md`](commands.md) 与 Serena 本机记忆处理；本文不固化某个
开发者的 Shell 细节。

## JSONL 输入约定

每行是一个对象，至少包含：

```json
{"seq":1,"className":"SomeProtocol","payload":{}}
```

解析器会拒绝空文件、非对象行、未支持字段、非正整数 `seq`、跳号以及非对象 `payload`。录制应尽量从
开局座位/牌堆初始化开始；如果从对局中途开始，报告会提示“录制可能开始过晚”，不能把缺失的前置状态
误判为 tracker 回归。

## 执行与诊断流程

1. `parser.ts` 校验 JSONL 并按顺序生成记录。
2. `TrackerProtocolReplayer.replay()` 为每条记录调用 `handlers.ts`，维护 `GameState`、Controller 与 Room。
3. 每条已应用协议后运行快照一致性检查，覆盖身份账本、公共区槽位、`CardLocationIndex`、
   `AmbiguousKnownIndex`、玩家快照等状态。
4. 首个异常立即停止，并输出失败 `seq`、`className`、原始 `payload`、前置上下文及失败前后 Room 摘要。
5. 需要领域断言时，在 `protocolReplay.test.ts` 或相邻测试中导入
   `tests/replay/tracker/helpers/protocolReplay`，对最终 `Room` 或报告快照断言；不要把回放 helper
   混入普通 `tests/tracker/` 夹具。

回放器只能保证“已实现协议集合”内的状态重建。遇到未支持协议会明确失败，不能用“忽略该条消息”来宣称
完整回放成功。

## 新增或修改回放测试

- 先判断问题是否能由普通 `Room`/Controller 单测复现；能复现时优先放在 `tests/tracker/`，避免让回放
  helper 承担不必要的协议编排。
- 必须验证跨协议时，使用最小 JSONL 记录或 `protocolReplay.test.ts` 中的内存记录，不提交真实录制。
- 需要扩展协议支持时，同时更新 `handlers.ts`、必要的类型/快照字段和最小失败诊断测试。
- 只改回放 helper 或 `tests/replay/` 时，最低验证为 `pnpm test:replay` + `pnpm typecheck:replay`；若同时改动
  `src/tracker/`，再按 [`testing.md`](testing.md) 加跑 tracker 回归、lint 和 build。

## 历史决策：匿名槽回放不再扩张

匿名槽阶段 0/1 的 G0、G1 真实回放采集已经结束，最终决定为 NO-GO / 收缩：保留匿名牌堆，不推进阶段
2–7。临时浏览器回放探针与固定 G0 五站点 schema 已从运行时移除。

历史决策、阶段 0 冲突基线与阶段 1 对照数据归档在被 `.gitignore` 忽略的本地计划目录：

- [`plans/anonymous-entity-and-slot.md`](../../plans/anonymous-entity-and-slot.md)
- [`plans/pile-identity-cohort-plan.md`](../../plans/pile-identity-cohort-plan.md)

这些归档是决策证据，不是当前运行时入口。当前匿名牌堆、身份分区与 cohort 运行时契约见
[`card_tracker_anonymous_pile.md`](card_tracker_anonymous_pile.md)；牌堆身份权威是生产
`PileIdentityLedger`，对应长期契约见 `tests/contracts/pile-identity/`，不需要因为历史回放结论重新启用
observer 或浏览器探针。

## 相关入口

- 常规测试选择与验证分层：[`testing.md`](testing.md)
- 匿名牌堆与身份账本：[`card_tracker_anonymous_pile.md`](card_tracker_anonymous_pile.md)
- 记牌器方法速查：[`tracker_api.md`](tracker_api.md)
- 运行时生命周期：[`lifecycle.md`](lifecycle.md)
- 回放测试就地说明：[`tests/replay/README.md`](../../tests/replay/README.md)
