import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAmbiguousKnownCard } from '@/tracker/projection/AmbiguousKnownIndex'
import { collectTraversalStats } from '@/tracker/traversalStats'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import { createTestRoom, getCard } from '../helpers/room'
import { expectAmbiguousKnownIndexMatchesRebuild } from '../helpers/ambiguousKnownIndex'
import {
  equipmentContainer,
  outsideLocation,
  playerLocation,
  publicLocation
} from '../helpers/locationCandidates'

afterEach(() => vi.restoreAllMocks())

function rebuildAmbiguousIndex(room) {
  room.ambiguousKnownIndex.rebuild(Array.from(room.constraintGroups.values()))
}

describe('AmbiguousKnownIndex 增量维护（Step 6）', () => {
  it.each([
    { name: '确定手牌', candidates: [], expected: false },
    {
      name: '跨座位手牌',
      candidates: [playerLocation(1, 'hand'), playerLocation(2, 'hand')],
      expected: true
    },
    {
      name: '同座位跨子区',
      candidates: [playerLocation(1, 'hand'), playerLocation(1, 'mark', 700)],
      expected: true
    },
    { name: '公共端点', candidates: [publicLocation('pile', 'top', 2)], expected: true },
    { name: '装备容器', candidates: [equipmentContainer(161, 700)], expected: true },
    { name: '场外候选', candidates: [outsideLocation()], expected: true }
  ])('$name 仅按完整位置主模型判定明牌模糊状态，不构造兼容投影', ({ candidates, expected }) => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })
    const card = getCard(room, 1)!
    card.bindCandidates([1], 'hand', null, { known: true })
    card.setLocationCandidates(candidates)
    const seats = vi.spyOn(card, 'seats', 'get')
    const subZoneCandidates = vi.spyOn(card, 'subZoneCandidates', 'get')
    const publicCandidates = vi.spyOn(card, 'publicCandidates', 'get')

    expect(isAmbiguousKnownCard(card)).toBe(expected)
    card.isKnown = false
    expect(isAmbiguousKnownCard(card)).toBe(false)
    expect(seats).not.toHaveBeenCalled()
    expect(subZoneCandidates).not.toHaveBeenCalled()
    expect(publicCandidates).not.toHaveBeenCalled()
  })

  it('多座位候选明牌收敛为确定手牌：单牌增量删除条目', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1, 2] })
    const card = getCard(room, 1)
    room.clearCardsFromPublicZones([card])
    card.bindCandidates([1, 2], 'hand', null, { known: true })
    rebuildAmbiguousIndex(room)
    expect(room.ambiguousKnownIndex.get(1)).not.toBeNull()

    const { stats } = collectTraversalStats(() => {
      card.deleteSeat(2, 'test:resolve-to-seat1')
      room.ambiguousKnownIndex.applyDirtyCardEvents(Array.from(room.constraintGroups.values()))
    })

    expect(stats.sites.get('ambiguousKnownIndex:rebuild')).toBeUndefined()
    expect(stats.sites.get('ambiguousKnownIndex:applyDirty')?.calls).toBe(1)
    expect(room.ambiguousKnownIndex.get(1)).toBeNull()
    expectAmbiguousKnownIndexMatchesRebuild(room)
  })

  it('确定明牌变成多位置候选：单牌增量新增条目并与全量描述一致', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1, 2] })
    const card = getCard(room, 1)
    const hand = playerLocation(1, 'hand')
    const mark = playerLocation(1, 'mark', 700)
    room.clearCardsFromPublicZones([card])
    card.bindCandidates([1], 'hand', null, { known: true })
    rebuildAmbiguousIndex(room)
    expect(room.ambiguousKnownIndex.get(1)).toBeNull()

    card.setLocationCandidates([hand, mark], 'test:hand-or-mark')
    room.ambiguousKnownIndex.applyDirtyCardEvents(Array.from(room.constraintGroups.values()))

    expect(room.ambiguousKnownIndex.describe(1)).toBe('1号位手牌/1号位标记')
    expectAmbiguousKnownIndexMatchesRebuild(room)
  })

  it('公共候选变化：单牌增量更新或删除公共候选描述', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1] })
    const card = getCard(room, 1)
    const pileTop = publicLocation('pile', 'top', 2)
    const hand = playerLocation(1, 'hand')
    card.confirmKnown()
    card.setLocationCandidates([pileTop, hand], 'test:public-or-hand')
    rebuildAmbiguousIndex(room)
    expect(room.ambiguousKnownIndex.describe(1)).toContain('牌堆顶前2张')

    card.removeLocationCandidate(pileTop, 'test:remove-public')
    room.ambiguousKnownIndex.applyDirtyCardEvents(Array.from(room.constraintGroups.values()))

    expect(room.ambiguousKnownIndex.get(1)).toBeNull()
    expect(card.locationCandidates).toEqual([])
    expectAmbiguousKnownIndexMatchesRebuild(room)
  })

  it('装备容器候选跨牌依赖：装备本体移动时描述座位前缀随之更新', () => {
    const { room } = createTestRoom({ cardIDs: [1, 161], seatIDs: [1, 2] })
    const markCard = getCard(room, 1)
    const equipment = getCard(room, 161)
    room.clearCardsFromPublicZones([markCard, equipment])
    equipment.bindCandidates([1], 'equip', null, { known: true })
    markCard.confirmKnown()
    markCard.setLocationCandidates([equipmentContainer(161, 700)], 'test:container-only')
    rebuildAmbiguousIndex(room)
    expect(room.ambiguousKnownIndex.describe(1)).toBe('1号位标记')

    equipment.bindCandidates([2], 'equip', null, { known: true })
    const { stats } = collectTraversalStats(() => {
      const applied = room.ambiguousKnownIndex.applyDirtyCardEvents(
        Array.from(room.constraintGroups.values())
      )
      expect(applied).toBe(true)
    })

    expect(stats.sites.get('ambiguousKnownIndex:rebuild')).toBeUndefined()
    expect(room.ambiguousKnownIndex.describe(1)).toBe('2号位标记')
    expectAmbiguousKnownIndexMatchesRebuild(room)
  })

  it('dirty 游标断档：回退全量 rebuild 并返回 false', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1, 2] })
    rebuildAmbiguousIndex(room)
    const consumed = room.ambiguousKnownIndex.lastConsumedSeq
    const first = getCard(room, 1)
    const second = getCard(room, 2)
    room.clearCardsFromPublicZones([first, second])
    first.bindCandidates([1, 2], 'hand', null, { known: true })
    second.bindCandidates([1, 2], 'hand', null, { known: true })
    room.dirtyCardEvents = room.dirtyCardEvents.filter((event) => event.seq > consumed + 1)
    expect(room.dirtyCardEvents.length).toBeGreaterThan(0)

    const { result: applied, stats } = collectTraversalStats(() =>
      room.ambiguousKnownIndex.applyDirtyCardEvents(Array.from(room.constraintGroups.values()))
    )

    expect(applied).toBe(false)
    expect(stats.sites.get('ambiguousKnownIndex:rebuild')?.calls).toBe(1)
    expect(room.ambiguousKnownIndex.get(1)).not.toBeNull()
    expect(room.ambiguousKnownIndex.get(2)).not.toBeNull()
    expectAmbiguousKnownIndexMatchesRebuild(room)
  })

  it('约束组 source label 变化：无卡牌脏事件时只刷新存量模糊明牌描述', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1, 2] })
    const card = getCard(room, 1)
    room.clearCardsFromPublicZones([card])
    card.bindCandidates([1, 2], 'hand', null, { known: true })
    room.createConstraintGroup({
      id: 'test:ambiguous-source',
      cards: [card],
      candidateSeats: [1, 2],
      known: true,
      sourceEvent: { type: 'test:first-source', label: '旧来源' }
    })
    room.resolveConstraints()
    expect(room.ambiguousKnownIndex.describe(1)).toContain('旧来源')
    const previousSeq = room.dirtyCardSeq

    room.createConstraintGroup({
      id: 'test:ambiguous-source',
      cards: [card],
      candidateSeats: [1, 2],
      known: true,
      sourceEvent: { type: 'test:second-source', label: '新来源' }
    })
    const { stats } = collectTraversalStats(() => room.resolveConstraints())

    expect(room.dirtyCardSeq).toBe(previousSeq)
    expect(room.constraintGroupsDirty).toBe(false)
    expect(stats.sites.get('ambiguousKnownIndex:rebuild')).toBeUndefined()
    expect(stats.sites.get('ambiguousKnownIndex:applyDirty')).toEqual({ calls: 1, visited: 0 })
    expect(stats.sites.get('ambiguousKnownIndex:refreshGroups')).toEqual({ calls: 1, visited: 1 })
    expect(room.ambiguousKnownIndex.describe(1)).toContain('新来源')
    expect(room.ambiguousKnownIndex.describe(1)).not.toContain('旧来源')
    expectAmbiguousKnownIndexMatchesRebuild(room)
  })

  it('约束组 sourceEvent 仅引用变化：同 type/label 不置结构 dirty', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1, 2] })
    const card = getCard(room, 1)
    room.clearCardsFromPublicZones([card])
    card.bindCandidates([1, 2], 'hand', null, { known: true })
    room.createConstraintGroup({
      id: 'test:same-source',
      cards: [card],
      candidateSeats: [1, 2],
      known: true,
      sourceEvent: { type: 'test:same-source', label: '同来源', raw: { seq: 1 } }
    })
    room.resolveConstraints()
    expect(room.ambiguousKnownIndex.describe(1)).toContain('同来源')

    room.createConstraintGroup({
      id: 'test:same-source',
      cards: [card],
      candidateSeats: [1, 2],
      known: true,
      sourceEvent: { type: 'test:same-source', label: '同来源', raw: { seq: 2 } }
    })
    const { stats } = collectTraversalStats(() => room.resolveConstraints())

    expect(room.constraintGroupsDirty).toBe(false)
    expect(stats.sites.get('ambiguousKnownIndex:rebuild')).toBeUndefined()
    expectAmbiguousKnownIndexMatchesRebuild(room)
  })

  it('约束组替换成员：无卡牌脏事件时同步旧成员和新成员的来源', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1, 2] })
    const previousCard = getCard(room, 1)!
    const nextCard = getCard(room, 2)!
    previousCard.bindCandidates([1, 2], 'hand', null, { known: true })
    nextCard.bindCandidates([1, 2], 'hand', null, { known: true })
    const group = room.createConstraintGroup({
      cards: [previousCard],
      sourceEvent: { label: '替换来源' }
    })
    room.resolveConstraints()
    const previousSeq = room.dirtyCardSeq

    expect(room.constraints.replaceCardInConstraintGroups(previousCard, nextCard)).toBe(true)
    const { stats } = collectTraversalStats(() => room.resolveConstraints())

    expect(room.dirtyCardSeq).toBe(previousSeq)
    expect(stats.sites.get('ambiguousKnownIndex:rebuild')).toBeUndefined()
    expect(stats.sites.get('ambiguousKnownIndex:refreshGroups')).toEqual({ calls: 1, visited: 2 })
    expect(room.ambiguousKnownIndex.get(1)?.groups).toEqual([])
    expect(room.ambiguousKnownIndex.describe(1)).not.toContain('替换来源')
    expect(room.ambiguousKnownIndex.get(2)?.groups).toEqual([group])
    expect(room.ambiguousKnownIndex.describe(2)).toContain('替换来源')
    expectAmbiguousKnownIndexMatchesRebuild(room)
  })

  it('结构变化与卡牌脏事件同时发生：先增删条目，再刷新所有存量来源', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1, 2] })
    const resolvedCard = getCard(room, 1)!
    const addedCard = getCard(room, 2)!
    const keptCard = getCard(room, 3)!
    resolvedCard.bindCandidates([1, 2], 'hand', null, { known: true })
    addedCard.bindCandidates([1], 'hand', null, { known: true })
    keptCard.bindCandidates([1, 2], 'hand', null, { known: true })
    const group = room.createConstraintGroup({
      id: 'test:mixed-group-changes',
      cards: [resolvedCard, keptCard],
      sourceEvent: { label: '旧来源' }
    })
    room.resolveConstraints()

    resolvedCard.deleteSeat(2, 'test:resolved')
    addedCard.setSeats([1, 2], 'test:added')
    room.removeCardsFromConstraintGroups([resolvedCard])
    room.createConstraintGroup({
      id: group.id,
      cards: [addedCard],
      sourceEvent: { label: '新来源' }
    })
    const { stats } = collectTraversalStats(() => room.resolveConstraints())

    expect(room.constraintGroupsDirty).toBe(false)
    expect(stats.sites.get('ambiguousKnownIndex:rebuild')).toBeUndefined()
    expect(stats.sites.get('ambiguousKnownIndex:applyDirty')).toEqual({ calls: 1, visited: 2 })
    expect(stats.sites.get('ambiguousKnownIndex:refreshGroups')).toEqual({ calls: 1, visited: 2 })
    expect(room.ambiguousKnownIndex.get(1)).toBeNull()
    for (const card of [addedCard, keptCard]) {
      expect(room.ambiguousKnownIndex.get(card.id)?.groups).toEqual([group])
      expect(room.ambiguousKnownIndex.describe(card.id)).toContain('新来源')
      expect(room.ambiguousKnownIndex.describe(card.id)).not.toContain('旧来源')
    }
    expectAmbiguousKnownIndexMatchesRebuild(room)
  })

  it('结构 dirty 且游标断档：全量重建已覆盖当前分组，不重复刷新描述', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1, 2] })
    const first = getCard(room, 1)!
    const second = getCard(room, 2)!
    first.bindCandidates([1, 2], 'hand', null, { known: true })
    second.bindCandidates([1], 'hand', null, { known: true })
    const group = room.createConstraintGroup({
      cards: [first],
      sourceEvent: { label: '旧来源' }
    })
    room.resolveConstraints()
    const consumedSeq = room.ambiguousKnownIndex.lastConsumedSeq

    second.setSeats([1, 2], 'test:gap')
    room.createConstraintGroup({
      id: group.id,
      cards: [second],
      sourceEvent: { label: '新来源' }
    })
    room.dirtyCardEvents = room.dirtyCardEvents.filter((event) => event.seq > consumedSeq + 1)
    expect(room.dirtyCardEvents.length).toBeGreaterThan(0)
    const { stats } = collectTraversalStats(() => room.resolveConstraints())

    expect(room.constraintGroupsDirty).toBe(false)
    expect(stats.sites.get('ambiguousKnownIndex:rebuild')?.calls).toBe(1)
    expect(stats.sites.get('ambiguousKnownIndex:applyDirty')).toBeUndefined()
    expect(stats.sites.get('ambiguousKnownIndex:refreshGroups')).toBeUndefined()
    for (const card of [first, second]) {
      expect(room.ambiguousKnownIndex.get(card.id)?.groups).toEqual([group])
      expect(room.ambiguousKnownIndex.describe(card.id)).toContain('新来源')
    }
    expectAmbiguousKnownIndexMatchesRebuild(room)
  })

  it('initDeck 全量重建后清理约束组 dirty 标记', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1] })
    room.markConstraintGroupsDirty('test:initDeck')
    room.initDeck([1, 2, 3, 4])

    const { stats } = collectTraversalStats(() => room.resolveConstraints())

    expect(room.constraintGroupsDirty).toBe(false)
    expect(stats.sites.get('ambiguousKnownIndex:rebuild')).toBeUndefined()
    expectAmbiguousKnownIndexMatchesRebuild(room)
  })

  it('约束组删除：只刷新存量模糊明牌并移除来源描述', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1, 2] })
    const card = getCard(room, 1)
    room.clearCardsFromPublicZones([card])
    card.bindCandidates([1, 2], 'hand', null, { known: true })
    room.createConstraintGroup({
      id: 'test:remove-group',
      cards: [card],
      candidateSeats: [1, 2],
      known: true,
      sourceEvent: { type: 'test:source', label: '待删除来源' }
    })
    room.resolveConstraints()
    expect(room.ambiguousKnownIndex.describe(1)).toContain('待删除来源')

    const changed = room.removeCardsFromConstraintGroups([card])
    expect(changed).toBe(true)
    const { stats } = collectTraversalStats(() => room.resolveConstraints())

    expect(room.constraintGroupsDirty).toBe(false)
    expect(stats.sites.get('ambiguousKnownIndex:rebuild')).toBeUndefined()
    expect(stats.sites.get('ambiguousKnownIndex:applyDirty')).toEqual({ calls: 1, visited: 0 })
    expect(stats.sites.get('ambiguousKnownIndex:refreshGroups')).toEqual({ calls: 1, visited: 1 })
    expect(room.ambiguousKnownIndex.get(1)?.groups).toEqual([])
    expect(room.ambiguousKnownIndex.describe(1)).not.toContain('待删除来源')
    expectAmbiguousKnownIndexMatchesRebuild(room)
  })

  it('约束组未命中删除：不置结构 dirty，普通增量路径继续使用 applyDirty', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1, 2] })
    const card = getCard(room, 1)
    const other = getCard(room, 2)
    room.clearCardsFromPublicZones([card, other])
    card.bindCandidates([1, 2], 'hand', null, { known: true })
    room.createConstraintGroup({
      id: 'test:kept-group',
      cards: [card],
      candidateSeats: [1, 2],
      known: true
    })
    room.resolveConstraints()

    const changed = room.removeCardsFromConstraintGroups([other])
    expect(changed).toBe(false)
    other.bindCandidates([1, 2], 'hand', null, { known: true })
    const { stats } = collectTraversalStats(() => room.resolveConstraints())

    expect(stats.sites.get('ambiguousKnownIndex:rebuild')).toBeUndefined()
    expect(stats.sites.get('ambiguousKnownIndex:applyDirty')?.calls).toBe(1)
    expectAmbiguousKnownIndexMatchesRebuild(room)
  })

  it('比较结构包含组 id，避免同牌不同来源误判一致', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })
    const card = getCard(room, 1)
    room.clearCardsFromPublicZones([card])
    card.bindCandidates([1, 2], 'hand', null, { known: true })
    room.createConstraintGroup({
      id: 'test:comparable',
      cards: [card],
      candidateSeats: [1, 2],
      expectedSlotsByLocation: new Map([[createLocationCandidateKey(playerLocation(1, 'hand')), 1]])
    })
    room.resolveConstraints()

    expectAmbiguousKnownIndexMatchesRebuild(room)
  })
})
