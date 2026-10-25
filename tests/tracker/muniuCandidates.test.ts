import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import { normalizeMoveEvent } from '@/tracker/protocol/MoveEventNormalizer'
import type { Room } from '@/tracker/Room'
import type { SeatID } from '@/tracker/types'
import { HIDDEN_MARK_STATE_KEY, type HiddenMarkState } from '@/tracker/room/movement/types'
import { trackerLogger } from '@/utils/logger'
import { createTestRoom, getCard, takeAnonymousCard } from './helpers/room'
import { equipmentContainer, playerLocation } from './helpers/locationCandidates'
import {
  moveHiddenHandToMark,
  moveKnownCardsToHand,
  moveUnknownCardsToHand
} from './helpers/hiddenMarks'

afterEach(() => vi.restoreAllMocks())

function equipMuniu(room: Room, seatID: SeatID): void {
  room.moveCards([161], {
    from: { type: 'public', zone: 'pile', position: POSITION_TOP },
    to: { type: 'player', seatID: seatID, subZone: 'equip' },
    triggerSpellID: 700,
    cardCount: 1,
    sourceEvent: { type: 'test:muniu-equip' }
  })
}

function moveMuniuMarks(room: Room, fromSeatID: SeatID, seatID: SeatID, count = 1): void {
  const event = normalizeMoveEvent({
    CardCount: count,
    CardIDs: [],
    FromID: fromSeatID,
    FromPosition: 65282,
    FromZone: 4,
    FromZoneParam: 700,
    MoveType: 19,
    SpellID: 700,
    ToID: seatID,
    ToPosition: 65280,
    ToZone: 4,
    ToZoneParam: 700
  })
  room.moveCards(event.cardIDs, {
    ...event.options,
    from: event.from,
    to: event.to,
    triggerSpellID: event.protocol.SpellID
  })
}

