import { createReadyControllerHarness, protocolMove } from './helpers/trackerController'
import { moveContext } from './helpers/moveContext'
import { describe, expect, it, vi } from 'vitest'

const { drawChengXiang } = vi.hoisted(() => ({ drawChengXiang: vi.fn() }))

vi.mock('@/draw', () => ({ drawChengXiang }))

import { applySpellEffect } from '@/handler/spellEffects'

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
  const { game, ...fields } = { game: createGameState(), ...overrides }
  return {
    game,
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

describe('技能副作用注册表', () => {
  it('未注册技能不产生副作用', () => {
    const context = createContext({
      SpellID: 9999,
      CardIDs: [1]
    })

    expect(applySpellEffect(context)).toBe(false)
    expect(context.patched.CardIDs).toEqual([1])
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
  it('技能304展示游戏外生成的匿名手牌时补建并揭示真实实体', () => {
    const knownHandIDs = [26, 149, 62]
    const { controller } = createReadyControllerHarness({
      seatIDs: [1],
      cardIDs: [...knownHandIDs, 1]
    })
    controller.syncTrackerMove(protocolMove({ CardIDs: knownHandIDs, ToID: 1 }))
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromID: 255,
        FromZone: 12,
        MoveType: 19,
        ToID: 1,
        ToZone: 5
      })
    )

    const room = controller.getTrackerRoom()
    expect(
      room.cards.filter(
        (card) =>
          card.isAnonymous &&
          card.location === 'player' &&
          card.subZone === 'hand' &&
          card.seats.has(1)
      )
    ).toHaveLength(1)

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [...knownHandIDs, 60992],
        CardCount: 4,
        FromID: 1,
        FromZone: 5,
        MoveType: 21,
        SpellID: 304,
        ToID: 1,
        ToZone: 5
      })
    )

    const revealedCard = room.cardIndex.get(60992)
    expect(revealedCard.location).toBe('player')
    expect(revealedCard.subZone).toBe('hand')
    expect(revealedCard.seats.has(1)).toBe(true)
    expect(revealedCard.isKnown).toBe(true)
    expect(
      room.cards.filter(
        (card) =>
          card.isAnonymous &&
          card.location === 'player' &&
          card.subZone === 'hand' &&
          card.seats.has(1)
      )
    ).toEqual([])
  })
})
