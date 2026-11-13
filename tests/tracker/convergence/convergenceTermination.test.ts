import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import { collectTraversalStats } from '@/tracker/traversalStats'
import { playerLocation } from '../helpers/locationCandidates'
import { createTestRoom, getCard } from '../helpers/room'

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * 收敛终止性回归护栏（承接 #2「约束二收敛非终止」修复）。
 *
 * 历史 bug：同一张牌同时属于多个约束组时，`combinationID` 单值标签在组间来回覆盖；
 * 且多座位候选每轮重投影都虚报 `changed`。二者都让 `resolveConstraints` 找不到不动点、
 * 空转到 `limit=100`（真实对局 avgRounds≈88）。此前合成单测只有确定移动、从不构造
 * 重叠组，故 168 例全绿而真实对局病态慢——所以这里在 Room 级直接断言收敛轮数。
 *
 * 这条护栏不针对某个具体 `changed` 来源，而是兜住"任何"未来的虚报-changed 回归：
 * `room.lastResolveRounds` 与 `resolveConstraints` 尾部的看门狗同源，轮数一旦回到病态
 * 高位就会被这里捕获，比 traversalBaseline 的遍历计数护栏更贴近"是否终止"本身。
 */
describe('收敛终止性回归护栏（#2 约束二收敛非终止）', () => {
  it('约束组收缩在分配阶段被消费，稳定末轮不再重算手牌槽', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })
    const card = getCard(room, 1)!
    const firstHand = playerLocation(1, 'hand')
    const secondHand = playerLocation(2, 'hand')
    card.setLocationCandidates([firstHand, secondHand])
    room.createConstraintGroup({
      cards: [card],
      expectedSlotsByLocation: new Map([
        [createLocationCandidateKey(firstHand), 1],
        [createLocationCandidateKey(secondHand), 0]
      ])
    })
    const firstPlayer = room.getPlayer(1)
    const secondPlayer = room.getPlayer(2)
    firstPlayer.syncObservedHandCount(1)
    secondPlayer.syncObservedHandCount(0)
    const firstRefresh = vi.spyOn(firstPlayer, 'refreshUnknownCardCount')
    const secondRefresh = vi.spyOn(secondPlayer, 'refreshUnknownCardCount')

    const { stats } = collectTraversalStats(() => room.resolveConstraints())

    expect(room.lastResolveRounds).toBe(2)
    expect(card.owner).toBe(1)
    expect(card.locationCandidates).toEqual([])
    expect(firstPlayer.knownHandCards).toEqual([card])
    expect(firstRefresh).toHaveBeenCalledTimes(1)
    expect(secondRefresh).toHaveBeenCalledTimes(1)
    expect(stats.sites.get('handSlotCounts:collectBySeat')).toEqual({ calls: 1, visited: 1 })
  })

  it('同座位在分配前收缩、分配后补位时，下一轮仍重算匿名覆盖', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })
    const card = getCard(room, 1)!
    const hand = playerLocation(1, 'hand')
    const mark = playerLocation(1, 'mark', 700)
    card.setLocationCandidates([hand, mark])
    room.createConstraintGroup({
      cards: [card],
      expectedSlotsByLocation: new Map([
        [createLocationCandidateKey(hand), 1],
        [createLocationCandidateKey(mark), 0]
      ])
    })
    const firstPlayer = room.getPlayer(1)
    const secondPlayer = room.getPlayer(2)
    firstPlayer.syncObservedHandCount(2)
    secondPlayer.syncObservedHandCount(0)
    const firstRefresh = vi.spyOn(firstPlayer, 'refreshUnknownCardCount')
    const secondRefresh = vi.spyOn(secondPlayer, 'refreshUnknownCardCount')

    const { stats } = collectTraversalStats(() => room.resolveConstraints())

    expect(room.lastResolveRounds).toBe(2)
    expect(firstRefresh).toHaveBeenCalledTimes(2)
    expect(secondRefresh).toHaveBeenCalledTimes(1)
    expect(firstPlayer.unknownCardCount).toBe(1)
    expect(firstPlayer.knownHandCards).toEqual([card])
    expect(room.playerCardsSnapshot).toHaveLength(2)
    expect(room.playerCardsSnapshot.filter((card) => card.isAnonymous)).toHaveLength(1)
    expect(stats.sites.get('handSlotCounts:collectBySeat')).toEqual({ calls: 2, visited: 3 })
    expect(room.resolveTouchedSeats).toBeNull()
  })

  it('匿名手牌补位后只重算受影响座位，手牌槽缓存不跨次收敛复用', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })
    const firstPlayer = room.players.get(1)!
    const secondPlayer = room.players.get(2)!
    firstPlayer.syncObservedHandCount(1)
    secondPlayer.syncObservedHandCount(0)

    const firstRefresh = vi.spyOn(firstPlayer, 'refreshUnknownCardCount')
    const secondRefresh = vi.spyOn(secondPlayer, 'refreshUnknownCardCount')

    room.resolveConstraints()

    expect(room.lastResolveRounds).toBe(2)
    expect(firstRefresh).toHaveBeenCalledTimes(2)
    expect(secondRefresh).toHaveBeenCalledTimes(1)
    expect(room.playerCardsSnapshot).toHaveLength(1)
    expect(room.playerCardsSnapshot[0].resolvedSeat).toBe(1)
    expect(room.resolveTouchedSeats).toBeNull()

    const anonymousHandCard = room.playerCardsSnapshot[0]
    firstRefresh.mockClear()
    secondRefresh.mockClear()
    room.resolveConstraints()

    expect(room.lastResolveRounds).toBe(1)
    expect(firstRefresh).toHaveBeenCalledTimes(1)
    expect(secondRefresh).toHaveBeenCalledTimes(1)
    expect(room.playerCardsSnapshot).toEqual([anonymousHandCard])
    expect(room.resolveTouchedSeats).toBeNull()
  })

  it('分配后的排他沿共享组传递重算，保留无关座位缓存', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1, 2, 3, 4] })
    const firstCard = getCard(room, 1)!
    const secondCard = getCard(room, 2)!
    const hands = [1, 2, 3].map((seatID) => playerLocation(seatID, 'hand'))
    firstCard.setLocationCandidates(hands.slice(0, 2))
    secondCard.setLocationCandidates(hands.slice(1))
    const cards = [firstCard, secondCard]
    cards.forEach((card, index) => {
      room.createConstraintGroup({
        cards: [card],
        expectedSlotsByLocation: new Map(
          hands
            .slice(index, index + 2)
            .map((hand) => [createLocationCandidateKey(hand), { min: 0, max: 1 }])
        )
      })
    })
    room.getPlayer(1).syncObservedHandCount(0)
    room.getPlayer(2).syncObservedHandCount(1)
    room.getPlayer(3).syncObservedHandCount(1)
    room.getPlayer(4).syncObservedHandCount(0)
    const thirdRefresh = vi.spyOn(room.getPlayer(3), 'refreshUnknownCardCount')
    const fourthRefresh = vi.spyOn(room.getPlayer(4), 'refreshUnknownCardCount')

    room.resolveConstraints()

    expect(room.lastResolveRounds).toBe(3)
    expect(firstCard.owner).toBe(2)
    expect(secondCard.owner).toBe(3)
    expect(firstCard.locationCandidates).toEqual([])
    expect(secondCard.locationCandidates).toEqual([])
    expect(thirdRefresh).toHaveBeenCalledTimes(3)
    expect(fourthRefresh).toHaveBeenCalledTimes(1)
    expect(room.playerCardsSnapshot).toHaveLength(2)
  })

  it('约束求解异常后清理触碰座位集合，后续调用仍可正常收敛', () => {
    const { room } = createTestRoom({ cardIDs: [1], seatIDs: [1, 2] })
    const card = getCard(room, 1)
    room.clearCardsFromPublicZones([card])
    card.bindCandidates([1, 2], 'hand', null, { known: true })
    room.createConstraintGroup({
      id: 'test:convergence-exception',
      cards: [card],
      candidateSeats: [1, 2],
      known: true
    })
    const group = room.constraintGroups.get('test:convergence-exception')!
    const error = new Error('test:constraint-resolution-failed')
    vi.spyOn(group, 'resolve').mockImplementationOnce(() => {
      throw error
    })

    expect(() => room.resolveConstraints()).toThrow(error)
    expect(room.resolveTouchedSeats).toBeNull()

    room.resolveConstraints()

    expect(room.lastResolveRounds).toBeGreaterThan(0)
    expect(room.lastResolveRounds).toBeLessThanOrEqual(3)
    expect(room.resolveTouchedSeats).toBeNull()
    expect(card.seats).toEqual(new Set([1, 2]))
  })

  it('重叠约束组 + 多座位候选不会驱动 resolveConstraints 空转', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1, 2] })
    const shared = getCard(room, 1)
    const other = getCard(room, 2)
    room.clearCardsFromPublicZones([shared, other])

    // 两张牌都成为 {1,2} 多座位手牌候选：复现"多座位候选每轮重投影虚报 changed"。
    shared.bindCandidates([1, 2], 'hand', null, { known: true })
    other.bindCandidates([1, 2], 'hand', null, { known: true })

    // 同一张 shared 牌同时属于两个约束组：复现"combinationID 单值标签在组间来回覆盖"。
    room.createConstraintGroup({
      id: 'test:terminate-a',
      cards: [shared, other],
      candidateSeats: [1, 2],
      known: true
    })
    room.createConstraintGroup({
      id: 'test:terminate-b',
      cards: [shared],
      candidateSeats: [1, 2],
      known: true
    })

    room.resolveConstraints()

    // 修复前该场景空转到 limit=100；修复后应在个位数轮内到不动点，远低于看门狗阈值(8)。
    expect(room.lastResolveRounds).toBeGreaterThan(0)
    expect(room.lastResolveRounds).toBeLessThanOrEqual(3)
    expect(room.maxResolveRounds).toBeLessThanOrEqual(3)
  })

  it('确定明牌移动只需极少轮收敛，maxResolveRounds 单调记录历史最大', () => {
    const { room } = createTestRoom({ cardIDs: [1, 2], seatIDs: [1, 2] })
    const card = getCard(room, 1)
    card.confirmKnown()

    room.resolveConstraints()
    const firstRounds = room.lastResolveRounds
    expect(firstRounds).toBeGreaterThan(0)
    expect(firstRounds).toBeLessThanOrEqual(2)

    room.resolveConstraints()
    // maxResolveRounds 是可查询的 tripwire：始终 ≥ 最近一次、≥ 历史任一次。
    expect(room.maxResolveRounds).toBeGreaterThanOrEqual(room.lastResolveRounds)
    expect(room.maxResolveRounds).toBeGreaterThanOrEqual(firstRounds)
  })
})
