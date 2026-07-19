/**
 * Room.cards 遍历计数插桩。
 * 默认关闭：没有同步 collect 或长生命周期 session 时，每个采样点只付空判断成本。
 */
export interface TraversalSiteStats {
  calls: number
  visited: number
}

export interface TraversalStats {
  sites: Map<string, TraversalSiteStats>
}

export const G0_TRAVERSAL_SITES = [
  'anonymousSlot:swapKnownCardWithPublicSourcePlaceholder',
  'anonymousSlot:swapKnownCardWithPlayerSourcePlaceholder',
  'anonymousSlot:recoverPlayerOccupiedIdentityForPublicReveal',
  'anonymousSlot:insertUnknownPlaceholderIntoPile',
  'anonymousSlot:createExternalCardsFallback'
] as const

export type G0TraversalSite = (typeof G0_TRAVERSAL_SITES)[number]

export interface G0TraversalStatsSnapshot {
  totals: TraversalSiteStats
  sites: Record<G0TraversalSite, TraversalSiteStats>
}

export interface TraversalStatsSnapshot {
  active: boolean
  startedAt: string | null
  capturedAt: string
  elapsedMs: number
  totals: TraversalSiteStats
  sites: Record<string, TraversalSiteStats>
  g0: G0TraversalStatsSnapshot
}

interface TraversalStatsSession {
  stats: TraversalStats
  startedAt: number
}

let activeStats: TraversalStats | null = null
let activeSession: TraversalStatsSession | null = null

function createStats(): TraversalStats {
  return { sites: new Map() }
}

function addTraversal(stats: TraversalStats, site: string, visitedCount: number): void {
  const entry = stats.sites.get(site)
  if (entry) {
    entry.calls += 1
    entry.visited += visitedCount
    return
  }

  stats.sites.set(site, { calls: 1, visited: visitedCount })
}

function createSnapshot(
  session: TraversalStatsSession | null,
  active: boolean
): TraversalStatsSnapshot {
  const capturedAt = Date.now()
  const sites: Record<string, TraversalSiteStats> = {}
  let totalCalls = 0
  let totalVisited = 0

  if (session) {
    Array.from(session.stats.sites.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .forEach(([site, entry]) => {
        sites[site] = { ...entry }
        totalCalls += entry.calls
        totalVisited += entry.visited
      })
  }

  const g0Sites = Object.fromEntries(
    G0_TRAVERSAL_SITES.map((site) => [site, { ...(sites[site] ?? { calls: 0, visited: 0 }) }])
  ) as Record<G0TraversalSite, TraversalSiteStats>
  const g0Totals = Object.values(g0Sites).reduce(
    (totals, entry) => ({
      calls: totals.calls + entry.calls,
      visited: totals.visited + entry.visited
    }),
    { calls: 0, visited: 0 }
  )

  return {
    active,
    startedAt: session ? new Date(session.startedAt).toISOString() : null,
    capturedAt: new Date(capturedAt).toISOString(),
    elapsedMs: session ? Math.max(0, capturedAt - session.startedAt) : 0,
    totals: { calls: totalCalls, visited: totalVisited },
    sites,
    g0: {
      totals: g0Totals,
      sites: g0Sites
    }
  }
}

/**
 * 记录一次遍历或冲突修复采样。
 * 同步 collect 与长生命周期 session 可同时启用：同步统计保持原有嵌套隔离，session 继续累计全程数据。
 */
export function recordTraversal(site: string, visitedCount: number): void {
  if (activeStats) addTraversal(activeStats, site, visitedCount)
  if (activeSession && activeSession.stats !== activeStats) {
    addTraversal(activeSession.stats, site, visitedCount)
  }
}

/**
 * 在同步计数上下文中执行 run，返回其结果与期间累计统计。
 * 支持嵌套调用：内层同步统计不会泄漏到外层；若长 session 已启动，事件仍会进入 session。
 */
export function collectTraversalStats<T>(run: () => T): { result: T; stats: TraversalStats } {
  const previousStats = activeStats
  const stats = createStats()
  activeStats = stats
  try {
    const result = run()
    return { result, stats }
  } finally {
    activeStats = previousStats
  }
}

/** 开始新的长生命周期统计会话；重复调用会清空旧会话并重新计时。 */
export function startTraversalStatsSession(): TraversalStatsSnapshot {
  activeSession = {
    stats: createStats(),
    startedAt: Date.now()
  }
  return createSnapshot(activeSession, true)
}

/** 返回当前会话的 JSON 友好快照，不停止采集。 */
export function snapshotTraversalStatsSession(): TraversalStatsSnapshot {
  return createSnapshot(activeSession, activeSession !== null)
}

/** 停止采集并返回最终快照；没有活动会话时返回空的非活动快照。 */
export function stopTraversalStatsSession(): TraversalStatsSnapshot {
  const session = activeSession
  activeSession = null
  return createSnapshot(session, false)
}

/** 清空当前会话的统计并重新计时；没有活动会话时保持关闭并返回空快照。 */
export function resetTraversalStatsSession(): TraversalStatsSnapshot {
  if (!activeSession) return createSnapshot(null, false)

  activeSession = {
    stats: createStats(),
    startedAt: Date.now()
  }
  return createSnapshot(activeSession, true)
}
