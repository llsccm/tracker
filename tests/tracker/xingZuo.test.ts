import { describe, expect, it, vi } from 'vitest'
import { isAnonymous } from '@/tracker/Card'
import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

function setupExchange(bottomIDs: number[] = [1, 2, 3], handIDs: number[] = []) {
  const onError = vi.fn()
  const { controller } = createTrackerControllerHarness({ onError })
  controller.initTrackerRoom()
  controller.registerTrackerPlayers(
    [1, 4, 7].map((seat) => ({ SeatID: seat, ClientID: seat })),
    1
  )
  controller.initTrackerDeck(Array.from({ length: 20 }, (_, index) => index + 1))
  controller.syncTrackerMove(protocolMove({ ToID: 4, CardCount: 4, CardIDs: handIDs }))
  controller.revealTrackerCardsInZone({ id: 255, zone: 1, pos: POSITION_BOTTOM }, bottomIDs)
  const room = controller.getTrackerRoom()!
  return { controller, room, onError }
}

function exchangeMoves(pileCount = 3, handCount = 4) {
  return [
    { FromID: 255, FromZone: 1, ToID: 7, ToZone: 10, CardCount: pileCount },
    { FromID: 4, FromZone: 5, ToID: 7, ToZone: 10, CardCount: handCount },
    { FromID: 7, FromZone: 10, ToID: 7, ToZone: 10, CardCount: pileCount },
    { FromID: 7, FromZone: 10, ToID: 7, ToZone: 10, CardCount: handCount },
    { FromID: 7, FromZone: 10, ToID: 4, ToZone: 5, CardCount: pileCount },
    {
      FromID: 7,
      FromZone: 10,
      ToID: 255,
      ToZone: 1,
      ToPosition: POSITION_BOTTOM,
      CardCount: handCount
    }
  ].map((move) =>
    protocolMove({
      CardIDs: [],
      FromPosition: POSITION_RANDOM,
      ToPosition: POSITION_TOP,
      MoveType: 11,
      SpellID: 3776,
      ...move
    })
  )
}

