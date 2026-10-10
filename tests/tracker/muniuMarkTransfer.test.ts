import { describe, expect, it } from 'vitest'
import { normalizeMoveEvent } from '@/tracker/MoveEventNormalizer'
import type { Room } from '@/tracker/Room'
import type { RawMoveCardEvent } from '@/tracker/types'
import { HIDDEN_MARK_STATE_KEY, type HiddenMarkState } from '@/tracker/roomMovement/types'
import { createTestRoom } from './helpers/room'

const putIntoMuniu: RawMoveCardEvent = {
  CardCount: 1,
  CardIDs: [],
  FromID: 0,
  FromPosition: 65282,
  FromZone: 5,
  FromZoneParam: 0,
  MoveType: 15,
  SpellID: 700,
  ToID: 0,
  ToPosition: 65280,
  ToZone: 4,
  ToZoneParam: 700
}
const moveMuniu: RawMoveCardEvent = {
  CardCount: 1,
  CardIDs: [161],
  FromID: 0,
  FromPosition: 65282,
  FromZone: 6,
  FromZoneParam: 0,
  MoveType: 15,
  SpellID: 700,
  ToID: 6,
  ToPosition: 65282,
  ToZone: 6,
  ToZoneParam: 0
}
const syncMuniuMarks: RawMoveCardEvent = {
  CardCount: 1,
  CardIDs: [],
  FromID: 0,
  FromPosition: 65282,
  FromZone: 4,
  FromZoneParam: 700,
  MoveType: 19,
  SpellID: 700,
  ToID: 6,
  ToPosition: 65280,
  ToZone: 4,
  ToZoneParam: 700
}

function applyProtocol(room: Room, raw: RawMoveCardEvent): void {
  const event = normalizeMoveEvent(raw)
  expect(event.type).not.toBe('noop')
  room.moveCards(event.cardIDs, event.toZone, event.options)
}

function createMuniuRoom(knownHandCount: number) {
  const { room } = createTestRoom({
    cardIDs: [161, 1, 2, 3, 4],
    seatIDs: [0, 6],
    materializeDeckIdentities: false
  })
  room.moveCards([161], 'player', {
    seatID: 0,
    fromZone: 'pile',
    subZone: 'equip',
    spellID: 700,
    cardCount: 1
  })
  if (knownHandCount > 0) {
    room.moveCards([1, 2].slice(0, knownHandCount), 'player', {
      seatID: 0,
      fromZone: 'pile',
      subZone: 'hand',
      cardCount: knownHandCount
    })
  }
  if (knownHandCount < 2) {
    room.moveCards([], 'player', {
      seatID: 0,
      fromZone: 'pile',
      subZone: 'hand',
      cardCount: 2 - knownHandCount
    })
  }
  room.players.get(0)!.syncObservedHandCount(2)
  return room
}

function cardState(room: Room) {
  return room.cards.map((card) => ({
    entityID: card.entityID,
    id: card.id,
    location: card.location,
    subZone: card.subZone,
    spellID: card.spellID,
    known: card.isKnown,
    seats: Array.from(card.seats),
    candidates: card.getLocationCandidates()
  }))
}

