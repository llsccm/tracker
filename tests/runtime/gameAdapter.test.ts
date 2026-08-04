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
})
