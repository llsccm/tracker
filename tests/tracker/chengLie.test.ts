import { describe, expect, it, vi } from 'vitest'
import { isAnonymous } from '@/tracker/Card'
import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

describe('骋烈：其他视角的牌顶展示与暗取', () => {
  it.each([{ revealedIDs: [99, 36, 109] }, { revealedIDs: [99] }, { revealedIDs: [] }])(
    '牌顶已展示 $revealedIDs 时按实际端点取牌并保持身份账本一致',
    ({ revealedIDs }) => {
      const onError = vi.fn()
      const { controller } = createTrackerControllerHarness({ onError })
      controller.initTrackerRoom()
      controller.registerTrackerPlayers(
        [0, 1, 6, 7].map((seat) => ({ SeatID: seat, ClientID: seat })),
        7
      )
      controller.initTrackerDeck([99, 36, 109, 10, 11, 12, 13, 14])
      controller.syncTrackerMove(protocolMove({ ToID: 0, CardIDs: [], CardCount: 1 }))
      if (revealedIDs.length > 0) {
        controller.syncTrackerMove(
          protocolMove({
            CardIDs: revealedIDs,
            FromID: 255,
            ToID: 255,
            ToZone: 1,
            MoveType: 21,
            SpellID: 3208
          })
        )
      }

      const room = controller.getTrackerRoom()!
      const pile = room.zones.get('pile')!
      const takenCards = pile.cards.slice(-3)
      const remainingCards = pile.cards.slice(0, -3)
      const move = (overrides: Parameters<typeof protocolMove>[0]) => {
        controller.syncTrackerMove(
          protocolMove({
            CardIDs: [],
            CardCount: 1,
            FromID: 0,
            FromZone: 10,
            FromPosition: POSITION_RANDOM,
            ToID: 0,
            ToZone: 10,
            MoveType: 11,
            SpellID: 3208,
            ...overrides
          })
        )
      }

      move({ FromID: 255, FromZone: 1, CardCount: 3 })
      expect(pile.cards).toEqual(remainingCards)
      expect(new Set(room.zones.get('exchange')!.cards)).toEqual(new Set(takenCards))
      expect(room.assertPileIdentityLedgerConsistency('3208:take')).toEqual([])

      move({ FromZone: 5 })
      move({})
      move({ ToPosition: 0 })
      move({ ToZone: 5 })
      for (const seat of [1, 6, 7]) {
        move({ ToID: seat, ToZone: 4, ToZoneParam: 3208, MoveType: 15 })
        const marks = room.cards.filter(
          (card) => card.location === 'player' && card.owner === seat && card.subZone === 'mark'
        )
        expect(marks).toHaveLength(1)
        expect(marks.every(isAnonymous)).toBe(true)
      }
      for (const seat of [1, 6, 7]) {
        move({
          FromID: seat,
          FromZone: 4,
          FromZoneParam: 3208,
          ToID: 255,
          ToZone: 2,
          ToPosition: POSITION_TOP,
          MoveType: 15
        })
        const discardedKnown = room.zones.get('discard')!.cards.filter((card) => card.id > 0)
        expect(discardedKnown).toHaveLength(
          Math.min([1, 6, 7].indexOf(seat) + 1, revealedIDs.length)
        )
        expect(room.assertPileIdentityLedgerConsistency('3208:discard')).toEqual([])
      }

      expect(pile.cards).toEqual(remainingCards)
      expect(room.pileIdentityLedger.getSnapshot().knownPileIdentityIDs).toEqual([])
      for (const id of revealedIDs) {
        expect(room.cardIndex.get(id)!.location).toBe('discard')
        expect(room.cardIndex.get(id)!.suspended).toBe(false)
      }
      expect(room.zones.get('discard')!.cards).toHaveLength(3)
      expect(room.pileIdentityLedger.getSnapshot().knownDiscardIdentityIDs.sort()).toEqual(
        [...revealedIDs].sort()
      )
      expect(room.zones.get('exchange')!.cards).toHaveLength(0)
      expect(room.getPlayer(0)!.knownHandCards).toHaveLength(0)
      expect(room.getPlayer(0)!.observedHandCount).toBe(1)
      expect(room.hasSkillState('chengLieDiscardQueue')).toBe(false)
      expect(room.assertPileIdentityLedgerConsistency('3208:complete')).toEqual([])
      expect(onError).not.toHaveBeenCalled()

      if (revealedIDs.length > 0) {
        const identity = room.cardIndex.get(revealedIDs[0])!
        const discardCount = room.zones.get('discard')!.cards.length
        controller.syncTrackerMove(
          protocolMove({
            FromID: 255,
            FromZone: 2,
            ToID: 0,
            CardIDs: [identity.id],
            MoveType: 18
          })
        )
        expect(room.cardIndex.get(identity.id)).toBe(identity)
        expect(identity.location).toBe('player')
        expect(identity.owner).toBe(0)
        expect(identity.isKnown).toBe(true)
        expect(room.suspendedKnownCards.has(identity)).toBe(false)
        expect(room.zones.get('discard')!.cards).toHaveLength(discardCount - 1)
        expect(room.assertPileIdentityLedgerConsistency('3208:revealed-again')).toEqual([])
        expect(onError).not.toHaveBeenCalled()
      }

      const returnedIDs = room.zones
        .get('discard')!
        .cards.filter((card) => card.id > 0)
        .map((card) => card.id)
      const shuffledCount = pile.cards.length + room.zones.get('discard')!.cards.length
      controller.syncTrackerMove(
        protocolMove({
          CardIDs: [],
          CardCount: shuffledCount,
          FromZone: 2,
          ToZone: 9,
          MoveType: 255
        })
      )
      expect(pile.cards).toHaveLength(shuffledCount)
      expect(room.zones.get('discard')!.cards).toHaveLength(0)
      for (const id of returnedIDs) {
        expect(room.unlocatedIdentities.has(id)).toBe(true)
        expect([...room.suspendedKnownCards].some((card) => card.id === id)).toBe(false)
      }
      expect(room.assertPileIdentityLedgerConsistency('3208:shuffle')).toEqual([])
      expect(onError).not.toHaveBeenCalled()
    }
  )
})
