import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkSeatOverlayOverflow, clearSeatOverlayCards } from '@/tracker/view/PlayerHandView'

type Host = {
  clientHeight: number
  scrollHeight: number
  classList: {
    classes: Set<string>
    add: (name: string) => void
    remove: (name: string) => void
    contains: (name: string) => boolean
  }
  querySelectorAll: (selector: string) => Element[]
}

function createHost(clientHeight: number, scrollHeight: number, withEllipsis = false): Host {
  const classes = new Set<string>(withEllipsis ? ['show-ellipsis'] : [])
  return {
    clientHeight,
    scrollHeight,
    classList: {
      classes,
      add(name: string) {
        classes.add(name)
      },
      remove(name: string) {
        classes.delete(name)
      },
      contains(name: string) {
        return classes.has(name)
      }
    },
    querySelectorAll() {
      return []
    }
  }
}

describe('座位镜像 show-ellipsis', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('隐藏容器不因 scrollHeight 误判为溢出', () => {
    const hidden = createHost(0, 96)
    checkSeatOverlayOverflow(hidden as unknown as HTMLElement)
    expect(hidden.classList.contains('show-ellipsis')).toBe(false)
  })

  it('清理座位镜像时同步移除 show-ellipsis', () => {
    const host = createHost(48, 96, true)
    clearSeatOverlayCards(host as unknown as HTMLElement)
    expect(host.classList.contains('show-ellipsis')).toBe(false)
  })

  it('清理后过期的溢出测量不会把 show-ellipsis 加回', () => {
    const callbacks: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      callbacks.push(cb)
      return callbacks.length
    })

    const host = createHost(48, 96)
    checkSeatOverlayOverflow(host as unknown as HTMLElement)
    clearSeatOverlayCards(host as unknown as HTMLElement)

    expect(callbacks).toHaveLength(1)
    callbacks[0](0)
    expect(host.classList.contains('show-ellipsis')).toBe(false)
  })

  it('可见溢出时仍会添加 show-ellipsis', () => {
    const host = createHost(48, 96)
    checkSeatOverlayOverflow(host as unknown as HTMLElement)
    expect(host.classList.contains('show-ellipsis')).toBe(true)
  })
})
