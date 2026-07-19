import { describe, expect, it } from 'vitest'
import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { collectTraversalStats } from '@/tracker/traversalStats'
import type { TraversalStats } from '@/tracker/traversalStats'
import type { RoomMoveContext } from '@/tracker/roomMovement/types'
import { createTestRoom, getCard } from './helpers/room'
import { createTrackerControllerHarness } from './helpers/trackerController'

function expectSite(
  stats: TraversalStats,
  site: string,
  expected: { calls: number; visited: number }
): void {
  expect(stats.sites.get(site)).toEqual(expected)
}

describe('阶段 0 匿名槽位冲突频次基线', () => {
  it('记录 createExternalCards 匿名兜底的调用与创建张数', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1] })

    const { stats } = collectTraversalStats(() => room.createExternalCards([], 3))

    expectSite(stats, 'anonymousSlot:createExternalCardsFallback', { calls: 1, visited: 3 })
  })

  it('记录玩家来源已知牌与暗占位交换', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1] })
    const knownCard = getCard(room, 1)
    const placeholder = getCard(room, 2)
    room.zones.get('pile')!.removeCard(placeholder)
    placeholder.bindCandidates([1], 'hand', null, { known: false })
    const context = {
      fromSeat: 1,
      fromSubZone: 'hand',
      knownCards: [],
      sourceEvent: { type: 'baseline:swap-player-placeholder' }
    } as RoomMoveContext

    const { result, stats } = collectTraversalStats(() =>
      room.movement.swapKnownCardWithPlayerSourcePlaceholder(knownCard, context)
    )

    expect(result).toBe(placeholder)
    expectSite(stats, 'anonymousSlot:swapKnownCardWithPlayerSourcePlaceholder', {
      calls: 1,
      visited: 1
    })
  })

  it('记录公共来源已知牌与来源占位交换', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1] })
    const knownCard = getCard(room, 1)
    const replacement = getCard(room, 2)
    room.moveCards([replacement.id], 'discard', {
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'baseline:prepare-public-placeholder' }
    })
    const context = {
      fromZone: 'discard',
      fromPosition: POSITION_TOP,
      sourceEvent: { type: 'baseline:swap-public-placeholder' }
    } as RoomMoveContext

    const { result, stats } = collectTraversalStats(() =>
      room.movement.swapKnownCardWithPublicSourcePlaceholder(knownCard, context)
    )

    expect(result).toBe(replacement)
    expectSite(stats, 'anonymousSlot:swapKnownCardWithPublicSourcePlaceholder', {
      calls: 1,
      visited: 1
    })
  })

  it('记录匿名占位插回牌堆', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1] })
    const [placeholder] = room.createExternalCards([], 1)

    const { stats } = collectTraversalStats(() =>
      room.movement.insertUnknownPlaceholderIntoPile(room.zones.get('pile')!, placeholder)
    )

    expectSite(stats, 'anonymousSlot:insertUnknownPlaceholderIntoPile', {
      calls: 1,
      visited: 1
    })
  })

  it('记录公共揭示回收玩家区占用身份', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
    controller.initTrackerDeck([1, 2, 3])
    const room = controller.getTrackerRoom()!
    const occupiedCard = getCard(room, 1)
    room.zones.get('pile')!.removeCard(occupiedCard)
    occupiedCard.bindCandidates([1], 'hand', null, { known: false })
    room.getPlayer(1)!.syncObservedHandCount(1)
    room.resolveConstraints()

    const { stats } = collectTraversalStats(() =>
      controller.revealTrackerCardsInZone({ id: 255, zone: 1, pos: POSITION_TOP }, [1])
    )

    expectSite(stats, 'anonymousSlot:recoverPlayerOccupiedIdentityForPublicReveal', {
      calls: 1,
      visited: 1
    })
  })
})