describe('木牛流马原始协议迁座通知', () => {
  it('zone 4 的来源和目标标记空间按 ZoneParam 识别，不被触发技能覆盖', () => {
    const put = normalizeMoveEvent({ ...putIntoMuniu, SpellID: 987 })
    expect(put.options.spellID).toBe(700)
    expect(put.options.fromSubZone).toBe('hand')
    expect(put.options.seatID).toBe(0)
    expect(put.cardCount).toBe(1)
    expect(put.cardIDs).toEqual([])
    const sync = normalizeMoveEvent({ ...syncMuniuMarks, SpellID: 987 })
    expect(sync.type).toBe('moveToMark')
    expect(sync.options.fromSpellID).toBe(700)
    expect(sync.options.spellID).toBe(700)
    expect(sync.options.fromSeatID).toBe(0)
    expect(sync.options.seatID).toBe(6)
  })

  it.each([0, 2])('来源有 %s 张明牌时，仅 mark700 协议迁移内部牌及账本', (knownHandCount) => {
    const room = createMuniuRoom(knownHandCount)
    applyProtocol(room, putIntoMuniu)
    const state = room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)
    const record = state?.records.get('0:muniu:161')
    const beforeEquipMove = cardState(room).filter((card) => card.id !== 161)
    const group = record ? room.constraintGroups.get(record.groupID) : undefined
    const placeholderCards = record ? [...record.placeholderCards] : []
    const originalMarkProjection = (
      room.locationIndex.markBySeatAndSpell.get(0)?.get(700) ?? []
    ).map((card) => card.id)

    applyProtocol(room, moveMuniu)

    expect(room.cardIndex.get(161)!.seats).toEqual(new Set([6]))
    expect(cardState(room).filter((card) => card.id !== 161)).toEqual(beforeEquipMove)
    expect(
      (room.locationIndex.markBySeatAndSpell.get(0)?.get(700) ?? []).map((card) => card.id)
    ).toEqual(originalMarkProjection)
    expect(room.locationIndex.markBySeatAndSpell.get(6)?.get(700) ?? []).toEqual([])
    if (record) {
      expect(record.targetSeat).toBe(0)
      expect(room.constraintGroups.get(record.groupID)).toBe(group)
    }

    const entityCount = room.cards.length
    applyProtocol(room, syncMuniuMarks)

    expect(room.cards.length).toBe(entityCount)
    expect(room.locationIndex.markBySeatAndSpell.get(0)?.get(700) ?? []).toEqual([])
    expect(
      (room.locationIndex.markBySeatAndSpell.get(6)?.get(700) ?? []).map((card) => card.id)
    ).toEqual(originalMarkProjection)
    const concreteMarks = room.cards.filter(
      (card) => card.location === 'player' && card.subZone === 'mark' && card.spellID === 700
    )
    expect(concreteMarks.every((card) => card.seats.has(6))).toBe(true)
    if (knownHandCount === 0) expect(concreteMarks).toHaveLength(1)
    if (record) {
      expect(state!.records.get('0:muniu:161')).toBe(record)
      expect(record.targetSeat).toBe(6)
      expect(record.sourceSeat).toBe(0)
      expect(record.hiddenCount).toBe(1)
      expect([...record.placeholderCards]).toEqual(placeholderCards)
      expect(room.constraintGroups.get(record.groupID)!.candidateSeats).toEqual(new Set([0, 6]))
    }

    const afterTransfer = cardState(room)
    const groupIDs = Array.from(room.constraintGroups.keys())
    const migratedGroup = record ? room.constraintGroups.get(record.groupID) : undefined
    applyProtocol(room, syncMuniuMarks)
    expect(cardState(room)).toEqual(afterTransfer)
    expect(Array.from(room.constraintGroups.keys())).toEqual(groupIDs)
    if (record) expect(room.constraintGroups.get(record.groupID)).toBe(migratedGroup)
  })
  it('mark700 暗迁座保留已知内部牌的身份，不把明牌改成暗占位', () => {
    const room = createMuniuRoom(2)
    applyProtocol(room, { ...putIntoMuniu, CardIDs: [1] })
    const card = room.cardIndex.get(1)!
    const entityCount = room.cards.length
    applyProtocol(room, moveMuniu)
    expect(card.seats).toEqual(new Set([0]))
    expect(card.isKnown).toBe(true)

    applyProtocol(room, syncMuniuMarks)
    expect(card.seats).toEqual(new Set([6]))
    expect(card.id).toBe(1)
    expect(card.subZone).toBe('mark')
    expect(card.spellID).toBe(700)
    expect(card.isKnown).toBe(true)
    expect(room.cards.length).toBe(entityCount)
  })
  it('全明手牌暗置后，带明牌的 mark700 迁座按新座位确认身份', () => {
    const room = createMuniuRoom(2)
    applyProtocol(room, putIntoMuniu)
    const state = room.readSkillState<HiddenMarkState>(HIDDEN_MARK_STATE_KEY)!
    const record = state.records.get('0:muniu:161')!
    applyProtocol(room, moveMuniu)
    expect(record.targetSeat).toBe(0)

    applyProtocol(room, { ...syncMuniuMarks, CardIDs: [1] })

    expect(record.targetSeat).toBe(6)
    expect(record.confirmedMarkCards.has(room.cardIndex.get(1)!)).toBe(true)
    expect(room.cardIndex.get(1)!.seats).toEqual(new Set([6]))
    expect(room.cardIndex.get(1)!.isKnown).toBe(true)
    expect(room.cardIndex.get(2)!.seats).toEqual(new Set([0]))
    expect(room.cardIndex.get(2)!.subZone).toBe('hand')
    expect(state.muniuMarkSeat).toBe(6)
  })
})
