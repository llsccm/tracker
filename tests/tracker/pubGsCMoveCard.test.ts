import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'

const { syncTrackerMove } = vi.hoisted(() => ({
  syncTrackerMove: vi.fn()
}))

vi.mock('../../src/tracker/runtime/browser', () => ({
  tracker: {
    syncTrackerMove
  }
}))

vi.mock('../../src/handler/gameFlowState', () => ({
  handleGameFlowState: vi.fn()
}))

vi.mock('../../src/handler/specialZones', () => ({
  handleSpecialZones: vi.fn(() => ({ handled: false }))
}))

vi.mock('../../src/handler/spellEffects', () => ({
  applySpellEffect: vi.fn()
}))

import { handleMoveCard } from '../../src/handler/PubGsCMoveCard'

describe('PubGsCMoveCard', () => {
  beforeEach(() => {
    syncTrackerMove.mockClear()
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
})
