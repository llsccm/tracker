import { describe, expect, it, vi } from 'vitest'
import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { handleSpecialZones } from '../../src/handler/specialZones'

describe('handleSpecialZones', () => {
  it('手气卡回堆不再提前结束通用移动流水线', () => {
    const finishMove = vi.fn()
    const context = {
      game: {},
      CardIDs: [],
      CardCount: 4,
      FromID: 6,
      FromZone: 5,
      FromPosition: POSITION_TOP,
      ToID: 0,
      ToZone: 1,
      ToPosition: POSITION_RANDOM,
      MoveType: 19,
      SpellID: 0,
      finishMove
    }

    expect(handleSpecialZones(context)).toEqual({ handled: false })
    expect(finishMove).not.toHaveBeenCalled()
  })
})
