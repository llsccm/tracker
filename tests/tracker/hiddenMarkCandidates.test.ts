import { describe, expect, it } from 'vitest'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import { normalizeMoveEvent } from '@/tracker/MoveEventNormalizer'
import type { RoomMoveContext } from '@/tracker/roomMovement/types'
import { createTestRoom, getCard } from './helpers/room'
import {
  equipmentContainer,
  outsideLocation,
  playerLocation,
  publicLocation
} from './helpers/locationCandidates'

function moveKnownCardsToHand(room, cardIDs, seatID) {
  room.moveCards(cardIDs, 'player', {
    seatID,
    subZone: 'hand',
    fromZone: 'pile',
    cardCount: cardIDs.length,
    sourceEvent: { type: 'test:known-hand' }
  })
}

function moveHiddenHandToMark(room, { seatID, count, spellID }) {
  room.moveCards(Array(count).fill(0), 'player', {
    seatID,
    fromSeatID: seatID,
    fromZone: 5,
    fromSubZone: 'hand',
    subZone: 'mark',
    spellID,
    cardCount: count,
    sourceEvent: { type: 'test:hidden-mark' }
  })
}

describe('隐藏标记区候选', () => {
  it('归一化标记区回手牌事件时保留来源标记 ID', () => {
    const event = normalizeMoveEvent({
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

  it('414 标记区全暗回手牌时兼容 3389 返回事件', () => {
    const { room } = createTestRoom({ cardIDs: [136, 137, 138, 139], seatIDs: [6] })
    const knownCard = getCard(room, 136)
    const hiddenCards = [137, 138, 139].map((id) => getCard(room, id))

    room.moveCards([136], 'player', {
      seatID: 6,
      subZone: 'equip',
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'test:known-equip' }
    })
    room.moveCards([136], 'player', {
      seatID: 6,
      fromSeatID: 6,
      fromZone: null,
      fromSubZone: 'equip',
      subZone: 'mark',
      spellID: 414,
      cardCount: 1,
      sourceEvent: { type: 'test:known-equip-to-mark' }
    })
    room.moveCards([0, 0, 0], 'player', {
      seatID: 6,
      subZone: 'hand',
      fromZone: 'pile',
      cardCount: 3,
      sourceEvent: { type: 'test:unknown-hand' }
    })
    room.players.get(6).syncObservedHandCount(3)
    room.moveCards([], 'player', {
      seatID: 6,
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
      seatID: 6,
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

    expect(room.getSkillState('hiddenMarkCandidates').records.has('6:6:414')).toBe(true)

    room.moveCards([136], 'player', {
      seatID: 6,
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

    expect(room.getSkillState('hiddenMarkCandidates').records.has('6:6:414')).toBe(false)
    expect(knownCard.location).toBe('player')
    expect(knownCard.subZone).toBe('hand')
    expect(knownCard.seats.has(6)).toBe(true)
  })

  it('玩家来源标记匹配使用 fromSpellID 而非目标 spellID', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [6, 7] })
    const candidateCard = getCard(room, 1)
    const knownCard = getCard(room, 2)
    const placeholder = getCard(room, 3)
    const sourceMark = playerLocation(6, 'mark', 414)
    const otherHand = playerLocation(7, 'hand')
    const context = {
      fromSeat: 6,
      fromSubZone: 'mark',
      fromSpellID: 414,
      spellID: 3389,
      knownCards: [knownCard],
      sourceEvent: { type: 'test:source-mark-spell' }
    } as RoomMoveContext

    candidateCard.confirmKnown()
    candidateCard.setLocationCandidates([sourceMark, otherHand])

    expect(room.movement.resolveSourcePlayerCandidate(candidateCard, context)).toBe(true)
    expect(candidateCard.subZone).toBe('mark')
    expect(candidateCard.spellID).toBe(414)

    knownCard.confirmKnown()
    knownCard.setLocationCandidates([sourceMark, otherHand])
    placeholder.bindCandidates([6], 'mark', 414, { known: false })

    expect(room.movement.getSourcePlaceholderReplacementCandidate(knownCard, context)).toEqual(
      expect.objectContaining(otherHand)
    )
    expect(room.movement.swapKnownCardWithPlayerSourcePlaceholder(knownCard, context)).toBe(
      placeholder
    )
    expect(room.movement.isCardInPlayerSource(knownCard, context)).toBe(true)
    expect(knownCard.subZone).toBe('mark')
    expect(knownCard.spellID).toBe(414)
    expect(placeholder.subZone).toBe('hand')
    expect(placeholder.spellID).toBe(null)
    expect(placeholder.seats.has(7)).toBe(true)
  })

  it('玩家暗标记来源保留 spell ID 数组中的全部兼容值', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [6] })
    const first = getCard(room, 1)
    const second = getCard(room, 2)

    room.clearCardsFromPublicZones([first, second])
    first.bindCandidates([6], 'mark', 100, { known: false })
    second.bindCandidates([6], 'mark', 200, { known: false })

    expect(room.movement.getUnknownPlayerSourceCards(6, 'mark', [100, 200])).toEqual([
      first,
      second
    ])
  })

  it('混合完整位置候选即使投影为空也可作为玩家标记来源', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [6, 7] })
    const mixedCandidate = getCard(room, 1)
    const exactSource = getCard(room, 2)
    const incompatibleCandidate = getCard(room, 3)
    const otherHand = playerLocation(7, 'hand')

    mixedCandidate.setLocationCandidates([playerLocation(6, 'mark', 414), otherHand])
    exactSource.bindCandidates([6], 'mark', 414, { known: false })
    incompatibleCandidate.setLocationCandidates([playerLocation(6, 'mark', 999), otherHand])

    expect(mixedCandidate.subZone).toBe(null)
    expect(mixedCandidate.spellID).toBe(null)
    expect(room.movement.getUnknownPlayerSourceCards(6, 'mark', 3389)).toEqual([
      exactSource,
      mixedCandidate
    ])
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

    const state = room.getSkillState('hiddenMarkCandidates')
    const record = state.records.get('1:1:1234')
    const group = room.constraintGroups.get('hidden_mark_1:1:1234')

    expect(record.knownMarkMin).toBe(markCount)
    expect(record.knownMarkMax).toBe(markCount)
    expect(group.expectedSlotsByLocation.get(createLocationCandidateKey(hand))).toBe(4 - markCount)
    expect(group.expectedSlotsByLocation.get(createLocationCandidateKey(mark))).toBe(markCount)
    cards.forEach((card) => {
      expect(
        card
          .getLocationCandidates()
          .map((candidate) => createLocationCandidateKey(candidate))
          .sort()
      ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())
    })
  })

  it('混有暗牌时只展示候选，不创建强约束', () => {
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

    const record = room.getSkillState('hiddenMarkCandidates').records.get('1:1:1234')

    expect(record.knownMarkMin).toBe(0)
    expect(record.knownMarkMax).toBe(2)
    expect(room.constraintGroups.has('hidden_mark_1:1:1234')).toBe(false)
    cards.forEach((card) => {
      expect(
        card
          .getLocationCandidates()
          .map((candidate) => createLocationCandidateKey(candidate))
          .sort()
      ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())
    })
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
        card
          .getLocationCandidates()
          .map((candidate) => createLocationCandidateKey(candidate))
          .sort()
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
        card
          .getLocationCandidates()
          .map((candidate) => createLocationCandidateKey(candidate))
          .sort()
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

  it('木马一明一暗暗放入标记区时只创建弱候选', () => {
    const { room } = createTestRoom({ cardIDs: [161, 1, 2], seatIDs: [1] })
    const knownCard = getCard(room, 1)
    const hiddenCard = getCard(room, 2)
    const hand = playerLocation(1, 'hand')
    const mark = equipmentContainer(161, 700)

    room.moveCards([161], 'player', {
      seatID: 1,
      subZone: 'equip',
      fromZone: 'pile',
      spellID: 700,
      cardCount: 1,
      sourceEvent: { type: 'test:muniu-equip' }
    })
    moveKnownCardsToHand(room, [1], 1)
    room.moveCards([0], 'player', {
      seatID: 1,
      subZone: 'hand',
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'test:unknown-hand' }
    })
    room.players.get(1).syncObservedHandCount(2)
    moveHiddenHandToMark(room, {
      seatID: 1,
      count: 1,
      spellID: 700
    })

    const state = room.getSkillState('hiddenMarkCandidates')
    const record = state.records.get('1:1:700')

    expect(record.knownMarkMin).toBe(0)
    expect(record.knownMarkMax).toBe(1)
    expect(room.constraintGroups.has('hidden_mark_1:1:700')).toBe(false)
    expect(
      knownCard
        .getLocationCandidates()
        .map((candidate) => createLocationCandidateKey(candidate))
        .sort()
    ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())
    expect(hiddenCard.isKnown).toBe(false)
    expect(hiddenCard.subZone).toBe('mark')
    expect(hiddenCard.spellID).toBe(700)
  })

  it('木马全明暗置时使用装备容器位置创建强约束', () => {
    const { room } = createTestRoom({ cardIDs: [161, 1, 2, 3, 4], seatIDs: [1, 2] })
    const cards = [1, 2, 3, 4].map((id) => getCard(room, id))
    const hand = playerLocation(1, 'hand')
    const mark = equipmentContainer(161, 700)

    room.moveCards([161], 'player', {
      seatID: 1,
      subZone: 'equip',
      fromZone: 'pile',
      spellID: 700,
      cardCount: 1,
      sourceEvent: { type: 'test:muniu-equip' }
    })
    moveKnownCardsToHand(room, [1, 2, 3, 4], 1)
    room.players.get(1).syncObservedHandCount(4)
    moveHiddenHandToMark(room, {
      seatID: 1,
      count: 1,
      spellID: 700
    })

    const group = room.constraintGroups.get('hidden_mark_1:1:700')

    expect(group.expectedSlotsByLocation.get(createLocationCandidateKey(hand))).toBe(3)
    expect(group.expectedSlotsByLocation.get(createLocationCandidateKey(mark))).toBe(1)
    cards.forEach((card) => {
      expect(
        card
          .getLocationCandidates()
          .map((candidate) => createLocationCandidateKey(candidate))
          .sort()
      ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())
    })

    room.moveCards([161], 'player', {
      seatID: 2,
      fromSeatID: 1,
      fromZone: 6,
      fromSubZone: 'equip',
      subZone: 'equip',
      spellID: 0,
      cardCount: 1,
      sourceEvent: { type: 'test:move-muniu-equip-by-other-skill' }
    })

    const movedGroup = room.constraintGroups.get('hidden_mark_1:2:700')

    expect(movedGroup.expectedSlotsByLocation.get(createLocationCandidateKey(mark))).toBe(1)
    expect(room.locationIndex.markBySeatAndSpell.get(2).get(700)).toEqual(
      expect.arrayContaining(cards)
    )
  })

  it('木马标记候选不残留在牌堆公共区', () => {
    const { room } = createTestRoom({ cardIDs: [152, 153], seatIDs: [4] })
    const card = getCard(room, 152)
    const mark = playerLocation(4, 'mark', 700)

    card.confirmKnown()
    card.setLocationCandidates([mark])
    const pileCountBefore = room.zones.get('pile').cards.length

    expect(room.zones.get('pile').cards).not.toContain(card)

    room.moveCards([152], 'process', {
      fromSeatID: 4,
      fromZone: null,
      fromSubZone: 'mark',
      spellID: 700,
      cardCount: 1,
      sourceEvent: { type: 'test:muniu-mark-to-process' }
    })

    expect(room.zones.get('pile').cards.length).toBe(pileCountBefore)
    expect(card.location).toBe('process')
  })

  it('木马从标记区打出时按标记来源收敛剩余候选', () => {
    const { room } = createTestRoom({ cardIDs: [152, 153], seatIDs: [4] })
    const movedCard = getCard(room, 152)
    const remainingCard = getCard(room, 153)
    const hand = playerLocation(4, 'hand')
    const mark = playerLocation(4, 'mark', 700)

    ;[movedCard, remainingCard].forEach((card) => {
      card.confirmKnown()
      card.setLocationCandidates([hand, mark])
    })

    room.createConstraintGroup({
      id: 'test:muniu-mark-source',
      cards: [movedCard, remainingCard],
      expectedSlotsByLocation: new Map([
        [createLocationCandidateKey(mark), 1],
        [createLocationCandidateKey(hand), 1]
      ])
    })

    room.moveCards([152], 'process', {
      fromSeatID: 4,
      fromZone: null,
      fromSubZone: 'mark',
      spellID: 700,
      cardCount: 1,
      sourceEvent: { type: 'test:muniu-mark-to-process' }
    })

    expect(remainingCard.subZone).toBe('hand')
    expect(remainingCard.spellID).toBe(null)
    expect(remainingCard.getLocationCandidates()).toEqual([])
  })

  it('木马候选明牌从标记区打出时用暗占位替回手牌', () => {
    const { room } = createTestRoom({ cardIDs: [152, 153], seatIDs: [4] })
    const knownCard = getCard(room, 152)
    const placeholderCard = getCard(room, 153)
    const hand = playerLocation(4, 'hand')
    const mark = equipmentContainer(161, 700)

    room.moveCards([161], 'player', {
      seatID: 4,
      subZone: 'equip',
      fromZone: 'pile',
      spellID: 700,
      cardCount: 1,
      sourceEvent: { type: 'test:muniu-equip' }
    })
    moveKnownCardsToHand(room, [152], 4)
    room.moveCards([0], 'player', {
      seatID: 4,
      subZone: 'hand',
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'test:unknown-hand' }
    })
    room.players.get(4).syncObservedHandCount(2)
    moveHiddenHandToMark(room, {
      seatID: 4,
      count: 1,
      spellID: 700
    })

    const pileCountBefore = room.zones.get('pile').cards.length

    expect(
      knownCard
        .getLocationCandidates()
        .map((candidate) => createLocationCandidateKey(candidate))
        .sort()
    ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())
    expect(placeholderCard.subZone).toBe('mark')
    expect(placeholderCard.spellID).toBe(700)

    room.moveCards([152], 'process', {
      fromSeatID: 4,
      fromZone: null,
      fromSubZone: 'mark',
      spellID: 700,
      cardCount: 1,
      sourceEvent: { type: 'test:muniu-known-mark-to-process' }
    })

    expect(room.zones.get('pile').cards.length).toBe(pileCountBefore)
    expect(knownCard.location).toBe('process')
    expect(placeholderCard.location).toBe('player')
    expect(placeholderCard.subZone).toBe('hand')
    expect(placeholderCard.isKnown).toBe(false)
  })

  it('木马暗占位对应牌堆明牌时回补占位保持牌堆数量', () => {
    const { room } = createTestRoom({ cardIDs: [152, 153], seatIDs: [4] })
    const knownCard = getCard(room, 152)
    const placeholderCard = getCard(room, 153)

    room.moveCards([0], 'player', {
      seatID: 4,
      subZone: 'hand',
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'test:unknown-hand' }
    })
    room.players.get(4).syncObservedHandCount(1)
    moveHiddenHandToMark(room, {
      seatID: 4,
      count: 1,
      spellID: 700
    })

    const pileCountBefore = room.zones.get('pile').cards.length

    expect(placeholderCard.subZone).toBe('mark')
    expect(placeholderCard.spellID).toBe(700)
    expect(room.zones.get('pile').cards).toContain(knownCard)

    room.moveCards([152], 'process', {
      fromSeatID: 4,
      fromZone: null,
      fromSubZone: 'mark',
      spellID: 700,
      cardCount: 1,
      sourceEvent: { type: 'test:muniu-hidden-mark-to-process' }
    })

    expect(room.zones.get('pile').cards.length).toBe(pileCountBefore)
    expect(room.zones.get('pile').cards).toContain(placeholderCard)
    expect(knownCard.location).toBe('process')
  })

  it('移动木马装备本体时同步迁移木马标记空间', () => {
    const { room } = createTestRoom({ cardIDs: [161, 152, 153], seatIDs: [4, 5] })
    const muniu = getCard(room, 161)
    const knownCard = getCard(room, 152)
    const placeholderCard = getCard(room, 153)
    const hand = playerLocation(4, 'hand')
    const mark = equipmentContainer(161, 700)

    room.moveCards([161], 'player', {
      seatID: 4,
      subZone: 'equip',
      fromZone: 'pile',
      spellID: 700,
      cardCount: 1,
      sourceEvent: { type: 'test:muniu-equip' }
    })
    moveKnownCardsToHand(room, [152], 4)
    room.moveCards([0], 'player', {
      seatID: 4,
      subZone: 'hand',
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'test:unknown-hand' }
    })
    room.players.get(4).syncObservedHandCount(2)
    moveHiddenHandToMark(room, {
      seatID: 4,
      count: 1,
      spellID: 700
    })

    expect(
      knownCard
        .getLocationCandidates()
        .map((candidate) => createLocationCandidateKey(candidate))
        .sort()
    ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())
    expect(placeholderCard.seats.has(4)).toBe(true)

    room.moveCards([161], 'player', {
      seatID: 5,
      fromSeatID: 4,
      fromZone: 6,
      fromSubZone: 'equip',
      subZone: 'equip',
      spellID: 0,
      cardCount: 1,
      sourceEvent: { type: 'test:move-muniu-equip' }
    })

    const record = room.getSkillState('hiddenMarkCandidates').records.get('4:5:700')

    expect(muniu.location).toBe('player')
    expect(muniu.subZone).toBe('equip')
    expect(muniu.seats.has(5)).toBe(true)
    expect(record).toBeTruthy()
    expect(record.targetSeat).toBe(5)
    expect(room.getSkillState('hiddenMarkCandidates').records.has('4:4:700')).toBe(false)
    expect(knownCard.location).toBe('player')
    expect(knownCard.subZone).toBe('hand')
    expect(knownCard.seats.has(4)).toBe(true)
    expect(
      knownCard
        .getLocationCandidates()
        .map((candidate) => createLocationCandidateKey(candidate))
        .sort()
    ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())
    expect(placeholderCard.location).toBe('player')
    expect(placeholderCard.subZone).toBe('mark')
    expect(placeholderCard.spellID).toBe(700)
    expect(placeholderCard.seats.has(5)).toBe(true)
    expect(room.locationIndex.markBySeatAndSpell.get(5).get(700)).toContain(knownCard)

    room.moveCards([], 'player', {
      seatID: 5,
      fromSeatID: 4,
      fromZone: null,
      fromSubZone: 'mark',
      subZone: 'mark',
      spellID: 700,
      cardCount: 1,
      position: 65280,
      fromPosition: 65282,
      sourceEvent: { type: 'test:empty-muniu-mark-sync' }
    })

    expect(
      knownCard
        .getLocationCandidates()
        .map((candidate) => createLocationCandidateKey(candidate))
        .sort()
    ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())
    expect(room.locationIndex.markBySeatAndSpell.get(5).get(700)).toContain(knownCard)
  })

  it('主视角看到木马内只有其他明牌时将弱候选收敛回手牌', () => {
    const { room } = createTestRoom({
      cardIDs: [161, 24, 70, 85, 119, 43, 200],
      seatIDs: [6, 7]
    })
    const visibleCards = [24, 70].map((id) => getCard(room, id))
    const candidateCards = [85, 119, 43].map((id) => getCard(room, id))
    const hand = playerLocation(6, 'hand')
    const mark = equipmentContainer(161, 700)

    room.moveCards([161], 'player', {
      seatID: 6,
      subZone: 'equip',
      fromZone: 'pile',
      spellID: 700,
      cardCount: 1,
      sourceEvent: { type: 'test:muniu-equip' }
    })
    room.moveCards([24, 70], 'player', {
      seatID: 6,
      subZone: 'mark',
      fromZone: 'pile',
      spellID: 700,
      cardCount: 2,
      sourceEvent: { type: 'test:existing-muniu-mark' }
    })
    moveKnownCardsToHand(room, [85, 119, 43], 6)
    room.moveCards([0], 'player', {
      seatID: 6,
      subZone: 'hand',
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'test:unknown-hand' }
    })
    room.players.get(6).syncObservedHandCount(4)
    moveHiddenHandToMark(room, {
      seatID: 6,
      count: 1,
      spellID: 700
    })

    candidateCards.forEach((card) => {
      expect(
        card
          .getLocationCandidates()
          .map((candidate) => createLocationCandidateKey(candidate))
          .sort()
      ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())
    })

    room.moveCards([161], 'player', {
      seatID: 7,
      fromSeatID: 6,
      fromZone: 6,
      fromSubZone: 'equip',
      subZone: 'equip',
      spellID: 0,
      cardCount: 1,
      sourceEvent: { type: 'test:move-muniu-equip' }
    })
    room.moveCards([24, 70], 'player', {
      seatID: 7,
      fromSeatID: 6,
      fromZone: null,
      fromSubZone: 'mark',
      fromSpellID: 700,
      subZone: 'mark',
      spellID: 700,
      cardCount: 2,
      position: 65280,
      fromPosition: 65282,
      sourceEvent: { type: 'test:visible-muniu-mark-snapshot' }
    })

    expect(room.getSkillState('hiddenMarkCandidates').records.has('6:7:700')).toBe(false)
    candidateCards.forEach((card) => {
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('hand')
      expect(card.spellID).toBe(null)
      expect(card.seats.has(6)).toBe(true)
      expect(card.getLocationCandidates()).toEqual([])
      expect(room.locationIndex.markBySeatAndSpell.get(7).get(700)).not.toContain(card)
    })
    expect(room.locationIndex.markBySeatAndSpell.get(7).get(700)).toEqual(
      expect.arrayContaining(visibleCards)
    )
  })

  it('弱候选手牌数同步归零时将唯一手牌候选收敛到木马容器', () => {
    const { room } = createTestRoom({ cardIDs: [161, 117, 152], seatIDs: [4] })
    const candidateCard = getCard(room, 117)
    const hand = playerLocation(4, 'hand')
    const mark = equipmentContainer(161, 700)

    room.moveCards([161], 'player', {
      seatID: 4,
      subZone: 'equip',
      fromZone: 'pile',
      spellID: 700,
      cardCount: 1,
      sourceEvent: { type: 'test:muniu-equip' }
    })
    moveKnownCardsToHand(room, [117], 4)
    room.moveCards([0], 'player', {
      seatID: 4,
      subZone: 'hand',
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'test:unknown-hand' }
    })
    room.players.get(4).syncObservedHandCount(2)
    moveHiddenHandToMark(room, {
      seatID: 4,
      count: 1,
      spellID: 700
    })

    expect(
      candidateCard
        .getLocationCandidates()
        .map((candidate) => createLocationCandidateKey(candidate))
        .sort()
    ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())

    room.syncObservedPlayerHandCount(4, 0)

    expect(candidateCard.getLocationCandidates()).toEqual([mark])
    expect(candidateCard.seats.size).toBe(0)
    expect(room.locationIndex.candidateHandBySeat.get(4)).not.toContain(candidateCard)
    expect(room.locationIndex.markBySeatAndSpell.get(4).get(700)).toContain(candidateCard)
  })

  it('主视角看到木马内候选牌和暗牌时收敛为确定标记牌', () => {
    const { room } = createTestRoom({ cardIDs: [161, 152, 153], seatIDs: [4] })
    const candidateCard = getCard(room, 152)
    const hiddenCard = getCard(room, 153)
    const hand = playerLocation(4, 'hand')
    const mark = equipmentContainer(161, 700)

    room.moveCards([161], 'player', {
      seatID: 4,
      subZone: 'equip',
      fromZone: 'pile',
      spellID: 700,
      cardCount: 1,
      sourceEvent: { type: 'test:muniu-equip' }
    })
    moveKnownCardsToHand(room, [152], 4)
    room.moveCards([0], 'player', {
      seatID: 4,
      subZone: 'hand',
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'test:unknown-hand' }
    })
    room.players.get(4).syncObservedHandCount(2)
    moveHiddenHandToMark(room, {
      seatID: 4,
      count: 1,
      spellID: 700
    })

    expect(
      candidateCard
        .getLocationCandidates()
        .map((candidate) => createLocationCandidateKey(candidate))
        .sort()
    ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())
    expect(hiddenCard.isKnown).toBe(false)
    expect(hiddenCard.subZone).toBe('mark')

    room.moveCards([152, 153], 'player', {
      seatID: 4,
      fromSeatID: 4,
      fromZone: null,
      fromSubZone: 'mark',
      subZone: 'mark',
      spellID: 700,
      cardCount: 2,
      sourceEvent: { type: 'test:reveal-muniu-mark' }
    })

    expect(room.getSkillState('hiddenMarkCandidates').records.has('4:4:700')).toBe(false)
    ;[candidateCard, hiddenCard].forEach((card) => {
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('mark')
      expect(card.spellID).toBe(700)
      expect(card.seats.has(4)).toBe(true)
      expect(card.isKnown).toBe(true)
      expect(card.getLocationCandidates()).toEqual([])
    })
  })
})
