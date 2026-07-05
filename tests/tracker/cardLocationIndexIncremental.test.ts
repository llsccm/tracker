import { describe, expect, it } from 'vitest'
import { collectTraversalStats } from '@/tracker/traversalStats'
import { createTestRoom, getCard } from './helpers/room'
import { expectLocationIndexMatchesRebuild } from './helpers/locationIndex'

// 覆盖 plans/cards-incremental-index-and-fast-path-plan.md 阶段 1 的增量维护能力。
// 该阶段不接入 resolveConstraints（仍默认全量 rebuild），这里直接驱动索引的增量入口，
// 与对同一 Room 的全量 rebuild 影子索引比对，验证等价性、桶内顺序、游标断档回退与显式公共区刷新。
describe('CardLocationIndex 增量维护', () => {
  it('确定手牌明牌移入弃牌堆：增量等价全量，且不触发全量 rebuild', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4, 5], seatIDs: [1, 2] })
    const known = getCard(room, 5)
    room.clearCardsFromPublicZones([known])
    known.bindCandidates([1], 'hand', null, { known: true })
    room.locationIndex.rebuild(room) // 基线
    expect(room.locationIndex.knownHandBySeat.get(1)).toEqual([known])

    const { stats } = collectTraversalStats(() => {
      // Zone.add → moveToPublicZone → clearSeats 会发脏牌事件
      room.zones.get('discard').add(known)
      room.locationIndex.applyDirtyCardEvents(room)
    })

    // 走的是增量，不是全量 rebuild
    expect(stats.sites.get('locationIndex:rebuild')).toBeUndefined()
    expect(stats.sites.get('locationIndex:applyDirty')?.calls).toBe(1)

    expect(room.locationIndex.knownHandBySeat.get(1)).toEqual([])
    expect(room.locationIndex.publicByZone.get('discard')).toEqual([known])
    expectLocationIndexMatchesRebuild(room)
  })

  it('牌堆确定明牌摸入手牌：刷新来源牌堆与目标玩家桶', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4, 5], seatIDs: [1, 2] })
    room.locationIndex.rebuild(room)
    const drawn = getCard(room, 3)

    room.zones.get('pile').removeCard(drawn)
    drawn.bindCandidates([1], 'hand', null, { known: true })
    const applied = room.locationIndex.applyDirtyCardEvents(room)

    expect(applied).toBe(true)
    expect(room.locationIndex.knownHandBySeat.get(1)).toEqual([drawn])
    expect(room.locationIndex.publicByZone.get('pile')?.includes(drawn)).toBe(false)
    expectLocationIndexMatchesRebuild(room)
  })

  it('多座位候选手牌收敛为确定手牌：从候选桶迁到确定桶', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1, 2] })
    const card = getCard(room, 1)
    room.clearCardsFromPublicZones([card])
    card.bindCandidates([1, 2], 'hand', null, { known: true })
    room.locationIndex.rebuild(room)
    expect(room.locationIndex.candidateHandBySeat.get(1)).toEqual([card])
    expect(room.locationIndex.candidateHandBySeat.get(2)).toEqual([card])

    card.deleteSeat(2, 'test:resolve-to-seat1')
    room.locationIndex.applyDirtyCardEvents(room)

    expect(room.locationIndex.candidateHandBySeat.get(1)).toEqual([])
    expect(room.locationIndex.candidateHandBySeat.get(2)).toEqual([])
    expect(room.locationIndex.knownHandBySeat.get(1)).toEqual([card])
    expectLocationIndexMatchesRebuild(room)
  })

  it('装备移交与标记弃置：从旧桶删除并插入新桶，清掉空 spellID 子数组', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1, 2] })
    const equip = getCard(room, 1)
    const mark = getCard(room, 2)
    room.clearCardsFromPublicZones([equip, mark])
    equip.bindCandidates([1], 'equip', null, { known: true })
    mark.bindCandidates([1], 'mark', 700, { known: true })
    room.locationIndex.rebuild(room)
    expect(room.locationIndex.equipBySeat.get(1)).toEqual([equip])
    expect(room.locationIndex.markBySeatAndSpell.get(1)?.get(700)).toEqual([mark])

    equip.bindCandidates([2], 'equip', null, { known: true })
    room.zones.get('discard').add(mark)
    room.locationIndex.applyDirtyCardEvents(room)

    expect(room.locationIndex.equipBySeat.get(1)).toEqual([])
    expect(room.locationIndex.equipBySeat.get(2)).toEqual([equip])
    expect(room.locationIndex.markBySeatAndSpell.get(1)?.has(700) ?? false).toBe(false)
    expectLocationIndexMatchesRebuild(room)
  })

  it('保持桶内 room.cards 顺序：乱序摸入后仍按实体顺序排列', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4, 5], seatIDs: [1, 2] })
    room.locationIndex.rebuild(room)

    // 先摸 4（下标 3）再摸 2（下标 1），桶内应仍是 [2, 4]
    ;[4, 2].forEach((id) => {
      const card = getCard(room, id)
      room.zones.get('pile').removeCard(card)
      card.bindCandidates([1], 'hand', null, { known: true })
    })
    room.locationIndex.applyDirtyCardEvents(room)

    expect(room.locationIndex.knownHandBySeat.get(1)).toEqual([getCard(room, 2), getCard(room, 4)])
    expectLocationIndexMatchesRebuild(room)
  })

  it('dirtyCardEvents 游标断档时回退全量 rebuild', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1, 2] })
    room.locationIndex.rebuild(room)
    const consumed = room.locationIndex.lastConsumedSeq

    const a = getCard(room, 1)
    const b = getCard(room, 2)
    room.clearCardsFromPublicZones([a, b])
    a.bindCandidates([1], 'hand', null, { known: true })
    b.bindCandidates([2], 'hand', null, { known: true })

    // 模拟事件缓冲被 DIRTY_CARD_EVENT_LIMIT 从前部 splice：丢掉“下一条应消费”的事件，
    // 使缓冲最早序号 > lastConsumedSeq + 1，制造断档。
    room.dirtyCardEvents = room.dirtyCardEvents.filter((event) => event.seq > consumed + 1)
    expect(room.dirtyCardEvents.length).toBeGreaterThan(0)

    const { result: applied, stats } = collectTraversalStats(() =>
      room.locationIndex.applyDirtyCardEvents(room)
    )

    expect(applied).toBe(false) // 回退了全量
    expect(stats.sites.get('locationIndex:rebuild')?.calls).toBe(1)
    expect(room.locationIndex.knownHandBySeat.get(1)).toEqual([a])
    expect(room.locationIndex.knownHandBySeat.get(2)).toEqual([b])
    expectLocationIndexMatchesRebuild(room)
  })

  it('纯公共区暗牌移动：无脏牌事件，需显式 dirtyPublicZones 才刷新公共桶', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4, 5], seatIDs: [1, 2] })
    room.locationIndex.rebuild(room)
    const pile = room.zones.get('pile')
    const discard = room.zones.get('discard')

    // 顶部一张无席位暗牌：move 只改 location，不经 clearSeats，不发脏牌事件
    const moved = pile.remove(1)[0]
    discard.add(moved)

    // 不给提示：无脏牌事件，公共桶保持基线（陈旧）
    room.locationIndex.applyDirtyCardEvents(room)
    expect(room.locationIndex.publicByZone.get('discard')).toEqual([])

    // 显式告知受影响公共区后与全量一致
    room.locationIndex.applyDirtyCardEvents(room, { dirtyPublicZones: ['pile', 'discard'] })
    expect(room.locationIndex.publicByZone.get('discard')).toEqual([moved])
    expectLocationIndexMatchesRebuild(room)
  })

  it('resolveConstraintCards 同席位改子区/技能时发脏牌事件并重投影', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3], seatIDs: [1, 2] })
    const card = getCard(room, 1)
    room.clearCardsFromPublicZones([card])
    card.bindCandidates([1], 'hand', null, { known: true })
    room.locationIndex.rebuild(room)
    expect(room.locationIndex.knownHandBySeat.get(1)).toEqual([card])

    room.createConstraintGroup({
      cardIDs: [1],
      seatID: 1,
      subZone: 'mark',
      spellID: 700,
      known: true
    })
    room.locationIndex.applyDirtyCardEvents(room)

    expect(room.locationIndex.knownHandBySeat.get(1)).toEqual([])
    expect(room.locationIndex.markBySeatAndSpell.get(1)?.get(700)).toEqual([card])
    expectLocationIndexMatchesRebuild(room)
  })
})

describe('syncViewGroups 按 seat 增量（C1）', () => {
  it('只同步指定玩家，且与全量同步该玩家结果一致', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2, 3, 4], seatIDs: [1, 2] })
    const hand1 = getCard(room, 1)
    const hand2 = getCard(room, 2)
    room.clearCardsFromPublicZones([hand1, hand2])
    hand1.bindCandidates([1], 'hand', null, { known: true })
    hand2.bindCandidates([2], 'hand', null, { known: true })
    room.locationIndex.rebuild(room)

    // 只同步 seat1
    room.constraints.syncViewGroups([1])
    expect(room.getPlayer(1).knownHandCards).toEqual([hand1])
    expect(room.getPlayer(2).knownHandCards).toEqual([]) // 未同步

    // 全量同步后 seat2 就位，与只同步 seat2 的结果一致
    room.constraints.syncViewGroups()
    expect(room.getPlayer(2).knownHandCards).toEqual([hand2])
  })
})
