import { moveContext } from './helpers/moveContext'
import { describe, expect, it, vi } from 'vitest'
import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { handleSpecialZones } from '../../src/handler/specialZones'

describe('handleSpecialZones', () => {
  it.each([POSITION_TOP + 1, POSITION_RANDOM])(
    '浑天仪入堆位置为 %s 时不再修正位置或提前结束通用移动流水线',
    (toPosition) => {
      const finishMove = vi.fn()
      const game = { isGameStart: false, isPassed: false }
      const context = {
        game,
        ...moveContext({
          CardIDs: [51],
          FromZone: 0,
          ToID: 255,
          ToZone: 1,
          ToPosition: toPosition,
          MoveType: 19,
          SpellID: 3694
        }),
        finishMove
      }

      expect(handleSpecialZones(context)).toEqual({ handled: false })
      expect(finishMove).not.toHaveBeenCalled()
      expect(context.patched.ToPosition).toBe(toPosition)
      expect(game).toEqual({ isGameStart: false, isPassed: false })
    }
  )

  it('手气卡回堆不再提前结束通用移动流水线', () => {
    const finishMove = vi.fn()
    const context = {
      game: {},
      ...moveContext({
        CardIDs: [],
        CardCount: 4,
        FromID: 6,
        FromZone: 5,
        FromPosition: POSITION_TOP,
        ToID: 0,
        ToZone: 1,
        ToPosition: POSITION_RANDOM,
        MoveType: 19,
        SpellID: 0
      }),
      finishMove
    }

    expect(handleSpecialZones(context)).toEqual({ handled: false })
    expect(finishMove).not.toHaveBeenCalled()
  })
})
