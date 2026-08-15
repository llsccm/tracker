import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'

const { applySpellEffect, handleGameFlowState, handleSpecialZones, syncTrackerMove } = vi.hoisted(
  () => ({
    applySpellEffect: vi.fn(),
    handleGameFlowState: vi.fn(),
    handleSpecialZones: vi.fn(() => ({ handled: false })),
    syncTrackerMove: vi.fn()
  })
)

vi.mock('../../src/tracker/runtime/browser', () => ({
  tracker: {
    syncTrackerMove
  }
}))

vi.mock('../../src/handler/gameFlowState', () => ({
  handleGameFlowState
}))

vi.mock('../../src/handler/specialZones', () => ({
  handleSpecialZones
}))

vi.mock('../../src/handler/spellEffects', () => ({
  applySpellEffect
}))

import { handleMoveCard } from '../../src/handler/PubGsCMoveCard'

describe('PubGsCMoveCard', () => {
  beforeEach(() => {
    applySpellEffect.mockClear()
    handleGameFlowState.mockClear()
    handleSpecialZones.mockClear()
    syncTrackerMove.mockClear()
  })

  it.each([
    ['其他视角', []],
    ['主视角', [51, 146, 138, 4]]
  ])('手气卡回堆在%s均归一为 RANDOM', (_view, cardIDs) => {
    const msg = {
      CardCount: 4,
      CardIDs: cardIDs,
      FromID: 6,
      FromPosition: POSITION_TOP,
      FromZone: 5,
      FromZoneParam: 0,
      MoveType: 19,
      SpellID: 0,
      ToID: 0,
      ToPosition: POSITION_TOP,
      ToZone: 1,
      ToZoneParam: 0
    }

    handleMoveCard(msg)

    expect(syncTrackerMove).toHaveBeenCalledOnce()
    expect(syncTrackerMove).toHaveBeenCalledWith(msg, {
      CardIDs: cardIDs,
      FromPosition: POSITION_TOP,
      ToPosition: POSITION_RANDOM
    })
    expect(handleSpecialZones).toHaveBeenCalledOnce()
    expect(handleGameFlowState).toHaveBeenCalledOnce()
    expect(applySpellEffect).toHaveBeenCalledOnce()
  })

  it('权变的牌堆同区展示将来源和目标都归一为牌顶', () => {
    const msg = {
      CardCount: 4,
      CardIDs: [158, 2, 63, 125],
      FromID: 255,
      FromPosition: POSITION_RANDOM,
      FromZone: 1,
      FromZoneParam: 0,
      MoveType: 21,
      SpellID: 7011,
      ToID: 255,
      ToPosition: POSITION_RANDOM,
      ToZone: 1,
      ToZoneParam: 0
    }

    handleMoveCard(msg)

    expect(syncTrackerMove).toHaveBeenCalledOnce()
    expect(syncTrackerMove).toHaveBeenCalledWith(msg, {
      CardIDs: [158, 2, 63, 125],
      FromPosition: POSITION_TOP,
      ToPosition: POSITION_TOP
    })
  })

  it('权变同区展示缺少位置字段时仍补为牌顶', () => {
    const msg = {
      CardCount: 4,
      CardIDs: [158, 2, 63, 125],
      FromID: 255,
      FromZone: 1,
      FromZoneParam: 0,
      MoveType: 21,
      SpellID: 7011,
      ToID: 255,
      ToZone: 1,
      ToZoneParam: 0
    }

    handleMoveCard(msg)

    expect(syncTrackerMove).toHaveBeenCalledOnce()
    expect(syncTrackerMove).toHaveBeenCalledWith(msg, {
      CardIDs: [158, 2, 63, 125],
      FromPosition: POSITION_TOP,
      ToPosition: POSITION_TOP
    })
  })

  it('观虚的牌堆同区展示将来源和目标都归一为牌顶', () => {
    const msg = {
      CardCount: 5,
      CardIDs: [62, 67, 37, 53, 142],
      FromID: 255,
      FromPosition: POSITION_RANDOM,
      FromZone: 1,
      FromZoneParam: 0,
      MoveType: 21,
      SpellID: 987,
      ToID: 255,
      ToPosition: POSITION_RANDOM,
      ToZone: 1,
      ToZoneParam: 0
    }

    handleMoveCard(msg)

    expect(syncTrackerMove).toHaveBeenCalledOnce()
    expect(syncTrackerMove).toHaveBeenCalledWith(msg, {
      CardIDs: [62, 67, 37, 53, 142],
      FromPosition: POSITION_TOP,
      ToPosition: POSITION_TOP
    })
  })

  it('天候同区展示不把 RANDOM 来源强行归一为牌顶', () => {
    const msg = {
      CardCount: 1,
      CardIDs: [18],
      FromID: 255,
      FromPosition: POSITION_RANDOM,
      FromZone: 1,
      FromZoneParam: 0,
      MoveType: 21,
      SpellID: 3903,
      ToID: 255,
      ToPosition: POSITION_RANDOM,
      ToZone: 1,
      ToZoneParam: 0
    }

    handleMoveCard(msg)

    expect(syncTrackerMove).toHaveBeenCalledOnce()
    expect(syncTrackerMove).toHaveBeenCalledWith(msg, {
      CardIDs: [18],
      FromPosition: POSITION_RANDOM,
      ToPosition: POSITION_RANDOM
    })
  })

  it('移动后副作用在 tracker 同步完成后执行', () => {
    const order: string[] = []
    applySpellEffect.mockImplementationOnce(
      (context: { afterMove(callback: () => void): void }) => {
        context.afterMove(() => order.push('afterMove'))
      }
    )
    syncTrackerMove.mockImplementationOnce(() => order.push('syncTrackerMove'))

    handleMoveCard({
      CardCount: 1,
      CardIDs: [0],
      FromID: 7,
      FromPosition: POSITION_TOP,
      FromZone: 5,
      FromZoneParam: 0,
      MoveType: 5,
      SpellID: 361,
      ToID: 3,
      ToPosition: POSITION_TOP,
      ToZone: 5,
      ToZoneParam: 0
    })

    expect(order).toEqual(['syncTrackerMove', 'afterMove'])
  })
})
