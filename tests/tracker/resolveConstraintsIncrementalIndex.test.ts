import { describe, expect, it } from 'vitest'
import { collectTraversalStats } from '@/tracker/traversalStats'
import { createTestRoom, getCard } from './helpers/room'
import { expectLocationIndexMatchesRebuild } from './helpers/locationIndex'
import { expectAmbiguousKnownIndexMatchesRebuild } from './helpers/ambiguousKnownIndex'

// 覆盖 plans/cards-incremental-index-and-fast-path-plan.md 阶段 3：
// resolveConstraints() 尾部由全量 rebuild 改为增量维护 locationIndex。
// 这些用例驱动真实 moveCards/shufflePile 走完整收敛路径，收敛后断言活索引与全量 rebuild 逐桶一致，
// 直接暴露脏牌事件或 Zone dirty 追踪的任何缺口。
const DECK = Array.from({ length: 20 }, (_, index) => index + 1)

describe('resolveConstraints 接入 locationIndex 增量（阶段 3）', () => {
  it('常规摸牌：确定明牌从牌堆进入手牌', () => {
    const { room } = createTestRoom({ cardIDs: DECK, seatIDs: [1, 2, 3] })

    room.moveCards([1], 'player', {
      seatID: 1,
      subZone: 'hand',
      fromZone: 'pile',
      cardCount: 1,
      sourceEvent: { type: 'test:draw-known' }
    })

    expect(room.locationIndex.knownHandBySeat.get(1)).toEqual([getCard(room, 1)])
    expect(room.locationIndex.publicByZone.get('pile')?.includes(getCard(room, 1))).toBe(false)
    expectLocationIndexMatchesRebuild(room)
    expectAmbiguousKnownIndexMatchesRebuild(room)
  })

  it('确定明牌弃置：手牌明牌进入弃牌堆', () => {
    const { room } = createTestRoom({ cardIDs: DECK, seatIDs: [1, 2, 3] })
    room.moveCards([1], 'player', { seatID: 1, subZone: 'hand', fromZone: 'pile', cardCount: 1 })

    room.moveCards([1], 'discard', { fromSeatID: 1, fromSubZone: 'hand', cardCount: 1 })

    expect(room.locationIndex.knownHandBySeat.get(1)).toEqual([])
    expect(room.locationIndex.publicByZone.get('discard')).toEqual([getCard(room, 1)])
    expectLocationIndexMatchesRebuild(room)
  })

  it('暗牌分配：纯计数暗牌进入手牌', () => {
    const { room } = createTestRoom({ cardIDs: DECK, seatIDs: [1, 2, 3] })

    room.moveCards([], 'player', { seatID: 2, subZone: 'hand', fromZone: 'pile', cardCount: 2 })

    expectLocationIndexMatchesRebuild(room)
  })

  it('牌堆顶弃置（纯公共区移动，无脏牌事件）：靠 Zone dirty 追踪补齐', () => {
    const { room } = createTestRoom({ cardIDs: DECK, seatIDs: [1, 2, 3] })
    const pileTop = room.zones.get('pile').cards.at(-1)

    room.moveCards([], 'discard', { fromZone: 'pile', cardCount: 1 })

    expect(room.locationIndex.publicByZone.get('discard')).toEqual([pileTop])
    expect(room.locationIndex.publicByZone.get('pile')?.includes(pileTop)).toBe(false)
    expectLocationIndexMatchesRebuild(room)
  })

  it('装备与判定区确定移动', () => {
    const { room } = createTestRoom({ cardIDs: DECK, seatIDs: [1, 2, 3] })

    room.moveCards([1], 'player', { seatID: 1, subZone: 'equip', fromZone: 'pile', cardCount: 1 })
    expect(room.locationIndex.equipBySeat.get(1)).toEqual([getCard(room, 1)])
    expectLocationIndexMatchesRebuild(room)

    room.moveCards([2], 'player', { seatID: 2, subZone: 'judge', fromZone: 'pile', cardCount: 1 })
    expect(room.locationIndex.judgeBySeat.get(2)).toEqual([getCard(room, 2)])
    expectLocationIndexMatchesRebuild(room)
  })

  it('多步移动序列：每步收敛后都与全量一致', () => {
    const { room } = createTestRoom({ cardIDs: DECK, seatIDs: [1, 2, 3] })

    const steps: (() => void)[] = [
      () => room.moveCards([1, 2], 'player', { seatID: 1, subZone: 'hand', cardCount: 2 }),
      () => room.moveCards([], 'player', { seatID: 2, subZone: 'hand', cardCount: 3 }),
      () => room.moveCards([1], 'discard', { fromSeatID: 1, fromSubZone: 'hand', cardCount: 1 }),
      () => room.moveCards([3], 'player', { seatID: 3, subZone: 'hand', cardCount: 1 }),
      () => room.moveCards([], 'discard', { fromZone: 'pile', cardCount: 2 })
    ]

    steps.forEach((step) => {
      step()
      expectLocationIndexMatchesRebuild(room)
    })
  })

  it('收敛尾部走增量而非全量 rebuild', () => {
    const { room } = createTestRoom({ cardIDs: DECK, seatIDs: [1, 2, 3] })

    const { stats } = collectTraversalStats(() => {
      room.moveCards([1], 'player', { seatID: 1, subZone: 'hand', fromZone: 'pile', cardCount: 1 })
    })

    expect(stats.sites.get('locationIndex:rebuild')).toBeUndefined()
    expect(stats.sites.get('locationIndex:applyDirty')?.calls).toBe(1)
    expect(stats.sites.get('ambiguousKnownIndex:rebuild')).toBeUndefined()
    expect(stats.sites.get('ambiguousKnownIndex:applyDirty')?.calls).toBe(1)
    expectLocationIndexMatchesRebuild(room)
    expectAmbiguousKnownIndexMatchesRebuild(room)
  })

  it('观测手牌数排他触发：多座位候选收缩后仍一致', () => {
    const { room } = createTestRoom({ cardIDs: DECK, seatIDs: [1, 2] })
    const first = getCard(room, 5)
    const second = getCard(room, 6)
    room.clearCardsFromPublicZones([first, second])
    first.bindCandidates([1, 2], 'hand', null, { known: true })
    second.bindCandidates([1, 2], 'hand', null, { known: true })
    room.resolveConstraints()
    expectLocationIndexMatchesRebuild(room)

    room.syncObservedPlayerHandCount(1, 0)

    expect(first.seats.has(1)).toBe(false)
    expect(second.seats.has(1)).toBe(false)
    expectLocationIndexMatchesRebuild(room)
    expectAmbiguousKnownIndexMatchesRebuild(room)
  })

  it('真实移动路径：多座位候选收敛、约束组移除后 ambiguousKnownIndex 与全量一致', () => {
    const { room } = createTestRoom({ cardIDs: DECK, seatIDs: [1, 2] })
    const first = getCard(room, 5)
    const second = getCard(room, 6)
    room.clearCardsFromPublicZones([first, second])
    first.bindCandidates([1, 2], 'hand', null, { known: true })
    second.bindCandidates([1, 2], 'hand', null, { known: true })
    room.createConstraintGroup({
      id: 'test:move-ambiguous-index',
      cards: [first, second],
      candidateSeats: [1, 2],
      known: true,
      sourceEvent: { type: 'test:ambiguous-move', label: '模糊来源' }
    })
    room.resolveConstraints()
    expect(room.ambiguousKnownIndex.describe(5)).toContain('模糊来源')
    expectAmbiguousKnownIndexMatchesRebuild(room)

    room.syncObservedPlayerHandCount(1, 0)
    expect(first.seats.has(1)).toBe(false)
    expect(second.seats.has(1)).toBe(false)
    expectAmbiguousKnownIndexMatchesRebuild(room)

    room.moveCards([5], 'discard', {
      fromSeatID: 2,
      fromSubZone: 'hand',
      cardCount: 1,
      sourceEvent: { type: 'test:discard-after-resolve' }
    })

    expect(room.constraintGroups.get('test:move-ambiguous-index')?.cards.has(first)).toBe(false)
    expectAmbiguousKnownIndexMatchesRebuild(room)
  })

  it('洗牌：弃牌堆回收并按协议张数重建牌堆后一致', () => {
    const { room } = createTestRoom({
      cardIDs: DECK,
      seatIDs: [1, 2],
      materializeDeckIdentities: false
    })
    room.moveCards([10, 11, 12], 'player', { seatID: 1, subZone: 'hand', cardCount: 3 })
    room.moveCards([10, 11, 12], 'discard', { fromSeatID: 1, fromSubZone: 'hand', cardCount: 3 })
    const pileCount = room.zones.get('pile').cards.length
    const discardCount = room.zones.get('discard').cards.length

    room.shufflePile({ cardCount: pileCount + discardCount })

    expect(room.zones.get('discard').cards).toHaveLength(0)
    expectLocationIndexMatchesRebuild(room)
  })
})
