import { describe, expect, it, vi } from 'vitest'
import { isAnonymous } from '@/tracker/Card'
import { trackerLogger } from '@/utils/logger'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import { computeHandSlotAllocation } from '@/tracker/candidate/handSlotUsage'
import type { RoomMoveContext } from '@/tracker/roomMovement/types'
import { createTestRoom, getCard } from './helpers/room'
import { playerLocation } from './helpers/locationCandidates'
import { getPlayerHandCardsBySeat } from '@/tracker/roomMovement/sourceQueries'

describe('玩家手牌数观测', () => {
  it('暗实体覆盖也扣除跨组限制后的明牌容量，不重复补建实体', () => {
    const { room } = createTestRoom({ cardIDs: [11, 12, 13, 14], seatIDs: [1] })
    const cards = [11, 12, 13, 14].map((id) => getCard(room, id)!)
    const hand = playerLocation(1, 'hand')
    const mark = playerLocation(1, 'mark', 700)
    room.clearCardsFromPublicZones(cards)
    cards.forEach((card) => card.setLocationCandidates([hand, mark]))
    cards.slice(0, 2).forEach((card) => card.confirmKnown())
    room.createConstraintGroup({ cards, expectedSlotsBySeat: new Map([[1, 3]]) })
    room.createConstraintGroup({ cards: cards.slice(0, 2), expectedSlotsBySeat: new Map([[1, 1]]) })
    room.getPlayer(1)!.syncObservedHandCount(3)

    expect(computeHandSlotAllocation(room).get(1)).toMatchObject({
      candidateKnownUpperBound: 1,
      ambiguousHiddenCoveredCount: 2,
      unknownCardCount: 2,
      anonymousMissingCount: 0,
      anonymousExcessCount: 0
    })
    room.resolveConstraints()
    expect(room.playerCardsSnapshot).toHaveLength(4)
    expect(room.cards.some((card) => isAnonymous(card))).toBe(false)
  })

  it.each([false, true])('共享暗实体无法满足全部名额时暂停补位（逆序建组：%s）', (reverse) => {
    const { room } = createTestRoom({ cardIDs: [11], seatIDs: [1, 2] })
    const card = getCard(room, 11)!
    room.clearCardsFromPublicZones([card])
    card.bindCandidates([1, 2], 'hand')
    const seats = reverse ? [2, 1] : [1, 2]
    seats.forEach((seatID) =>
      room.createConstraintGroup({
        cards: [card],
        expectedSlotsBySeat: new Map([[seatID, 1]])
      })
    )
    seats.forEach((seatID) => room.getPlayer(seatID)!.syncObservedHandCount(1))
    const allocations = computeHandSlotAllocation(room)
    seats.forEach((seatID) =>
      expect(allocations.get(seatID)).toMatchObject({
        ambiguousHiddenCoveredCount: 0,
        canReconcileAnonymous: false,
        anonymousMissingCount: null,
        anonymousExcessCount: null
      })
    )
    room.resolveConstraints()
    expect(room.playerCardsSnapshot).toHaveLength(1)
    expect(card.seats).toEqual(new Set([1, 2]))
  })

  it('统一分配同时给出确定明暗占用、候选上界和匿名缺口，并保留未观测语义', () => {
    const { room } = createTestRoom({ cardIDs: [11, 12, 13, 14, 15], seatIDs: [1, 2] })
    const cards = [11, 12, 13, 14, 15].map((id) => getCard(room, id)!)
    room.clearCardsFromPublicZones(cards)
    cards[0].bindCandidates([1], 'hand', null, { known: true })
    cards[1].bindCandidates([1], 'hand')
    const hand = playerLocation(1, 'hand')
    const mark = playerLocation(1, 'mark', 700)
    cards.slice(2).forEach((card) => {
      card.setLocationCandidates([hand, mark])
    })
    cards[2].confirmKnown()
    room.createConstraintGroup({
      cards: cards.slice(2),
      expectedSlotsByLocation: new Map([[createLocationCandidateKey(hand), 2]])
    })
    const player = room.getPlayer(1)!
    const unobserved = computeHandSlotAllocation(room).get(1)!
    expect(unobserved).toMatchObject({
      exactKnownCount: 1,
      exactHiddenCount: 1,
      candidateKnownUpperBound: 1,
      ambiguousHiddenCoveredCount: 1,
      unknownCardCount: null,
      anonymousMissingCount: null,
      anonymousExcessCount: null,
      canReconcileAnonymous: false
    })
    expect(unobserved.exactHiddenCards.map((card) => card.id)).toEqual([12])
    player.syncObservedHandCount(5)
    const allocation = computeHandSlotAllocation(room, [1]).get(1)!
    expect(allocation).toMatchObject({
      exactKnownCount: 1,
      exactHiddenCount: 1,
      candidateKnownUpperBound: 1,
      ambiguousHiddenCoveredCount: 1,
      unknownCardCount: 3,
      anonymousMissingCount: 1,
      anonymousExcessCount: 0,
      canReconcileAnonymous: true
    })
    expect(player.observedHandCount).toBe(5)
    expect(player.unknownCardCount).toBe(allocation.unknownCardCount)
    expect(cards.slice(2).every((card) => card.locationCandidates.length === 2)).toBe(true)
    room.resolveConstraints()
    expect(room.playerCardsSnapshot).toHaveLength(6)
    expect(
      room.cards.filter((card) => isAnonymous(card) && card.location === 'player')
    ).toHaveLength(1)
    expect(computeHandSlotAllocation(room, [1]).get(1)?.anonymousMissingCount).toBe(0)
  })

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

    const candidateCards = room.movement.candidates.markRandomHandTransferCandidates({
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
    expect(group.expectedSlotsByLocation.get('player:1:hand:none')).toBe(1)
    expect(group.expectedSlotsByLocation.get('player:2:hand:none')).toBe(1)
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
      toSeatID: 3,
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
    expect(group.expectedSlotsByLocation.get('player:2:hand:none')).toBe(6)
    expect(group.expectedSlotsByLocation.get('player:3:hand:none')).toBe(3)
    expect(sourceCards.every((card) => card.seats.has(2) && card.seats.has(3))).toBe(true)
    expect(hiddenIDs.map((id) => getCard(room, id)).every((card) => card.seats.size === 2)).toBe(
      true
    )
    expect(getPlayerHandCardsBySeat(room, 2)).toHaveLength(9)
    expect(getPlayerHandCardsBySeat(room, 3)).toHaveLength(9)

    expect(targetPlayer.candidateHandCards).toEqual(knownIDs.map((id) => getCard(room, id)))
  })

  it('来源全暗随机获取时不传播手牌候选，直接移动一张暗实体', () => {
    const infoSpy = vi.spyOn(trackerLogger, 'info').mockImplementation(() => {})
    const { room } = createTestRoom({ cardIDs: [11, 12, 13, 14, 15, 16], seatIDs: [0, 1] })

    try {
      room.moveCards([], 'player', {
        toSeatID: 1,
        subZone: 'hand',
        fromZone: 'pile',
        cardCount: 4,
        sourceEvent: { type: 'test:draw-four-unknown' }
      })

      const sourceBefore = getPlayerHandCardsBySeat(room, 1)
      expect(sourceBefore).toHaveLength(4)
      expect(sourceBefore.every((card) => card.isKnown !== true)).toBe(true)

      room.moveCards([], 'player', {
        fromZone: null,
        fromSeatID: 1,
        fromSubZone: 'hand',
        toSeatID: 0,
        subZone: 'hand',
        cardCount: 1,
        sourceEvent: { type: 'test:all-hidden-random-gain' }
      })

      const sourceAfter = getPlayerHandCardsBySeat(room, 1)
      const targetAfter = getPlayerHandCardsBySeat(room, 0)
      const transferGroup = Array.from(room.constraintGroups.values()).find(
        (group) =>
          (group.sourceEvent as { type?: string } | null)?.type === 'test:all-hidden-random-gain'
      )

      expect(infoSpy).not.toHaveBeenCalledWith(
        '手牌候选传播',
        expect.objectContaining({ fromSeat: 1, targetSeat: 0 })
      )
      // 全暗时不建 N 选 K，直接搬一张暗实体；默认未知移动可能不带同名 sourceEvent 组。
      expect(transferGroup?.expectedSlotsByLocation?.get('player:1:hand:none')).toBeUndefined()
      expect(sourceAfter).toHaveLength(3)
      expect(targetAfter).toHaveLength(1)
      expect(targetAfter[0]?.isKnown).not.toBe(true)
      expect(targetAfter[0]?.seats.has(0)).toBe(true)
      expect(room.getPlayer(1).observedHandCount).toBe(3)
      expect(room.getPlayer(0).observedHandCount).toBe(1)
    } finally {
      infoSpy.mockRestore()
    }
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
      toSeatID: 1,
      subZone: 'hand',
      cardCount: 1,
      sourceEvent: { type: 'test:random-transfer-with-hidden-coverage' }
    })

    const playerCards = room.cards.filter((card) => card.location === 'player')
    expect(playerCards).toHaveLength(4)
    expect(playerCards).toEqual(expect.arrayContaining(sourceCards))
    expect(room.cards.some((card) => isAnonymous(card))).toBe(false)
    expect(room.getPlayer(1).unknownCardCount).toBe(0)
    expect(room.getPlayer(2).unknownCardCount).toBe(2)
  })

  it('来源已有跨座位候选时，后续随机转移不因 entityOverflow 放弃覆盖', () => {
    const warnSpy = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})
    const { room } = createTestRoom({ cardIDs: [11, 12, 13, 14, 15, 16], seatIDs: [1, 5] })

    try {
      // 1 号：1 明 + 2 暗，再额外叠一张跨座位匿名候选。
      // seats.has(1) 实体数 = 4，唯一归属实体 = 3，对应 sourceTotal=3。
      // 至少 1 张明牌才会触发候选传播门槛。
      room.moveCards([11], 'player', {
        toSeatID: 1,
        subZone: 'hand',
        fromZone: 'pile',
        cardCount: 1,
        sourceEvent: { type: 'test:draw-one-known' }
      })
      room.moveCards([], 'player', {
        toSeatID: 1,
        subZone: 'hand',
        fromZone: 'pile',
        cardCount: 2,
        sourceEvent: { type: 'test:draw-two-unknown' }
      })

      const residualCandidate = room.createExternalCards([], 1)[0]
      residualCandidate.bindCandidates([1, 2], 'hand', null, { known: false })
      residualCandidate.isKnown = false
      room.notifyCardChanged(residualCandidate, { type: 'test:residual-multi-seat-candidate' })

      const sourceEntitiesBefore = getPlayerHandCardsBySeat(room, 1)
      expect(sourceEntitiesBefore).toHaveLength(4)
      expect(sourceEntitiesBefore.filter((card) => card.seats.size === 1)).toHaveLength(3)
      expect(sourceEntitiesBefore.some((card) => card.isKnown === true)).toBe(true)
      expect(room.getPlayer(1).observedHandCount).toBe(3)

      room.moveCards([], 'player', {
        fromZone: null,
        fromSeatID: 1,
        fromSubZone: 'hand',
        toSeatID: 5,
        subZone: 'hand',
        cardCount: 1,
        sourceEvent: { type: 'test:random-transfer-after-residual-candidate' }
      })

      const transferGroup = Array.from(room.constraintGroups.values()).find(
        (group) =>
          (group.sourceEvent as { type?: string } | null)?.type ===
          'test:random-transfer-after-residual-candidate'
      )

      expect(warnSpy).not.toHaveBeenCalledWith(
        '随机手牌转移无法建立完整实体候选覆盖',
        expect.objectContaining({ reason: 'entityOverflow' })
      )
      expect(transferGroup).toBeDefined()
      expect(transferGroup?.cards.size).toBe(3)
      expect(transferGroup?.expectedSlotsByLocation.get('player:1:hand:none')).toBe(2)
      expect(transferGroup?.expectedSlotsByLocation.get('player:5:hand:none')).toBe(1)
      expect(room.getPlayer(1).observedHandCount).toBe(2)
      expect(room.getPlayer(5).observedHandCount).toBe(1)
      // 只有本次唯一归属覆盖的 3 张进入 N 选 K；残留跨座位候选不掺入。
      expect(
        Array.from(transferGroup?.cards ?? []).every(
          (card) => card.seats.has(1) && card.seats.has(5) && card.seats.size === 2
        )
      ).toBe(true)
      expect(residualCandidate.seats.has(5)).toBe(false)
    } finally {
      warnSpy.mockRestore()
    }
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

    expect(
      new Map(
        Array.from(
          computeHandSlotAllocation(room),
          ([seatID, allocation]) => [seatID, allocation.ambiguousHiddenCoveredCount] as const
        ).filter(([, count]) => count > 0)
      )
    ).toEqual(
      new Map([
        [1, 1],
        [2, 1]
      ])
    )
  })

  it('同一席位的多个手牌位置约束合并全部暗实体候选', () => {
    const { room } = createTestRoom({ cardIDs: [130, 131], seatIDs: [1, 2] })
    const first = getCard(room, 130)
    const second = getCard(room, 131)
    const firstHand = playerLocation(1, 'hand', 100)
    const secondHand = playerLocation(1, 'hand', 200)
    const otherHand = playerLocation(2, 'hand')

    // 两个完整位置键都属于 1 号位；旧实现会用第二批候选覆盖第一批候选。
    room.clearCardsFromPublicZones([first, second])
    first.setLocationCandidates([firstHand, otherHand])
    second.setLocationCandidates([secondHand, otherHand])
    room.createConstraintGroup({
      id: 'same-seat-multiple-hand-locations',
      cards: [first, second],
      expectedSlotsByLocation: new Map([
        [createLocationCandidateKey(firstHand), 1],
        [createLocationCandidateKey(secondHand), 1]
      ])
    })

    expect(computeHandSlotAllocation(room).get(1)?.ambiguousHiddenCoveredCount).toBe(2)
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
        isAnonymous(card) &&
        card.location === 'player' &&
        card.subZone === 'hand' &&
        card.seats.has(2)
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
      (card) => isAnonymous(card) && card.location === 'player' && card.seats.has(2)
    )
    expect(anonymousCards).toHaveLength(2)
    expect(new Set(anonymousCards.map((card) => card.entityID)).size).toBe(2)
    expect(anonymousCards.every((card) => card.entityID < 0)).toBe(true)

    const originalEntityIDs = anonymousCards.map((card) => card.entityID).sort()
    room.resolveConstraints()

    const resolvedEntityIDs = room.cards
      .filter((card) => isAnonymous(card) && card.location === 'player' && card.seats.has(2))
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
      .filter((card) => isAnonymous(card) && card.location === 'player')
      .map((card) => card.entityID)
    player.syncObservedHandCount(2)
    room.resolveConstraints()

    const activeAnonymousCards = room.cards.filter(
      (card) => isAnonymous(card) && card.location === 'player' && card.seats.has(2)
    )
    const releasedAnonymousCards = room.cards.filter(
      (card) => isAnonymous(card) && card.location === 'outside'
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
      room.cards.some(
        (card) => isAnonymous(card) && card.location === 'player' && card.seats.has(2)
      )
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
      (card) => isAnonymous(card) && card.location === 'pile'
    )
    expect(revealedCard.location).toBe('process')
    expect(anonymousReplacement).toBeDefined()
    expect(anonymousReplacement.entityID).toBeLessThan(0)
    expect(sourcePlayer.observedHandCount).toBe(2)
  })

  it('模糊身份迁移约束组后保留新组合标签', () => {
    const { room } = createTestRoom({ cardIDs: [29, 130], seatIDs: [1, 2] })
    const candidateCard = getCard(room, 29)
    const placeholder = getCard(room, 130)
    const sourceHand = playerLocation(1, 'hand')
    const otherHand = playerLocation(2, 'hand')
    const context = {
      fromSeat: 1,
      fromSubZone: 'hand',
      knownCards: [],
      sourceEvent: { type: 'test:preserve-migrated-combination-id' }
    } as RoomMoveContext

    room.clearCardsFromPublicZones([candidateCard, placeholder])
    candidateCard.setLocationCandidates([sourceHand, otherHand])
    placeholder.bindCandidates([1], 'hand', null, { known: false })
    const group = room.createConstraintGroup({
      id: 'migrated-group',
      cards: [candidateCard]
    })
    // combinationID 是最近标签，可能落后于实体实际参与的约束组。
    candidateCard.combinationID = 'stale-group'

    expect(
      room.movement.sources.swapKnownCardWithPlayerSourcePlaceholder(candidateCard, context)
    ).toBe(placeholder)
    expect(group.cards.has(candidateCard)).toBe(false)
    expect(group.cards.has(placeholder)).toBe(true)
    expect(placeholder.combinationID).toBe('migrated-group')
  })
})
