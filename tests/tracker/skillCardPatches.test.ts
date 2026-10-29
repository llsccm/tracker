import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { moveContext } from './helpers/moveContext'
import { afterEach, describe, expect, it } from 'vitest'
import type { Room } from '@/tracker/Room'
import type { PatchedMoveCardFields, RawMoveCardEvent } from '@/tracker/types'
import { registerDefaultMoveEventHandlers } from '@/tracker/skill/registerHandlers'
import { createTestRoom } from './helpers/room'
import { protocolMove, createReadyControllerHarness } from './helpers/trackerController'

const rooms: Room[] = []
afterEach(() => rooms.splice(0).forEach((room) => room.destroy()))

function createSkillRoom(initialState: Record<string, unknown> = {}): Room {
  const { room } = createTestRoom({ cardIDs: [11, 12, 42, 84, 99, 147], seatIDs: [1, 3, 5] })
  registerDefaultMoveEventHandlers(room)
  for (const [key, value] of Object.entries(initialState)) room.setSkillState(key, value)
  rooms.push(room)
  return room
}

function createContext(overrides: Partial<RawMoveCardEvent> & { room?: Room } = {}) {
  const { room = createSkillRoom(), ...fields } = overrides
  return {
    room,
    ...moveContext({
      CardIDs: [],
      CardCount: 0,
      FromID: 1,
      FromZone: 0,
      ToZone: 0,
      MoveType: 0,
      SpellID: 0,
      SrcSeatID: 1,
      ...fields
    })
  }
}

function prepareMove(context: {
  room: Room
  patched: PatchedMoveCardFields
  raw: Readonly<RawMoveCardEvent>
}) {
  context.room.beforeNormalizeMove(context.patched, context.raw)
}

