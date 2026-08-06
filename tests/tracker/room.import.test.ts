import { describe, expect, it } from 'vitest'
import { Card } from '@/tracker/Card'
import { CardLocationIndex } from '@/tracker/CardLocationIndex'
import { ConstraintGroup } from '@/tracker/ConstraintGroup'
import { Room } from '@/tracker/Room'
import { GameState } from '@/tracker/Game'
import { createNoopGameState } from './helpers/noopRuntime'

describe('Room Node 导入边界', () => {
  it('不依赖浏览器全局对象也能导入并创建房间', () => {
    expect(globalThis.window).toBeUndefined()
    expect(globalThis.document).toBeUndefined()
    expect(globalThis.Laya).toBeUndefined()

    const gameState = createNoopGameState()
    const room = new Room({ gameState })

    expect(room.game).toBe(gameState)
    expect(room.cards).toEqual([])
    expect(room.players.size).toBe(0)
  })

  it('核心卡牌与约束对象读取注入状态，不拉起浏览器运行时', () => {
    const gameState = createNoopGameState()
    gameState.turn = 2
    gameState.round = 3
    gameState.phase = 4

    const room = new Room({ gameState })
    const card = new Card(1, room)
    card.syncTimestamp()

    const group = new ConstraintGroup({
      id: 'node-import',
      cards: [card],
      candidateSeats: [1]
    })
    const index = new CardLocationIndex()

    expect(card.turn).toBe(2)
    expect(card.round).toBe(3)
    expect(card.phase).toBe(4)
    expect(group.cards.has(card)).toBe(true)
    expect(index.knownHandBySeat).toBeInstanceOf(Map)
  })

  it('GameState 解绑房间时清理派生座位状态', () => {
    const gameState = new GameState()
    const room = new Room({ gameState })

    room.registerPlayers([{ seat_id: 2, user_temp_id: 100 }], 100)

    expect(gameState.room).toBe(room)
    expect(gameState.seatIDs).toEqual([2])
    expect(gameState.myID).toBe(2)

    room.destroy()

    expect(gameState.room).toBe(null)
    expect(gameState.seatIDs).toEqual([])
    expect(gameState.myID).toBeUndefined()
  })

  it('GameState 更新武将后通知注入的展示监听器', () => {
    const gameState = new GameState({ orderLabels: ['', '甲', '乙'] })
    const room = new Room({ gameState })
    room.registerPlayers([{ seat_id: 2, user_temp_id: 100 }], 100)
    let renderedLabel = ''

    gameState.setGeneralChangeListener((player, orderLabels) => {
      renderedLabel = `${player.generals.join(',')}|${orderLabels[player.fixedViewId ?? 1]}`
    })
    gameState.setGeneral(2, 101)

    expect(renderedLabel).toBe('101|甲')
  })

  it('GameState 统一状态流管理', () => {
    const gameState = new GameState()

    gameState.init()
    gameState.end()
    gameState.start()
    gameState.setTurn(2)
    gameState.enter(0, 3)

    expect(gameState.turn).toBe(2)
    expect(gameState.round).toBe(1)
    expect(gameState.phase).toBe(0)
    expect(gameState.currentID).toBe(3)

    gameState.end()

    expect(gameState.isGameStart).toBe(false)
    expect(gameState.isPassed).toBe(true)
  })
})
