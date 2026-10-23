import { describe, expect, it } from 'vitest'
import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import type { PopupSpaceState } from '@/tracker/room/movement/types'
import { createTestRoom, getCard } from './helpers/room'
import { locationKeys, playerHand, publicLocation } from './helpers/locationCandidates'

describe('Room.moveCards 组合路线', () => {
  it.each([
    { subZone: 'equip', hiddenCount: 0, cardCount: 1 },
    { subZone: 'judge', hiddenCount: 0, cardCount: 1 },
    { subZone: 'equip', hiddenCount: 1, cardCount: 2 }
  ] as const)(
    '未接管的 $subZone 来源移动按张数扣减实体（暗牌 $hiddenCount，移动 $cardCount）',
    ({ subZone, hiddenCount, cardCount }) => {
      const { room } = createTestRoom({ cardIDs: [11, 12, 13], seatIDs: [1, 2] })
      const cards = [11, 12, 13].map((id) => getCard(room, id)!)
      room.clearCardsFromPublicZones(cards)
      cards.forEach((card, index) => {
        card.bindCandidates([1], subZone, null, { known: index >= hiddenCount })
      })
      const targetPlayer = room.getPlayer(2)!
      targetPlayer.syncObservedHandCount(0)

      room.moveCards([], 'player', {
        fromZone: null,
        fromSeatID: 1,
        fromSubZone: subZone,
        toSeatID: 2,
        subZone: 'hand',
        cardCount,
        sourceEvent: { type: 'test:visible-subzone-count-only-transfer' }
      })

      const sourceCards = room.playerCardsSnapshot.filter(
        (card) => card.subZone === subZone && card.resolvedSeat === 1
      )
      const targetCards = room.playerCardsSnapshot.filter(
        (card) => card.subZone === 'hand' && card.resolvedSeat === 2
      )
      expect(sourceCards).toHaveLength(cards.length - cardCount)
      expect(targetCards).toHaveLength(cardCount)
      expect(targetCards.every((card) => cards.includes(card))).toBe(true)
      expect(targetPlayer.observedHandCount).toBe(cardCount)
      expect(room.cards).toHaveLength(cards.length)
    }
  )

  it('已知牌与暗牌混合移入玩家手牌时保留数量与身份边界', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1] })
    const knownCard = getCard(room, 1)

    room.moveCards([1, 0], 'player', {
      toSeatID: 1,
      subZone: 'hand',
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'test:mixed-known-hidden-to-hand' }
    })

    const handCards = room.cards.filter(
      (card) => card.location === 'player' && card.subZone === 'hand' && card.seats.has(1)
    )
    const hiddenCards = handCards.filter((card) => card.isKnown !== true)

    expect(knownCard.location).toBe('player')
    expect(knownCard.subZone).toBe('hand')
    expect(knownCard.isKnown).toBe(true)
    expect(knownCard.seats.has(1)).toBe(true)
    expect(handCards).toHaveLength(2)
    expect(hiddenCards).toHaveLength(1)
    expect(room.zones.get('pile').cards).not.toContain(knownCard)
  })

  it('弹窗暗占位回到牌堆时复用原实体', () => {
    const { room } = createTestRoom({ cardIDs: [31, 71, 97, 32, 92, 150], seatIDs: [1] })

    room.moveCards([], 'popup', {
      toPopupSpaceID: 35,
      fromZone: 'pile',
      cardCount: 5,
      position: POSITION_TOP,
      sourceEvent: { type: 'test:popup-mark-placeholders' }
    })

    const popupPlaceholders = room.cards.filter(
      (card) => card.location === 'popup' && card.popupSpaceID === 35 && card.isKnown !== true
    )

    expect(popupPlaceholders).toHaveLength(5)
    popupPlaceholders.forEach((card) => {
      expect(card.seats.size).toBe(0)
    })
    const popupState = room.readSkillState<PopupSpaceState>('popupSpaces')!
    expect(popupState.spaces.get(35)).toEqual(expect.arrayContaining(popupPlaceholders))
    expect(popupState.spaces.get(35)).toHaveLength(5)

    room.moveCards([], 'pile', {
      fromZone: 'popup',
      fromPopupSpaceID: 35,
      cardCount: 4,
      position: POSITION_TOP,
      fromPosition: 65282,
      sourceEvent: { type: 'test:popup-mark-return-to-pile' }
    })

    const pileCards = room.zones.get('pile').cards

    // 回牌堆必须复用原占位实体，不能额外创建匿名回退实体。
    expect(room.cards).toHaveLength(6)
    expect(popupPlaceholders.filter((card) => pileCards.includes(card))).toHaveLength(4)
    const remainingPopupPlaceholders = popupPlaceholders.filter((card) => card.location === 'popup')
    expect(remainingPopupPlaceholders).toHaveLength(1)
    expect(popupState.spaces.get(35)).toEqual(remainingPopupPlaceholders)
  })

  it('弹窗回牌堆按空间 ID 隔离来源', () => {
    const { room } = createTestRoom({ cardIDs: [31, 32, 71, 72, 150], seatIDs: [1] })

    room.moveCards([], 'popup', {
      toPopupSpaceID: 35,
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'test:popup-mark-35' }
    })
    room.moveCards([], 'popup', {
      toPopupSpaceID: 36,
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'test:popup-mark-36' }
    })

    const popupState = room.readSkillState<PopupSpaceState>('popupSpaces')!
    const spell35Cards = [...popupState.spaces.get(35)]
    const spell36Cards = [...popupState.spaces.get(36)]

    room.moveCards([], 'pile', {
      fromZone: 'popup',
      fromPopupSpaceID: 35,
      cardCount: 1,
      position: POSITION_TOP,
      sourceEvent: { type: 'test:popup-mark-return-with-from-id-only' }
    })

    const pileCards = room.zones.get('pile').cards

    // 回牌堆必须复用原占位实体，不能额外创建匿名回退实体。
    expect(room.cards).toHaveLength(5)
    expect(spell35Cards.filter((card) => pileCards.includes(card))).toHaveLength(1)
    expect(spell36Cards.some((card) => pileCards.includes(card))).toBe(false)
    expect(popupState.spaces.get(35)).toHaveLength(1)
    expect(popupState.spaces.get(36)).toEqual(spell36Cards)
  })

  it('显式来源牌取走弹窗 占位时同步清理空间账本', () => {
    const { room } = createTestRoom({ cardIDs: [31, 71, 97], seatIDs: [1] })

    room.moveCards([], 'popup', {
      toPopupSpaceID: 35,
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'test:popup-mark-explicit-source' }
    })

    const popupState = room.readSkillState<PopupSpaceState>('popupSpaces')!
    const explicitSourceCard = popupState.spaces.get(35)[0]

    room.moveCards([], 'pile', {
      fromZone: 'popup',
      fromPopupSpaceID: 35,
      sourceCards: [explicitSourceCard],
      cardCount: 1,
      position: POSITION_TOP,
      sourceEvent: { type: 'test:explicit-seatless-mark-to-pile' }
    })

    expect(room.zones.get('pile').cards).toContain(explicitSourceCard)
    expect(popupState.spaces.get(35)).not.toContain(explicitSourceCard)
    expect(popupState.spaces.get(35)).toHaveLength(1)
  })

  it('已知牌置换弹窗 时将回补暗占位重新入账', () => {
    const { room } = createTestRoom({ cardIDs: [31, 71, 97], seatIDs: [1] })
    const knownMarkCard = getCard(room, 31)

    room.moveCards([31], 'popup', {
      toPopupSpaceID: 35,
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'test:known-seatless-mark' }
    })
    room.moveCards([], 'player', {
      toSeatID: 1,
      subZone: 'hand',
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'test:unknown-hand-placeholder' }
    })

    const handPlaceholder = room.cards.find(
      (card) =>
        card.location === 'player' &&
        card.subZone === 'hand' &&
        card.seats.has(1) &&
        card.isKnown !== true
    )
    if (!handPlaceholder) throw new Error('expected unknown hand placeholder')

    room.moveCards([31], 'discard', {
      fromSeatID: 1,
      fromZone: null,
      fromSubZone: 'hand',
      cardCount: 1,
      sourceEvent: { type: 'test:known-source-replaced-from-hand' }
    })

    const popupState = room.readSkillState<PopupSpaceState>('popupSpaces')!

    expect(knownMarkCard.location).toBe('discard')
    expect(room.zones.get('discard').cards).toContain(knownMarkCard)
    expect(handPlaceholder.location).toBe('popup')
    expect(handPlaceholder.subZone).toBeNull()
    expect(handPlaceholder.popupSpaceID).toBe(35)
    expect(handPlaceholder.seats.size).toBe(0)
    expect(popupState.spaces.get(35)).toEqual([handPlaceholder])
  })

  it('弹窗明牌进入弃牌堆后不残留玩家快照', () => {
    const { room } = createTestRoom({ cardIDs: [87, 41, 12], seatIDs: [7] })
    const takenCard = getCard(room, 87)
    const discardedCard = getCard(room, 41)

    room.moveCards([87, 41], 'popup', {
      toPopupSpaceID: 3544,
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'test:spell-3544-popup-mark' }
    })

    room.moveCards([87], 'player', {
      toSeatID: 7,
      fromZone: 'popup',
      fromPopupSpaceID: 3544,
      subZone: 'hand',
      spellID: 3544,
      cardCount: 1,
      sourceEvent: { type: 'test:spell-3544-take-known' }
    })

    room.moveCards([41], 'discard', {
      fromZone: 'popup',
      fromPopupSpaceID: 3544,
      spellID: 3544,
      cardCount: 1,
      sourceEvent: { type: 'test:spell-3544-discard-known' }
    })

    expect(takenCard.location).toBe('player')
    expect(takenCard.subZone).toBe('hand')
    expect(discardedCard.location).toBe('discard')
    expect(room.zones.get('discard').cards).toContain(discardedCard)
    expect(room.refreshPlayerSnapshot()).toEqual([takenCard])
  })

  it('暗牌从玩家到玩家时把来源明牌传播为双方候选', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1, 2] })
    const cards = [1, 2].map((id) => getCard(room, id))

    room.moveCards([1, 2], 'player', {
      toSeatID: 1,
      subZone: 'hand',
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'test:source-known-hand' }
    })
    room.syncObservedPlayerHandCount(1, 2)

    room.moveCards([0], 'player', {
      toSeatID: 2,
      fromSeatID: 1,
      fromZone: null,
      fromSubZone: 'hand',
      subZone: 'hand',
      cardCount: 1,
      sourceEvent: { type: 'test:hidden-hand-transfer' }
    })

    cards.forEach((card) => {
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('hand')
      expect(Array.from(card.seats).sort()).toEqual([1, 2])
    })
    expect(room.locationIndex.candidateHandBySeat.get(1)).toEqual(expect.arrayContaining(cards))
    expect(room.locationIndex.candidateHandBySeat.get(2)).toEqual(expect.arrayContaining(cards))
  })

  it('玩家来源明牌仍残留公共区时用暗占位回补旧公共槽位', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1] })
    const stalePublicCard = getCard(room, 1)

    stalePublicCard.bindCandidates([1], 'hand', null, { known: true })
    room.syncObservedPlayerHandCount(1, 1)

    room.moveCards([1], 'discard', {
      fromSeatID: 1,
      fromZone: null,
      fromSubZone: 'hand',
      cardCount: 1,
      sourceEvent: { type: 'test:known-source-stale-public' }
    })

    expect(stalePublicCard.location).toBe('discard')
    expect(room.zones.get('pile').cards).not.toContain(stalePublicCard)
    expect(room.zones.get('pile').cards.some((card) => card.isKnown !== true)).toBe(true)
  })

  it('公共区候选位置被摸走后传播到玩家手牌候选', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1] })
    const first = getCard(room, 1)
    const second = getCard(room, 2)
    const pileTop = publicLocation('pile', 'top', 2)
    const targetHand = playerHand(1)

    ;[first, second].forEach((card) => {
      card.confirmKnown()
      card.setLocationCandidates([pileTop])
    })

    room.moveCards([0], 'player', {
      toSeatID: 1,
      subZone: 'hand',
      fromZone: 'pile',
      fromPosition: POSITION_TOP,
      cardCount: 1,
      sourceEvent: { type: 'test:draw-public-candidate-route' }
    })
    //
    ;[first, second].forEach((card) => {
      expect(locationKeys(card)).toEqual(
        [
          createLocationCandidateKey(publicLocation('pile', 'top', 1)),
          createLocationCandidateKey(targetHand)
        ].sort()
      )
    })
  })

  it('玩家手牌数归零时剔除手牌候选并保留非手牌候选', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1] })
    const card = getCard(room, 1)
    const hand = playerHand(1)
    const pileTop = publicLocation('pile', 'top', 1)

    card.confirmKnown()
    card.setLocationCandidates([hand, pileTop])

    room.syncObservedPlayerHandCount(1, 0)

    expect(locationKeys(card)).toEqual([createLocationCandidateKey(pileTop)])
    expect(room.locationIndex.candidateHandBySeat.get(1)).not.toContain(card)
  })
})
