import { describe, expect, it, vi } from 'vitest'
import { isAnonymous } from '@/tracker/Card'
import type { Room } from '@/tracker/Room'
import { HIDDEN_MARK_STATE_KEY } from '@/tracker/roomMovement/types'
import type { HiddenMarkRecord, HiddenMarkState } from '@/tracker/roomMovement/types'
import { trackerLogger } from '@/utils/logger'
import { createTestRoom } from './helpers/room'

const TROJAN_SPELL_ID = 700
const PLAYER_MARK_SPELL_ID = 500
const FOREIGN_SPELL_ID = 999

function dealKnownHand(room, cardIDs, seatID) {
  room.moveCards(cardIDs, 'player', {
    seatID,
    subZone: 'hand',
    fromZone: 'pile',
    cardCount: cardIDs.length,
    sourceEvent: { type: 'test:known-hand' }
  })
}

function dealHiddenHand(room, count, seatID) {
  room.moveCards(Array(count).fill(0), 'player', {
    seatID,
    subZone: 'hand',
    fromZone: 'pile',
    cardCount: count,
    sourceEvent: { type: 'test:hidden-hand' }
  })
}

function hiddenHandToMark(room, { seatID, count, spellID }) {
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
      isAnonymous(card)
  ).length
}

describe('mark 空间守恒原语 reconcileMarkSpace', () => {
  it('player-mark 确认占住名额后，溢出匿名占位回来源手牌而非 outside', () => {
    const seatID = 3
    const { room } = createTestRoom({
      cardIDs: [141, 900, 901, 902, 903, 904],
      seatIDs: [1, 2, 3],
      materializeDeckIdentities: false
    })

    dealKnownHand(room, [141], seatID)
    dealHiddenHand(room, 2, seatID)
    hiddenHandToMark(room, { seatID, count: 1, spellID: PLAYER_MARK_SPELL_ID })

    const record = getSingleRecord(room)
    expect(record.hiddenCount).toBe(1)
    expect(record.placeholderCards.size).toBe(1)
    const placeholder = Array.from(record.placeholderCards)[0]
    const handBefore = countAnonymousHand(room, seatID)

    const card141 = room.cardIndex.get(141)!
    record.confirmedHandCards.delete(card141)
    record.confirmedMarkCards.add(card141)
    const changed = room.movement.bindConfirmedMarkCardToMarkSpace(record, card141, 'test:confirm')

    expect(changed).toBe(true)
    // 占位被挤出账本，回到来源手牌，保持匿名
    expect(record.placeholderCards.size).toBe(0)
    expect(placeholder.location).toBe('player')
    expect(placeholder.subZone).toBe('hand')
    expect(placeholder.seats.has(seatID)).toBe(true)
    expect(isAnonymous(placeholder)).toBe(true)
    // 来源手牌匿名数量 +1（占位挤回），不丢 outside
    expect(countAnonymousHand(room, seatID)).toBe(handBefore + 1)
    expect(room.zones.get('outside')?.cards ?? []).not.toContain(placeholder)
  })

  it('container(木马) 确认占住名额后，溢出占位同样回来源手牌', () => {
    const seatID = 3
    const { room } = createTestRoom({
      cardIDs: [141, 900, 901, 902, 903, 904],
      seatIDs: [1, 2, 3],
      materializeDeckIdentities: false
    })

    dealKnownHand(room, [141], seatID)
    dealHiddenHand(room, 2, seatID)
    hiddenHandToMark(room, { seatID, count: 1, spellID: TROJAN_SPELL_ID })

    const record = getSingleRecord(room)
    const placeholder = Array.from(record.placeholderCards)[0]

    const card141 = room.cardIndex.get(141)!
    record.confirmedHandCards.delete(card141)
    record.confirmedMarkCards.add(card141)
    room.movement.bindConfirmedMarkCardToMarkSpace(record, card141, 'test:confirm')

    expect(record.placeholderCards.size).toBe(0)
    // 木马虽是 container，占位仍有手牌物理背书 → 回手牌，不能 outside
    expect(placeholder.location).toBe('player')
    expect(placeholder.subZone).toBe('hand')
    expect(placeholder.seats.has(seatID)).toBe(true)
  })

  it('连续两次 confirm 同一 record 不产生负占位或重复回收', () => {
    const seatID = 3
    const { room } = createTestRoom({
      cardIDs: [141, 142, 900, 901, 902, 903, 904],
      seatIDs: [1, 2, 3],
      materializeDeckIdentities: false
    })

    dealKnownHand(room, [141, 142], seatID)
    dealHiddenHand(room, 3, seatID)
    hiddenHandToMark(room, { seatID, count: 2, spellID: PLAYER_MARK_SPELL_ID })

    const record = getSingleRecord(room)
    expect(record.hiddenCount).toBe(2)
    expect(record.placeholderCards.size).toBe(2)

    for (const id of [141, 142]) {
      const card = room.cardIndex.get(id)!
      record.confirmedHandCards.delete(card)
      record.confirmedMarkCards.add(card)
      room.movement.bindConfirmedMarkCardToMarkSpace(record, card, 'test:confirm')
    }

    // 两次确认后占位全部挤回，无负数、无残留
    expect(record.placeholderCards.size).toBe(0)
    // 幂等：再次 reconcile 不再回收
    expect(room.movement.reconcileMarkSpace(record, 'test:idempotent')).toBe(false)
  })

  it('无可回收占位时对 mark 配额溢出告警并返回 false', () => {
    const seatID = 3
    const { room } = createTestRoom({
      cardIDs: [141, 142, 900, 901, 902, 903, 904],
      seatIDs: [1, 2, 3],
      materializeDeckIdentities: false
    })

    dealKnownHand(room, [141, 142], seatID)
    dealHiddenHand(room, 1, seatID)
    hiddenHandToMark(room, { seatID, count: 1, spellID: PLAYER_MARK_SPELL_ID })

    const record = getSingleRecord(room)
    record.placeholderCards.clear()
    record.hiddenCount = 2

    for (const id of [141, 142]) {
      const card = room.cardIndex.get(id)!
      record.confirmedHandCards.delete(card)
      record.confirmedMarkCards.add(card)
      room.movement.bindConfirmedMarkCardToMarkSpace(record, card, 'test:confirm')
    }

    record.hiddenCount = 1
    const warnSpy = vi.spyOn(trackerLogger, 'warn')
    const debugSpy = vi.spyOn(trackerLogger, 'debug')
    const changed = room.movement.reconcileMarkSpace(record, 'test:quota-overflow')

    expect(changed).toBe(false)
    expect(record.placeholderCards.size).toBe(0)
    expect(record.confirmedMarkCards.size).toBe(2)
    expect(warnSpy).toHaveBeenCalledWith(
      'mark 空间守恒溢出但无可回收占位',
      expect.objectContaining({
        reason: 'test:quota-overflow',
        hiddenCount: 1,
        confirmedMarkSlotUsers: 2,
        overflow: 1
      })
    )
    expect(debugSpy).not.toHaveBeenCalledWith('mark 空间守恒回收溢出匿名占位', expect.anything())
    warnSpy.mockRestore()
    debugSpy.mockRestore()
  })

  it('错误 spellID 的匿名占位混入账本时不会被误回收', () => {
    const seatID = 3
    const { room } = createTestRoom({
      cardIDs: [141, 900, 901, 902, 903, 904],
      seatIDs: [1, 2, 3],
      materializeDeckIdentities: false
    })

    dealKnownHand(room, [141], seatID)
    dealHiddenHand(room, 2, seatID)
    hiddenHandToMark(room, { seatID, count: 1, spellID: PLAYER_MARK_SPELL_ID })

    const record = getSingleRecord(room)

    // 构造一个属于其它 spell 的匿名 mark 占位，混入本记录账本
    const foreign = room.zones.get('pile')?.cards.find((card) => isAnonymous(card))
    expect(foreign).toBeTruthy()
    foreign!.bindCandidates([seatID], 'mark', FOREIGN_SPELL_ID, { known: false })
    record.placeholderCards.add(foreign!)

    const card141 = room.cardIndex.get(141)!
    record.confirmedHandCards.delete(card141)
    record.confirmedMarkCards.add(card141)
    room.movement.bindConfirmedMarkCardToMarkSpace(record, card141, 'test:confirm')

    // 只回收本 spell 的占位；异 spell 占位保持在 mark，未被误绑回手牌
    expect(record.placeholderCards.has(foreign!)).toBe(true)
    expect(foreign!.subZone).toBe('mark')
    expect(Number(foreign!.spellID)).toBe(FOREIGN_SPELL_ID)
  })

  it('整手完整揭示的守恒回收统一经 reconcileMarkSpace，占位不落 outside', () => {
    const seatID = 3
    const { room } = createTestRoom({
      cardIDs: [141, 29, 50, 113, 900, 901, 902, 903, 904, 905],
      seatIDs: [1, 2, 3],
      materializeDeckIdentities: false
    })

    dealKnownHand(room, [141], seatID)
    dealHiddenHand(room, 2, seatID)
    hiddenHandToMark(room, { seatID, count: 1, spellID: TROJAN_SPELL_ID })
    dealKnownHand(room, [113], seatID)

    const reconcileSpy = vi.spyOn(room.movement, 'reconcileMarkSpace')

    room.moveCards([29, 50, 113], 'process', {
      fromSeatID: seatID,
      fromZone: 5,
      fromSubZone: 'hand',
      cardCount: 3,
      sourceEvent: { type: 'test:hand-to-process' }
    })

    // 守恒回收由原语承担
    expect(reconcileSpy).toHaveBeenCalled()
    // 处理区正确，无占位泄漏到 outside 造成缺口
    const processIDs = room.zones
      .get('process')!
      .cards.map((c) => c.id)
      .sort((a, b) => a - b)
    expect(processIDs).toEqual([29, 50, 113])

    reconcileSpy.mockRestore()
  })
})
