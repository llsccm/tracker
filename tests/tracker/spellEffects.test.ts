import { describe, expect, it, vi } from 'vitest'

const { drawChengXiang } = vi.hoisted(() => ({ drawChengXiang: vi.fn() }))

vi.mock('@/draw', () => ({ drawChengXiang }))

import { applySpellEffect, spellEffectHandlers } from '@/handler/spellEffects'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

function createGameState(initialState = {}) {
  const states = new Map(Object.entries(initialState).map(([key, value]) => [Number(key), value]))

  return {
    myID: 1,
    currentID: 1,
    ensureSpellState(spellID, factory) {
      if (!states.has(spellID)) {
        states.set(spellID, factory())
      }
      return states.get(spellID)
    },
    getSpellState(spellID) {
      return states.get(spellID)
    },
    setSpellState(spellID, value) {
      states.set(spellID, value)
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
  it('包含仍由 handler 处理的技能注册项', () => {
    const registeredSpellIDs = Array.from(spellEffectHandlers.keys()).map(Number)

    expect(registeredSpellIDs.sort((a, b) => a - b)).toEqual([
      361, 441, 3157, 3488, 3492, 3511, 3571, 3750
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

  it.each([441, 3492])('称象 %s 暂存展示牌，等待目标通知结算', (SpellID) => {
    const game = createGameState()
    const CardIDs = [11, 12, 13, 14]

    drawChengXiang.mockClear()
    applySpellEffect(
      createContext({
        game,
        CardIDs,
        ToZone: 8,
        MoveType: 6,
        SpellID
      })
    )

    expect(game.getSpellState(SpellID)).toEqual(CardIDs)
    expect(drawChengXiang).not.toHaveBeenCalled()
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
    expect((game.getSpellState(3488) as Record<number, number>)[3]).toBeUndefined()

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

  it('佐练已知牌进入交换区后，暗牌返回牌堆时回填并清理状态', () => {
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
      CardIDs: [42],
      FromID: 3,
      FromZone: 5,
      ToZone: 10,
      MoveType: 11
    })

    applySpellEffect(toStack)

    const spellState = game.getSpellState(3488) as { stack?: number; 3?: number }
    expect(spellState.stack).toBe(42)
    expect(spellState[3]).toBeUndefined()

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
    expect(spellState.stack).toBeUndefined()
  })

  it('佐练全程未知时保持暗牌 CardIDs，不回填 0', () => {
    const game = createGameState({ 3488: { stack: 99 } })
    const toStack = createContext({
      game,
      SpellID: 3488,
      CardIDs: [],
      FromID: 3,
      FromZone: 5,
      ToZone: 10,
      MoveType: 11
    })

    applySpellEffect(toStack)

    expect(toStack.CardIDs).toEqual([])
    expect(game.getSpellState(3488)).toEqual({})

    const fromStack = createContext({
      game,
      SpellID: 3488,
      CardIDs: [],
      FromZone: 10,
      ToZone: 1,
      MoveType: 11
    })

    applySpellEffect(fromStack)

    expect(fromStack.CardIDs).toEqual([])
    expect((game.getSpellState(3488) as { stack?: number }).stack).toBeUndefined()
  })

  it('佐练已知牌返回牌堆时保留 CardIDs 并清理 stack', () => {
    const game = createGameState({ 3488: { stack: 42 } })
    const fromStack = createContext({
      game,
      SpellID: 3488,
      CardIDs: [84],
      FromZone: 10,
      ToZone: 1,
      MoveType: 11
    })

    applySpellEffect(fromStack)

    expect(fromStack.CardIDs).toEqual([84])
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

  it('迁附暗牌回堆时回填 CardIDs 并清理技能状态', () => {
    const game = createGameState({ 3750: [11, 12] })
    const context = createContext({
      game,
      SpellID: 3750,
      CardIDs: [0, 0],
      CardCount: 2,
      FromZone: 2,
      ToZone: 1,
      MoveType: 15
    })

    applySpellEffect(context)

    expect(context.CardIDs).toEqual([11, 12])
    expect(game.getSpellState(3750)).toBeUndefined()
  })

  it('椒遇从无席位 mark 回手时按选择颜色补全其他视角的 CardIDs', () => {
    const selectedCardIDs = [147, 148, 149, 150, 151]
    const otherCardID = 152
    const { controller } = createTrackerControllerHarness()

    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 5, ClientID: 500 }], 500)
    controller.initTrackerDeck([...selectedCardIDs, otherCardID])

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

    const game = { ...createGameState({ 3571: new Set([1, 2]) }), room }
    const context = createContext({
      game,
      CardIDs: [],
      CardCount: 5,
      FromID: 3571,
      FromZone: 8,
      ToID: 5,
      ToZone: 5,
      MoveType: 8,
      SpellID: 3571
    })

    applySpellEffect(context)

    expect([...context.CardIDs].sort((a, b) => a - b)).toEqual(selectedCardIDs)

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 5,
        FromID: 3571,
        FromZone: 8,
        ToID: 5,
        ToZone: 5,
        MoveType: 8,
        SpellID: 3571
      }),
      { CardIDs: context.CardIDs }
    )

    selectedCardIDs.forEach((cardID) => {
      const card = room.cardIndex.get(cardID)
      expect(card.location).toBe('player')
      expect(card.subZone).toBe('hand')
      expect(card.seats.has(5)).toBe(true)
    })
    const otherCard = room.cardIndex.get(otherCardID)
    expect(otherCard.location).toBe('player')
    expect(otherCard.subZone).toBe('mark')
    expect(otherCard.spellID).toBe(3571)
    expect(otherCard.seats.size).toBe(0)
  })

  it('椒遇颜色候选数与协议张数不一致时保持暗牌消息', () => {
    const game = {
      ...createGameState({ 3571: new Set([1, 2]) }),
      room: {
        refreshPlayerSnapshot: () => [
          {
            id: 147,
            color: 1,
            isKnown: true,
            location: 'player',
            subZone: 'mark',
            spellID: 3571
          }
        ]
      }
    }
    const context = createContext({
      game,
      CardIDs: [],
      CardCount: 5,
      FromID: 3571,
      FromZone: 8,
      ToZone: 5,
      MoveType: 8,
      SpellID: 3571
    })

    applySpellEffect(context)

    expect(context.CardIDs).toEqual([])
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
