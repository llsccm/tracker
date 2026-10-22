# Phase C（P1-1）：抽象跨消息协议序列协调器（`ProtocolSequenceCoordinator`）

> 导航：[总览](tracker_architecture_refactoring_plan.md) · [Phase B](tracker_architecture_phase_b.md) · [Phase D](tracker_architecture_phase_d.md)
>
> 状态：待执行；以下为阶段设计方案，实施前需按当前源码核对。

## 1. 根因剖析

三国杀中大量技能并非单条消息可闭环，而是横跨多条异构消息：

- **诡伏（`3709`）**：`PubGsCMoveCard`（无 ID 获得）$\rightarrow$ 紧邻 `GsCUpdateRoleDataExNtf (DataID=3709)`
- **下书（`361`）**：`GsCRoleOptTargetNtf`（展示牌+目标）$\rightarrow$ `CGsRoleSpellOptRep (Type=22)`（选明/选暗）$\rightarrow$ `PubGsCMoveCard (5->5)`
- **诫厉（`3483`）**：`GsCRoleOptTargetNtf` $\rightarrow$ `PubGsCMoveCard (1->10, 5->10)` $\rightarrow$ `CGsRoleSpellOptRep (Type=53)` $\rightarrow$ `PubGsCMoveCard (10->1, 10->5)`
- **观虚（`987/988`）/ 天候（`3903`）/ 骋烈（`3208`）**：多段 `1->10`、`5->10`、`10->10`、`10->1`、`10->5`

目前每个技能各自在 `skillState` 中维护零散的阶段字段。当序列中途插入被动响应（如受到伤害触发反馈/贞烈、装有木牛流马或闪电判定）或录像跳帧时，散装状态机缺乏统一的**过期清理与异常中断回退**机制。

## 2. 具体重构方案

在 `src/tracker/skill/protocolSequence.ts` 中提供轻量、无外部依赖的会话管理辅助器：

```ts
// src/tracker/skill/protocolSequence.ts
import { trackerLogger } from '@/utils/logger'
import type { Room } from '../Room'
import type { NormalizedMoveEvent } from '../types'

export interface ProtocolSequenceSpec<State> {
  readonly stateKey: string | number
  /** 判断当前移动事件是否属于本序列期望的合法步骤，或属于允许穿插的无害旁路事件 */
  classifyMove: (
    state: State,
    event: NormalizedMoveEvent,
    room: Room
  ) => 'match' | 'bypass' | 'interrupt'
  /** 当序列被非预期移动打断时的清理与告警回调 */
  onInterrupt?: (state: State, interruptingEvent: NormalizedMoveEvent, room: Room) => void
}

export function guardSequenceOnMove<State>(
  room: Room,
  spec: ProtocolSequenceSpec<State>,
  event: NormalizedMoveEvent
): State | undefined {
  const state = room.readSkillState<State>(spec.stateKey)
  if (!state) return undefined

  const decision = spec.classifyMove(state, event, room)
  if (decision === 'match' || decision === 'bypass') return state

  trackerLogger.warn('技能协议序列被非预期移动打断，已清理暂存状态', {
    stateKey: spec.stateKey,
    interruptingSpellID: event.protocol.SpellID,
    interruptingType: event.type
  })
  spec.onInterrupt?.(state, event, room)
  room.deleteSkillState(spec.stateKey)
  return undefined
}
```

- 将 `GuiFu.ts`（`3709`）、`YanXi.ts`（`7017`）、`WenGua.ts`（`780`）、`JieLi.ts`（`3483`）接入该守卫，统一处理“相邻消息失配或被打断时告警并清理状态”的横切逻辑。

## 3. 提交拆分与验证命令

- **PR 1**：`refactor(tracker): add protocol sequence guard for multi-message skills`
- **PR 2**：`refactor(tracker): migrate GuiFu, YanXi, WenGua, and JieLi to sequence guard`
- **验证门槛**：`pnpm test:tracker && pnpm typecheck:tracker && pnpm lint && pnpm build`
