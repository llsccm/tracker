# 回放测试（按需）

这里的测试只在明确处理协议 JSONL 回放、录制诊断或回放 helper 时读取和执行。普通 tracker 任务使用
`tests/tracker/`；`pnpm test:tracker` 不包含本目录。

详细的目录地图、输入格式、环境变量、诊断流程和历史决策见
[`docs/agents/replay.md`](../../docs/agents/replay.md)。

常用命令：

```sh
pnpm test:replay
pnpm typecheck:replay
pnpm replay:tracker
```

真实 JSONL 录制仅放在 Git 忽略的 `replays/`，默认文件为 `replays/tracker-protocols.jsonl`。不要把录制
文件或一次性浏览器探针重新加入运行时。
