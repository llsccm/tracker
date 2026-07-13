import { beforeEach, describe, expect, it, vi } from 'vitest'

const { destroyPeiXiuMapWindow, revealTrackerCards } = vi.hoisted(() => ({
  destroyPeiXiuMapWindow: vi.fn(),
  revealTrackerCards: vi.fn()
}))

vi.mock('../../src/tracker/runtime/browser', () => ({
  tracker: {
    getReadyTrackerRoom: vi.fn(),
    revealTrackerCards
  }
}))

vi.mock('@/ui/PeiXiuMapWindow', () => ({
  destroyPeiXiuMapWindow
}))

vi.mock('../../src/draw', () => ({
  drawYanJiao: vi.fn(),
  drawYiCheng: vi.fn()
}))

import { handleRoleOptTargetNtf } from '../../src/handler/GsCRoleOptTargetNtf'
import { Game } from '../../src/tracker'

describe('GsCRoleOptTargetNtf', () => {
  beforeEach(() => {
    destroyPeiXiuMapWindow.mockClear()
    revealTrackerCards.mockClear()
    Game.deleteSpellState(4022)
  })

  it('界强识将 Params 作为目标座位的全部手牌明牌', () => {
    handleRoleOptTargetNtf({
      Param: 0,
      Params: [137, 42, 46, 94, 118, 47, 96, 59],
      SeatID: 0,
      SpellID: 3876,
      SrcSeatID: 0,
      targetSeatID: 2,
      Timeout: 15,
      Type: 3,
      className: 'GsCRoleOptTargetNtf'
    })

    expect(revealTrackerCards).toHaveBeenCalledOnce()
    expect(revealTrackerCards).toHaveBeenCalledWith(
      { type: 'player', seatID: 2, fullHand: true },
      [137, 42, 46, 94, 118, 47, 96, 59]
    )
  })

  it('裴秀开始选择技能时销毁地图并清除地图状态', () => {
    Game.setMyID(2)
    Game.setSpellState(4022, { mapId: 12 })

    handleRoleOptTargetNtf({
      SpellID: 4021,
      SrcSeatID: 2,
      Type: 78
    })

    expect(destroyPeiXiuMapWindow).toHaveBeenCalledOnce()
    expect(Game.getSpellState(4022)).toBeUndefined()
  })
})
