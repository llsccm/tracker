import { describe, expect, it, vi } from 'vitest'
import { isAnonymous } from '@/tracker/Card'
import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import type { RawMoveCardEvent } from '@/tracker/types'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

function createRoomWithDiscard(discardIDs = [1, 2, 3, 4, 5, 6]) {
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
  controller.initTrackerDeck([1, 2, 3, 4, 5, 6, 7, 8])
  if (discardIDs.length > 0) {
    controller.syncTrackerMove(
      protocolMove({ CardIDs: discardIDs, ToZone: 2, ToID: 255, MoveType: 16 })
    )
  }

  const room = controller.getTrackerRoom()!
  return { controller, room, onError }
}

function discardGainMove(overrides: RawMoveCardEvent = {}) {
  return protocolMove({
    CardCount: 4,
    CardIDs: [],
    FromID: 255,
    FromPosition: POSITION_RANDOM,
    FromZone: 2,
    MoveType: 18,
    SpellID: 4023,
    ToID: 3,
    ToPosition: POSITION_TOP,
    ToZone: 5,
    ...overrides
  })
}

describe('弃牌堆未知获得', () => {
  it.each([
    { scenario: '4023 空 CardIDs', overrides: {} },
    { scenario: '零 ID 占位', overrides: { CardIDs: [0, 0, 0, 0] } },
    {
      scenario: '其他技能牌顶位置',
      overrides: { SpellID: 9999, FromPosition: POSITION_TOP }
    },
    {
      scenario: '其他技能牌底位置',
      overrides: { SpellID: 9999, FromPosition: POSITION_BOTTOM }
    }
  ])('$scenario 创建四张负 ID 暗手牌，不按弃牌顺序猜测身份', ({ overrides }) => {
    const { controller, room, onError } = createRoomWithDiscard()
    const discardBefore = [...room.zones.get('discard')!.cards]
    const pileBefore = [...room.zones.get('pile')!.cards]
    const message = discardGainMove(overrides)
    const cardIDsBefore = [...(message.CardIDs as number[])]

    controller.syncTrackerMove(message)

    const player = room.players.get(3)!
    const handCards = player.cards.filter((card) => card.subZone === 'hand')
    expect(handCards).toHaveLength(4)
    expect(new Set(handCards.map((card) => card.id)).size).toBe(4)
    handCards.forEach((card) => {
      expect(isAnonymous(card)).toBe(true)
      expect(card.id).toBeLessThan(0)
      expect(card.entityID).toBe(card.id)
      expect(card.isKnown).toBe(false)
      expect(card.owner).toBe(3)
    })
    expect(player.observedHandCount).toBe(4)
    expect(player.unknownCardCount).toBe(4)
    expect(player.knownHandCards).toEqual([])
    expect(room.zones.get('discard')!.cards).toEqual(discardBefore)
    expect(room.zones.get('pile')!.cards).toEqual(pileBefore)
    expect(room.pileIdentityLedger.getSnapshot().knownDiscardIdentityIDs).toEqual([
      1, 2, 3, 4, 5, 6
    ])
    expect(room.assertPileIdentityLedgerConsistency('test:anonymous-discard-gain')).toEqual([])
    expect(message.CardIDs).toEqual(cardIDsBefore)
    expect(onError).not.toHaveBeenCalled()
  })

  it.each([
    { cardIDs: [2, 5, 1, 4], knownIDs: [1, 2, 4, 5], discardIDs: [3, 6], unknownCount: 0 },
    { cardIDs: [2, 0, 5, 0], knownIDs: [2, 5], discardIDs: [1, 3, 4, 6], unknownCount: 2 }
  ])('协议给出 $cardIDs 时精确移动已知牌，仅为未知部分补位', (testCase) => {
    const { controller, room, onError } = createRoomWithDiscard()

    controller.syncTrackerMove(discardGainMove({ CardIDs: testCase.cardIDs }))

    const player = room.players.get(3)!
    const handCards = player.cards.filter((card) => card.subZone === 'hand')
    expect(handCards).toHaveLength(4)
    expect(handCards.filter(isAnonymous)).toHaveLength(testCase.unknownCount)
    expect(player.knownHandCards.map((card) => card.id).sort((a, b) => a - b)).toEqual(
      testCase.knownIDs
    )
    expect(player.observedHandCount).toBe(4)
    expect(player.unknownCardCount).toBe(testCase.unknownCount)
    expect(room.zones.get('discard')!.cards.map((card) => card.id)).toEqual(testCase.discardIDs)
    expect(room.pileIdentityLedger.getSnapshot().knownDiscardIdentityIDs).toEqual(
      testCase.discardIDs
    )
    expect(room.assertPileIdentityLedgerConsistency('test:known-discard-gain')).toEqual([])
    expect(onError).not.toHaveBeenCalled()
  })

  it.each([
    { scenario: '部分来源', sourceIDs: [2], cardCount: 3, unknownCount: 2 },
    { scenario: '重复来源', sourceIDs: [2, 2], cardCount: 3, unknownCount: 2 },
    { scenario: '完整来源', sourceIDs: [2, 5], cardCount: 2, unknownCount: 0 }
  ])('有效 fromSeat 的$scenario 获得保留真实牌并补齐标记区数量', (testCase) => {
    const { room } = createRoomWithDiscard()
    const sourceCards = testCase.sourceIDs.map((id) => room.cardIndex.get(id)!)
    const entityCountBefore = room.cards.length

    room.moveCards([], 'player', {
      fromZone: 'discard',
      fromSeatID: 1,
      fromSubZone: 'mark',
      seatID: 3,
      subZone: 'mark',
      spellID: 4023,
      moveType: 18,
      cardCount: testCase.cardCount,
      sourceCards
    })

    const markCards = room.players
      .get(3)!
      .cards.filter((card) => card.subZone === 'mark' && card.spellID === 4023)
    expect(markCards).toHaveLength(testCase.cardCount)
    expect(new Set(markCards.filter((card) => card.id > 0))).toEqual(new Set(sourceCards))
    const placeholders = markCards.filter(isAnonymous)
    expect(placeholders).toHaveLength(testCase.unknownCount)
    expect(new Set(placeholders.map((card) => card.id)).size).toBe(testCase.unknownCount)
    placeholders.forEach((card) => {
      expect(card.id).toBeLessThan(0)
      expect(card.entityID).toBe(card.id)
      expect(card.isKnown).toBe(false)
      expect(card.owner).toBe(3)
    })
    expect(room.cards).toHaveLength(entityCountBefore + testCase.unknownCount)
    expect(sourceCards.map((card) => card.id)).toEqual(testCase.sourceIDs)
  })

  it('缺少弃牌历史时仍按协议张数创建暗牌', () => {
    const { controller, room, onError } = createRoomWithDiscard([])

    controller.syncTrackerMove(discardGainMove())

    const player = room.players.get(3)!
    expect(player.cards.filter(isAnonymous)).toHaveLength(4)
    expect(player.unknownCardCount).toBe(4)
    expect(player.observedHandCount).toBe(4)
    expect(room.zones.get('discard')!.cards).toEqual([])
    expect(room.zones.get('pile')!.cards).toHaveLength(8)
    expect(onError).not.toHaveBeenCalled()
  })

  it('后续揭示非最新弃牌时正确更新明暗手牌，手牌总数不增加', () => {
    const { controller, room, onError } = createRoomWithDiscard()
    controller.syncTrackerMove(discardGainMove())

    controller.revealTrackerCards({ type: 'player', seatID: 3 }, [2, 5])

    const player = room.players.get(3)!
    expect(player.knownHandCards.map((card) => card.id).sort((a, b) => a - b)).toEqual([2, 5])
    expect(player.cards.filter(isAnonymous)).toHaveLength(2)
    expect(player.observedHandCount).toBe(4)
    expect(player.unknownCardCount).toBe(2)
    expect(room.cards.filter((card) => card.id === 2)).toHaveLength(1)
    expect(room.cards.filter((card) => card.id === 5)).toHaveLength(1)
    expect(room.pileIdentityLedger.getSnapshot().knownDiscardIdentityIDs).toEqual([1, 3, 4, 6])
    expect(room.assertPileIdentityLedgerConsistency('test:discard-gain-reveal')).toEqual([])
    expect(onError).not.toHaveBeenCalled()
  })

  it('其他移动类型仍按弃牌端点移动已有实体', () => {
    const { controller, room, onError } = createRoomWithDiscard()

    controller.syncTrackerMove(discardGainMove({ MoveType: 15 }))

    const player = room.players.get(3)!
    expect(player.knownHandCards.map((card) => card.id).sort((a, b) => a - b)).toEqual([3, 4, 5, 6])
    expect(player.unknownCardCount).toBe(0)
    expect(room.zones.get('discard')!.cards.map((card) => card.id)).toEqual([1, 2])
    expect(room.cards).toHaveLength(8)
    expect(onError).not.toHaveBeenCalled()
  })
})
