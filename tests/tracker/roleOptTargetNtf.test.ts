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
    vi.stubEnv('DEV', false)
    destroyPeiXiuMapWindow.mockClear()
    drawChengXiang.mockClear()
    revealTrackerCards.mockClear()
    vi.mocked(tracker.getReadyTrackerRoom).mockReset()
    Game.bindRoom(null)
    Game.deleteSpellState(361)
    Game.deleteSpellState(441)
    Game.deleteSpellState(3492)
    Game.deleteSpellState(7009)
    Game.deleteSpellState(4022)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
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

  it('下书目标通知直接记录目标座位和展示牌', () => {
    handleRoleOptTargetNtf({
      Param: 0,
      Params: [108, 131, 49, 54, 78],
      SeatID: 1,
      SpellID: 361,
      SrcSeatID: 1,
      targetSeatID: 4,
      Timeout: 30,
      Type: 29,
      className: 'GsCRoleOptTargetNtf'
    })

    expect(revealTrackerCards).not.toHaveBeenCalled()
    expect(Game.getSpellState(361)).toEqual({
      shownCardIDs: [108, 131, 49, 54, 78],
      targetSeatID: 4
    })
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

  it('诫厉发动者视角可同步完整牌堆顶与目标部分手牌', () => {
    const skillState: Record<string, any> = {}
    const ensureSkillState = vi.fn(() => skillState)
    vi.mocked(tracker.getReadyTrackerRoom).mockReturnValue({
      mySeatID: 3,
      ensureSkillState,
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

    expect(ensureSkillState).toHaveBeenCalledWith(3483, expect.any(Function))
    expect(skillState.context).toEqual({ actorSeat: 3, targetSeat: 4, pileCount: 4 })
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

  it.each([
    { label: '目标视角', mySeatID: 6, actorSeat: 7, targetSeat: 6 },
    { label: '其它视角', mySeatID: 2, actorSeat: 3, targetSeat: 4 }
  ])('诫厉 $label 只收到牌堆张数并记录上下文', ({ mySeatID, actorSeat, targetSeat }) => {
    const skillState: Record<string, any> = {}
    const ensureSkillState = vi.fn(() => skillState)
    vi.mocked(tracker.getReadyTrackerRoom).mockReturnValue({
      mySeatID,
      ensureSkillState
    } as any)

    handleRoleOptTargetNtf({
      Param: 1,
      Params: [4],
      SeatID: actorSeat,
      SpellID: 3483,
      SrcSeatID: actorSeat,
      Timeout: 30,
      Type: 28,
      targetSeatID: targetSeat,
      className: 'GsCRoleOptTargetNtf'
    })

    expect(revealTrackerCards).not.toHaveBeenCalled()
    expect(skillState.context).toEqual({ actorSeat, targetSeat, pileCount: 4 })
  })

  it('诫厉开发模式也不从纯计数通知伪造牌面', () => {
    vi.stubEnv('DEV', true)
    const skillState: Record<string, any> = {}
    vi.mocked(tracker.getReadyTrackerRoom).mockReturnValue({
      mySeatID: 2,
      ensureSkillState: vi.fn(() => skillState)
    } as any)

    handleRoleOptTargetNtf({
      Param: 1,
      Params: [4],
      SeatID: 3,
      SpellID: 3483,
      SrcSeatID: 3,
      Timeout: 30,
      Type: 28,
      targetSeatID: 4,
      className: 'GsCRoleOptTargetNtf'
    })

    expect(revealTrackerCards).not.toHaveBeenCalled()
    expect(skillState.context).toEqual({ actorSeat: 3, targetSeat: 4, pileCount: 4 })
  })
})
