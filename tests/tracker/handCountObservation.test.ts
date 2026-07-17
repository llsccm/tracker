import { describe, expect, it, vi } from 'vitest'
import { trackerLogger } from '@/utils/logger'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import { createTestRoom, getCard } from './helpers/room'
import { playerLocation } from './helpers/locationCandidates'

describe('玩家手牌数观测', () => {
  it('未观测时负向 delta 不建立 0 张手牌快照', () => {
    const { room } = createTestRoom({ seatIDs: [1] })
    const player = room.getPlayer(1)

    player.applyObservedHandCountDelta(-1)

    expect(player.hasObservedHandCount).toBe(false)
    expect(player.observedHandCount).toBe(0)
    expect(player.unknownCardCount).toBe(0)

    player.syncObservedHandCount(3)
    player.applyObservedHandCountDelta(-1)

    expect(player.hasObservedHandCount).toBe(true)
    expect(player.observedHandCount).toBe(2)
  })

  it('未观测来源手牌传播时不把默认 0 当作真实手牌数', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1, 2] })
    const first = getCard(room, 1)
    const second = getCard(room, 2)
    const sourcePlayer = room.getPlayer(1)

    room.clearCardsFromPublicZones([first, second])
    ;[first, second].forEach((card) => {
      card.bindCandidates([1], 'hand', null, { known: true })
    })

    expect(sourcePlayer.hasObservedHandCount).toBe(false)

    const candidateCards = room.movement.markRandomHandTransferCandidates({
      fromSeat: 1,
      targetSeat: 2,
      count: 1,
      sourceEvent: { type: 'test:random-hand-transfer' }
    })
    const group = Array.from(room.constraintGroups.values()).find(
      (constraintGroup) =>
        (constraintGroup.sourceEvent as { type?: string } | null)?.type ===
        'test:random-hand-transfer'
    )

    expect(candidateCards).toEqual([first, second])
    expect(group.expectedSlotsBySeat.get(1)).toBe(1)
    expect(group.expectedSlotsBySeat.get(2)).toBe(1)
  })

  it('随机手牌转移让明暗实体共同参与精确槽位约束', () => {
    const knownIDs = [42, 46, 47, 59, 94, 118, 137]
    const hiddenIDs = [130, 131]
    const { room } = createTestRoom({
      cardIDs: [...knownIDs, ...hiddenIDs],
      seatIDs: [2, 3]
    })
    const sourceCards = [...knownIDs, ...hiddenIDs].map((id) => getCard(room, id))
    const sourcePlayer = room.getPlayer(2)
    const targetPlayer = room.getPlayer(3)

    room.clearCardsFromPublicZones(sourceCards)
    sourceCards.forEach((card) => {
      card.bindCandidates([2], 'hand', null, { known: knownIDs.includes(card.id) })
      if (hiddenIDs.includes(card.id)) {
        card.isKnown = false
        room.notifyCardChanged(card, { type: 'test:hidden-card' })
      }
    })
    sourcePlayer.syncObservedHandCount(9)
    targetPlayer.syncObservedHandCount(0)

    room.moveCards([], 'player', {
      fromZone: null,
      fromSeatID: 2,
      fromSubZone: 'hand',
      seatID: 3,
      subZone: 'hand',
      cardCount: 3,
      sourceEvent: { type: 'test:all-entity-random-hand-transfer' }
    })

    const group = Array.from(room.constraintGroups.values()).find(
      (constraintGroup) =>
        (constraintGroup.sourceEvent as { type?: string } | null)?.type ===
        'test:all-entity-random-hand-transfer'
    )

    expect(group).toBeDefined()
    expect(group.cards.size).toBe(9)
    expect(group.expectedSlotsBySeat.get(2)).toBe(6)
    expect(group.expectedSlotsBySeat.get(3)).toBe(3)
    expect(sourceCards.every((card) => card.seats.has(2) && card.seats.has(3))).toBe(true)
    expect(hiddenIDs.map((id) => getCard(room, id)).every((card) => card.seats.size === 2)).toBe(
      true
    )
    expect(room.movement.getPlayerHandCardsBySeat(2)).toHaveLength(9)
    expect(room.movement.getPlayerHandCardsBySeat(3)).toHaveLength(9)

    expect(targetPlayer.candidateHandCards).toEqual(knownIDs.map((id) => getCard(room, id)))
  })

  it('随机转移已有暗实体完整覆盖手牌槽时不重复补建匿名实体', () => {
    const knownIDs = [116]
    const hiddenIDs = [130, 131, 132]
    const allIDs = [...knownIDs, ...hiddenIDs]
    const { room } = createTestRoom({ cardIDs: allIDs, seatIDs: [1, 2] })
    const sourceCards = allIDs.map((id) => getCard(room, id))

    room.clearCardsFromPublicZones(sourceCards)
    sourceCards.forEach((card) => {
      card.bindCandidates([2], 'hand', null, { known: knownIDs.includes(card.id) })
      if (hiddenIDs.includes(card.id)) {
        card.isKnown = false
        room.notifyCardChanged(card, { type: 'test:hidden-card' })
      }
    })
    room.getPlayer(1).syncObservedHandCount(0)
    room.getPlayer(2).syncObservedHandCount(4)

    room.moveCards([], 'player', {
      fromZone: null,
      fromSeatID: 2,
      fromSubZone: 'hand',
      seatID: 1,
      subZone: 'hand',
      cardCount: 1,
      sourceEvent: { type: 'test:random-transfer-with-hidden-coverage' }
    })

    const playerCards = room.cards.filter((card) => card.location === 'player')
    expect(playerCards).toHaveLength(4)
    expect(playerCards).toEqual(expect.arrayContaining(sourceCards))
    expect(room.cards.some((card) => card.id === 0)).toBe(false)
    expect(room.getPlayer(1).unknownCardCount).toBe(0)
    expect(room.getPlayer(2).unknownCardCount).toBe(2)
  })

  it('共享部分暗实体的约束包保留不同座位的可行覆盖', () => {
    const { room } = createTestRoom({ cardIDs: [130, 131, 132], seatIDs: [1, 2, 3] })
    const [first, shared, third] = [130, 131, 132].map((id) => getCard(room, id))
    const seat1Hand = playerLocation(1, 'hand')
    const seat2Hand = playerLocation(2, 'hand')

    room.clearCardsFromPublicZones([first, shared, third])
    first.bindCandidates([1, 3], 'hand', null, { known: false })
    shared.bindCandidates([1, 2], 'hand', null, { known: false })
    third.bindCandidates([2, 3], 'hand', null, { known: false })

    room.createConstraintGroup({
      id: 'overlap-seat-1',
      cards: [first, shared],
      expectedSlotsByLocation: new Map([[createLocationCandidateKey(seat1Hand), 1]])
    })
    room.createConstraintGroup({
      id: 'overlap-seat-2',
      cards: [shared, third],
      expectedSlotsByLocation: new Map([[createLocationCandidateKey(seat2Hand), 1]])
    })

    expect(room.constraints.collectAmbiguousHiddenHandCoverage()).toEqual(
      new Map([
        [1, 1],
        [2, 1]
      ])
    )
  })

  it('主动实体化未知手牌槽并在明牌打出时回补原公共位置', () => {
    const { room } = createTestRoom({ cardIDs: [2, 118, 130], seatIDs: [2] })
    const knownCards = [getCard(room, 118), getCard(room, 130)]
    const revealedCard = getCard(room, 2)
    const player = room.getPlayer(2)

    room.clearCardsFromPublicZones(knownCards)
    knownCards.forEach((card) => {
      card.bindCandidates([2], 'hand', null, { known: true })
    })
    player.syncObservedHandCount(3)

    room.resolveConstraints()

    const anonymousCard = room.cards.find(
      (card) =>
        card.id === 0 && card.location === 'player' && card.subZone === 'hand' && card.seats.has(2)
    )
    expect(anonymousCard).toBeDefined()
    expect(anonymousCard.entityID).toBeLessThan(0)
    expect(player.unknownCardCount).toBe(1)

    room.moveCards([2], 'process', {
      fromZone: null,
      fromSeatID: 2,
      fromSubZone: 'hand',
      cardCount: 1,
      sourceEvent: { type: 'test:reveal-unknown-hand-card' }
    })

    expect(revealedCard.location).toBe('process')
    expect(room.getPublicZone('process').cards).toContain(revealedCard)
    expect(anonymousCard.location).toBe('pile')
    expect(room.getPublicZone('pile').cards).toContain(anonymousCard)
    expect(player.observedHandCount).toBe(2)
    expect(player.unknownCardCount).toBe(0)
  })

  it('为多张匿名手牌分配稳定且唯一的内部实体 ID', () => {
    const { room } = createTestRoom({ cardIDs: [118], seatIDs: [2] })
    const knownCard = getCard(room, 118)
    const player = room.getPlayer(2)

    room.clearCardsFromPublicZones([knownCard])
    knownCard.bindCandidates([2], 'hand', null, { known: true })
    player.syncObservedHandCount(3)

    room.resolveConstraints()

    const anonymousCards = room.cards.filter(
      (card) => card.id === 0 && card.location === 'player' && card.seats.has(2)
    )
    expect(anonymousCards).toHaveLength(2)
    expect(new Set(anonymousCards.map((card) => card.entityID)).size).toBe(2)
    expect(anonymousCards.every((card) => card.entityID < 0)).toBe(true)

    const originalEntityIDs = anonymousCards.map((card) => card.entityID).sort()
    room.resolveConstraints()

    const resolvedEntityIDs = room.cards
      .filter((card) => card.id === 0 && card.location === 'player' && card.seats.has(2))
      .map((card) => card.entityID)
      .sort()
    expect(resolvedEntityIDs).toEqual(originalEntityIDs)
  })

  it('未知手牌槽减少时仅释放多余匿名实体', () => {
    const { room } = createTestRoom({ cardIDs: [118], seatIDs: [2] })
    const knownCard = getCard(room, 118)
    const player = room.getPlayer(2)

    room.clearCardsFromPublicZones([knownCard])
    knownCard.bindCandidates([2], 'hand', null, { known: true })
    player.syncObservedHandCount(3)
    room.resolveConstraints()

    const originalEntityIDs = room.cards
      .filter((card) => card.id === 0 && card.location === 'player')
      .map((card) => card.entityID)
    player.syncObservedHandCount(2)
    room.resolveConstraints()

    const activeAnonymousCards = room.cards.filter(
      (card) => card.id === 0 && card.location === 'player' && card.seats.has(2)
    )
    const releasedAnonymousCards = room.cards.filter(
      (card) => card.id === 0 && card.location === 'outside'
    )
    expect(activeAnonymousCards).toHaveLength(1)
    expect(releasedAnonymousCards).toHaveLength(1)
    expect(
      [...activeAnonymousCards, ...releasedAnonymousCards].map((card) => card.entityID).sort()
    ).toEqual(originalEntityIDs.sort())
  })

  it('来源仅有跨座位候选时按明牌移动事实创建瞬时匿名置换实体', () => {
    const candidateIDs = [42, 46, 59, 118, 137]
    const { room } = createTestRoom({ cardIDs: [29, ...candidateIDs], seatIDs: [2, 3] })
    const revealedCard = getCard(room, 29)
    const candidateCards = candidateIDs.map((id) => getCard(room, id))
    const sourcePlayer = room.getPlayer(2)

    room.clearCardsFromPublicZones(candidateCards)
    candidateCards.forEach((card) => {
      card.bindCandidates([2, 3], 'hand', null, { known: true })
    })
    sourcePlayer.syncObservedHandCount(3)
    room.resolveConstraints()

    expect(
      room.cards.some((card) => card.id === 0 && card.location === 'player' && card.seats.has(2))
    ).toBe(false)

    const warnSpy = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})
    try {
      room.moveCards([29], 'process', {
        fromZone: null,
        fromSeatID: 2,
        fromSubZone: 'hand',
        cardCount: 1,
        sourceEvent: { type: 'test:known-card-from-candidate-only-hand' }
      })

      expect(warnSpy).not.toHaveBeenCalledWith(
        '玩家来源明牌未找到可立即置换的手牌占位',
        expect.anything()
      )
      expect(warnSpy).not.toHaveBeenCalledWith(
        '玩家来源明牌残留公共区，已尝试用来源占位回补旧公共区槽位',
        expect.anything()
      )
    } finally {
      warnSpy.mockRestore()
    }

    const anonymousReplacement = room.cards.find(
      (card) => card.id === 0 && card.location === 'pile'
    )
    expect(revealedCard.location).toBe('process')
    expect(anonymousReplacement).toBeDefined()
    expect(anonymousReplacement.entityID).toBeLessThan(0)
    expect(sourcePlayer.observedHandCount).toBe(2)
  })
})
