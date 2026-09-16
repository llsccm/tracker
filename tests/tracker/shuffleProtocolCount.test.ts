import { describe, expect, it, vi } from 'vitest'
import { isAnonymous } from '@/tracker/Card'
import { POSITION_RANDOM } from '@/tracker/candidate/cardPositions'
import type { Room } from '@/tracker/Room'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

const CARD_IDS = Array.from({ length: 10 }, (_, index) => index + 25)

function createDiscardRoom(discardIDs = CARD_IDS) {
  const onError = vi.fn()
  const { controller } = createTrackerControllerHarness({ onError })
  controller.initTrackerRoom()
  controller.registerTrackerPlayers(
    [
      { SeatID: 1, ClientID: 100 },
      { SeatID: 3, ClientID: 300 }
    ],
    100
  )
  controller.initTrackerDeck(CARD_IDS)
  controller.syncTrackerMove(
    protocolMove({ CardIDs: discardIDs, ToZone: 2, ToID: 255, MoveType: 16 })
  )
  const room = controller.getTrackerRoom()!
  return { controller, room, onError }
}

function anonymousDiscardGain(cardCount: number) {
  return protocolMove({
    CardIDs: [],
    CardCount: cardCount,
    FromZone: 2,
    FromPosition: POSITION_RANDOM,
    ToID: 3,
    MoveType: 18,
    SpellID: 4023
  })
}

function shuffleMove(cardCount: number) {
  return protocolMove({ CardIDs: [], CardCount: cardCount, FromZone: 2, ToZone: 9, MoveType: 0 })
}

function expectConsistentPile(room: Room, count: number) {
  expect(room.zones.get('pile')!.cards).toHaveLength(count)
  expect(room.zones.get('discard')!.cards).toEqual([])
  expect(room.pileIdentityLedger.getSnapshot().accountedPileCount).toBe(count)
  expect(room.assertPileIdentityLedgerConsistency('test:shuffle-protocol-count')).toEqual([])
  expect(room.publicZones.getPublicZoneConsistencyIssues()).toEqual([])
}