describe('木牛流马候选与收敛', () => {
  describe('暗置候选与名额', () => {
    it('木马一明一暗暗放入标记区时保留零到一张明牌名额', () => {
      const { room } = createTestRoom({ cardIDs: [161, 1, 2], seatIDs: [1] })
      const knownCard = getCard(room, 1)
      const hand = playerLocation(1, 'hand')
      const mark = equipmentContainer(161, 700)

      equipMuniu(room, 1)
      moveKnownCardsToHand(room, [1], 1)
      moveUnknownCardsToHand(room, 1, 1)
      room.players.get(1).syncObservedHandCount(2)
      moveHiddenHandToMark(room, {
        seatID: 1,
        count: 1,
        spellID: 700
      })
      const hiddenCard = room.playerCardsSnapshot.find(
        (card) => card.isAnonymous && card.subZone === 'mark'
      )!

      const state = room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)!
      const record = state.records.get('1:muniu:161')!

      expect(record.knownMarkMin).toBe(0)
      expect(record.knownMarkMax).toBe(1)
      expect(
        room.constraintGroups
          .get('hidden_mark_1:muniu:161')!
          .expectedSlotsByLocation.get('container:equipment:161:700')
      ).toEqual({ min: 0, max: 1 })
      expect(
        knownCard.locationCandidates
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

      equipMuniu(room, 1)
      moveKnownCardsToHand(room, [1, 2, 3, 4], 1)
      room.players.get(1).syncObservedHandCount(4)
      moveHiddenHandToMark(room, {
        seatID: 1,
        count: 1,
        spellID: 700
      })

      const group = room.constraintGroups.get('hidden_mark_1:muniu:161')

      expect(group.expectedSlotsByLocation.get(createLocationCandidateKey(hand))).toEqual({
        min: 3,
        max: 3
      })
      expect(group.expectedSlotsByLocation.get(createLocationCandidateKey(mark))).toEqual({
        min: 1,
        max: 1
      })
      cards.forEach((card) => {
        expect(
          card.locationCandidates.map((candidate) => createLocationCandidateKey(candidate)).sort()
        ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())
      })

      room.moveCards([161], {
        from: { type: 'player', seatID: 1, subZone: 'equip' },
        to: { type: 'player', seatID: 2, subZone: 'equip' },
        triggerSpellID: 0,
        cardCount: 1,
        sourceEvent: { type: 'test:move-muniu-equip-by-other-skill' }
      })

      expect(room.constraintGroups.get('hidden_mark_1:muniu:161')).toBe(group)
      expect(group.candidateSeats).toEqual(new Set([1]))
      moveMuniuMarks(room, 1, 2)

      const movedGroup = room.constraintGroups.get('hidden_mark_1:muniu:161')

      expect(movedGroup.id).toBe(group.id)
      expect(movedGroup.candidateSeats).toEqual(new Set([1, 2]))
      expect(room.constraintGroups.has('hidden_mark_1:2:700')).toBe(false)
      expect(movedGroup.expectedSlotsByLocation.get(createLocationCandidateKey(mark))).toEqual({
        min: 1,
        max: 1
      })
      expect(room.locationIndex.markBySeatAndSpell.get(2).get(700)).toEqual(
        expect.arrayContaining(cards)
      )
    })
  })

  describe('标记出牌与占位置换', () => {
    it('木马标记候选不残留在牌堆公共区', () => {
      const { room } = createTestRoom({ cardIDs: [152, 153], seatIDs: [4] })
      const card = getCard(room, 152)
      const mark = playerLocation(4, 'mark', 700)

      card.confirmKnown()
      card.setLocationCandidates([mark])
      const pileCountBefore = room.zones.get('pile').cards.length

      expect(room.zones.get('pile').cards).not.toContain(card)

      room.moveCards([152], {
        from: { type: 'player', seatID: 4, subZone: 'mark', markSpellID: 700 },
        to: { type: 'public', zone: 'process', position: POSITION_TOP },
        triggerSpellID: 700,
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

      room.moveCards([152], {
        from: { type: 'player', seatID: 4, subZone: 'mark', markSpellID: 700 },
        to: { type: 'public', zone: 'process', position: POSITION_TOP },
        triggerSpellID: 700,
        cardCount: 1,
        sourceEvent: { type: 'test:muniu-mark-to-process' }
      })

      expect(remainingCard.subZone).toBe('hand')
      expect(remainingCard.spellID).toBe(null)
      expect(remainingCard.locationCandidates).toEqual([])
    })

    it('木马候选明牌从标记区打出时用暗占位替回手牌', () => {
      const { room } = createTestRoom({ cardIDs: [161, 152, 153], seatIDs: [4] })
      getCard(room, 161)
      const knownCard = getCard(room, 152)
      const hand = playerLocation(4, 'hand')
      const mark = equipmentContainer(161, 700)

      equipMuniu(room, 4)
      moveKnownCardsToHand(room, [152], 4)
      moveUnknownCardsToHand(room, 1, 4)
      room.players.get(4).syncObservedHandCount(2)
      moveHiddenHandToMark(room, {
        seatID: 4,
        count: 1,
        spellID: 700
      })
      const placeholderCard = room.playerCardsSnapshot.find(
        (card) => card.isAnonymous && card.subZone === 'mark'
      )!

      const pileCountBefore = room.zones.get('pile').cards.length

      expect(
        knownCard.locationCandidates
          .map((candidate) => createLocationCandidateKey(candidate))
          .sort()
      ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())
      expect(placeholderCard.subZone).toBe('mark')
      expect(placeholderCard.spellID).toBe(700)

      room.moveCards([152], {
        from: { type: 'player', seatID: 4, subZone: 'mark', markSpellID: 700 },
        to: { type: 'public', zone: 'process', position: POSITION_TOP },
        triggerSpellID: 700,
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

      moveUnknownCardsToHand(room, 1, 4)
      room.players.get(4).syncObservedHandCount(1)
      moveHiddenHandToMark(room, {
        seatID: 4,
        count: 1,
        spellID: 700
      })
      const placeholderCard = room.playerCardsSnapshot.find(
        (card) => card.isAnonymous && card.subZone === 'mark'
      )!

      const pileCountBefore = room.zones.get('pile').cards.length

      expect(placeholderCard.subZone).toBe('mark')
      expect(placeholderCard.spellID).toBe(700)
      expect(room.zones.get('pile').cards).toContain(knownCard)

      room.moveCards([152], {
        from: { type: 'player', seatID: 4, subZone: 'mark', markSpellID: 700 },
        to: { type: 'public', zone: 'process', position: POSITION_TOP },
        triggerSpellID: 700,
        cardCount: 1,
        sourceEvent: { type: 'test:muniu-hidden-mark-to-process' }
      })

      expect(room.zones.get('pile').cards.length).toBe(pileCountBefore)
      expect(room.zones.get('pile').cards).toContain(placeholderCard)
      expect(knownCard.location).toBe('process')
    })
  })

  describe('迁座与投影', () => {
    it('木马装备本体移动后，标记协议才迁移内部占位与账本', () => {
      const { room } = createTestRoom({ cardIDs: [161, 152, 153], seatIDs: [4, 5] })
      const muniu = getCard(room, 161)
      const knownCard = getCard(room, 152)
      const hand = playerLocation(4, 'hand')
      const mark = equipmentContainer(161, 700)

      equipMuniu(room, 4)
      moveKnownCardsToHand(room, [152], 4)
      moveUnknownCardsToHand(room, 1, 4)
      room.players.get(4).syncObservedHandCount(2)
      moveHiddenHandToMark(room, {
        seatID: 4,
        count: 1,
        spellID: 700
      })
      const placeholderCard = room.playerCardsSnapshot.find(
        (card) => card.isAnonymous && card.subZone === 'mark'
      )!

      expect(
        knownCard.locationCandidates
          .map((candidate) => createLocationCandidateKey(candidate))
          .sort()
      ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())
      expect(placeholderCard.seats.has(4)).toBe(true)
      const originalRecord = room
        .readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)!
        .records.get('4:muniu:161')!

      room.moveCards([161], {
        from: { type: 'player', seatID: 4, subZone: 'equip' },
        to: { type: 'player', seatID: 5, subZone: 'equip' },
        triggerSpellID: 0,
        cardCount: 1,
        sourceEvent: { type: 'test:move-muniu-equip' }
      })

      expect(originalRecord.targetSeat).toBe(4)
      expect(placeholderCard.seats).toEqual(new Set([4]))
      moveMuniuMarks(room, 4, 5)

      const record = room
        .readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)!
        .records.get('4:muniu:161')!

      expect(muniu.location).toBe('player')
      expect(muniu.subZone).toBe('equip')
      expect(muniu.seats.has(5)).toBe(true)
      expect(record).toBeTruthy()
      expect(record.targetSeat).toBe(5)
      expect(record).toBe(originalRecord)
      expect(record.id).toBe('4:muniu:161')
      expect(room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)!.records.size).toBe(1)
      expect(knownCard.location).toBe('player')
      expect(knownCard.subZone).toBe('hand')
      expect(knownCard.seats.has(4)).toBe(true)
      expect(
        knownCard.locationCandidates
          .map((candidate) => createLocationCandidateKey(candidate))
          .sort()
      ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())
      expect(placeholderCard.location).toBe('player')
      expect(placeholderCard.subZone).toBe('mark')
      expect(placeholderCard.spellID).toBe(700)
      expect(placeholderCard.seats.has(5)).toBe(true)
      expect(room.locationIndex.markBySeatAndSpell.get(5).get(700)).toContain(knownCard)

      room.moveCards([], {
        from: { type: 'player', seatID: 4, subZone: 'mark', markSpellID: 700 },
        to: { type: 'player', seatID: 5, subZone: 'mark', markSpellID: 700 },
        triggerSpellID: 700,
        cardCount: 1,
        sourceEvent: { type: 'test:empty-muniu-mark-sync' }
      })

      expect(
        knownCard.locationCandidates
          .map((candidate) => createLocationCandidateKey(candidate))
          .sort()
      ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())
      expect(room.locationIndex.markBySeatAndSpell.get(5).get(700)).toContain(knownCard)
    })

    it('未观察标记协议时容器候选回退到装备座位且不初始化账本', () => {
      const { room } = createTestRoom({ cardIDs: [161], seatIDs: [4] })

      equipMuniu(room, 4)

      expect(room.readSkillState(HIDDEN_MARK_STATE_KEY)).toBeUndefined()
      expect(
        room.resolveEquipmentContainerLocationCandidates(equipmentContainer(161, 700))
      ).toEqual([playerLocation(4, 'mark', 700)])
      expect(room.readSkillState(HIDDEN_MARK_STATE_KEY)).toBeUndefined()
    })

    it('木牛流马离开装备区后容器候选不再投影到旧标记座位', () => {
      const { room } = createTestRoom({ cardIDs: [161, 152, 153], seatIDs: [4, 5] })
      const knownCard = getCard(room, 152)

      equipMuniu(room, 4)
      moveKnownCardsToHand(room, [152], 4)
      moveUnknownCardsToHand(room, 1, 4)
      room.players.get(4).syncObservedHandCount(2)
      moveHiddenHandToMark(room, { seatID: 4, count: 1, spellID: 700 })

      expect(room.locationIndex.markBySeatAndSpell.get(4).get(700)).toContain(knownCard)

      room.moveCards([161], {
        from: { type: 'player', seatID: 4, subZone: 'equip' },
        to: { type: 'public', zone: 'discard', position: POSITION_TOP },
        triggerSpellID: 987,
        cardCount: 1,
        sourceEvent: { type: 'test:muniu-to-discard' }
      })

      expect(room.cardIndex.get(161)!.location).toBe('discard')
      expect(room.locationIndex.markBySeatAndSpell.get(4)?.get(700) ?? []).not.toContain(knownCard)
    })

    it('木牛流马往返迁座后继续暗置时复用账本与约束 ID，不重复累计名额', () => {
      const { room } = createTestRoom({ cardIDs: [161, 1, 2, 3, 4], seatIDs: [1, 2] })
      equipMuniu(room, 1)
      moveKnownCardsToHand(room, [1, 2, 3, 4], 1)
      room.players.get(1).syncObservedHandCount(4)
      moveHiddenHandToMark(room, { seatID: 1, count: 1, spellID: 700 })

      const state = room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)!
      const record = state.records.get('1:muniu:161')!
      const groupID = record.groupID
      for (const [fromSeatID, seatID] of [
        [1, 2],
        [2, 1]
      ]) {
        room.moveCards([161], {
          from: { type: 'player', seatID: fromSeatID, subZone: 'equip' },
          to: { type: 'player', seatID: seatID, subZone: 'equip' },
          triggerSpellID: 987,
          cardCount: 1
        })
        expect(record.targetSeat).toBe(fromSeatID)
        moveMuniuMarks(room, fromSeatID, seatID)
        expect(state.records.get(record.id)).toBe(record)
        expect(state.records.size).toBe(1)
        expect(record.targetSeat).toBe(seatID)
        expect(record.hiddenCount).toBe(1)
        expect(record.knownMarkMin).toBe(1)
        expect(record.knownMarkMax).toBe(1)
        expect(room.constraintGroups.get(groupID).candidateSeats).toEqual(new Set([1, seatID]))
      }

      moveHiddenHandToMark(room, { seatID: 1, count: 1, spellID: 700 })

      expect(state.records.get('1:muniu:161')).toBe(record)
      expect(record.groupID).toBe(groupID)
      expect(record.hiddenCount).toBe(2)
      expect(record.knownMarkMin).toBe(2)
      expect(record.knownMarkMax).toBe(2)
      expect(record.cards.size).toBe(4)
      const group = room.constraintGroups.get(groupID)
      expect(
        group.expectedSlotsByLocation.get(createLocationCandidateKey(playerLocation(1, 'hand')))
      ).toEqual({ min: 2, max: 2 })
      expect(
        group.expectedSlotsByLocation.get(createLocationCandidateKey(equipmentContainer(161, 700)))
      ).toEqual({ min: 2, max: 2 })
      expect(
        Array.from(room.constraintGroups.keys()).filter(
          (id) => typeof id === 'string' && id.startsWith('hidden_mark_')
        )
      ).toEqual([groupID])
    })

    it('普通标记继续按玩家座位记账，不随木牛流马迁移', () => {
      const { room } = createTestRoom({ cardIDs: [161, 1, 2], seatIDs: [1, 2] })
      equipMuniu(room, 1)
      moveKnownCardsToHand(room, [1, 2], 1)
      room.players.get(1).syncObservedHandCount(2)
      moveHiddenHandToMark(room, { seatID: 1, count: 1, spellID: 1234 })
      const state = room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)!
      const record = state.records.get('1:1:1234')!
      const group = room.constraintGroups.get(record.groupID)

      room.moveCards([161], {
        from: { type: 'player', seatID: 1, subZone: 'equip' },
        to: { type: 'player', seatID: 2, subZone: 'equip' },
        triggerSpellID: 987,
        cardCount: 1
      })

      expect(state.records.get('1:1:1234')).toBe(record)
      expect(state.records.size).toBe(1)
      expect(record.targetSeat).toBe(1)
      expect(room.constraintGroups.get('hidden_mark_1:1:1234')).toBe(group)
      expect(
        group.expectedSlotsByLocation.get(
          createLocationCandidateKey(playerLocation(1, 'mark', 1234))
        )
      ).toEqual({ min: 1, max: 1 })
      expect(group.candidateSeats).toEqual(new Set([1]))
    })
  })

  describe('完整揭示与收敛', () => {
    it('主视角看到木马内只有其他明牌时将弱候选收敛回手牌', () => {
      // 实战约束：
      // 1) 弱候选建立前，不要把快照明牌预置成已知 mark；
      // 2) 24/70 首次出现在主视角全明快照中（此前 unlocated）；
      // 3) 装备先迁到 7 号位后，协议 FromID 仍可能是旧座位 6。
      const { room } = createTestRoom({
        cardIDs: [161, 24, 70, 85, 119, 43, 200, 201],
        seatIDs: [6, 7],
        materializeDeckIdentities: false
      })
      const pile = room.zones.get('pile')!
      ;[161, 85, 119, 43].forEach((cardID) => {
        const slot = pile.cards.find((card) => card.id < 0)
        if (slot) room.materialize(cardID, slot)
      })
      room.applyPileIdentityReveal([161, 85, 119, 43])
      const visibleIDs = [24, 70]
      const candidateCards = [85, 119, 43].map((id) => getCard(room, id))
      const hand = playerLocation(6, 'hand')
      const mark = equipmentContainer(161, 700)

      equipMuniu(room, 6)
      // 不预置 24/70 到 mark；只建立弱候选 + 与快照张数一致的暗占位。
      moveKnownCardsToHand(room, [85, 119, 43], 6)
      moveUnknownCardsToHand(room, 2, 6)
      room.players.get(6).syncObservedHandCount(5)
      moveHiddenHandToMark(room, {
        seatID: 6,
        count: 2,
        spellID: 700
      })

      expect(room.cardIndex.has(24)).toBe(false)
      expect(room.cardIndex.has(70)).toBe(false)
      candidateCards.forEach((card) => {
        expect(
          card.locationCandidates.map((candidate) => createLocationCandidateKey(candidate)).sort()
        ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())
      })

      room.moveCards([161], {
        from: { type: 'player', seatID: 6, subZone: 'equip' },
        to: { type: 'player', seatID: 7, subZone: 'equip' },
        triggerSpellID: 0,
        cardCount: 1,
        sourceEvent: { type: 'test:move-muniu-equip' }
      })

      // 协议：FromZone=4/FromID=6 → ToZone=4/ToID=7，CardIDs 为首次揭示的明牌。
      room.moveCards(visibleIDs, {
        from: { type: 'player', seatID: 6, subZone: 'mark', markSpellID: 700 },
        to: { type: 'player', seatID: 7, subZone: 'mark', markSpellID: 700 },
        triggerSpellID: 700,
        cardCount: 2,
        sourceEvent: {
          type: 'test:visible-muniu-mark-snapshot',
          raw: {
            CardCount: 2,
            CardIDs: visibleIDs,
            FromID: 6,
            FromZone: 4,
            FromZoneParam: 700,
            MoveType: 19,
            SpellID: 700,
            ToID: 7,
            ToZone: 4,
            ToZoneParam: 700
          }
        }
      })

      expect(
        room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)?.records.has('6:muniu:161') ??
          false
      ).toBe(false)
      candidateCards.forEach((card) => {
        expect(card.location).toBe('player')
        expect(card.subZone).toBe('hand')
        expect(card.spellID).toBe(null)
        expect(card.seats.has(6)).toBe(true)
        expect(card.locationCandidates).toEqual([])
        expect(room.locationIndex.markBySeatAndSpell.get(7)?.get(700) ?? []).not.toContain(card)
      })

      const visibleCards = visibleIDs.map((id) => room.cardIndex.get(id))
      visibleCards.forEach((card) => {
        expect(card).toBeTruthy()
        expect(card.location).toBe('player')
        expect(card.subZone).toBe('mark')
        expect(card.spellID).toBe(700)
        expect(card.seats.has(7)).toBe(true)
        expect(card.isKnown).toBe(true)
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

      equipMuniu(room, 4)
      moveKnownCardsToHand(room, [117], 4)
      moveUnknownCardsToHand(room, 1, 4)
      room.players.get(4).syncObservedHandCount(2)
      moveHiddenHandToMark(room, {
        seatID: 4,
        count: 1,
        spellID: 700
      })

      expect(
        candidateCard.locationCandidates
          .map((candidate) => createLocationCandidateKey(candidate))
          .sort()
      ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())

      room.syncObservedPlayerHandCount(4, 0)

      expect(candidateCard.locationCandidates).toEqual([mark])
      expect(candidateCard.seats.size).toBe(0)
      expect(room.locationIndex.candidateHandBySeat.get(4)).not.toContain(candidateCard)
      expect(room.locationIndex.markBySeatAndSpell.get(4).get(700)).toContain(candidateCard)
    })

    it('主视角看到木马内候选牌和暗牌时收敛为确定标记牌', () => {
      const { room } = createTestRoom({ cardIDs: [161, 152, 153, 154], seatIDs: [4] })
      const candidateCard = getCard(room, 152)
      const hand = playerLocation(4, 'hand')
      const mark = equipmentContainer(161, 700)

      equipMuniu(room, 4)
      moveKnownCardsToHand(room, [152], 4)
      moveUnknownCardsToHand(room, 2, 4)
      room.players.get(4).syncObservedHandCount(3)
      moveHiddenHandToMark(room, {
        seatID: 4,
        count: 2,
        spellID: 700
      })
      const placeholders = room.playerCardsSnapshot.filter(
        (card) => card.isAnonymous && card.subZone === 'mark'
      )
      const entityCountBefore = room.cards.length

      expect(
        candidateCard.locationCandidates
          .map((candidate) => createLocationCandidateKey(candidate))
          .sort()
      ).toEqual([createLocationCandidateKey(hand), createLocationCandidateKey(mark)].sort())
      expect(placeholders).toHaveLength(2)
      expect(room.cardIndex.has(153)).toBe(false)

      room.moveCards([152, 153], {
        from: { type: 'player', seatID: 4, subZone: 'mark', markSpellID: 700 },
        to: { type: 'player', seatID: 4, subZone: 'mark', markSpellID: 700 },
        triggerSpellID: 700,
        cardCount: 2,
        sourceEvent: { type: 'test:reveal-muniu-mark' }
      })

      expect(
        room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)?.records.has('4:muniu:161') ??
          false
      ).toBe(false)
      // 候选身份占用一个标记名额时会将其匿名占位挤回手牌；另一个槽才物化为 153。
      const revealedCard = room.cardIndex.get(153)!
      expect(placeholders).toContain(revealedCard)
      expect(room.cards).toHaveLength(entityCountBefore)
      const remainingHand = room.playerCardsSnapshot.filter((card) => card.subZone === 'hand')
      expect(remainingHand).toHaveLength(1)
      expect(remainingHand.every((card) => card.isAnonymous)).toBe(true)
      ;[candidateCard, revealedCard].forEach((card) => {
        expect(card.location).toBe('player')
        expect(card.subZone).toBe('mark')
        expect(card.spellID).toBe(700)
        expect(card.seats.has(4)).toBe(true)
        expect(card.isKnown).toBe(true)
        expect(card.locationCandidates).toEqual([])
      })
    })

    it('木牛流马完整快照来源为技能空间时仍置换当前承载者实体占位', () => {
      const { room } = createTestRoom({ cardIDs: [11, 12, 73, 105], seatIDs: [7] })
      // 显式保留已知身份残留公共区的异常，来源占位仍使用真实匿名实体。
      const visibleMarkCards = [11, 12].map((id) => getCard(room, id)!)
      const hiddenMarkCards = [takeAnonymousCard(room), takeAnonymousCard(room)]

      hiddenMarkCards.forEach((card) => {
        card.bindCandidates([7], 'mark', 700, { known: false })
      })

      room.moveCards(
        visibleMarkCards.map((card) => card.id),
        {
          from: { type: 'player', seatID: 7, subZone: 'mark', markSpellID: 700 },
          to: { type: 'player', seatID: 7, subZone: 'mark', markSpellID: 700 },
          triggerSpellID: 700,
          cardCount: 2,
          sourceEvent: { type: 'test:observed-mount-mark-snapshot-from-space' }
        }
      )

      visibleMarkCards.forEach((card) => {
        expect(card.location).toBe('player')
        expect(card.subZone).toBe('mark')
        expect(card.spellID).toBe(700)
        expect(card.seats.has(7)).toBe(true)
        expect(card.isKnown).toBe(true)
      })
      hiddenMarkCards.forEach((card) => {
        expect(card.location).toBe('pile')
        expect(card.subZone).toBeNull()
        expect(card.seats.has(7)).toBe(false)
      })
      expect(
        room.cards.filter(
          (card) =>
            hiddenMarkCards.includes(card) &&
            card.location === 'player' &&
            card.subZone === 'mark' &&
            card.spellID === 700 &&
            card.seats.has(7)
        )
      ).toHaveLength(0)
      expect(room.publicZones.getPublicZoneConsistencyIssues()).toEqual([])
    })

    it('整手离场揭示 [29,50,113] 时应收敛 141 进木马且不产生实体缺口', () => {
      const seatID = 3
      const room = createTestRoom({
        cardIDs: [141, 29, 50, 113, 900, 901, 902, 903, 904, 905],
        seatIDs: [1, 2, 3],
        materializeDeckIdentities: false
      }).room

      // 3 号位：141(明) + 2 暗牌
      moveKnownCardsToHand(room, [141], seatID)
      moveUnknownCardsToHand(room, 2, seatID)

      // 暗置一张进木马(mark:700)：形成 141 hand/mark 弱候选
      moveHiddenHandToMark(room, { seatID, count: 1, spellID: 700 })

      // 之后拿到明牌 113，最终手牌为 3 张；141 仍保留手牌/木牛弱候选。
      moveKnownCardsToHand(room, [113], seatID)

      const card141 = room.cardIndex.get(141)
      expect(card141, '141 应仍是实体').toBeTruthy()

      const entityCountBefore = room.cards.length
      const markPlaceholders = [
        ...room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)!.records.get('3:muniu:161')!
          .placeholderCards
      ]
      const warnSpy = vi.spyOn(trackerLogger, 'warn')

      // 整手完整离场进处理区，揭示为 [29, 50, 113]，141 不在其中
      room.moveCards([29, 50, 113], {
        from: { type: 'player', seatID: seatID, subZone: 'hand' },
        to: { type: 'public', zone: 'process', position: POSITION_TOP },
        cardCount: 3,
        sourceEvent: { type: 'test:hand-to-process' }
      })

      // 断言 1：不应出现实体缺口 / 置换失败告警
      expect(warnSpy).not.toHaveBeenCalledWith(
        '玩家来源 known 路径实体缺口，将 createExternal',
        expect.anything()
      )
      expect(warnSpy).not.toHaveBeenCalledWith(
        '玩家来源明牌未找到可立即置换的手牌占位',
        expect.anything()
      )

      // 断言 2：29/50/113 都进了处理区
      const processIDs = room.zones
        .get('process')!
        .cards.map((c) => c.id)
        .sort((a, b) => a - b)
      expect(processIDs).toEqual([29, 50, 113])

      // 断言 3：141 收敛进木马容器(mark:700)，不再是任何座位的普通手牌
      const settled141 = room.cardIndex.get(141)!
      expect(settled141.location).toBe('player')
      expect(settled141.locationCandidates.map((c) => createLocationCandidateKey(c))).toEqual([
        createLocationCandidateKey(equipmentContainer(161, 700))
      ])
      // 已被木马容器候选收敛，不再拥有 hand 归属座位
      expect(Array.from(settled141.seats)).toEqual([])
      // 141 不应出现在处理区
      expect(room.zones.get('process')!.cards.map((c) => c.id)).not.toContain(141)

      // 3 号位手牌应清空（整手已离场）
      const handOfSeat3 = room.cards.filter(
        (c) => c.location === 'player' && c.subZone === 'hand' && c.seats.has(seatID)
      )
      expect(handOfSeat3.map((c) => c.id)).toEqual([])

      expect(room.cards).toHaveLength(entityCountBefore)
      markPlaceholders.forEach((card) => {
        expect(card.location).toBe('process')
        expect(room.zones.get('outside')?.cards ?? []).not.toContain(card)
      })
    })
  })
})
