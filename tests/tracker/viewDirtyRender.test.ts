import { describe, expect, it } from 'vitest'
import {
  collectDirtyRenderState,
  finishDirtyRender,
  markFullPlayerRender
} from '@/tracker/view/dirtyRenderState'
import { createTestRoom } from './helpers/room'
import type { Room } from '@/tracker/Room'
import type { Card } from '@/tracker/Card'

describe('视图 dirty 渲染状态', () => {
  it('无新脏事件且 viewDirty=false 时返回空渲染计划', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })

    expect(collectDirtyRenderState(room)).toMatchObject({
      shouldRenderPanels: false,
      shouldRenderAllPlayers: false,
      consumedEventCount: 0,
      overflowed: false
    })
  })

  it.each([
    {
      name: '卡牌从玩家手牌移走时旧座位会进入受影响玩家',
      seatIDs: [1, 2] as number[],
      prepare(room: Room, card: Card) {
        card.bindTo([1], 'hand')
        collectDirtyRenderState(room)
        finishDirtyRender(room)
        card.moveToPublicZone('discard')
      },
      assert(state: ReturnType<typeof collectDirtyRenderState>) {
        expect(state.shouldRenderPanels).toBe(true)
        expect(state.shouldRenderAllPlayers).toBe(false)
        expect([...state.affectedSeatIDs].sort()).toEqual([1])
      }
    },
    {
      name: '卡牌进入新玩家手牌时新座位会进入受影响玩家',
      seatIDs: [1, 2] as number[],
      prepare(_room: Room, card: Card) {
        card.bindTo([2], 'hand')
      },
      assert(state: ReturnType<typeof collectDirtyRenderState>) {
        expect(state.shouldRenderPanels).toBe(true)
        expect(state.shouldRenderAllPlayers).toBe(false)
        expect([...state.affectedSeatIDs].sort()).toEqual([2])
      }
    },
    {
      name: '多席位候选收缩时被移除座位会进入受影响玩家',
      seatIDs: [1, 2, 3] as number[],
      prepare(room: Room, card: Card) {
        card.bindTo([1, 2, 3], 'hand')
        finishDirtyRender(room, collectDirtyRenderState(room))
        card.setSeats([2, 3], 'test-shrink')
      },
      assert(state: ReturnType<typeof collectDirtyRenderState>) {
        // 座位 1 已不在事件 owner 字段与卡牌当前候选里，只能靠 previousSeats 找回；
        // 同时确认不是溢出兜底在掩盖问题。
        expect(state.shouldRenderAllPlayers).toBe(false)
        expect(state.overflowed).toBe(false)
        expect([...state.affectedSeatIDs].sort()).toEqual([1, 2, 3])
      }
    },
    {
      name: '完整位置候选收缩时被移除座位会进入受影响玩家',
      seatIDs: [1, 2, 3] as number[],
      prepare(room: Room, card: Card) {
        card.bindTo([1, 2, 3], 'hand')
        finishDirtyRender(room, collectDirtyRenderState(room))
        const remaining = card
          .getLocationCandidates()
          .filter((candidate) => candidate.type !== 'player' || candidate.seatID !== 1)
        card.setLocationCandidates(remaining, 'test-shrink-location')
      },
      assert(state: ReturnType<typeof collectDirtyRenderState>) {
        expect(state.shouldRenderAllPlayers).toBe(false)
        expect(state.affectedSeatIDs.has(1)).toBe(true)
      }
    },
    {
      name: '候选落定到其他座位时被排除座位会进入受影响玩家',
      seatIDs: [1, 2, 3] as number[],
      prepare(room: Room, card: Card) {
        card.bindTo([1, 2, 3], 'hand')
        finishDirtyRender(room, collectDirtyRenderState(room))
        card.resolveLocationCandidate({ type: 'player', seatID: 2, subZone: 'hand' }, 'test-resolve')
      },
      assert(state: ReturnType<typeof collectDirtyRenderState>) {
        expect(state.shouldRenderAllPlayers).toBe(false)
        expect([...state.affectedSeatIDs].sort()).toEqual([1, 2, 3])
      }
    }
  ])('受影响座位：$name', ({ seatIDs, prepare, assert }) => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs })
    const card = room.cardIndex.get(1)!
    prepare(room, card)
    assert(collectDirtyRenderState(room))
  })

  it('收集脏状态不会在渲染完成前提前消费事件', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })
    const card = room.cardIndex.get(1)!

    card.bindTo([1], 'hand')

    const state = collectDirtyRenderState(room)
    expect(state.affectedSeatIDs.has(1)).toBe(true)

    const retryState = collectDirtyRenderState(room)
    expect(retryState.affectedSeatIDs.has(1)).toBe(true)

    finishDirtyRender(room, state)

    const cleanState = collectDirtyRenderState(room)
    expect(cleanState.shouldRenderPanels).toBe(false)
    expect(cleanState.affectedSeatIDs.size).toBe(0)
  })

  it('按收集快照完成渲染时不会消费渲染期间新增的脏事件', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1, 2] })
    const firstCard = room.cardIndex.get(1)!
    const secondCard = room.cardIndex.get(2)!

    firstCard.bindTo([1], 'hand')
    const state = collectDirtyRenderState(room)

    secondCard.bindTo([2], 'hand')
    finishDirtyRender(room, state)

    const nextState = collectDirtyRenderState(room)
    expect(nextState.shouldRenderPanels).toBe(true)
    expect(nextState.affectedSeatIDs.has(2)).toBe(true)
  })

  it('dirty event 日志被裁剪时触发全玩家手牌兜底刷新', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1, 2] })
    const firstCard = room.cardIndex.get(1)!
    const secondCard = room.cardIndex.get(2)!

    firstCard.bindTo([1], 'hand')
    secondCard.bindTo([2], 'hand')
    room.dirtyCardEvents = [room.dirtyCardEvents[room.dirtyCardEvents.length - 1]]

    const state = collectDirtyRenderState(room)
    expect(state.overflowed).toBe(true)
    expect(state.shouldRenderAllPlayers).toBe(true)
    expect(state.affectedSeatIDs.size).toBe(0)
  })

  it('markViewDirty 只触发非手牌面板刷新', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })

    room.markViewDirty('turn-changed')

    const state = collectDirtyRenderState(room)
    expect(state.shouldRenderPanels).toBe(true)
    expect(state.shouldRenderAllPlayers).toBe(false)
    expect(state.affectedSeatIDs.size).toBe(0)
  })

  it('显式全量标记会刷新全部玩家手牌', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })

    markFullPlayerRender(room)

    const state = collectDirtyRenderState(room)
    expect(state.shouldRenderPanels).toBe(false)
    expect(state.shouldRenderAllPlayers).toBe(true)
  })

  it('显式全量标记在渲染完成前会保留用于重试', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })

    markFullPlayerRender(room)

    const state = collectDirtyRenderState(room)
    expect(state.shouldRenderAllPlayers).toBe(true)

    const retryState = collectDirtyRenderState(room)
    expect(retryState.shouldRenderAllPlayers).toBe(true)

    finishDirtyRender(room, state)

    const cleanState = collectDirtyRenderState(room)
    expect(cleanState.shouldRenderAllPlayers).toBe(false)
  })
})