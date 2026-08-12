import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { destroyPeiXiuMapWindow, drawChengXiang, revealTrackerCards } = vi.hoisted(() => ({
  destroyPeiXiuMapWindow: vi.fn(),
  drawChengXiang: vi.fn(),
  revealTrackerCards: vi.fn()
}))

vi.mock('@/tracker/runtime/browser', () => ({
  tracker: {
    getReadyTrackerRoom: vi.fn(),
    revealTrackerCards
  }
}))

vi.mock('@/ui/PeiXiuMapWindow', () => ({
  destroyPeiXiuMapWindow
}))

vi.mock('@/draw', () => ({
  drawChengXiang,
  drawYanJiao: vi.fn(),
  drawYiCheng: vi.fn()
}))

import { CardConfig } from '@/config'
import { handleRoleOptTargetNtf } from '@/handler/GsCRoleOptTargetNtf'
import { Game } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'

describe('GsCRoleOptTargetNtf', () => {
  beforeEach(() => {
    destroyPeiXiuMapWindow.mockClear()
    drawChengXiang.mockClear()
    revealTrackerCards.mockClear()
    vi.mocked(tracker.getReadyTrackerRoom).mockReset()
    Game.bindRoom(null)
    Game.deleteSpellState(441)
    Game.deleteSpellState(3492)
    Game.deleteSpellState(7009)
    Game.deleteSpellState(4022)
  })

  afterEach(() => {
    Game.bindRoom(null)
    vi.restoreAllMocks()
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

  it.each([
    { SpellID: 441, isNewChengXiang: false },
    { SpellID: 3492, isNewChengXiang: true }
  ])('称象 $SpellID 在目标通知中计算并展示结果', ({ SpellID, isNewChengXiang }) => {
    Game.bindRoom({ mySeatID: 2, seatIDs: [2], size: 1 } as any)
    Game.setSpellState(SpellID, [11, 12, 13, 14])
    vi.spyOn(CardConfig.GetInstance(), 'getCardNumber').mockImplementation((id) => id - 10)

    handleRoleOptTargetNtf({
      SpellID,
      SrcSeatID: 2,
      targetSeatID: 255
    })

    expect(drawChengXiang).toHaveBeenCalledOnce()
    expect(drawChengXiang).toHaveBeenCalledWith([1, 2, 3, 4], isNewChengXiang)
    expect(Game.getSpellState(SpellID)).toBeUndefined()
  })

  it.each([441, 3492])('其他玩家的称象 %s 目标通知清除暂存牌但不展示', (SpellID) => {
    Game.bindRoom({ mySeatID: 2, seatIDs: [2], size: 1 } as any)
    Game.setSpellState(SpellID, [11, 12, 13, 14])

    handleRoleOptTargetNtf({
      SpellID,
      SrcSeatID: 3,
      targetSeatID: 255
    })

    expect(drawChengXiang).not.toHaveBeenCalled()
    expect(Game.getSpellState(SpellID)).toBeUndefined()
  })

  it('称象目标通知缺少暂存牌时不展示', () => {
    Game.bindRoom({ mySeatID: 2, seatIDs: [2], size: 1 } as any)

    handleRoleOptTargetNtf({
      SpellID: 441,
      SrcSeatID: 2,
      targetSeatID: 255
    })

    expect(drawChengXiang).not.toHaveBeenCalled()
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

  it('天候 Type 28 仅同步计数声明的牌堆顶', () => {
    handleRoleOptTargetNtf({
      Param: 0,
      Params: [3, 5, 88, 146, 106, 38, 8, 54, 99, 51],
      SeatID: 5,
      SpellID: 3903,
      SrcSeatID: 5,
      targetSeatID: 255,
      Timeout: 30,
      Type: 28,
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
      [88, 146, 106]
    )
  })

  it('天候 Type 29 跳过首位座位号并同步发动者私有牌堆顶', () => {
    handleRoleOptTargetNtf({
      Param: 0,
      Params: [5, 8, 99, 146],
      SeatID: 5,
      SpellID: 3903,
      SrcSeatID: 5,
      targetSeatID: 255,
      Timeout: 30,
      Type: 29,
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
      [8, 99, 146]
    )
  })

  it('诫厉同时公开牌堆顶与目标部分手牌，并记录 expectedPileCount', () => {
    const skillState: Record<string, any> = {}
    const getSkillState = vi.fn(() => skillState)
    vi.mocked(tracker.getReadyTrackerRoom).mockReturnValue({
      getSkillState,
      getPlayer: vi.fn(() => ({ hasObservedHandCount: true, observedHandCount: 5 }))
    } as any)

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
    const skillState: Record<string, any> = {}
    const getSkillState = vi.fn(() => skillState)
    vi.mocked(tracker.getReadyTrackerRoom).mockReturnValue({
      getSkillState,
      getPlayer: vi.fn(() => ({ hasObservedHandCount: true, observedHandCount: 2 }))
    } as any)

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
    const skillState: Record<string, any> = {}
    const getSkillState = vi.fn(() => skillState)
    vi.mocked(tracker.getReadyTrackerRoom).mockReturnValue({ getSkillState } as any)

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
