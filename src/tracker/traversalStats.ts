/**
 * Room.cards 遍历计数插桩。
 * 默认关闭：activeStats 为 null 时每个采样点只付一次空判断，不影响生产路径。
 * 性能基线测试通过 collectTraversalStats 启用，用于客观验收遍历优化收益
 * （见 plans/cards-traversal-optimization-final.md 第三节）。
 */
export interface TraversalSiteStats {
  calls: number
  visited: number
}

export interface TraversalStats {
  sites: Map<string, TraversalSiteStats>
}

let activeStats: TraversalStats | null = null

/**
 * 记录一次全量遍历采样。
 * @param site 采样点标识，如 'resolveConstraints:constraint1'
 * @param visitedCount 本次遍历访问的元素数量
 */
export function recordTraversal(site: string, visitedCount: number): void {
  if (!activeStats) return

  const entry = activeStats.sites.get(site)
  if (entry) {
    entry.calls += 1
    entry.visited += visitedCount
  } else {
    activeStats.sites.set(site, { calls: 1, visited: visitedCount })
  }
}

/**
 * 在启用计数的上下文中执行 run，返回其结果与期间累计的遍历统计。
 * 支持嵌套调用：内层统计不会泄漏到外层。
 */
export function collectTraversalStats<T>(run: () => T): { result: T; stats: TraversalStats } {
  const previousStats = activeStats
  const stats: TraversalStats = { sites: new Map() }
  activeStats = stats
  try {
    const result = run()
    return { result, stats }
  } finally {
    activeStats = previousStats
  }
}
