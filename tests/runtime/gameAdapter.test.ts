import { describe, expect, it, vi } from 'vitest'

vi.mock('@/tracker/Game', () => ({ Game: {} }))
vi.mock('@/utils/notification', () => ({ addTooltip: vi.fn() }))

import { GameRuntime } from '@/runtime/gameAdapter'

describe('GameRuntime', () => {
  it('复用已解析类，并在 anew 时重新解析', () => {
    const runtime = new GameRuntime()
    const firstClass = {}
    const secondClass = {}
    const firstResolver = vi.fn(() => firstClass)
    const secondResolver = vi.fn(() => secondClass)

    expect(runtime.class('CustomClass', false, firstResolver)).toBe(firstClass)
    expect(runtime.class('CustomClass', false, secondResolver)).toBe(firstClass)
    expect(secondResolver).not.toHaveBeenCalled()

    expect(runtime.class('CustomClass', true, secondResolver)).toBe(secondClass)
    expect(secondResolver).toHaveBeenCalledOnce()
  })

  it('获取窗口实例后调用 Close，并返回真实关闭状态', () => {
    const runtime = new GameRuntime()
    const resultClose = vi.fn()
    const tianShuClose = vi.fn()
    const windows = {
      GameResultWindow: { Close: resultClose },
      TianShuWindow: { Close: tianShuClose }
    }
    const GetWindow = vi.fn((name: keyof typeof windows) => windows[name])

    runtime.class('WindowManager', false, { GetWindow })
    vi.spyOn(runtime, 'find').mockReturnValue(null)

    expect(runtime.closeWindow('GameResultWindow')).toBe(true)
    expect(runtime.closeTianShu()).toBe(true)
    expect(runtime.closeWindow('GameMvpWindow')).toBe(false)
    expect(resultClose).toHaveBeenCalledOnce()
    expect(tianShuClose).toHaveBeenCalledOnce()
  })

  it('窗口实例没有 Close 方法时返回 false', () => {
    const runtime = new GameRuntime()

    runtime.class('WindowManager', false, { GetWindow: () => ({}) })

    expect(runtime.closeWindow('GameResultWindow')).toBe(false)
  })

  it('优先使用管理器 GetWindow，并兼容非 Map 的窗口实例表与场景回退', () => {
    const runtime = new GameRuntime()
    const managedWindow = { Close: vi.fn() }
    const cachedWindow = { Close: vi.fn() }
    const fallbackWindow = { Close: vi.fn() }
    const GetWindow = vi.fn((name: string) => (name === 'ManagedWindow' ? managedWindow : null))

    runtime.class('WindowManager', false, {
      GetWindow,
      WindowInstanceDict: { CachedWindow: cachedWindow }
    })
    vi.spyOn(runtime, 'find').mockImplementation((_, name) =>
      name === 'FallbackWindow' ? [null, fallbackWindow] : []
    )

    expect(runtime.GetWindow('ManagedWindow')).toBe(managedWindow)
    expect(runtime.GetWindow('CachedWindow')).toBe(cachedWindow)
    expect(runtime.GetWindow('FallbackWindow')).toBe(fallbackWindow)
    expect(runtime.GetWindow('MissingWindow')).toBeNull()
    expect(GetWindow).toHaveBeenCalledWith('ManagedWindow')
  })
})
