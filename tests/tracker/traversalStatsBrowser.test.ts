import { describe, expect, it } from 'vitest'
import {
  installTraversalStatsBrowserControl,
  traversalStatsBrowserControl,
  uninstallTraversalStatsBrowserControl
} from '@/tracker/runtime/traversalStatsBrowser'
import { recordTraversal, stopTraversalStatsSession } from '@/tracker/traversalStats'

describe('遍历统计浏览器控制接口', () => {
  it('安装到目标 window 后可控制真实回放统计会话', () => {
    const target = {} as Window

    installTraversalStatsBrowserControl(target)
    expect(target.__DXC_TRAVERSAL__).toBe(traversalStatsBrowserControl)

    target.__DXC_TRAVERSAL__!.start()
    recordTraversal('anonymousSlot:test-browser', 7)
    const snapshot = target.__DXC_TRAVERSAL__!.snapshot()

    expect(snapshot.sites).toEqual({
      'anonymousSlot:test-browser': { calls: 1, visited: 7 }
    })
    const stopped = target.__DXC_TRAVERSAL__!.stop()
    expect(stopped.active).toBe(false)
    expect(stopped.g0.totals).toEqual({ calls: 0, visited: 0 })

    uninstallTraversalStatsBrowserControl(target)
    expect(target.__DXC_TRAVERSAL__).toBeUndefined()
    stopTraversalStatsSession()
  })
})
