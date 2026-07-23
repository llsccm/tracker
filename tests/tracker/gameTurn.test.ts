import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface ZhanFaItem {
  PlotID: number
  Value: number
  n?: number
}

const {
  Game,
  hideOrderContainer,
  hideSelfOrderContainer,
  laya,
  resetOrderContainer,
  scheduleTrackerRender,
  zhanFaItems
} = vi.hoisted(() => {
  const zhanFaItems: ZhanFaItem[] = []
  return {
    Game: {
      size: 4,
      room: { getMyDisplayID: vi.fn() },
      setTurn: vi.fn<(turn: number) => void>()
    },
    hideOrderContainer: vi.fn(),
    hideSelfOrderContainer: vi.fn(),
    laya: {
      gamescene: {
        SelfSeatUi: { zhanFaItems }
      }
    },
    resetOrderContainer: vi.fn(),
    scheduleTrackerRender: vi.fn(),
    zhanFaItems
  }
})

vi.mock('@/tracker', () => ({ Game }))
vi.mock('@/tracker/runtime/browser', () => ({
  tracker: { scheduleTrackerRender }
}))
vi.mock('@/runtime/gameAdapter', () => ({ laya }))
vi.mock('@/ui/seatOverlay', () => ({
  hideOrderContainer,
  hideSelfOrderContainer,
  resetOrderContainer
}))

import { handleGameTurn } from '@/handler/MsgGameTurnNtf'

describe('MsgGameTurnNtf', () => {
  beforeEach(() => {
    Game.room.getMyDisplayID.mockReset()
    Game.room.getMyDisplayID.mockReturnValue(2)
    Game.setTurn.mockReset()
    hideOrderContainer.mockReset()
    hideSelfOrderContainer.mockReset()
    resetOrderContainer.mockReset()
    scheduleTrackerRender.mockReset()
    zhanFaItems.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('首轮消息清理座位覆盖并重置轮战法状态', () => {
    zhanFaItems.push(
      { PlotID: 2033, Value: 2, n: 2 },
      { PlotID: 2301, Value: 4, n: 4 },
      { PlotID: 9999, Value: 6, n: 6 }
    )

    handleGameTurn({ TurnCnt: 1 })

    expect(resetOrderContainer).toHaveBeenCalledOnce()
    expect(hideOrderContainer).toHaveBeenCalledWith(4)
    expect(hideSelfOrderContainer).toHaveBeenCalledWith(2)
    expect(Game.setTurn).toHaveBeenCalledWith(1)
    expect(zhanFaItems).toEqual([
      { PlotID: 2033, Value: 0, n: 0 },
      { PlotID: 2301, Value: 0, n: 0 },
      { PlotID: 9999, Value: 6, n: 6 }
    ])
    expect(scheduleTrackerRender).toHaveBeenCalledOnce()
  })

  it('普通轮次不重复清理首轮座位覆盖，但仍重置轮战法状态', () => {
    zhanFaItems.push({ PlotID: 2034, Value: 2, n: 2 })

    handleGameTurn({ TurnCnt: 2 })

    expect(resetOrderContainer).not.toHaveBeenCalled()
    expect(hideOrderContainer).not.toHaveBeenCalled()
    expect(hideSelfOrderContainer).not.toHaveBeenCalled()
    expect(Game.setTurn).toHaveBeenCalledWith(2)
    expect(zhanFaItems).toEqual([{ PlotID: 2034, Value: 0, n: 0 }])
    expect(scheduleTrackerRender).toHaveBeenCalledOnce()
  })

  it('忽略字符串或非有限轮次，避免污染状态', () => {
    handleGameTurn({ TurnCnt: '1' })
    handleGameTurn({ TurnCnt: Number.NaN })

    expect(resetOrderContainer).not.toHaveBeenCalled()
    expect(Game.setTurn).not.toHaveBeenCalled()
    expect(scheduleTrackerRender).not.toHaveBeenCalled()
  })
})
