/**
 * 快路径 dry-run 数据 gate 的命中率埋点
 * （plans/cards-incremental-index-and-fast-path-plan.md 阶段 4 / §九 step 8）。
 *
 * 阶段 4 的四条移动快路径都「绕过 resolveConstraints」，属高风险优化，落地前必须先用真实
 * 命中率反证是否值得其维护税。这里的计数器只在非 production 模式开启，只做 dry-run 观测：
 * 记录每条快路径「本可命中 / 需回退及回退原因」，不改变任何收敛行为。
 *
 * 读取方式：浏览器对局中执行 `window.__dxcTracker.fastPathStats()`；
 * Node/测试用具名导出 `getFastPathStats()`。
 */

export type FastPathName =
  | 'deterministicMove' // 4A：确定明牌确定移动
  | 'hiddenHandReveal' // 4B：普通暗手牌首次揭示
  | 'plainHiddenHandTransfer' // 4C：普通暗手牌玩家间转移
  | 'knownIdHandTransfer' // 4D：协议给正 ID 的玩家间手牌转移

interface FastPathSiteStats {
  hit: number
  rollback: number
  reasons: Map<string, number>
}

export interface FastPathReport {
  name: FastPathName
  hit: number
  rollback: number
  total: number
  hitRate: number
  reasons: Record<string, number>
}

const stats = new Map<FastPathName, FastPathSiteStats>()

interface FastPathDebugApi {
  fastPathStats?: typeof getFastPathStats
  fastPathTiming?: typeof getConvergenceTiming
}

interface FastPathDebugHost {
  __dxcTracker?: FastPathDebugApi
}

export function isFastPathStatsEnabled(): boolean {
  return import.meta.env.MODE !== 'production'
}

function siteStats(name: FastPathName): FastPathSiteStats {
  let entry = stats.get(name)
  if (!entry) {
    entry = { hit: 0, rollback: 0, reasons: new Map() }
    stats.set(name, entry)
  }
  return entry
}

/** 记录一次「本可命中该快路径」（dry-run，不代表真的绕了收敛）。 */
export function recordFastPathHit(name: FastPathName): void {
  if (!isFastPathStatsEnabled()) return
  siteStats(name).hit += 1
}

/** 记录一次回退，并按原因归类，供数据 gate 分析哪些条件最常挡住快路径。 */
export function recordFastPathRollback(name: FastPathName, reason: string): void {
  if (!isFastPathStatsEnabled()) return
  const entry = siteStats(name)
  entry.rollback += 1
  entry.reasons.set(reason, (entry.reasons.get(reason) ?? 0) + 1)
}

/** 汇总各条快路径的命中/回退计数与命中率；回退原因按次数降序。 */
export function getFastPathStats(): FastPathReport[] {
  return Array.from(stats.entries()).map(([name, entry]) => {
    const total = entry.hit + entry.rollback
    const reasons = Object.fromEntries(
      Array.from(entry.reasons.entries()).sort((a, b) => b[1] - a[1])
    )
    return {
      name,
      hit: entry.hit,
      rollback: entry.rollback,
      total,
      hitRate: total === 0 ? 0 : entry.hit / total,
      reasons
    }
  })
}

// ---- 收敛 wall-clock 计时（回答「4A 命中本可省多少毫秒」）----
// 在 moveCards 里量整段 resolveConstraints() 的耗时，按「本次 4A 本可命中 / 需回退」分桶累计。
// hitMs 是 4A 可省时间的**上界**：4A 的 apply 版本仍会付增量索引/视图/计数尾部，实际省得略少。
// 若连上界都可忽略，即为明确的 no-go。

interface ConvergenceTiming {
  hitCount: number
  hitMs: number
  missCount: number
  missMs: number
  // 相位拆分：4A 只跳过 converge（refreshPlayerSnapshot + while 循环 + suspend），
  // 仍付 tail（增量索引 + syncViewGroups + ambiguous + counter）。用于判断收敛耗时到底花在哪、4A 能不能省到。
  convergeMs: number
  tailMs: number
  phaseCalls: number
  // converge 内部再拆：约束一/二/三各自耗时 + 总轮数 + 观测到的最大组数/玩家牌数，
  // 用于定位收敛耗时到底在哪个约束（约束二 group.resolve 无跳过优化，是首要嫌疑）。
  c1Ms: number
  c2Ms: number
  c3Ms: number
  rounds: number
  maxRounds: number
  maxGroupCount: number
  maxPlayerCards: number
  // 各约束块触发 changed=true 的次数（区分"谁在驱动重循环"与"谁在消耗时间"）。
  c1ChangedCount: number
  c2ChangedCount: number
  c3ChangedCount: number
}

