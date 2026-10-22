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
})
