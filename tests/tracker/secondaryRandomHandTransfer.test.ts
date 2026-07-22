import { describe, expect, it } from 'vitest'
import { createTestRoom, getCard } from './helpers/room'

describe('二次随机手牌转移时的候选传播', () => {
  function setupAmbiguousHand() {
    const knownIDs = [112]
    const hiddenIDs = [201, 202, 203, 204, 205]
    const allIDs = [...knownIDs, ...hiddenIDs]
    const { room } = createTestRoom({ cardIDs: allIDs, seatIDs: [0, 2, 7] })

    const sourceCards = allIDs.map((id) => getCard(room, id))
    room.clearCardsFromPublicZones(sourceCards)
    sourceCards.forEach((card) => {
      card.bindCandidates([0], 'hand', null, { known: knownIDs.includes(card.id) })
      if (hiddenIDs.includes(card.id)) {
        card.isKnown = false
        room.notifyCardChanged(card, { type: 'test:hidden-card' })
      }
    })
    room.getPlayer(0).syncObservedHandCount(6)
    room.getPlayer(2).syncObservedHandCount(0)
    room.getPlayer(7).syncObservedHandCount(0)

    // 先形成 0/7 双边候选，供后续 7->2 二次转移使用。
    room.moveCards([], 'player', {
      fromZone: null,
      fromSeatID: 0,
      fromSubZone: 'hand',
      seatID: 7,
      subZone: 'hand',
      cardCount: 2,
      sourceEvent: { type: 'seed:random-partial-transfer' }
    })

    return { room, knownIDs, hiddenIDs, allIDs }
  }

  function expectSeats(cardIDs: number[], room: ReturnType<typeof createTestRoom>['room'], seats: number[]) {
    cardIDs.forEach((id) => {
      expect(
        Array.from(getCard(room, id).seats)
          .map((seatID) => Number(seatID))
          .sort((a, b) => a - b)
      ).toEqual(seats)
    })
  }

  it.each([
    {
      name: '1 张手牌',
      transferCount: 1,
      sourceObservedBefore: 2,
      expectedSourceAfter: 1,
      expectedTargetAfter: 1,
      expectedSeats: [0, 2, 7]
    },
    {
      name: '全部手牌',
      transferCount: 7,
      sourceObservedBefore: 7,
      expectedSourceAfter: 0,
      expectedTargetAfter: 7,
      expectedSeats: [0, 2]
    }
  ])(
    '二次暗转移（$name）应把目标座位写入已有完整位置候选',
    ({
      transferCount,
      sourceObservedBefore,
      expectedSourceAfter,
      expectedTargetAfter,
      expectedSeats
    }) => {
      const { room, knownIDs, hiddenIDs } = setupAmbiguousHand()
      const card112 = getCard(room, 112)

      expectSeats([112], room, [0, 7])
      expect(room.getPlayer(0).observedHandCount).toBe(4)
      expect(room.getPlayer(7).observedHandCount).toBe(2)

      // 全部手牌场景会把 7 号位观测总数抬到协议整手数，再做整手暗转移。
      room.getPlayer(7).syncObservedHandCount(sourceObservedBefore)
      room.moveCards([], 'player', {
        fromZone: null,
        fromSeatID: 7,
        fromSubZone: 'hand',
        seatID: 2,
        subZone: 'hand',
        cardCount: transferCount,
        sourceEvent: {
          type: transferCount === sourceObservedBefore ? 'case:whole-hand-transfer' : 'case:one-card-transfer',
          spellID: 209
        }
      })

      expect(room.getPlayer(7).observedHandCount).toBe(expectedSourceAfter)
      expect(room.getPlayer(2).observedHandCount).toBe(expectedTargetAfter)
      expectSeats([...knownIDs, ...hiddenIDs], room, expectedSeats)
      expect(Array.from(card112.seats).map(Number).sort((a, b) => a - b)).toEqual(expectedSeats)
    }
  )
})