describe('洗牌使用协议张数并保留身份候选', () => {
  it('暗取五张后只洗回五个物理槽，十个身份仍作为候选保留', () => {
    const { controller, room, onError } = createDiscardRoom()
    controller.syncTrackerMove(anonymousDiscardGain(5))
    const handBefore = [...room.players.get(3)!.cards]
    expect(handBefore).toHaveLength(5)
    expect(room.zones.get('discard')!.cards).toHaveLength(10)

    controller.syncTrackerMove(shuffleMove(5))

    expectConsistentPile(room, 5)
    expect(room.zones.get('pile')!.cards.every(isAnonymous)).toBe(true)
    expect(room.players.get(3)!.cards).toEqual(handBefore)
    expect(room.pileIdentityLedger.getSnapshot().cohort).toMatchObject({
      generation: 1,
      flatCandidateWidth: 10,
      groups: [{ cardIDs: CARD_IDS, remainingPileCount: 5, kind: 'partial' }]
    })
    expect([...room.unlocatedIdentities].sort((a, b) => a - b)).toEqual(CARD_IDS)
    expect(onError).not.toHaveBeenCalled()
  })

  it.each(['hand', 'exchange'] as const)(
    '暗取后已确认位于 %s 的五个身份不再进入洗回候选',
    (destination) => {
      const { controller, room, onError } = createDiscardRoom()
      const knownIDs = CARD_IDS.slice(0, 5)
      controller.syncTrackerMove(anonymousDiscardGain(5))
      if (destination === 'hand') {
        controller.revealTrackerCards({ type: 'player', seatID: 3 }, knownIDs)
      } else {
        controller.syncTrackerMove(
          protocolMove({
            CardIDs: knownIDs,
            FromZone: 5,
            FromID: 3,
            ToZone: 10,
            ToID: 255,
            MoveType: 15
          })
        )
      }
      const knownCards = knownIDs.map((id) => room.cardIndex.get(id)!)

      controller.syncTrackerMove(shuffleMove(5))

      expectConsistentPile(room, 5)
      expect(room.pileIdentityLedger.getSnapshot().cohort.definitelyInPileIDs).toEqual(
        CARD_IDS.slice(5)
      )
      knownCards.forEach((card) => {
        expect(room.cardIndex.get(card.id)).toBe(card)
        expect(card.location).toBe(destination === 'hand' ? 'player' : 'exchange')
        expect(card.isKnown).toBe(true)
      })
      expect(onError).not.toHaveBeenCalled()
    }
  )

  it('缩减洗回数量时保留原有公开牌顶顺序与身份', () => {
    const { controller, room, onError } = createDiscardRoom(CARD_IDS.slice(0, 8))
    controller.revealTrackerCardsInZone({ id: 255, zone: 1 }, CARD_IDS.slice(8))
    const remainingPileCards = [...room.zones.get('pile')!.cards]
    controller.syncTrackerMove(anonymousDiscardGain(5))

    controller.syncTrackerMove(shuffleMove(5))

    expectConsistentPile(room, 5)
    expect(room.zones.get('pile')!.cards.slice(-2)).toEqual(remainingPileCards)
    expect(remainingPileCards.every((card) => card.isKnown)).toBe(true)
    expect(room.pileIdentityLedger.getSnapshot()).toMatchObject({
      knownPileIdentityIDs: CARD_IDS.slice(8),
      hiddenPileSlotCount: 3,
      cohort: {
        groups: [{ cardIDs: CARD_IDS.slice(0, 8), remainingPileCount: 3, kind: 'partial' }]
      }
    })
    expect(onError).not.toHaveBeenCalled()
  })

  it('全部暗取后协议零张清空物理牌堆，保留仍未确定的身份', () => {
    const { controller, room, onError } = createDiscardRoom()
    controller.syncTrackerMove(anonymousDiscardGain(10))

    controller.syncTrackerMove(shuffleMove(0))

    expectConsistentPile(room, 0)
    expect(room.players.get(3)!.cards).toHaveLength(10)
    expect(room.pileIdentityLedger.getSnapshot().cohort).toMatchObject({
      flatCandidateWidth: 0,
      groups: [{ cardIDs: CARD_IDS, remainingPileCount: 0, kind: 'none-in-pile' }]
    })
    expect(room.pileIdentityLedger.getUnresolvedIdentityIDs()).toEqual(CARD_IDS)
    expect(onError).not.toHaveBeenCalled()
  })

  it('协议张数无法容纳旧明牌时降级其位置，身份仍保留在候选池', () => {
    const { controller, room, onError } = createDiscardRoom(CARD_IDS.slice(0, 8))
    controller.revealTrackerCardsInZone({ id: 255, zone: 1 }, CARD_IDS.slice(8))

    controller.syncTrackerMove(shuffleMove(1))

    expectConsistentPile(room, 1)
    expect(room.zones.get('pile')!.cards.every(isAnonymous)).toBe(true)
    expect(room.pileIdentityLedger.getSnapshot()).toMatchObject({
      knownPileIdentityIDs: [],
      cohort: { groups: [{ cardIDs: CARD_IDS, remainingPileCount: 1, kind: 'partial' }] }
    })
    expect(onError).not.toHaveBeenCalled()
  })

  it('洗牌后继续暗摸、亮牌弃置并再次洗牌，数量与身份仍一致', () => {
    const { controller, room, onError } = createDiscardRoom()
    controller.syncTrackerMove(anonymousDiscardGain(5))
    controller.syncTrackerMove(shuffleMove(5))
    expectConsistentPile(room, 5)

    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 1, ToID: 1 }))
    expect(room.zones.get('pile')!.cards).toHaveLength(4)
    expect(room.pileIdentityLedger.getSnapshot().accountedPileCount).toBe(4)
    controller.revealTrackerCards({ type: 'player', seatID: 3 }, [29])
    controller.syncTrackerMove(
      protocolMove({ CardIDs: [29], FromZone: 5, FromID: 3, ToZone: 2, ToID: 255, MoveType: 4 })
    )
    controller.syncTrackerMove(shuffleMove(5))

    expectConsistentPile(room, 5)
    expect(room.players.get(1)!.cards.filter(isAnonymous)).toHaveLength(1)
    expect(room.players.get(3)!.cards.filter(isAnonymous)).toHaveLength(4)
    expect(onError).not.toHaveBeenCalled()
  })
})
