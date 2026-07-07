import { describe, expect, it } from 'vitest'
import { createTestRoom, getCard } from './helpers/room'

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