const convergence: ConvergenceTiming = {
  hitCount: 0,
  hitMs: 0,
  missCount: 0,
  missMs: 0,
  convergeMs: 0,
  tailMs: 0,
  phaseCalls: 0,
  c1Ms: 0,
  c2Ms: 0,
  c3Ms: 0,
  rounds: 0,
  maxRounds: 0,
  maxGroupCount: 0,
  maxPlayerCards: 0,
  c1ChangedCount: 0,
  c2ChangedCount: 0,
  c3ChangedCount: 0
}

/** 清空命中率与耗时计数器（测试隔离用；真实对局一般不重置，跨局累计更能反映命中率）。 */
export function resetFastPathStats(): void {
  stats.clear()
  Object.assign(convergence, {
    hitCount: 0,
    hitMs: 0,
    missCount: 0,
    missMs: 0,
    convergeMs: 0,
    tailMs: 0,
    phaseCalls: 0,
    c1Ms: 0,
    c2Ms: 0,
    c3Ms: 0,
    rounds: 0,
    maxRounds: 0,
    maxGroupCount: 0,
    maxPlayerCards: 0,
    c1ChangedCount: 0,
    c2ChangedCount: 0,
    c3ChangedCount: 0
  })
}

/** 返回单调毫秒时钟；无 performance 时退化为 0（计时失效但不报错）。 */
export function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0
}

/** 记录一次 moveCards 收敛耗时，按 4A 本次是否本可命中分桶。 */
export function recordConvergenceTime(deterministicHit: boolean, ms: number): void {
  if (!isFastPathStatsEnabled()) return
  if (deterministicHit) {
    convergence.hitCount += 1
    convergence.hitMs += ms
  } else {
    convergence.missCount += 1
    convergence.missMs += ms
  }
}

/**
 * 记录一次 resolveConstraints 的相位拆分（不分命中/回退，聚合全部收敛调用）：
 * convergeMs = 4A 可跳过的部分（refreshPlayerSnapshot + while 循环 + suspend），
 * tailMs = 4A 仍要付的部分（增量索引 + syncViewGroups + ambiguous + counter）。
 */
export function recordConvergencePhases(convergeMs: number, tailMs: number): void {
  if (!isFastPathStatsEnabled()) return
  convergence.convergeMs += convergeMs
  convergence.tailMs += tailMs
  convergence.phaseCalls += 1
}

/**
 * 记录一次 resolveConstraints 的 converge 内部拆分：约束一/二/三各自耗时、本次轮数，
 * 以及本次观测到的约束组数与 player 快照大小（用于定位 82ms 的真实来源）。
 */
export function recordConvergenceBreakdown(
  c1Ms: number,
  c2Ms: number,
  c3Ms: number,
  rounds: number,
  groupCount: number,
  playerCardCount: number,
  c1ChangedCount: number,
  c2ChangedCount: number,
  c3ChangedCount: number
): void {
  if (!isFastPathStatsEnabled()) return
  convergence.c1Ms += c1Ms
  convergence.c2Ms += c2Ms
  convergence.c3Ms += c3Ms
  convergence.rounds += rounds
  convergence.maxRounds = Math.max(convergence.maxRounds, rounds)
  convergence.maxGroupCount = Math.max(convergence.maxGroupCount, groupCount)
  convergence.maxPlayerCards = Math.max(convergence.maxPlayerCards, playerCardCount)
  convergence.c1ChangedCount += c1ChangedCount
  convergence.c2ChangedCount += c2ChangedCount
  convergence.c3ChangedCount += c3ChangedCount
}

