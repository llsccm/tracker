import { describe, expect, it } from 'vitest'
import { collectTraversalStats } from '@/tracker/traversalStats'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import { createTestRoom, getCard } from './helpers/room'
import { expectAmbiguousKnownIndexMatchesRebuild } from './helpers/ambiguousKnownIndex'
import { equipmentContainer, playerLocation, publicLocation } from './helpers/locationCandidates'

function rebuildAmbiguousIndex(room) {
  room.ambiguousKnownIndex.rebuild(Array.from(room.constraintGroups.values()))
}

describe('AmbiguousKnownIndex 增量维护（Step 6）', () => {
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
    expect(room.ambiguousKnownIndex.describe(1)).toContain('牌堆随机2张')

    card.removeLocationCandidate(pileTop, 'test:remove-public')
    room.ambiguousKnownIndex.applyDirtyCardEvents(Array.from(room.constraintGroups.values()))

    expect(room.ambiguousKnownIndex.get(1)).toBeNull()
    expect(card.getLocationCandidates()).toEqual([])
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

  it('约束组 source label 变化：结构 dirty 时走全量 rebuild 并刷新描述', () => {
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

    room.createConstraintGroup({
      id: 'test:ambiguous-source',
      cards: [card],
      candidateSeats: [1, 2],
      known: true,
      sourceEvent: { type: 'test:second-source', label: '新来源' }
    })
    const { stats } = collectTraversalStats(() => room.resolveConstraints())

    expect(stats.sites.get('ambiguousKnownIndex:rebuild')?.calls).toBe(1)
    expect(room.ambiguousKnownIndex.describe(1)).toContain('新来源')
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

  it('initDeck 全量重建后清理约束组 dirty 标记', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1] })
    room.markConstraintGroupsDirty('test:initDeck')
    room.initDeck([1, 2, 3, 4])

    const { stats } = collectTraversalStats(() => room.resolveConstraints())

    expect(room.constraintGroupsDirty).toBe(false)
    expect(stats.sites.get('ambiguousKnownIndex:rebuild')).toBeUndefined()
    expectAmbiguousKnownIndexMatchesRebuild(room)
  })

  it('约束组删除：结构 dirty 时走全量 rebuild 并移除来源描述', () => {
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

    expect(stats.sites.get('ambiguousKnownIndex:rebuild')?.calls).toBe(1)
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
