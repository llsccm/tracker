import { describe, expect, it } from 'vitest'
import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import type { RawMoveCardEvent } from '@/tracker/types'
import {
  createErrorSpy,
  protocolMove,
  createReadyControllerHarness
} from './helpers/trackerController'

const DISCARD_SETUP = {
  cardIDs: [1, 2, 3, 4, 5, 6, 7, 8],
  seatIDs: [1, 3],
  discardIDs: [1, 2, 3, 4, 5, 6]
}

function discardGainMove(overrides: Partial<RawMoveCardEvent> = {}) {
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
    { scenario: '3653 MoveType=8 空 CardIDs', overrides: { SpellID: 3653, MoveType: 8 } },
    {
      scenario: 'MoveType=8 零 ID 占位',
      overrides: { MoveType: 8, CardIDs: [0, 0, 0, 0] }
    },
    { scenario: '3434 MoveType=15 空 CardIDs', overrides: { SpellID: 3434, MoveType: 15 } },
    {
      scenario: '3434 MoveType=15 零 ID 占位',
      overrides: { SpellID: 3434, MoveType: 15, CardIDs: [0, 0, 0, 0] }
    },
    {
      scenario: 'MoveType=15 其他技能牌顶位置',
      overrides: { SpellID: 9999, MoveType: 15, FromPosition: POSITION_TOP }
    },
    {
      scenario: 'MoveType=15 其他技能牌底位置',
      overrides: { SpellID: 9999, MoveType: 15, FromPosition: POSITION_BOTTOM }
    },
    {
      scenario: 'MoveType=15 附带来源席位',
      overrides: { SpellID: 3434, MoveType: 15, FromID: 1 }
    },
    {
      scenario: '其他技能牌顶位置',
      overrides: { SpellID: 9999, FromPosition: POSITION_TOP }
    },
    {
      scenario: '其他技能牌底位置',
      overrides: { SpellID: 9999, FromPosition: POSITION_BOTTOM }
    }
  ])('$scenario 创建四张负 ID 暗手牌，不按弃牌顺序猜测身份', ({ overrides }) => {
    const errorSpy = createErrorSpy()
    const { controller, room } = createReadyControllerHarness(DISCARD_SETUP)
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
      expect(card.isAnonymous).toBe(true)
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
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('3653 连续以 MoveType=15/8 暗取弃牌时保持匿名，不把弃牌顶 129 交给 0 号', () => {
    const errorSpy = createErrorSpy()
    const { controller, room } = createReadyControllerHarness({
      cardIDs: [127, 128, 129, 130],
      seatIDs: [0, 7],
      currentUserID: 0,
      discardIDs: [127, 128, 129]
    })
    const discardBefore = [...room.zones.get('discard')!.cards]
    expect(discardBefore.at(-1)?.id).toBe(129)

    controller.syncTrackerMove(
      discardGainMove({ SpellID: 3653, MoveType: 15, CardCount: 1, ToID: 7 })
    )
    controller.syncTrackerMove(
      discardGainMove({ SpellID: 3653, MoveType: 8, CardCount: 1, ToID: 0 })
    )

    for (const seatID of [7, 0]) {
      const player = room.players.get(seatID)!
      const handCards = player.cards.filter((card) => card.subZone === 'hand')
      expect(handCards).toHaveLength(1)
      expect(handCards[0].id).toBeLessThan(0)
      expect(handCards[0].isKnown).toBe(false)
      expect(player.knownHandCards).toEqual([])
      expect(player.observedHandCount).toBe(1)
      expect(player.unknownCardCount).toBe(1)
    }
    expect(room.zones.get('discard')!.cards).toEqual(discardBefore)
    expect(room.pileIdentityLedger.getSnapshot().knownDiscardIdentityIDs).toEqual([127, 128, 129])
    expect(room.assertPileIdentityLedgerConsistency('test:3653-discard-gain')).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it.each([
    {
      cardIDs: [2, 5, 1, 4],
      knownIDs: [1, 2, 4, 5],
      discardIDs: [3, 6],
      unknownCount: 0,
      moveType: 18
    },
    {
      cardIDs: [2, 0, 5, 0],
      knownIDs: [2, 5],
      discardIDs: [1, 3, 4, 6],
      unknownCount: 2,
      moveType: 18
    },
    {
      cardIDs: [2, 0, 5, 0],
      knownIDs: [2, 5],
      discardIDs: [1, 3, 4, 6],
      unknownCount: 2,
      moveType: 8
    }
  ])('领域 MoveType=$moveType 给出 $cardIDs 时精确移动已知牌，仅为未知部分补位', (testCase) => {
    const errorSpy = createErrorSpy()
    const { room } = createReadyControllerHarness(DISCARD_SETUP)

    room.moveCards(testCase.cardIDs, {
      from: { type: 'public', zone: 'discard', position: POSITION_TOP },
      to: { type: 'player', seatID: 3, subZone: 'hand' },
      cardCount: 4,
      moveType: testCase.moveType
    })

    const player = room.players.get(3)!
    const handCards = player.cards.filter((card) => card.subZone === 'hand')
    expect(handCards).toHaveLength(4)
    expect(handCards.filter((card) => card.isAnonymous)).toHaveLength(testCase.unknownCount)
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
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it.each([
    { scenario: '部分来源', sourceIDs: [2], cardCount: 3, unknownCount: 2, moveType: 18 },
    { scenario: '重复来源', sourceIDs: [2, 2], cardCount: 3, unknownCount: 2, moveType: 18 },
    { scenario: '完整来源', sourceIDs: [2, 5], cardCount: 2, unknownCount: 0, moveType: 18 },
    { scenario: 'MoveType=8 部分来源', sourceIDs: [2], cardCount: 3, unknownCount: 2, moveType: 8 }
  ])('有效 fromSeat 的$scenario 获得保留真实牌并补齐标记区数量', (testCase) => {
    const { room } = createReadyControllerHarness(DISCARD_SETUP)
    const sourceCards = testCase.sourceIDs.map((id) => room.cardIndex.get(id)!)
    const entityCountBefore = room.cards.length

    room.moveCards([], {
      from: { type: 'public', zone: 'discard', position: POSITION_TOP },
      to: { type: 'player', seatID: 3, subZone: 'mark', markSpellID: 4023 },
      triggerSpellID: 4023,
      moveType: testCase.moveType,
      cardCount: testCase.cardCount,
      sourceCards
    })

    const markCards = room.players
      .get(3)!
      .cards.filter((card) => card.subZone === 'mark' && card.spellID === 4023)
    expect(markCards).toHaveLength(testCase.cardCount)
    expect(new Set(markCards.filter((card) => card.id > 0))).toEqual(new Set(sourceCards))
    const placeholders = markCards.filter((card) => card.isAnonymous)
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

  it.each([
    {
      scenario: '手牌且省略 sourceCards',
      seatID: 1,
      fromSeat: 1,
      subZone: 'hand' as const,
      emptySource: false
    },
    {
      scenario: '标记区且 sourceCards 为空',
      seatID: 1,
      fromSeat: 1,
      subZone: 'mark' as const,
      emptySource: true
    },
    {
      scenario: '弹窗区',
      seatID: 255,
      fromSeat: 35,
      subZone: 'mark' as const,
      emptySource: true
    }
  ])('弃牌获得不消费 fromSeat 指向的$scenario', (testCase) => {
    const { room } = createReadyControllerHarness(DISCARD_SETUP)
    const playerSourceCards = [...room.zones.get('pile')!.cards]
    room.moveCards([], {
      from: { type: 'public', zone: 'pile', position: POSITION_TOP },
      to:
        testCase.seatID === 255
          ? { type: 'popup', spaceID: 35 }
          : { type: 'player', seatID: testCase.seatID, subZone: testCase.subZone, markSpellID: 35 },
      triggerSpellID: 35,
      moveType: 1,
      cardCount: 2
    })
    const discardBefore = [...room.zones.get('discard')!.cards]
    const entityCountBefore = room.cards.length
    const sourceOptions = {
      to: { type: 'player', seatID: 3, subZone: 'hand' } as const,
      moveType: 18,
      sourceCards: testCase.emptySource ? [] : undefined
    }

    const gainedCards = room.movement.sources.takeSourceCards(2, {
      ...sourceOptions,
      from: { type: 'public', zone: 'discard', position: 65280 }
    })

    expect(gainedCards).toHaveLength(2)
    expect(gainedCards.every((card) => card.isAnonymous)).toBe(true)
    gainedCards.forEach((card) => {
      expect(playerSourceCards).not.toContain(card)
      expect(card.location).toBe('outside')
    })
    expect(room.cards).toHaveLength(entityCountBefore + 2)
    expect(room.zones.get('discard')!.cards).toEqual(discardBefore)

    // 同一来源随后仍可按正常玩家/标记路径取出，证明弃牌获得没有消费其实体或空间账本。
    const regularSourceCards = room.movement.sources.takeSourceCards(2, {
      ...sourceOptions,
      from:
        testCase.seatID === 255
          ? { type: 'popup', spaceID: 35 }
          : {
              type: 'player',
              seatID: testCase.fromSeat,
              subZone: testCase.subZone,
              markSpellID: 35
            }
    })
    expect(new Set(regularSourceCards)).toEqual(new Set(playerSourceCards))
    expect(room.cards).toHaveLength(entityCountBefore + 2)
  })

  it.each([8, 15, 18])('MoveType=%i 缺少弃牌历史时仍按协议张数创建暗牌', (moveType) => {
    const errorSpy = createErrorSpy()
    const { controller, room } = createReadyControllerHarness({ ...DISCARD_SETUP, discardIDs: [] })

    controller.syncTrackerMove(discardGainMove({ MoveType: moveType }))

    const player = room.players.get(3)!
    expect(player.cards.filter((card) => card.isAnonymous)).toHaveLength(4)
    expect(player.unknownCardCount).toBe(4)
    expect(player.observedHandCount).toBe(4)
    expect(room.zones.get('discard')!.cards).toEqual([])
    expect(room.zones.get('pile')!.cards).toHaveLength(8)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('后续揭示非最新弃牌时正确更新明暗手牌，手牌总数不增加', () => {
    const errorSpy = createErrorSpy()
    const { controller, room } = createReadyControllerHarness(DISCARD_SETUP)
    controller.syncTrackerMove(discardGainMove())

    controller.revealTrackerCards({ type: 'player', seatID: 3 }, [2, 5])

    const player = room.players.get(3)!
    expect(player.knownHandCards.map((card) => card.id).sort((a, b) => a - b)).toEqual([2, 5])
    expect(player.cards.filter((card) => card.isAnonymous)).toHaveLength(2)
    expect(player.observedHandCount).toBe(4)
    expect(player.unknownCardCount).toBe(2)
    expect(room.cards.filter((card) => card.id === 2)).toHaveLength(1)
    expect(room.cards.filter((card) => card.id === 5)).toHaveLength(1)
    expect(room.pileIdentityLedger.getSnapshot().knownDiscardIdentityIDs).toEqual([1, 3, 4, 6])
    expect(room.assertPileIdentityLedgerConsistency('test:discard-gain-reveal')).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('MoveType=19 仍按弃牌端点移动已有实体', () => {
    const errorSpy = createErrorSpy()
    const { controller, room } = createReadyControllerHarness(DISCARD_SETUP)

    controller.syncTrackerMove(discardGainMove({ MoveType: 19 }))

    const player = room.players.get(3)!
    expect(player.knownHandCards.map((card) => card.id).sort((a, b) => a - b)).toEqual([3, 4, 5, 6])
    expect(player.unknownCardCount).toBe(0)
    expect(room.zones.get('discard')!.cards.map((card) => card.id)).toEqual([1, 2])
    expect(room.cards).toHaveLength(8)
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

describe.each([8, 15])('MoveType=%i 弃牌堆明确来源兼容', (moveType) => {
  it('已回填正 ID 时仍精确移动对应实体', () => {
    const errorSpy = createErrorSpy()
    const { controller, room } = createReadyControllerHarness(DISCARD_SETUP)
    const sourceCards = [2, 5].map((id) => room.cardIndex.get(id)!)

    controller.syncTrackerMove(
      discardGainMove({ SpellID: 3434, MoveType: moveType, CardIDs: [2, 5], CardCount: 2 })
    )

    const player = room.players.get(3)!
    expect(new Set(player.knownHandCards)).toEqual(new Set(sourceCards))
    expect(player.cards.filter((card) => card.isAnonymous)).toEqual([])
    expect(player.observedHandCount).toBe(2)
    expect(player.unknownCardCount).toBe(0)
    expect(room.zones.get('discard')!.cards.map((card) => card.id)).toEqual([1, 3, 4, 6])
    expect(room.assertPileIdentityLedgerConsistency('test:known-discard-gain')).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('完整 sourceCards 仍移动指定实体', () => {
    const { room } = createReadyControllerHarness(DISCARD_SETUP)
    const sourceCards = [2, 5].map((id) => room.cardIndex.get(id)!)
    const entityCountBefore = room.cards.length

    room.moveCards([], {
      from: { type: 'public', zone: 'discard', position: POSITION_TOP },
      to: { type: 'player', seatID: 3, subZone: 'hand' },
      moveType,
      cardCount: 2,
      sourceCards
    })

    const player = room.players.get(3)!
    expect(new Set(player.knownHandCards)).toEqual(new Set(sourceCards))
    expect(player.unknownCardCount).toBe(0)
    expect(player.observedHandCount).toBe(2)
    expect(room.cards).toHaveLength(entityCountBefore)
    expect(room.zones.get('discard')!.cards.map((card) => card.id)).toEqual([1, 3, 4, 6])
  })
})
