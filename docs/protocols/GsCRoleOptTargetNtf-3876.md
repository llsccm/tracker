# `GsCRoleOptTargetNtf`：界强识明牌通知

## 消息用途

`SpellID = 3876` 对应界强识获取目标角色手牌的通知。收到该消息时，`Params`
包含目标角色当前全部手牌的物理牌 ID，记牌器应将这些牌同步为
`targetSeatID` 座位的确定手牌明牌。

## 已观测样例

```text
Param: 0
Params: [137, 42, 46, 94, 118, 47, 96, 59]
SeatID: 0
SpellID: 3876
SrcSeatID: 0
targetSeatID: 2
Timeout: 15
Type: 3
className: "GsCRoleOptTargetNtf"
```

## 字段说明

| 字段 | 样例值 | 含义 |
| --- | ---: | --- |
| `className` | `GsCRoleOptTargetNtf` | 角色操作目标通知消息类型 |
| `SpellID` | `3876` | 界强识技能 ID |
| `targetSeatID` | `2` | 被查看手牌的目标座位 |
| `Params` | `[137, 42, 46, 94, 118, 47, 96, 59]` | 目标角色的全部手牌物理 ID |
| `Param` | `0` | 本次观测中的操作阶段参数；当前适配不依赖该值 |
| `SeatID` | `0` | 协议携带的操作相关座位，不作为明牌归属依据 |
| `SrcSeatID` | `0` | 技能来源座位，不作为明牌归属依据 |
| `Type` | `3` | 本次观测中的操作类型；当前适配不依赖该值 |
| `Timeout` | `15` | 操作超时时间，与记牌状态无关 |

## 适配规则

1. 仅在 `Params` 非空时处理。
2. `targetSeatID` 必须存在且不能为公共占位座位 `255`。
3. 将 `Params` 原样作为目标座位的全部手牌调用
   `tracker.revealTrackerCards({ type: 'player', seatID: targetSeatID, fullHand: true }, Params)`。
4. `fullHand: true` 会同步目标座位的观测手牌数为 `Params.length`，再由 `Room`
   确认物理牌身份、位置和相关约束。

## 代码位置

- 协议处理：`src/handler/GsCRoleOptTargetNtf.js`
- 消息路由：`src/logic.js`
- 消息白名单：`src/featureFlags.js`
- 明牌同步：`src/tracker/runtime/trackerController.ts`
- 回归测试：`tests/tracker/roleOptTargetNtf.test.ts`
