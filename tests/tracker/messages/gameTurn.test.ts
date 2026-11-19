import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { Game, laya, scheduleTrackerRender, zhanfaRegister, zhanfaReset } = vi.hoisted(() => {
  const zhanfaRegister = vi.fn()
  const zhanfaReset = vi.fn()

  return {
    Game: {
      setTurn: vi.fn<(turn: number) => void>()
    },
    laya: {
      zhanfaRegister,
      zhanfaReset
    },
    scheduleTrackerRender: vi.fn(),
    zhanfaRegister,
    zhanfaReset
  }
})

vi.mock('@/tracker', () => ({ Game }))
vi.mock('@/tracker/runtime/browser', () => ({
  tracker: { getTrackerRoom: () => null, scheduleTrackerRender }
}))
vi.mock('@/runtime/gameAdapter', () => ({ laya }))
vi.mock('@/ui/seatOverlay', () => ({
  updateSeatOverlay: vi.fn()
}))

import { handleGameTurn } from '@/handler/MsgGameTurnNtf'

describe('MsgGameTurnNtf', () => {
  beforeEach(() => {
    Game.setTurn.mockReset()
    scheduleTrackerRender.mockReset()
    zhanfaRegister.mockReset()
    zhanfaReset.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('首轮消息更新轮次并初始化、重置轮战法状态', () => {
    handleGameTurn({ TurnCnt: 1 })

    expect(zhanfaRegister).toHaveBeenCalledOnce()
    expect(Game.setTurn).toHaveBeenCalledWith(1)
    expect(zhanfaReset).toHaveBeenCalledOnce()
    expect(scheduleTrackerRender).toHaveBeenCalledOnce()
  })

  it('普通轮次不重复初始化战法映射，但仍重置轮战法状态', () => {
    handleGameTurn({ TurnCnt: 2 })

    expect(zhanfaRegister).not.toHaveBeenCalled()
    expect(Game.setTurn).toHaveBeenCalledWith(2)
    expect(zhanfaReset).toHaveBeenCalledOnce()
    expect(scheduleTrackerRender).toHaveBeenCalledOnce()
  })
})
