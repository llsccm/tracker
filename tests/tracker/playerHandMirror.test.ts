import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearRenderedMainHandCardIDs,
  getRenderedMainHandCardIDs,
  renderPlayerHand,
  subscribeRenderedMainHandCardIDs
} from '@/tracker/view/PlayerHandView'
import type { Player } from '@/tracker/Player'

function createRenderDocument(): Document {
  const body = {
    appendChild() {},
    querySelectorAll() {
      return []
    }
  }
  const panel = {
    querySelector() {
      return body
    }
  }
  const panelRoot = {
    querySelector() {
      return panel
    }
  }

  return {
    createDocumentFragment() {
      return {
        appendChild() {}
      }
    },
    createElement() {
      return {
        classList: {
          add() {},
          toggle() {}
        },
        setAttribute() {}
      }
    },
    getElementById() {
      return panelRoot
    },
    querySelector() {
      return null
    }
  } as unknown as Document
}

function createPlayer(seatID: number, mySeatID: number, cardIDs: number[]): Player {
  return {
    seatID,
    fixedViewId: 1,
    room: { mySeatID },
    knownHandCards: cardIDs.map((id) => ({
      id,
      color: 3,
      number: 1,
      name: '杀'
    })),
    candidateHandCards: [],
    markCards: new Map()
  } as unknown as Player
}

describe('主视角渲染手牌镜像', () => {
  beforeEach(() => {
    clearRenderedMainHandCardIDs()
  })

  it('仅在主视角手牌成功渲染后更新镜像', () => {
    const doc = createRenderDocument()

    renderPlayerHand(doc, createPlayer(2, 1, [21]))
    expect(getRenderedMainHandCardIDs()).toBeNull()

    renderPlayerHand(doc, createPlayer(1, 1, [11, 12]))
    expect(getRenderedMainHandCardIDs()).toEqual([11, 12])
  })

  it('返回防御性副本并区分空手牌与尚未渲染', () => {
    const doc = createRenderDocument()
    renderPlayerHand(doc, createPlayer(1, 1, [31]))

    const snapshot = getRenderedMainHandCardIDs()
    snapshot?.push(32)
    expect(getRenderedMainHandCardIDs()).toEqual([31])

    renderPlayerHand(doc, createPlayer(1, 1, []))
    expect(getRenderedMainHandCardIDs()).toEqual([])

    clearRenderedMainHandCardIDs()
    expect(getRenderedMainHandCardIDs()).toBeNull()
  })

  it('镜像内容变化时通知订阅者，相同内容不重复通知', () => {
    const doc = createRenderDocument()
    let updates = 0
    const unsubscribe = subscribeRenderedMainHandCardIDs(() => {
      updates += 1
    })

    renderPlayerHand(doc, createPlayer(1, 1, [41, 42]))
    renderPlayerHand(doc, createPlayer(1, 1, [41, 42]))
    expect(updates).toBe(1)

    renderPlayerHand(doc, createPlayer(1, 1, [41, 42, 43]))
    expect(updates).toBe(2)

    unsubscribe()
    renderPlayerHand(doc, createPlayer(1, 1, [41]))
    expect(updates).toBe(2)
  })
})
