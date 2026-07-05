import { describe, expect, it } from 'vitest'
import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import { createTestRoom, getCard } from './helpers/room'
import { locationKeys, playerHand, publicLocation } from './helpers/locationCandidates'

describe('Room.moveCards 组合路线', () => {
  it('已知牌与暗牌混合移入玩家手牌时保留数量与身份边界', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1] })
    const knownCard = getCard(room, 1)

    room.moveCards([1, 0], 'player', {
      seatID: 1,
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

  it('无席位弹窗标记暗占位回到牌堆时复用原实体', () => {
    const { room } = createTestRoom({ cardIDs: [31, 71, 97, 32, 92, 150], seatIDs: [1] })

    room.moveCards([], 'player', {
      seatID: 255,
      subZone: 'mark',
      spellID: 35,
      fromZone: 'pile',
      cardCount: 5,
      position: POSITION_TOP,
      sourceEvent: { type: 'test:popup-mark-placeholders' }
    })

    const markPlaceholders = room.cards.filter(
      (card) =>
        card.location === 'player' &&
        card.subZone === 'mark' &&
        card.spellID === 35 &&
        card.isKnown !== true
    )

    expect(markPlaceholders).toHaveLength(5)
    markPlaceholders.forEach((card) => {
      expect(card.seats.size).toBe(0)
    })
    const markSpaceState = room.skillState.get('unassignedMarkSpaces')
    expect(markSpaceState.spaces.get(35)).toEqual(expect.arrayContaining(markPlaceholders))
    expect(markSpaceState.spaces.get(35)).toHaveLength(5)

    room.moveCards([], 'pile', {
      fromSeatID: 35,
      fromZone: null,
      fromSubZone: 'mark',
      fromSpellID: 35,
      subZone: 'mark',
      spellID: 35,
      cardCount: 4,
      position: POSITION_TOP,
      fromPosition: 65282,
      sourceEvent: { type: 'test:popup-mark-return-to-pile' }
    })

    const pileCards = room.zones.get('pile').cards

    expect(room.cards.filter((card) => card.id === 0)).toHaveLength(0)
    expect(markPlaceholders.filter((card) => pileCards.includes(card))).toHaveLength(4)
    const remainingMarkPlaceholders = markPlaceholders.filter((card) => card.location === 'player')
    expect(remainingMarkPlaceholders).toHaveLength(1)
    expect(markSpaceState.spaces.get(35)).toEqual(remainingMarkPlaceholders)
  })

  it('弹窗标记回牌堆缺少显式 spell 时用 FromID 定位无席位空间', () => {
    const { room } = createTestRoom({ cardIDs: [31, 32, 71, 72, 150], seatIDs: [1] })

    room.moveCards([], 'player', {
      seatID: 255,
      subZone: 'mark',
      spellID: 35,
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'test:popup-mark-35' }
    })
    room.moveCards([], 'player', {
      seatID: 255,
      subZone: 'mark',
      spellID: 36,
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'test:popup-mark-36' }
    })

    const markSpaceState = room.skillState.get('unassignedMarkSpaces')
    const spell35Cards = [...markSpaceState.spaces.get(35)]
    const spell36Cards = [...markSpaceState.spaces.get(36)]

    room.moveCards([], 'pile', {
      fromSeatID: 35,
      fromZone: null,
      fromSubZone: 'mark',
      cardCount: 1,
      position: POSITION_TOP,
      sourceEvent: { type: 'test:popup-mark-return-with-from-id-only' }
    })

    const pileCards = room.zones.get('pile').cards

    expect(room.cards.filter((card) => card.id === 0)).toHaveLength(0)
    expect(spell35Cards.filter((card) => pileCards.includes(card))).toHaveLength(1)
    expect(spell36Cards.some((card) => pileCards.includes(card))).toBe(false)
    expect(markSpaceState.spaces.get(35)).toHaveLength(1)
    expect(markSpaceState.spaces.get(36)).toEqual(spell36Cards)
  })

  it('显式来源牌取走无席位 mark 占位时同步清理空间账本', () => {
    const { room } = createTestRoom({ cardIDs: [31, 71, 97], seatIDs: [1] })

    room.moveCards([], 'player', {
      seatID: 255,
      subZone: 'mark',
      spellID: 35,
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'test:popup-mark-explicit-source' }
    })

    const markSpaceState = room.skillState.get('unassignedMarkSpaces')
    const explicitSourceCard = markSpaceState.spaces.get(35)[0]

    room.moveCards([], 'pile', {
      fromSeatID: 35,
      fromZone: null,
      fromSubZone: 'mark',
      fromSpellID: 35,
      subZone: 'mark',
      spellID: 35,
      sourceCards: [explicitSourceCard],
      cardCount: 1,
      position: POSITION_TOP,
      sourceEvent: { type: 'test:explicit-seatless-mark-to-pile' }
    })

    expect(room.zones.get('pile').cards).toContain(explicitSourceCard)
    expect(markSpaceState.spaces.get(35)).not.toContain(explicitSourceCard)
    expect(markSpaceState.spaces.get(35)).toHaveLength(1)
  })

  it('已知牌置换无席位 mark 时将回补暗占位重新入账', () => {
    const { room } = createTestRoom({ cardIDs: [31, 71, 97], seatIDs: [1] })
    const knownMarkCard = getCard(room, 31)

    room.moveCards([31], 'player', {
      seatID: 255,
      subZone: 'mark',
      spellID: 35,
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'test:known-seatless-mark' }
    })
    room.moveCards([], 'player', {
      seatID: 1,
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

    const markSpaceState = room.skillState.get('unassignedMarkSpaces')

    expect(knownMarkCard.location).toBe('discard')
    expect(room.zones.get('discard').cards).toContain(knownMarkCard)
    expect(handPlaceholder.location).toBe('player')
    expect(handPlaceholder.subZone).toBe('mark')
    expect(handPlaceholder.spellID).toBe(35)
    expect(handPlaceholder.seats.size).toBe(0)
    expect(markSpaceState.spaces.get(35)).toEqual([handPlaceholder])
  })

  it('无席位弹窗 mark 明牌进入弃牌堆时刷新 player 快照', () => {
    const { room } = createTestRoom({ cardIDs: [87, 41, 12], seatIDs: [7] })
    const takenCard = getCard(room, 87)
    const discardedCard = getCard(room, 41)

    room.moveCards([87, 41], 'player', {
      seatID: 255,
      subZone: 'mark',
      spellID: 3544,
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'test:spell-3544-popup-mark' }
    })

    room.moveCards([87], 'player', {
      seatID: 7,
      fromSeatID: 216,
      fromZone: null,
      fromSubZone: 'mark',
      fromSpellID: 3544,
      subZone: 'hand',
      spellID: 3544,
      cardCount: 1,
      sourceEvent: { type: 'test:spell-3544-take-known' }
    })

    room.moveCards([41], 'discard', {
      fromSeatID: 216,
      fromZone: null,
      fromSubZone: 'mark',
      fromSpellID: 3544,
      subZone: 'mark',
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
      seatID: 1,
      subZone: 'hand',
      fromZone: 'pile',
      cardCount: 2,
      sourceEvent: { type: 'test:source-known-hand' }
    })
    room.syncObservedPlayerHandCount(1, 2)

    room.moveCards([0], 'player', {
      seatID: 2,
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
      seatID: 1,
      subZone: 'hand',
      fromZone: 'pile',
      fromPosition: POSITION_TOP,
      cardCount: 1,
      sourceEvent: { type: 'test:draw-public-candidate-route' }
    })
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
