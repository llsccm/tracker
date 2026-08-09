/**
 * 回放阶段计时与计数。
 *
 * 只做只读采集：不得在这里读取会推进游标或触发收敛的 Room 接口。
 * 时间统一用 `performance.now()`（毫秒，浮点），报告阶段再四舍五入。
 */

export type ReplayMetricPhase =
  | 'parse'
  | 'apply'
  | 'consistency'
  | 'indexRebuild'
  | 'snapshot'
  | 'watch'
  | 'assert'
  | 'format'

export interface ReplayMetricsSink {
  add(phase: ReplayMetricPhase, durationMs: number): void
  count(name: string, delta?: number): void
}

export interface ReplayMetricsSnapshot {
  timings: Record<string, number>
  counters: Record<string, number>
}

export class ReplayMetrics implements ReplayMetricsSink {
  private readonly timings = new Map<string, number>()
  private readonly counters = new Map<string, number>()
  private readonly createdAt = performance.now()

  add(phase: ReplayMetricPhase, durationMs: number): void {
    this.timings.set(phase, (this.timings.get(phase) ?? 0) + durationMs)
  }

  count(name: string, delta = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + delta)
  }

  /** 取最大值写入：只有新值更大时才覆盖，用于 max 类指标。 */
  observeMax(name: string, value: number): void {
    const current = this.counters.get(name)
    if (current === undefined || value > current) this.counters.set(name, value)
  }

  time<T>(phase: ReplayMetricPhase, run: () => T): T {
    const startedAt = performance.now()
    try {
      return run()
    } finally {
      this.add(phase, performance.now() - startedAt)
    }
  }

  getSnapshot(): ReplayMetricsSnapshot {
    // 直接遍历实际记录到的阶段（按首次出现顺序），避免另立一份白名单后漏掉新增阶段。
    const timings: Record<string, number> = {}
    this.timings.forEach((value, phase) => {
      timings[phase] = round(value)
    })
    timings.wallClock = round(performance.now() - this.createdAt)

    const counters: Record<string, number> = {}
    Array.from(this.counters.keys())
      .sort()
      .forEach((name) => {
        counters[name] = this.counters.get(name) as number
      })

    return { timings, counters }
  }
}

/** 供不需要采集的调用方复用的空实现，避免在热路径上写 `metrics?.` 判空。 */
export const NOOP_REPLAY_METRICS: ReplayMetricsSink = {
  add() {},
  count() {}
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
