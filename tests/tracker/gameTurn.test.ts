import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  Game,
  hideSelfOrderContainer,
  laya,
  scheduleTrackerRender,
  showOrderContainers,
  UI,
  zhanfaRegister,
  zhanfaReset
} = vi.hoisted(() => {
  const zhanfaRegister = vi.fn()
  const zhanfaReset = vi.fn()

  return {
    Game: {
      size: 4,
      room: { getMyDisplayID: vi.fn() },
      setTurn: vi.fn<(turn: number) => void>()
    },
    drawSeatUIs: vi.fn(),
    hideSelfOrderContainer: vi.fn(),
    laya: {
      zhanfaRegister,
      zhanfaReset
    },
    scheduleTrackerRender: vi.fn(),
    showOrderContainers: vi.fn(),
    UI: { firstUpdateSeatUI: false },
    zhanfaRegister,
    zhanfaReset
  }
})

vi.mock('@/tracker', () => ({ Game, UI }))
vi.mock('@/tracker/runtime/browser', () => ({
  tracker: { scheduleTrackerRender }
}))
vi.mock('@/runtime/gameAdapter', () => ({ laya }))
vi.mock('@/ui/seatOverlay', () => ({
  hideSelfOrderContainer,
  showOrderContainers
}))

import { handleGameTurn } from '@/handler/MsgGameTurnNtf'

describe('MsgGameTurnNtf', () => {
  beforeEach(() => {
    Game.room.getMyDisplayID.mockReset()
    Game.room.getMyDisplayID.mockReturnValue(2)
    Game.setTurn.mockReset()
    hideSelfOrderContainer.mockReset()
    scheduleTrackerRender.mockReset()
    showOrderContainers.mockReset()
    zhanfaRegister.mockReset()
    zhanfaReset.mockReset()
    UI.firstUpdateSeatUI = false
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('首轮消息隐藏主视角并显示已定位座位，同时重置轮战法状态', () => {
    UI.firstUpdateSeatUI = true

    handleGameTurn({ TurnCnt: 1 })

    expect(zhanfaRegister).toHaveBeenCalledOnce()
    expect(hideSelfOrderContainer).toHaveBeenCalledWith(2)
    expect(showOrderContainers).toHaveBeenCalledOnce()
    expect(Game.setTurn).toHaveBeenCalledWith(1)
    expect(zhanfaReset).toHaveBeenCalledOnce()
    expect(scheduleTrackerRender).toHaveBeenCalledOnce()
  })

  it('普通轮次不重复清理首轮座位覆盖，但仍重置轮战法状态', () => {
    handleGameTurn({ TurnCnt: 2 })

    expect(zhanfaRegister).not.toHaveBeenCalled()
    expect(hideSelfOrderContainer).not.toHaveBeenCalled()
    expect(showOrderContainers).not.toHaveBeenCalled()
    expect(Game.setTurn).toHaveBeenCalledWith(2)
    expect(zhanfaReset).toHaveBeenCalledOnce()
    expect(scheduleTrackerRender).toHaveBeenCalledOnce()
  })

  it('忽略字符串或非有限轮次，避免污染状态', () => {
    handleGameTurn({ TurnCnt: '1' })
    handleGameTurn({ TurnCnt: Number.NaN })

    expect(zhanfaRegister).not.toHaveBeenCalled()
    expect(zhanfaReset).not.toHaveBeenCalled()
    expect(hideSelfOrderContainer).not.toHaveBeenCalled()
    expect(Game.setTurn).not.toHaveBeenCalled()
    expect(scheduleTrackerRender).not.toHaveBeenCalled()
  })
})
