/**
 * Room.cards 遍历计数插桩。
 * 默认关闭：没有同步 collect 时，每个采样点只付空判断成本。
 */
export interface TraversalSiteStats {
  calls: number
  visited: number
}

export interface TraversalStats {
  sites: Map<string, TraversalSiteStats>
}

let activeStats: TraversalStats | null = null

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

/**
 * 记录一次遍历采样。
 */
export function recordTraversal(site: string, visitedCount: number): void {
  if (activeStats) addTraversal(activeStats, site, visitedCount)
}

/**
 * 在同步计数上下文中执行 run，返回其结果与期间累计统计。
 * 支持嵌套调用：内层同步统计不会泄漏到外层。
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