describe('技能插件归一化前补牌', () => {
  it('佐练记录来源明牌并在后续暗牌移动中回填 CardIDs', () => {
    const room = createSkillRoom()

    prepareMove(
      createContext({
        room,
        SpellID: 3488,
        CardIDs: [42],
        FromID: 3,
        FromZone: 5,
        ToZone: 5,
        MoveType: 21
      })
    )

    const toStack = createContext({
      room,
      SpellID: 3488,
      CardIDs: [0],
      FromID: 3,
      FromZone: 5,
      ToZone: 10,
      MoveType: 11
    })

    prepareMove(toStack)

    expect(toStack.patched.CardIDs).toEqual([42])
    expect((room.readSkillState(3488) as { stack?: number }).stack).toBe(42)
    expect((room.readSkillState(3488) as Record<number, number>)[3]).toBeUndefined()

    const fromStack = createContext({
      room,
      SpellID: 3488,
      CardIDs: [0],
      FromZone: 10,
      ToZone: 1,
      MoveType: 11
    })

    prepareMove(fromStack)

    expect(fromStack.patched.CardIDs).toEqual([42])
    expect((room.readSkillState(3488) as { stack?: number }).stack).toBeUndefined()
  })

  it('佐练已知牌进入交换区后，暗牌返回牌堆时回填并清理状态', () => {
    const room = createSkillRoom()

    prepareMove(
      createContext({
        room,
        SpellID: 3488,
        CardIDs: [42],
        FromID: 3,
        FromZone: 5,
        ToZone: 5,
        MoveType: 21
      })
    )

    const toStack = createContext({
      room,
      SpellID: 3488,
      CardIDs: [42],
      FromID: 3,
      FromZone: 5,
      ToZone: 10,
      MoveType: 11
    })

    prepareMove(toStack)

    const spellState = room.readSkillState(3488) as { stack?: number; 3?: number }
    expect(spellState.stack).toBe(42)
    expect(spellState[3]).toBeUndefined()

    const fromStack = createContext({
      room,
      SpellID: 3488,
      CardIDs: [0],
      FromZone: 10,
      ToZone: 1,
      MoveType: 11
    })

    prepareMove(fromStack)

    expect(fromStack.patched.CardIDs).toEqual([42])
    expect(spellState.stack).toBeUndefined()
  })

  it('佐练全程未知时保持暗牌 CardIDs，不回填 0', () => {
    const room = createSkillRoom({ 3488: { stack: 99 } })
    const toStack = createContext({
      room,
      SpellID: 3488,
      CardIDs: [],
      FromID: 3,
      FromZone: 5,
      ToZone: 10,
      MoveType: 11
    })

    prepareMove(toStack)

    expect(toStack.patched.CardIDs).toEqual([])
    expect(room.readSkillState(3488)).toEqual({})

    const fromStack = createContext({
      room,
      SpellID: 3488,
      CardIDs: [],
      FromZone: 10,
      ToZone: 1,
      MoveType: 11
    })

    prepareMove(fromStack)

    expect(fromStack.patched.CardIDs).toEqual([])
    expect((room.readSkillState(3488) as { stack?: number }).stack).toBeUndefined()
  })

  it('佐练已知牌返回牌堆时保留 CardIDs 并清理 stack', () => {
    const room = createSkillRoom({ 3488: { stack: 42 } })
    const fromStack = createContext({
      room,
      SpellID: 3488,
      CardIDs: [84],
      FromZone: 10,
      ToZone: 1,
      MoveType: 11
    })

    prepareMove(fromStack)

    expect(fromStack.patched.CardIDs).toEqual([84])
    expect((room.readSkillState(3488) as { stack?: number }).stack).toBeUndefined()
  })

  it('清议/联句从弃牌堆取回暗牌时回填并清理技能状态', () => {
    const room = createSkillRoom({ 3157: [11, 12] })
    const context = createContext({
      room,
      SpellID: 3157,
      CardIDs: [0, 0],
      CardCount: 2,
      FromZone: 2,
      ToZone: 5
    })

    prepareMove(context)

    expect(context.patched.CardIDs).toEqual([11, 12])
    expect(room.readSkillState(3157)).toBeUndefined()
  })

  it('迁附暗牌回堆时回填 CardIDs 并清理技能状态', () => {
    const room = createSkillRoom({ 3750: [11, 12] })
    const context = createContext({
      room,
      SpellID: 3750,
      CardIDs: [0, 0],
      CardCount: 2,
      FromZone: 2,
      ToZone: 1,
      MoveType: 15
    })

    prepareMove(context)

    expect(context.patched.CardIDs).toEqual([11, 12])
    expect(room.readSkillState(3750)).toBeUndefined()
  })

  it('椒遇从弹窗区 暗取后通过剩余明弃收敛，不按颜色回填 CardIDs', () => {
    const selectedCardIDs = [147, 148, 149, 150, 151]
    const otherCardID = 152
    const { controller } = createReadyControllerHarness({
      seatIDs: [5],
      currentUserID: 500,
      cardIDs: [...selectedCardIDs, otherCardID]
    })

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [...selectedCardIDs, otherCardID],
        CardCount: 6,
        FromZone: 1,
        ToZone: 3,
        ToID: 255,
        MoveType: 6,
        SpellID: 3571
      })
    )

    const room = controller.getTrackerRoom()
    selectedCardIDs.forEach((cardID, index) => {
      room.cardIndex.get(cardID).color = index % 2 == 0 ? 1 : 2
    })
    room.cardIndex.get(otherCardID).color = 3

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 6,
        FromID: 255,
        FromZone: 3,
        ToID: 255,
        ToZone: 8,
        MoveType: 6,
        SpellID: 3571
      })
    )

    controller.dispatchSkillProtocolEvent({
      type: 'roleData',
      message: { DataID: 3571, SeatID: 5, Datas: [1] }
    })
    const context = createContext({
      room,
      CardIDs: [],
      CardCount: 5,
      FromID: 3571,
      FromZone: 8,
      ToID: 5,
      ToZone: 5,
      MoveType: 8,
      SpellID: 3571
    })

    controller.syncTrackerMove(context.patched, context.raw)
    expect(context.patched.CardIDs).toEqual([])
    expect(room.getPlayer(5)!.candidateHandCards).toHaveLength(6)
    expect(room.getPlayer(5)!.getCandidateHandSlotCount()).toBe(5)
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [otherCardID],
        CardCount: 1,
        FromID: 3571,
        FromZone: 8,
        ToID: 255,
        ToZone: 2,
        MoveType: 4,
        SpellID: 3571
      })
    )

    selectedCardIDs.forEach((cardID) => {
      const card = room.cardIndex.get(cardID)
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('hand')
      expect(card.seats.has(5)).toBe(true)
    })
    const otherCard = room.cardIndex.get(otherCardID)
    expect(otherCard.location).toBe('discard')
    expect(otherCard.subZone).toBeNull()
    expect(otherCard.spellID).toBeNull()
    expect(otherCard.seats.size).toBe(0)
  })

  it('椒遇颜色候选数与协议张数不一致时保持暗牌消息', () => {
    const room = createSkillRoom({ 3571: new Set([1, 2]) })
    room.moveCards([147], {
      from: { type: 'public', zone: 'pile', position: POSITION_TOP },
      to: { type: 'player', seatID: 1, subZone: 'mark', markSpellID: 3571 },
      triggerSpellID: 3571
    })
    const card = room.cardIndex.get(147)!
    card.color = 1
    const context = createContext({
      room,
      CardIDs: [],
      CardCount: 5,
      FromID: 3571,
      FromZone: 8,
      ToZone: 5,
      MoveType: 8,
      SpellID: 3571
    })

    prepareMove(context)

    expect(context.patched.CardIDs).toEqual([])
  })

  it('清议回填后经 tracker 同步，弃牌堆明牌进入目标手牌', () => {
    const cardIDs = [11, 12]
    const { controller } = createReadyControllerHarness({
      seatIDs: [1],
      cardIDs: [...cardIDs, 100, 101]
    })

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: cardIDs,
        CardCount: cardIDs.length,
        FromZone: 1,
        ToZone: 2,
        ToID: 255,
        MoveType: 4
      })
    )

    const room = controller.getTrackerRoom()
    expect(room.zones.get('discard')?.cards.map((card) => card.id)).toEqual(cardIDs)

    room.setSkillState(3157, cardIDs)
    const context = createContext({
      room,
      SpellID: 3157,
      CardIDs: [0, 0],
      CardCount: 2,
      FromZone: 2,
      ToZone: 5,
      ToID: 1
    })

    prepareMove(context)

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: context.patched.CardIDs,
        CardCount: context.patched.CardCount,
        FromZone: 2,
        FromID: 255,
        ToZone: 5,
        ToID: 1,
        MoveType: 5,
        SpellID: 3157
      })
    )

    const handCards = room.cards.filter(
      (card) => card.location === 'player' && card.subZone === 'hand' && card.seats.has(1)
    )

    expect(context.patched.CardIDs).toEqual(cardIDs)
    expect(room.readSkillState(3157)).toBeUndefined()
    expect(room.zones.get('discard')?.cards.map((card) => card.id)).toEqual([])
    expect(handCards.map((card) => card.id).sort((a, b) => a - b)).toEqual(cardIDs)
    handCards.forEach((card) => {
      expect(card.isKnown).toBe(true)
      expect(card.seats.has(1)).toBe(true)
    })
  })
})
