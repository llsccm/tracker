import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface ZhanFaItem {
  PlotID: number
  Value: number
  n?: number
}

const {
  Game,
  hideSelfOrderContainer,
  laya,
  scheduleTrackerRender,
  showOrderContainers,
  UI,
  zhanFaItems
} = vi.hoisted(() => {
  const zhanFaItems: ZhanFaItem[] = []
  return {
    Game: {
      size: 4,
      room: { getMyDisplayID: vi.fn() },
      setTurn: vi.fn<(turn: number) => void>()
    },
    drawSeatUIs: vi.fn(),
    hideSelfOrderContainer: vi.fn(),
    laya: {
      gamescene: {
        SelfSeatUi: { zhanFaItems }
      }
    },
    scheduleTrackerRender: vi.fn(),
    showOrderContainers: vi.fn(),
    UI: { firstUpdateSeatUI: false },
    zhanFaItems
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
    UI.firstUpdateSeatUI = false
    zhanFaItems.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('首轮消息隐藏主视角并显示已定位座位，同时重置轮战法状态', () => {
    zhanFaItems.push(
      { PlotID: 2036, Value: 2, n: 2 },
      { PlotID: 2301, Value: 4, n: 4 },
      { PlotID: 9999, Value: 6, n: 6 }
    )
    UI.firstUpdateSeatUI = true

    handleGameTurn({ TurnCnt: 1 })

    expect(hideSelfOrderContainer).toHaveBeenCalledWith(2)
    expect(showOrderContainers).toHaveBeenCalledOnce()
    expect(Game.setTurn).toHaveBeenCalledWith(1)
    expect(zhanFaItems).toEqual([
      { PlotID: 2036, Value: 0, n: 0 },
      { PlotID: 2301, Value: 0, n: 0 },
      { PlotID: 9999, Value: 6, n: 6 }
    ])
    expect(scheduleTrackerRender).toHaveBeenCalledOnce()
  })

  it('普通轮次不重复清理首轮座位覆盖，但仍重置轮战法状态', () => {
    zhanFaItems.push({ PlotID: 2036, Value: 2, n: 2 })

    handleGameTurn({ TurnCnt: 2 })

    expect(hideSelfOrderContainer).not.toHaveBeenCalled()
    expect(showOrderContainers).not.toHaveBeenCalled()
    expect(Game.setTurn).toHaveBeenCalledWith(2)
    expect(zhanFaItems).toEqual([{ PlotID: 2036, Value: 0, n: 0 }])
    expect(scheduleTrackerRender).toHaveBeenCalledOnce()
  })

  it('忽略字符串或非有限轮次，避免污染状态', () => {
    handleGameTurn({ TurnCnt: '1' })
    handleGameTurn({ TurnCnt: Number.NaN })

    expect(hideSelfOrderContainer).not.toHaveBeenCalled()
    expect(Game.setTurn).not.toHaveBeenCalled()
    expect(scheduleTrackerRender).not.toHaveBeenCalled()
  })
})
