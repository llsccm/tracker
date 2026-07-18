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
import { tracker } from '../../src/tracker/runtime/browser'

describe('GsCRoleOptTargetNtf', () => {
  beforeEach(() => {
    destroyPeiXiuMapWindow.mockClear()
    revealTrackerCards.mockClear()
    tracker.getReadyTrackerRoom.mockReset()
    Game.deleteSpellState(7009)
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
    Game.setSpellState(4022, { mapId: 12 })

    handleRoleOptTargetNtf({
      SpellID: 4021,
      SrcSeatID: 2,
      Type: 78
    })

    expect(destroyPeiXiuMapWindow).toHaveBeenCalledOnce()
    expect(Game.getSpellState(4022)).toBeUndefined()
  })

  it('权变将 Params 作为牌堆顶明牌且不借用鹰视状态', () => {
    handleRoleOptTargetNtf({
      Param: 1,
      Params: [158, 2, 63, 125],
      SeatID: 2,
      SpellID: 7011,
      SrcSeatID: 2,
      Timeout: 30,
      Type: 28,
      targetSeatID: 255,
      className: 'GsCRoleOptTargetNtf'
    })

    expect(revealTrackerCards).toHaveBeenCalledOnce()
    expect(revealTrackerCards).toHaveBeenCalledWith(
      {
        type: 'public',
        zoneName: 'pile',
        reposition: true,
        cardIDsTopFirst: true
      },
      [158, 2, 63, 125]
    )
    expect(Game.getSpellState(7009)).toBeUndefined()
  })

  it('观虚同时公开牌堆顶与目标手牌', () => {
    handleRoleOptTargetNtf({
      Param: 1,
      Params: [5, 4, 62, 67, 37, 53, 142, 16, 160, 79, 106],
      SeatID: 6,
      SpellID: 987,
      SrcSeatID: 6,
      Timeout: 30,
      Type: 29,
      targetSeatID: 1,
      className: 'GsCRoleOptTargetNtf'
    })

    expect(revealTrackerCards).toHaveBeenCalledTimes(2)
    expect(revealTrackerCards).toHaveBeenNthCalledWith(
      1,
      {
        type: 'public',
        zoneName: 'pile',
        reposition: true,
        cardIDsTopFirst: true
      },
      [62, 67, 37, 53, 142]
    )
    expect(revealTrackerCards).toHaveBeenNthCalledWith(
      2,
      { type: 'player', seatID: 1 },
      [16, 160, 79, 106]
    )
  })

  it('诫厉同时公开牌堆顶与目标部分手牌，并记录 expectedPileCount', () => {
    const skillState = {}
    const getSkillState = vi.fn(() => skillState)
    tracker.getReadyTrackerRoom.mockReturnValue({
      getSkillState,
      getPlayer: vi.fn(() => ({ hasObservedHandCount: true, observedHandCount: 5 }))
    })

    handleRoleOptTargetNtf({
      Param: 1,
      Params: [4, 2, 81, 99, 124, 4, 91, 158],
      SeatID: 3,
      SpellID: 3483,
      SrcSeatID: 3,
      Timeout: 30,
      Type: 28,
      targetSeatID: 4,
      className: 'GsCRoleOptTargetNtf'
    })

    expect(getSkillState).toHaveBeenCalledWith(3483)
    expect(skillState.expectedPileCount).toBe(4)
    expect(revealTrackerCards).toHaveBeenCalledTimes(2)
    expect(revealTrackerCards).toHaveBeenNthCalledWith(
      1,
      {
        type: 'public',
        zoneName: 'pile',
        reposition: true,
        cardIDsTopFirst: true
      },
      [81, 99, 124, 4]
    )
    expect(revealTrackerCards).toHaveBeenNthCalledWith(2, { type: 'player', seatID: 4 }, [91, 158])
  })

  it('诫厉 handCount 等于目标整手数时按 fullHand 同步', () => {
    const skillState = {}
    const getSkillState = vi.fn(() => skillState)
    tracker.getReadyTrackerRoom.mockReturnValue({
      getSkillState,
      getPlayer: vi.fn(() => ({ hasObservedHandCount: true, observedHandCount: 2 }))
    })

    handleRoleOptTargetNtf({
      Param: 1,
      Params: [4, 2, 81, 99, 124, 4, 91, 158],
      SeatID: 3,
      SpellID: 3483,
      SrcSeatID: 3,
      Timeout: 30,
      Type: 28,
      targetSeatID: 4,
      className: 'GsCRoleOptTargetNtf'
    })

    expect(revealTrackerCards).toHaveBeenNthCalledWith(
      2,
      { type: 'player', seatID: 4, fullHand: true },
      [91, 158]
    )
  })

  it('诫厉仅有牌堆张数时只写入 expectedPileCount', () => {
    const skillState = {}
    const getSkillState = vi.fn(() => skillState)
    tracker.getReadyTrackerRoom.mockReturnValue({ getSkillState })

    handleRoleOptTargetNtf({
      Param: 1,
      Params: [4],
      SeatID: 3,
      SpellID: 3483,
      SrcSeatID: 3,
      Timeout: 30,
      Type: 28,
      targetSeatID: 255,
      className: 'GsCRoleOptTargetNtf'
    })

    expect(getSkillState).toHaveBeenCalledWith(3483)
    expect(skillState.expectedPileCount).toBe(4)
    expect(revealTrackerCards).not.toHaveBeenCalled()
  })
})
