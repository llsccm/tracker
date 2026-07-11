import { beforeEach, describe, expect, it, vi } from 'vitest'

const { revealTrackerCards } = vi.hoisted(() => ({
  revealTrackerCards: vi.fn()
}))

vi.mock('../../src/tracker/runtime/browser', () => ({
  tracker: {
    getReadyTrackerRoom: vi.fn(),
    revealTrackerCards
  }
}))

vi.mock('../../src/draw', () => ({
  drawYanJiao: vi.fn(),
  drawYiCheng: vi.fn()
}))

import { handleRoleOptTargetNtf } from '../../src/handler/GsCRoleOptTargetNtf'

describe('GsCRoleOptTargetNtf', () => {
  beforeEach(() => {
    revealTrackerCards.mockClear()
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
})