export interface ConvergenceTimingReport {
  totalMoves: number
  totalMs: number
  avgMsPerMove: number
  hitCount: number
  /** 本可命中移动上的收敛总耗时（含 tail）= 4A 可省时间的松上界。 */
  saveableMsUpperBound: number
  avgHitMs: number
  missCount: number
  missMs: number
  /** 可省时间占比（松上界）。 */
  saveableShare: number
  // ---- 相位拆分（聚合全部 resolveConstraints 调用，回答「收敛耗时花在哪、4A 能省到多少」）----
  phaseCalls: number
  /** 4A 可跳过部分：refreshPlayerSnapshot + while 循环 + suspend。 */
  convergeMsTotal: number
  /** 4A 仍要付部分：增量索引 + syncViewGroups + ambiguous + counter。 */
  tailMsTotal: number
  avgConvergeMs: number
  avgTailMs: number
  /** convergeMsTotal /（converge + tail）：4A 真正能省到的时间占比。高→值得做；低→no-go。 */
  convergeShare: number
  // ---- converge 内部拆分（定位约束一/二/三谁是大头；c2=约束二 group.resolve 无跳过优化）----
  c1MsTotal: number
  c2MsTotal: number
  c3MsTotal: number
  c1Share: number
  c2Share: number
  c3Share: number
  roundsTotal: number
  avgRounds: number
  maxRounds: number
  maxGroupCount: number
  maxPlayerCards: number
  /** 约束一触发 changed=true 的总次数——区分"谁驱动重循环"。 */
  c1ChangedCount: number
  /** 约束二触发 changed=true 的总次数。 */
  c2ChangedCount: number
  /** 约束三触发 changed=true 的总次数。 */
  c3ChangedCount: number
}

/** 汇总 moveCards 收敛耗时，供数据 gate 的「命中率 × 单条收益」阈值判断。 */
export function getConvergenceTiming(): ConvergenceTimingReport {
  const totalMoves = convergence.hitCount + convergence.missCount
  const totalMs = convergence.hitMs + convergence.missMs
  const phaseTotal = convergence.convergeMs + convergence.tailMs
  return {
    totalMoves,
    totalMs,
    avgMsPerMove: totalMoves === 0 ? 0 : totalMs / totalMoves,
    hitCount: convergence.hitCount,
    saveableMsUpperBound: convergence.hitMs,
    avgHitMs: convergence.hitCount === 0 ? 0 : convergence.hitMs / convergence.hitCount,
    missCount: convergence.missCount,
    missMs: convergence.missMs,
    saveableShare: totalMs === 0 ? 0 : convergence.hitMs / totalMs,
    phaseCalls: convergence.phaseCalls,
    convergeMsTotal: convergence.convergeMs,
    tailMsTotal: convergence.tailMs,
    avgConvergeMs:
      convergence.phaseCalls === 0 ? 0 : convergence.convergeMs / convergence.phaseCalls,
    avgTailMs: convergence.phaseCalls === 0 ? 0 : convergence.tailMs / convergence.phaseCalls,
    convergeShare: phaseTotal === 0 ? 0 : convergence.convergeMs / phaseTotal,
    c1MsTotal: convergence.c1Ms,
    c2MsTotal: convergence.c2Ms,
    c3MsTotal: convergence.c3Ms,
    c1Share: convergence.convergeMs === 0 ? 0 : convergence.c1Ms / convergence.convergeMs,
    c2Share: convergence.convergeMs === 0 ? 0 : convergence.c2Ms / convergence.convergeMs,
    c3Share: convergence.convergeMs === 0 ? 0 : convergence.c3Ms / convergence.convergeMs,
    roundsTotal: convergence.rounds,
    avgRounds: convergence.phaseCalls === 0 ? 0 : convergence.rounds / convergence.phaseCalls,
    maxRounds: convergence.maxRounds,
    maxGroupCount: convergence.maxGroupCount,
    maxPlayerCards: convergence.maxPlayerCards,
    c1ChangedCount: convergence.c1ChangedCount,
    c2ChangedCount: convergence.c2ChangedCount,
    c3ChangedCount: convergence.c3ChangedCount
  }
}

function getBrowserDebugHost(): FastPathDebugHost | null {
  return typeof window === 'undefined' ? null : (window as unknown as FastPathDebugHost)
}

export function attachFastPathDebugApi(
  host: FastPathDebugHost | null = getBrowserDebugHost()
): void {
  if (!isFastPathStatsEnabled()) return
  if (!host) return

  const api = host.__dxcTracker ?? {}
  api.fastPathStats = getFastPathStats
  api.fastPathTiming = getConvergenceTiming
  host.__dxcTracker = api
}

export function detachFastPathDebugApi(
  host: FastPathDebugHost | null = getBrowserDebugHost()
): void {
  if (!host?.__dxcTracker) return

  if (host.__dxcTracker.fastPathStats === getFastPathStats) {
    delete host.__dxcTracker.fastPathStats
  }
  if (host.__dxcTracker.fastPathTiming === getConvergenceTiming) {
    delete host.__dxcTracker.fastPathTiming
  }
  if (Object.keys(host.__dxcTracker).length === 0) {
    delete host.__dxcTracker
  }
}
