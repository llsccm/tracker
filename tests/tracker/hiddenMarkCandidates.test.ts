import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import { normalizeMoveEvent } from '@/tracker/protocol/MoveEventNormalizer'
import {
  HIDDEN_MARK_STATE_KEY,
  type HiddenMarkState,
  type RoomMoveContext
} from '@/tracker/room/movement/types'
import { createTestRoom, getCard, takeAnonymousCard } from './helpers/room'
import { outsideLocation, playerLocation, publicLocation } from './helpers/locationCandidates'
import { getUnknownPlayerSourceCards } from '@/tracker/room/movement/sourceQueries'
import { collectTraversalStats } from '@/tracker/traversalStats'
import { moveHiddenHandToMark, moveKnownCardsToHand } from './helpers/hiddenMarks'

afterEach(() => vi.restoreAllMocks())

describe('隐藏标记区候选', () => {
  it('暗置查询纳入刚入手明牌和仍在公共区的手牌候选，不全量过滤牌池', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4] })
    const first = getCard(room, 1)!
    const second = getCard(room, 2)!
    const otherSeat = getCard(room, 3)!
    room.clearCardsFromPublicZones([second, otherSeat])
    second.bindCandidates([1], 'hand', null, { known: true })
    const pileTop = publicLocation('pile', 'top', 2)
    first.confirmKnown()
    first.setLocationCandidates([playerLocation(1, 'hand'), pileTop])
    otherSeat.bindCandidates([2], 'hand', null, { known: true })
    // 玩家候选会把 location 归一为 player；公共区引用和候选仍可同时保留。
    expect(first.location).toBe('player')
    expect(room.zones.get('pile')!.cards).toContain(first)
    const context = room.movement.createMoveContext([], 'player', {
      fromSeatID: 1,
      fromSubZone: 'hand',
      toSeatID: 1,
      subZone: 'mark',
      spellID: 414,
      cardCount: 1
    })
    const filter = vi.spyOn(room.cards, 'filter')

    const { result, stats } = collectTraversalStats(() =>
      room.movement.hiddenMarks.handleHiddenMarkMove(context)
    )

    expect(result).toBe(true)
    const record = room
      .readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)!
      .records.get('1:1:414')!
    expect([...record.cards]).toEqual([first, second])
    expect(record.knownMarkMax).toBe(1)
    expect(context.skipUnknownMovement).toBe(true)
    expect(first.hasSubZoneCandidate({ seatID: 1, subZone: 'mark', spellID: 414 })).toBe(true)
    expect(first.hasLocationCandidate(pileTop)).toBe(true)
    expect(second.hasSubZoneCandidate({ seatID: 1, subZone: 'hand', spellID: null })).toBe(true)
    expect(otherSeat.hasLocationCandidates()).toBe(false)
    expect(filter).not.toHaveBeenCalled()
    expect(stats.sites.get('resolveConstraints:playerSnapshot')).toBeUndefined()
  })

  it('归一化标记区回手牌事件时保留来源标记 ID', () => {
    const event = normalizeMoveEvent({
      MoveType: 19,
      CardIDs: [],
      CardCount: 4,
      FromZone: 4,
      FromID: 6,
      FromZoneParam: 414,
      FromPosition: 65282,
      ToZone: 5,
      ToID: 6,
      ToZoneParam: 0,
      ToPosition: 65280,
      SpellID: 3389
    })

    expect(event.options.fromSubZone).toBe('mark')
    expect(event.options.fromSpellID).toBe(414)
    expect(event.options.spellID).toBe(3389)
  })

  it('414 标记区全暗回手牌按来源空间读取，动作技能为 3389', () => {
    const { room } = createTestRoom({ cardIDs: [136, 137, 138, 139], seatIDs: [6] })
    const knownCard = getCard(room, 136)
    const hiddenCards = room.zones.get('pile')!.cards.filter((card) => card.isAnonymous)

    room.moveCards([136], 'player', {
      toSeatID: 6,
      subZone: 'equip',
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'test:known-equip' }
    })
    room.moveCards([136], 'player', {
      toSeatID: 6,
      fromSeatID: 6,
      fromZone: null,
      fromSubZone: 'equip',
      subZone: 'mark',
      spellID: 414,
      cardCount: 1,
      sourceEvent: { type: 'test:known-equip-to-mark' }
    })
    room.moveCards([0, 0, 0], 'player', {
      toSeatID: 6,
      subZone: 'hand',
      fromZone: 'pile',
      cardCount: 3,
      sourceEvent: { type: 'test:unknown-hand' }
    })
    room.players.get(6).syncObservedHandCount(3)
    room.moveCards([], 'player', {
      toSeatID: 6,
      fromSeatID: 6,
      fromZone: null,
      fromSubZone: 'hand',
      subZone: 'mark',
      spellID: 414,
      cardCount: 3,
      sourceEvent: { type: 'test:hidden-hand-to-mark' }
    })

    expect(room.locationIndex.markBySeatAndSpell.get(6).get(414)).toContain(knownCard)

    room.moveCards([], 'player', {
      toSeatID: 6,
      fromSeatID: 6,
      fromZone: null,
      fromSubZone: 'mark',
      fromSpellID: 414,
      subZone: 'hand',
      spellID: 3389,
      cardCount: 4,
      position: 65280,
      fromPosition: 65282,
      sourceEvent: { type: 'test:hidden-mark-to-hand' }
    })

    expect(room.locationIndex.markBySeatAndSpell.get(6)?.get(414) ?? []).not.toContain(knownCard)
    expect(room.locationIndex.knownHandBySeat.get(6)).toContain(knownCard)
    ;[knownCard, ...hiddenCards].forEach((card) => {
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('hand')
      expect(card.seats.has(6)).toBe(true)
    })
  })

  it('标记区明牌回手牌时用来源标记 ID 确认暗置账本', () => {
    const { room } = createTestRoom({ cardIDs: [136], seatIDs: [6] })
    const knownCard = getCard(room, 136)

    moveKnownCardsToHand(room, [136], 6)
    room.players.get(6).syncObservedHandCount(1)
    moveHiddenHandToMark(room, {
      seatID: 6,
      count: 1,
      spellID: 414
    })

    expect(
      room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)!.records.has('6:6:414')
    ).toBe(true)

    room.moveCards([136], 'player', {
      toSeatID: 6,
      fromSeatID: 6,
      fromZone: null,
      fromSubZone: 'mark',
      fromSpellID: 414,
      subZone: 'hand',
      spellID: 3389,
      cardCount: 1,
      position: 65280,
      fromPosition: 65282,
      sourceEvent: { type: 'test:known-mark-to-hand' }
    })

    expect(
      room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)?.records.has('6:6:414') ?? false
    ).toBe(false)
    expect(knownCard.location).toBe('player')
    expect(knownCard.subZone).toBe('hand')
    expect(knownCard.seats.has(6)).toBe(true)
  })

  it('玩家来源标记匹配使用 fromSpellID 而非目标 spellID', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [6, 7] })
    const candidateCard = getCard(room, 1)
    const knownCard = getCard(room, 2)
    const placeholder = takeAnonymousCard(room)
    const sourceMark = playerLocation(6, 'mark', 414)
    const otherHand = playerLocation(7, 'hand')
    const context = {
      from: { type: 'player', seatID: 6, subZone: 'mark', markSpellID: 414 },
      to: { type: 'player', seatID: 6, subZone: 'hand' },
      triggerSpellID: 3389,
      knownCards: [knownCard],
      sourceEvent: { type: 'test:source-mark-spell' }
    } as RoomMoveContext

    candidateCard.confirmKnown()
    candidateCard.setLocationCandidates([sourceMark, otherHand])

    expect(room.movement.sources.resolveStoredSourceCandidate(candidateCard, context)).toBe(true)
    expect(candidateCard.subZone).toBe('mark')
    expect(candidateCard.spellID).toBe(414)

    knownCard.confirmKnown()
    knownCard.setLocationCandidates([sourceMark, otherHand])
    placeholder.bindCandidates([6], 'mark', 414, { known: false })

    expect(
      room.movement.sources.getSourcePlaceholderReplacementCandidate(knownCard, context)
    ).toEqual(expect.objectContaining(otherHand))
    expect(room.movement.sources.swapKnownCardWithPlayerSourcePlaceholder(knownCard, context)).toBe(
      placeholder
    )
    expect(room.movement.sources.isCardInStoredSource(knownCard, context)).toBe(true)
    expect(knownCard.subZone).toBe('mark')
    expect(knownCard.spellID).toBe(414)
    expect(placeholder.subZone).toBe('hand')
    expect(placeholder.spellID).toBe(null)
    expect(placeholder.seats.has(7)).toBe(true)
  })

  it.each([0, 100])('玩家暗标记来源只匹配指定空间 %s，未限定时保留全部空间', (spellID) => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [6] })
    const first = takeAnonymousCard(room)
    const second = takeAnonymousCard(room)

    room.clearCardsFromPublicZones([first, second])
    first.bindCandidates([6], 'mark', spellID, { known: false })
    second.bindCandidates([6], 'mark', 200, { known: false })

    expect(getUnknownPlayerSourceCards(room, 6, 'mark', spellID)).toEqual([first])
    expect(getUnknownPlayerSourceCards(room, 6, 'mark', 200)).toEqual([second])
    expect(getUnknownPlayerSourceCards(room, 6, 'mark')).toEqual([first, second])
    expect(getUnknownPlayerSourceCards(room, 6, 'mark', null)).toEqual([first, second])
  })

  it('混合完整位置候选即使投影为空也可作为玩家标记来源', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [6, 7] })
    const mixedCandidate = takeAnonymousCard(room)
    const exactSource = takeAnonymousCard(room)
    const incompatibleCandidate = takeAnonymousCard(room)
    const otherHand = playerLocation(7, 'hand')

    mixedCandidate.setLocationCandidates([playerLocation(6, 'mark', 414), otherHand])
    exactSource.bindCandidates([6], 'mark', 414, { known: false })
    incompatibleCandidate.setLocationCandidates([playerLocation(6, 'mark', 999), otherHand])

    expect(mixedCandidate.subZone).toBe(null)
    expect(mixedCandidate.spellID).toBe(null)
    expect(getUnknownPlayerSourceCards(room, 6, 'mark', 414)).toEqual([exactSource, mixedCandidate])
  })

  it.each([1, 3])('全明手牌暗置 %s 张标记区时创建完整位置强约束', (markCount) => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4], seatIDs: [1] })
    const cards = [1, 2, 3, 4].map((id) => getCard(room, id))
    const hand = playerLocation(1, 'hand')
    const mark = playerLocation(1, 'mark', 1234)

    moveKnownCardsToHand(room, [1, 2, 3, 4], 1)
    room.players.get(1).syncObservedHandCount(4)
    moveHiddenHandToMark(room, {
      seatID: 1,
      count: markCount,
      spellID: 1234
    })

    const state = room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)!
    const record = state.records.get('1:1:1234')!
    const group = room.constraintGroups.get('hidden_mark_1:1:1234')

    expect(record.knownMarkMin).toBe(markCount)
    expect(record.knownMarkMax).toBe(markCount)
    expect(group.expectedSlotsByLocation.get(createLocationCandidateKey(hand))).toEqual({
      min: 4 - markCount,
      max: 4 - markCount
    })
    expect(group.expectedSlotsByLocation.get(createLocationCandidateKey(mark))).toEqual({
      min: markCount,
      max: markCount
    })
    cards.forEach((card) => {
      expect(
        card.locationCandidates.map((candidate) => createLocationCandidateKey(candidate)).sort()
      ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())
    })
  })

  it('混有暗牌时保留候选并建立区间名额', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1] })
    const cards = [1, 2].map((id) => getCard(room, id))
    const hand = playerLocation(1, 'hand')
    const mark = playerLocation(1, 'mark', 1234)

    moveKnownCardsToHand(room, [1, 2], 1)
    room.players.get(1).syncObservedHandCount(4)
    moveHiddenHandToMark(room, {
      seatID: 1,
      count: 2,
      spellID: 1234
    })

    const record = room
      .readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)!
      .records.get('1:1:1234')!

    expect(record.knownMarkMin).toBe(0)
    expect(record.knownMarkMax).toBe(2)
    expect(
      room.constraintGroups
        .get('hidden_mark_1:1:1234')!
        .expectedSlotsByLocation.get('player:1:mark:1234')
    ).toEqual({ min: 0, max: 2 })
    cards.forEach((card) => {
      expect(
        card.locationCandidates.map((candidate) => createLocationCandidateKey(candidate)).sort()
      ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())
    })
  })

  it('三明两暗暗置一张后，一张明牌从标记明弃可排除其余标记候选', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4, 5], seatIDs: [1] })
    moveKnownCardsToHand(room, [1, 2, 3], 1)
    room.moveCards([], 'player', { toSeatID: 1, fromZone: 'pile', cardCount: 2 })
    moveHiddenHandToMark(room, { seatID: 1, count: 1, spellID: 1234 })
    const group = room.constraintGroups.get('hidden_mark_1:1:1234')!
    expect(group.expectedSlotsByLocation.get('player:1:hand:none')).toEqual({ min: 2, max: 3 })
    expect(group.expectedSlotsByLocation.get('player:1:mark:1234')).toEqual({ min: 0, max: 1 })
    room.moveCards([1], 'discard', { fromSeatID: 1, fromSubZone: 'mark', fromSpellID: 1234 })
    expect(
      room
        .getPlayer(1)!
        .knownHandCards.map((card) => card.id)
        .sort()
    ).toEqual([2, 3])
    expect(room.getPlayer(1)!.observedHandCount).toBe(4)
    expect(room.getPlayer(1)!.unknownCardCount).toBe(2)
  })

  it('暗置标记追加目标候选时不丢已有跨角色手牌候选', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1, 2] })
    const cards = [1, 2].map((id) => getCard(room, id))
    const sourceHand = playerLocation(1, 'hand')
    const otherHand = playerLocation(2, 'hand')
    const mark = playerLocation(1, 'mark', 1234)

    moveKnownCardsToHand(room, [1, 2], 1)
    room.removeCardsFromConstraintGroups(cards)
    cards.forEach((card) => {
      card.setLocationCandidates([sourceHand, otherHand])
    })
    room.players.get(1).syncObservedHandCount(2)
    moveHiddenHandToMark(room, {
      seatID: 1,
      count: 1,
      spellID: 1234
    })

    expect(room.constraintGroups.has('hidden_mark_1:1:1234')).toBe(false)
    cards.forEach((card) => {
      expect(
        card.locationCandidates.map((candidate) => createLocationCandidateKey(candidate)).sort()
      ).toEqual(
        [
          createLocationCandidateKey(sourceHand),
          createLocationCandidateKey(otherHand),
          createLocationCandidateKey(mark)
        ].sort()
      )
    })
  })

  it('暗置标记追加目标候选时保留已有公共与场外候选', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1] })
    const cards = [1, 2].map((id) => getCard(room, id))
    const sourceHand = playerLocation(1, 'hand')
    const pileTop = publicLocation('pile', 'top', 2)
    const outside = outsideLocation()
    const mark = playerLocation(1, 'mark', 1234)

    moveKnownCardsToHand(room, [1, 2], 1)
    room.removeCardsFromConstraintGroups(cards)
    cards.forEach((card) => {
      card.setLocationCandidates([sourceHand, pileTop, outside])
    })
    room.players.get(1).syncObservedHandCount(2)
    moveHiddenHandToMark(room, {
      seatID: 1,
      count: 1,
      spellID: 1234
    })

    expect(room.constraintGroups.has('hidden_mark_1:1:1234')).toBe(false)
    cards.forEach((card) => {
      expect(
        card.locationCandidates.map((candidate) => createLocationCandidateKey(candidate)).sort()
      ).toEqual(
        [
          createLocationCandidateKey(sourceHand),
          createLocationCandidateKey(pileTop),
          createLocationCandidateKey(outside),
          createLocationCandidateKey(mark)
        ].sort()
      )
    })
  })
})
