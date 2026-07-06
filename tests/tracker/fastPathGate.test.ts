import { beforeEach, describe, expect, it } from 'vitest'
import {
  attachFastPathDebugApi,
  detachFastPathDebugApi,
  getConvergenceTiming,
  getFastPathStats,
  resetFastPathStats
} from '@/tracker/fastPathStats'
import type { FastPathName } from '@/tracker/fastPathStats'
import { evaluateDeterministicMove } from '@/tracker/fastPathGate'
import type { RoomMoveContext } from '@/tracker/roomMovement/types'
import { createTestRoom, getCard } from './helpers/room'
import { expectLocationIndexMatchesRebuild } from './helpers/locationIndex'

// 覆盖 plans/cards-incremental-index-and-fast-path-plan.md §九 step 8：
// 快路径 dry-run 数据 gate。这些用例驱动真实 moveCards 走完整收敛路径，
// 断言 4A 命中率埋点分类正确，且 dry-run 观测不改变收敛结果（仍与全量 rebuild 等价）。
const DECK = Array.from({ length: 20 }, (_, index) => index + 1)

function statsFor(name: FastPathName) {
  return getFastPathStats().find((entry) => entry.name === name)
}

describe('快路径 dry-run 数据 gate（step 8，4A）', () => {
  beforeEach(() => resetFastPathStats())

  it('确定明牌从牌堆进入手牌：命中 4A，且不改变收敛结果', () => {
    const { room } = createTestRoom({ cardIDs: DECK, seatIDs: [1, 2, 3] })
    room.moveCards([1], 'player', { seatID: 1, subZone: 'hand', fromZone: 'pile', cardCount: 1 })

    const s = statsFor('deterministicMove')
    expect(s?.hit).toBe(1)
    expect(s?.rollback).toBe(0)
    // dry-run 只观测，收敛结果仍与全量 rebuild 逐桶等价。
    expectLocationIndexMatchesRebuild(room)
  })

  it('确定明牌弃置：手牌明牌进入弃牌堆也命中 4A', () => {
    const { room } = createTestRoom({ cardIDs: DECK, seatIDs: [1, 2, 3] })
    room.moveCards([1], 'player', { seatID: 1, subZone: 'hand', fromZone: 'pile', cardCount: 1 })
    resetFastPathStats()

    room.moveCards([1], 'discard', { fromSeatID: 1, fromSubZone: 'hand', cardCount: 1 })
    expect(statsFor('deterministicMove')?.hit).toBe(1)
    expectLocationIndexMatchesRebuild(room)
  })

  it('纯暗牌摸牌：回退，原因归类为 unknownCount', () => {
    const { room } = createTestRoom({ cardIDs: DECK, seatIDs: [1, 2, 3] })
    room.moveCards([], 'player', { seatID: 2, subZone: 'hand', fromZone: 'pile', cardCount: 2 })

    const s = statsFor('deterministicMove')
    expect(s?.hit).toBe(0)
    expect(s?.rollback).toBe(1)
    expect(s?.reasons.unknownCount).toBe(1)
  })

  it('明暗混合摸牌（1 明 1 暗）：回退，原因归类为 unknownCount', () => {
    const { room } = createTestRoom({ cardIDs: DECK, seatIDs: [1, 2, 3] })
    room.moveCards([1], 'player', { seatID: 1, subZone: 'hand', fromZone: 'pile', cardCount: 2 })

    const s = statsFor('deterministicMove')
    expect(s?.hit).toBe(0)
    expect(s?.reasons.unknownCount).toBe(1)
  })

  it('确定明牌的约束组成员检查使用反向索引并随移除更新', () => {
    const { room } = createTestRoom({ cardIDs: DECK, seatIDs: [1, 2, 3] })
    const card = getCard(room, 1)
    card.bindCandidates([1], 'hand', null, { known: true })
    room.createConstraintGroup({
      id: 'test:non-trivial-group',
      cards: [card],
      candidateSeats: [1, 2]
    })

    const context = {
      cardCount: 1,
      unknownCount: 0,
      movedUnknownCards: [],
      knownCards: [card],
      hiddenMarkRecord: null
    }

    const moveContext = context as unknown as RoomMoveContext
    expect(evaluateDeterministicMove(room, moveContext)).toEqual({
      ok: false,
      reason: 'cardInConstraintGroup'
    })

    room.removeCardsFromConstraintGroups([card])
    expect(evaluateDeterministicMove(room, moveContext)).toEqual({ ok: true })
  })

  it('命中率按命中/(命中+回退) 累计', () => {
    const { room } = createTestRoom({ cardIDs: DECK, seatIDs: [1, 2, 3] })
    // 一次确定摸牌（命中）+ 一次纯暗牌摸牌（回退）。
    room.moveCards([1], 'player', { seatID: 1, subZone: 'hand', fromZone: 'pile', cardCount: 1 })
    room.moveCards([], 'player', { seatID: 2, subZone: 'hand', fromZone: 'pile', cardCount: 1 })

    const s = statsFor('deterministicMove')
    expect(s?.total).toBe(2)
    expect(s?.hitRate).toBeCloseTo(0.5)
  })

  it('非 moveCards 收敛不写入 fastPathTiming', () => {
    const { room } = createTestRoom({ cardIDs: DECK, seatIDs: [1, 2, 3] })
    room.resolveConstraints()
    room.syncObservedPlayerHandCount(1, 0)

    const t = getConvergenceTiming()
    expect(t.totalMoves).toBe(0)
    expect(t.phaseCalls).toBe(0)
    expect(t.roundsTotal).toBe(0)
  })

  it('调试 API 由显式生命周期挂载和清理', () => {
    const host: {
      __dxcTracker?: {
        fastPathStats?: typeof getFastPathStats
        fastPathTiming?: typeof getConvergenceTiming
      }
    } = {}

    expect(host.__dxcTracker).toBeUndefined()
    attachFastPathDebugApi(host)
    expect(host.__dxcTracker?.fastPathStats).toBe(getFastPathStats)
    expect(host.__dxcTracker?.fastPathTiming).toBe(getConvergenceTiming)

    detachFastPathDebugApi(host)
    expect(host.__dxcTracker).toBeUndefined()
  })

  it('收敛耗时按 4A 本可命中/回退分桶累计', () => {
    const { room } = createTestRoom({ cardIDs: DECK, seatIDs: [1, 2, 3] })
    // 命中：确定摸牌；回退：纯暗牌摸牌。
    room.moveCards([1], 'player', { seatID: 1, subZone: 'hand', fromZone: 'pile', cardCount: 1 })
    room.moveCards([], 'player', { seatID: 2, subZone: 'hand', fromZone: 'pile', cardCount: 1 })

    const t = getConvergenceTiming()
    expect(t.totalMoves).toBe(2)
    expect(t.hitCount).toBe(1)
    expect(t.missCount).toBe(1)
    // saveable 上界 = 命中移动上的收敛耗时；非负且不超过总耗时。
    expect(t.saveableMsUpperBound).toBeGreaterThanOrEqual(0)
    expect(t.totalMs).toBeGreaterThanOrEqual(t.saveableMsUpperBound)
    // 相位拆分：converge + tail 覆盖每次 resolveConstraints；convergeShare ∈ [0,1]。
    expect(t.phaseCalls).toBe(2)
    expect(t.convergeShare).toBeGreaterThanOrEqual(0)
    expect(t.convergeShare).toBeLessThanOrEqual(1)
  })
})
