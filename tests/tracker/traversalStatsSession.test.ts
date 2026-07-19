import { afterEach, describe, expect, it } from 'vitest'
import {
  collectTraversalStats,
  recordTraversal,
  resetTraversalStatsSession,
  snapshotTraversalStatsSession,
  startTraversalStatsSession,
  stopTraversalStatsSession
} from '@/tracker/traversalStats'

afterEach(() => {
  stopTraversalStatsSession()
})

describe('长生命周期遍历统计会话', () => {
  it('累计 recordTraversal 并返回 JSON 友好快照', () => {
    const started = startTraversalStatsSession()
    recordTraversal('anonymousSlot:test', 2)
    recordTraversal('anonymousSlot:test', 3)

    const snapshot = snapshotTraversalStatsSession()

    expect(started.active).toBe(true)
    expect(snapshot.active).toBe(true)
    expect(snapshot.sites).toEqual({
      'anonymousSlot:test': { calls: 2, visited: 5 }
    })
    expect(snapshot.totals).toEqual({ calls: 2, visited: 5 })
    expect(snapshot.g0).toEqual({
      totals: { calls: 0, visited: 0 },
      sites: {
        'anonymousSlot:swapKnownCardWithPublicSourcePlaceholder': {
          calls: 0,
          visited: 0
        },
        'anonymousSlot:swapKnownCardWithPlayerSourcePlaceholder': {
          calls: 0,
          visited: 0
        },
        'anonymousSlot:recoverPlayerOccupiedIdentityForPublicReveal': {
          calls: 0,
          visited: 0
        },
        'anonymousSlot:insertUnknownPlaceholderIntoPile': {
          calls: 0,
          visited: 0
        },
        'anonymousSlot:createExternalCardsFallback': {
          calls: 0,
          visited: 0
        }
      }
    })
    expect(snapshot.startedAt).toBe(started.startedAt)
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
  })

  it('G0 快照固定输出五个站点与精确合计', () => {
    startTraversalStatsSession()
    recordTraversal('anonymousSlot:swapKnownCardWithPublicSourcePlaceholder', 1)
    recordTraversal('anonymousSlot:createExternalCardsFallback', 3)
    recordTraversal('resolveConstraints:unrelated', 9)

    const { g0 } = snapshotTraversalStatsSession()

    expect(g0.totals).toEqual({ calls: 2, visited: 4 })
    expect(g0.sites).toEqual({
      'anonymousSlot:swapKnownCardWithPublicSourcePlaceholder': {
        calls: 1,
        visited: 1
      },
      'anonymousSlot:swapKnownCardWithPlayerSourcePlaceholder': {
        calls: 0,
        visited: 0
      },
      'anonymousSlot:recoverPlayerOccupiedIdentityForPublicReveal': {
        calls: 0,
        visited: 0
      },
      'anonymousSlot:insertUnknownPlaceholderIntoPile': {
        calls: 0,
        visited: 0
      },
      'anonymousSlot:createExternalCardsFallback': {
        calls: 1,
        visited: 3
      }
    })
  })

  it('与同步 collectTraversalStats 并行累计但保持局部统计隔离', () => {
    startTraversalStatsSession()

    const { stats } = collectTraversalStats(() => {
      recordTraversal('local:site', 4)
    })
    recordTraversal('session:site', 2)

    expect(stats.sites.get('local:site')).toEqual({ calls: 1, visited: 4 })
    expect(stats.sites.has('session:site')).toBe(false)
    expect(snapshotTraversalStatsSession().sites).toEqual({
      'local:site': { calls: 1, visited: 4 },
      'session:site': { calls: 1, visited: 2 }
    })
  })

  it('重复 start 会丢弃上一局统计并重新开始', () => {
    startTraversalStatsSession()
    recordTraversal('previous:replay', 5)

    const restarted = startTraversalStatsSession()
    recordTraversal('current:replay', 2)

    expect(restarted.active).toBe(true)
    expect(restarted.sites).toEqual({})
    expect(snapshotTraversalStatsSession().sites).toEqual({
      'current:replay': { calls: 1, visited: 2 }
    })
  })

  it('reset 清空统计但保持会话开启，stop 返回最终快照并关闭会话', () => {
    startTraversalStatsSession()
    recordTraversal('before:reset', 1)

    const reset = resetTraversalStatsSession()
    expect(reset.active).toBe(true)
    expect(reset.sites).toEqual({})

    recordTraversal('after:reset', 3)
    const stopped = stopTraversalStatsSession()
    expect(stopped.active).toBe(false)
    expect(stopped.sites).toEqual({
      'after:reset': { calls: 1, visited: 3 }
    })
    expect(snapshotTraversalStatsSession().active).toBe(false)
    expect(snapshotTraversalStatsSession().sites).toEqual({})
  })
})
