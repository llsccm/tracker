import { describe, expect, it } from 'vitest'
import type { Room } from '@/tracker/Room'
import { HIDDEN_MARK_STATE_KEY } from '@/tracker/room/movement/types'
import type { HiddenMarkRecord, HiddenMarkState } from '@/tracker/room/movement/types'
import { createTestRoom } from '../helpers/room'
import {
  moveHiddenHandToMark,
  moveKnownCardsToHand,
  moveUnknownCardsToHand
} from '../helpers/hiddenMarks'

const MUNIU_SPELL_ID = 700
const PLAYER_MARK_SPELL_ID = 500

function getSingleRecord(room: Room): HiddenMarkRecord {
  const state = room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)
  const records = Array.from(state?.records?.values() ?? [])
  expect(records.length).toBe(1)
  return records[0]!
}

function countAnonymousHand(room, seatID: number): number {
  return room.cards.filter(
    (card) =>
      card.location === 'player' &&
      card.subZone === 'hand' &&
      card.seats.has(seatID) &&
      card.isAnonymous
  ).length
}

describe('mark 空间守恒原语 reconcileMarkSpace', () => {
  it.each([
    { space: '普通标记', spellID: PLAYER_MARK_SPELL_ID },
    { space: '木牛容器', spellID: MUNIU_SPELL_ID }
  ])('$space 确认占住名额后，溢出匿名占位回来源手牌而非 outside', ({ spellID }) => {
    const seatID = 3
    const { room } = createTestRoom({
      cardIDs: [141, 900, 901, 902, 903, 904],
      seatIDs: [1, 2, 3],
      materializeDeckIdentities: false
    })

    moveKnownCardsToHand(room, [141], seatID)
    moveUnknownCardsToHand(room, 2, seatID)
    moveHiddenHandToMark(room, { seatID, count: 1, spellID })

    const record = getSingleRecord(room)
    expect(record.hiddenCount).toBe(1)
    expect(record.placeholderCards.size).toBe(1)
    const placeholder = Array.from(record.placeholderCards)[0]
    const handBefore = countAnonymousHand(room, seatID)

    const card141 = room.cardIndex.get(141)!
    record.confirmedHandCards.delete(card141)
    record.confirmedMarkCards.add(card141)
    const changed = room.movement.hiddenMarks.bindConfirmedMarkCardToMarkSpace(
      record,
      card141,
      'test:confirm'
    )

    expect(changed).toBe(true)
    // 占位被挤出账本，回到来源手牌，保持匿名
    expect(record.placeholderCards.size).toBe(0)
    expect(placeholder.location).toBe('player')
    expect(placeholder.subZone).toBe('hand')
    expect(placeholder.seats.has(seatID)).toBe(true)
    expect(placeholder.isAnonymous).toBe(true)
    // 来源手牌匿名数量 +1（占位挤回），不丢 outside
    expect(countAnonymousHand(room, seatID)).toBe(handBefore + 1)
    expect(room.zones.get('outside')?.cards ?? []).not.toContain(placeholder)
  })

  it('连续两次 confirm 同一 record 不产生负占位或重复回收', () => {
    const seatID = 3
    const { room } = createTestRoom({
      cardIDs: [141, 142, 900, 901, 902, 903, 904],
      seatIDs: [1, 2, 3],
      materializeDeckIdentities: false
    })

    moveKnownCardsToHand(room, [141, 142], seatID)
    moveUnknownCardsToHand(room, 3, seatID)
    moveHiddenHandToMark(room, { seatID, count: 2, spellID: PLAYER_MARK_SPELL_ID })

    const record = getSingleRecord(room)
    expect(record.hiddenCount).toBe(2)
    expect(record.placeholderCards.size).toBe(2)

    for (const id of [141, 142]) {
      const card = room.cardIndex.get(id)!
      record.confirmedHandCards.delete(card)
      record.confirmedMarkCards.add(card)
      room.movement.hiddenMarks.bindConfirmedMarkCardToMarkSpace(record, card, 'test:confirm')
    }

    // 两次确认后占位全部挤回，无负数、无残留
    expect(record.placeholderCards.size).toBe(0)
    // 幂等：再次 reconcile 不再回收
    expect(room.movement.hiddenMarks.reconcileMarkSpace(record, 'test:idempotent')).toBe(false)
  })
})
