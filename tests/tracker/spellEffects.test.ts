import { describe, expect, it, vi } from 'vitest'

vi.mock('@/draw', () => ({ drawChengXiang: vi.fn() }))

import { applySpellEffect, spellEffectHandlers } from '@/handler/spellEffects'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

function createGameState(initialState = {}) {
  const states = new Map(Object.entries(initialState).map(([key, value]) => [Number(key), value]))

  return {
    myID: 1,
    currentID: 1,
    spellSpace: {},
    ensureSpellState(spellID, factory) {
      if (!states.has(spellID)) {
        states.set(spellID, factory())
      }
      return states.get(spellID)
    },
    getSpellState(spellID) {
      return states.get(spellID)
    },
    deleteSpellState(spellID) {
      states.delete(spellID)
    }
  }
}

function createContext(overrides = {}) {
  return {
    game: createGameState(),
    CardIDs: [],
    CardCount: 0,
    FromID: 1,
    FromZone: 0,
    ToZone: 0,
    MoveType: 0,
    SpellID: 0,
    SrcSeatID: 1,
    ...overrides
  }
}

describe('技能副作用注册表', () => {
  it('包含 P0 计划列出的技能注册项', () => {
    const registeredSpellIDs = Array.from(spellEffectHandlers.keys()).map(Number)

    expect(registeredSpellIDs.sort((a, b) => a - b)).toEqual([
      441, 3157, 3329, 3488, 3492, 3511, 3543, 3571, 3659, 3750, 3821
    ])
  })

  it('未注册技能不产生副作用', () => {
    const context = createContext({
      SpellID: 9999,
      CardIDs: [1]
    })

    expect(applySpellEffect(context)).toBe(false)
    expect(context.CardIDs).toEqual([1])
  })

  it('佐练记录来源明牌并在后续暗牌移动中回填 CardIDs', () => {
    const game = createGameState()

    applySpellEffect(
      createContext({
        game,
        SpellID: 3488,
        CardIDs: [42],
        FromID: 3,
        FromZone: 5,
        ToZone: 5,
        MoveType: 21
      })
    )

    const toStack = createContext({
      game,
      SpellID: 3488,
      CardIDs: [0],
      FromID: 3,
      FromZone: 5,
      ToZone: 10,
      MoveType: 11
    })

    applySpellEffect(toStack)

    expect(toStack.CardIDs).toEqual([42])
    expect((game.getSpellState(3488) as { stack?: number }).stack).toBe(42)

    const fromStack = createContext({
      game,
      SpellID: 3488,
      CardIDs: [0],
      FromZone: 10,
      ToZone: 1,
      MoveType: 11
    })

    applySpellEffect(fromStack)

    expect(fromStack.CardIDs).toEqual([42])
    expect((game.getSpellState(3488) as { stack?: number }).stack).toBeUndefined()
  })

  it('清议/联句从弃牌堆取回暗牌时回填并清理技能状态', () => {
    const game = createGameState({ 3157: [11, 12] })
    const context = createContext({
      game,
      SpellID: 3157,
      CardIDs: [0, 0],
      CardCount: 2,
      FromZone: 2,
      ToZone: 5
    })

    applySpellEffect(context)

    expect(context.CardIDs).toEqual([11, 12])
    expect(game.getSpellState(3157)).toBeUndefined()
  })

  it('清议回填后经 tracker 同步，弃牌堆明牌进入目标手牌', () => {
    const { controller } = createTrackerControllerHarness()
    const cardIDs = [11, 12]

    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 1, ClientID: 100 }], 100)
    controller.initTrackerDeck([...cardIDs, 100, 101])

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

    const game = createGameState({ 3157: cardIDs })
    const context = createContext({
      game,
      SpellID: 3157,
      CardIDs: [0, 0],
      CardCount: 2,
      FromZone: 2,
      ToZone: 5,
      ToID: 1
    })

    applySpellEffect(context)

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: context.CardIDs,
        CardCount: context.CardCount,
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

    expect(context.CardIDs).toEqual(cardIDs)
    expect(game.getSpellState(3157)).toBeUndefined()
    expect(room.zones.get('discard')?.cards.map((card) => card.id)).toEqual([])
    expect(handCards.map((card) => card.id).sort((a, b) => a - b)).toEqual(cardIDs)
    handCards.forEach((card) => {
      expect(card.isKnown).toBe(true)
      expect(card.seats.has(1)).toBe(true)
    })
  })
})