describe('兴作：牌堆底部经交换区换入手牌', () => {
  it.each([{ bottomIDs: [1, 2, 3] }, { bottomIDs: [1] }, { bottomIDs: [] }])(
    '底部已知牌 $bottomIDs 在六步交换后仍显示为目标手牌',
    ({ bottomIDs }) => {
      const { controller, room, onError } = setupExchange(bottomIDs)
      const pile = room.zones.get('pile')!
      const originalBottom = pile.cards.slice(0, 3)
      const remainingPile = pile.cards.slice(3)
      const entityCount = room.cards.length
      const moves = exchangeMoves()

      controller.syncTrackerMove(moves[0])
      expect(
        room.zones
          .get('exchange')!
          .cards.map((card) => card.id)
          .sort()
      ).toEqual(originalBottom.map((card) => card.id).sort())
      expect(pile.cards).toEqual(remainingPile)
      expect(room.assertPileIdentityLedgerConsistency('3776:stage')).toEqual([])

      moves.slice(1).forEach((move) => controller.syncTrackerMove(move))

      expect(
        room
          .getPlayer(4)!
          .knownHandCards.map((card) => card.id)
          .sort()
      ).toEqual(bottomIDs)
      expect(room.getPlayer(4)!.observedHandCount).toBe(3)
      expect(room.getPlayer(4)!.unknownCardCount).toBe(3 - bottomIDs.length)
      expect(originalBottom.every((card) => card.location === 'player' && card.owner === 4)).toBe(
        true
      )
      expect(room.getPlayer(7)!.knownHandCards).toEqual([])
      expect(room.zones.get('exchange')!.cards).toEqual([])
      expect(pile.cards.slice(4)).toEqual(remainingPile)
      expect(pile.cards.slice(0, 4).every(isAnonymous)).toBe(true)
      expect(room.cards).toHaveLength(entityCount)
      expect(room.hasSkillState(3776)).toBe(false)
      expect(room.hasSkillState('handExchangeBatches')).toBe(false)
      expect(room.assertPileIdentityLedgerConsistency('3776:complete')).toEqual([])
      expect(onError).not.toHaveBeenCalled()
    }
  )

  it('换出的明暗混合整手回到牌底，明牌只保留底部范围而不猜顺序', () => {
    const { controller, room, onError } = setupExchange([1, 2, 3], [8, 9])
    exchangeMoves().forEach((move) => controller.syncTrackerMove(move))

    expect(
      room
        .getPlayer(4)!
        .knownHandCards.map((card) => card.id)
        .sort()
    ).toEqual([1, 2, 3])
    for (const id of [8, 9]) {
      const card = room.cardIndex.get(id)!
      expect(card.location).toBe('pile')
      expect(card.publicCandidates).toEqual([
        expect.objectContaining({ zone: 'pile', position: 'bottom', count: 4 })
      ])
    }
    expect(room.zones.get('pile')!.cards.slice(0, 4).filter(isAnonymous)).toHaveLength(2)
    expect(room.zones.get('exchange')!.cards).toEqual([])
    expect(room.assertPileIdentityLedgerConsistency('3776:known-return')).toEqual([])
    expect(onError).not.toHaveBeenCalled()
  })

  it('连续发动且第二轮两批张数相同时，仍按来源批次交换', () => {
    const { controller, room, onError } = setupExchange()
    exchangeMoves().forEach((move) => controller.syncTrackerMove(move))
    const secondBottom = room.zones.get('pile')!.cards.slice(0, 3)
    exchangeMoves(3, 3).forEach((move) => controller.syncTrackerMove(move))

    expect(secondBottom.every((card) => card.location === 'player' && card.owner === 4)).toBe(true)
    expect(room.getPlayer(4)!.knownHandCards).toEqual([])
    expect(room.getPlayer(4)!.observedHandCount).toBe(3)
    expect(
      room.zones
        .get('pile')!
        .cards.slice(0, 3)
        .map((card) => card.id)
        .sort()
    ).toEqual([1, 2, 3])
    expect(room.zones.get('exchange')!.cards).toEqual([])
    expect(room.hasSkillState(3776)).toBe(false)
    expect(room.assertPileIdentityLedgerConsistency('3776:second-exchange')).toEqual([])
    expect(onError).not.toHaveBeenCalled()
  })

  it('交换区已有其它批次时，不移动那些实体', () => {
    const { controller, room, onError } = setupExchange()
    controller.syncTrackerMove(protocolMove({ ToZone: 10, ToID: 1, CardIDs: [10] }))
    const otherCard = room.cardIndex.get(10)!
    exchangeMoves().forEach((move) => controller.syncTrackerMove(move))

    expect(room.zones.get('exchange')!.cards).toHaveLength(1)
    expect(room.zones.get('exchange')!.cards[0]).toBe(otherCard)
    expect(
      room
        .getPlayer(4)!
        .knownHandCards.map((card) => card.id)
        .sort()
    ).toEqual([1, 2, 3])
    expect(room.assertPileIdentityLedgerConsistency('3776:other-batch')).toEqual([])
    expect(onError).not.toHaveBeenCalled()
  })

  it('目标视角手牌带正 ID，回手揭示只物化原牌底批次', () => {
    const { controller, room, onError } = setupExchange([1])
    const originalBottom = room.zones.get('pile')!.cards.slice(0, 3)
    const moves = exchangeMoves()
    moves[1].CardIDs = [8, 9, 10, 11]
    moves[4].CardIDs = [1, 2, 3]
    moves.forEach((move) => controller.syncTrackerMove(move))

    expect(
      room
        .getPlayer(4)!
        .knownHandCards.map((card) => card.id)
        .sort()
    ).toEqual([1, 2, 3])
    expect(originalBottom.every((card) => card.location === 'player' && card.owner === 4)).toBe(
      true
    )
    expect(
      room.zones
        .get('pile')!
        .cards.slice(0, 4)
        .map((card) => card.id)
        .sort()
    ).toEqual([10, 11, 8, 9])
    expect(room.zones.get('exchange')!.cards).toEqual([])
    expect(room.cards).toHaveLength(20)
    expect(room.assertPileIdentityLedgerConsistency('3776:visible-return')).toEqual([])
    expect(onError).not.toHaveBeenCalled()
  })
})
