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

  function expectSeats(
    cardIDs: number[],
    room: ReturnType<typeof createTestRoom>['room'],
    seats: number[]
  ) {
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
          type:
            transferCount === sourceObservedBefore
              ? 'case:whole-hand-transfer'
              : 'case:one-card-transfer',
          spellID: 209
        }
      })

      expect(room.getPlayer(7).observedHandCount).toBe(expectedSourceAfter)
      expect(room.getPlayer(2).observedHandCount).toBe(expectedTargetAfter)
      expectSeats([...knownIDs, ...hiddenIDs], room, expectedSeats)
      expect(
        Array.from(card112.seats)
          .map(Number)
          .sort((a, b) => a - b)
      ).toEqual(expectedSeats)
    }
  )

  it('后续随机转移会失效旧批次的来源/目标槽位约束', () => {
    const allIDs = [10, 129, 201, 202, 203, 204, 205]
    const { room } = createTestRoom({ cardIDs: allIDs, seatIDs: [2, 7] })
    const sourceCards = allIDs.map((id) => getCard(room, id))

    room.clearCardsFromPublicZones(sourceCards)
    sourceCards.forEach((card) => {
      card.bindCandidates([7], 'hand', null, { known: card.id === 10 })
      if (card.id !== 10) {
        card.isKnown = false
        room.notifyCardChanged(card, { type: 'test:hidden-card' })
      }
    })
    room.getPlayer(2).syncObservedHandCount(0)
    room.getPlayer(7).syncObservedHandCount(allIDs.length)

    room.moveCards([], 'player', {
      fromZone: null,
      fromSeatID: 7,
      fromSubZone: 'hand',
      seatID: 2,
      subZone: 'hand',
      cardCount: allIDs.length,
      sourceEvent: { type: 'case:first-transfer' }
    })

    const firstGroup = Array.from(room.constraintGroups.values()).find(
      (group) => (group.sourceEvent as { type?: string } | null)?.type === 'case:first-transfer'
    )
    expect(firstGroup?.expectedSlotsBySeat.get(2)).toBe(allIDs.length)
    expect(firstGroup?.expectedSlotsBySeat.get(7)).toBe(0)

    // 模拟整手转移后才揭示 129；它仍属于第一次转移的实体批次。
    const card129 = getCard(room, 129)
    card129.confirmKnown()

    room.moveCards([], 'player', {
      fromZone: null,
      fromSeatID: 2,
      fromSubZone: 'hand',
      seatID: 7,
      subZone: 'hand',
      cardCount: 3,
      sourceEvent: { type: 'case:second-transfer' }
    })

    const secondGroup = Array.from(room.constraintGroups.values()).find(
      (group) => (group.sourceEvent as { type?: string } | null)?.type === 'case:second-transfer'
    )
    expect(secondGroup?.expectedSlotsBySeat.get(2)).toBe(4)
    expect(secondGroup?.expectedSlotsBySeat.get(7)).toBe(3)
    expectSeats([10, 129], room, [2, 7])
    ;[2, 7].forEach((seatID) => {
      expect(
        room
          .getPlayer(seatID)
          .candidateHandCards.map((card) => card.id)
          .sort((left, right) => left - right)
      ).toEqual([10, 129])
    })
    expect(firstGroup?.expectedSlotsByLocation.size).toBe(0)
  })
})
