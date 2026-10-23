import { collectConstraintHandSlots, type ConstraintHandSlotState } from './constraintSlots'
import { collectHandSlotCardsBySeat } from './handSlotCounts'
import type { Card } from '@/tracker/model/Card'
import type { ConstraintGroup } from './ConstraintGroup'
import type { Room } from '../Room'
import type { SeatID } from '../types'

interface HandSlotBudget {
  cards: Set<Card>
  count: number
}

export interface HandSlotAllocation {
  exactKnownCount: number
  exactHiddenCount: number
  /** 单座位可容纳的候选明牌上界，不能相加作为全局确定身份数。 */
  candidateKnownUpperBound: number
  ambiguousHiddenCoveredCount: number
  candidateKnownCards: Card[]
  exactHiddenCards: Card[]
  /** 已落定手牌位置、等待接管匿名物理槽的范围身份。 */
  detachedKnownCards: Card[]
  /** 未观测手牌总数时，展示额度未知；不能安全对账时，补位数量也为 null。 */
  unknownCardCount: number | null
  anonymousMissingCount: number | null
  anonymousExcessCount: number | null
  canReconcileAnonymous: boolean
}

/**
 * 手牌数量的统一读面：一次归组，同时计算展示额度和匿名实体补缺。
 * 只读取协议事实与候选，不选择一个匹配作为身份归属，也不回写 observedHandCount。
 */
export function computeHandSlotAllocation(
  room: Room,
  seatIDs: Iterable<SeatID> = room.players.keys(),
  /** 收敛器可复用同一同步阶段已刷新的玩家区快照。 */
  playerCards?: Card[]
): Map<SeatID, HandSlotAllocation> {
  const targetSeats = Array.from(seatIDs).filter((seatID) => room.players.has(seatID))
  const allocations = new Map<SeatID, HandSlotAllocation>()
  if (targetSeats.length === 0) return allocations
  const cardsBySeat = collectHandSlotCardsBySeat(
    playerCards ?? room.refreshPlayerSnapshot(),
    targetSeats
  )
  const slots = collectConstraintHandSlots(room.constraintGroups.values())
  // 暗覆盖和整座位明牌额度共享查询，缓存只在这次只读计算期间有效。
  const candidateCounts = new Map<string, number>()
  const countKnownSlots = (seatID: SeatID, cards: readonly Card[]): number => {
    if (cards.length === 0) return 0
    const key = `${seatID}:${cards
      .map((card) => card.entityID)
      .sort((a, b) => a - b)
      .join(',')}`
    const cached = candidateCounts.get(key)
    if (cached !== undefined) return cached
    const count = countCandidateHandSlots(slots, seatID, cards)
    candidateCounts.set(key, count)
    return count
  }
  // 跨座位暗实体匹配始终包含完整约束集合，不随本轮重算的座位子集改变。
  const hiddenCoverage = collectHiddenHandCoverage(slots, countKnownSlots)
  for (const seatID of targetSeats) {
    const player = room.players.get(seatID)!
    const cards = cardsBySeat.get(seatID)!
    const exactKnownCount = cards.knownCards.length
    const exactHiddenCount = cards.exactHiddenCards.length
    const candidateKnownUpperBound = countKnownSlots(seatID, cards.candidateCards)
    const detachedKnownCards = cards.knownCards.filter((card) => room.detachedKnownCards.has(card))
    const physicalCandidateCards = cards.candidateCards.filter(
      (card) => !room.detachedKnownCards.has(card)
    )
    const physicalCandidateUpperBound =
      physicalCandidateCards.length === cards.candidateCards.length
        ? candidateKnownUpperBound
        : countKnownSlots(seatID, physicalCandidateCards)
    const ambiguousHiddenCoveredCount = hiddenCoverage.coveredBySeat.get(seatID) ?? 0
    const unknownCardCount = player.hasObservedHandCount
      ? Math.max(0, player.observedHandCount - exactKnownCount - candidateKnownUpperBound)
      : null
    // 有明牌候选却没有可解释名额、或暗实体不能满足全部跨座位需求时，不补造物理实体。
    const canReconcileAnonymous =
      unknownCardCount !== null &&
      !hiddenCoverage.unresolvedSeats.has(seatID) &&
      (cards.candidateCards.length === 0 || candidateKnownUpperBound > 0)
    // detached 身份可以占展示名额，但不承担物理槽；候选上界与实体补缺分别按同一组约束求值。
    const physicalUnknownCount = player.hasObservedHandCount
      ? Math.max(
          0,
          player.observedHandCount -
            (exactKnownCount - detachedKnownCards.length) -
            physicalCandidateUpperBound
        )
      : null
    const anonymousBalance = !canReconcileAnonymous
      ? null
      : physicalUnknownCount! - exactHiddenCount - ambiguousHiddenCoveredCount
    allocations.set(seatID, {
      exactKnownCount,
      exactHiddenCount,
      candidateKnownUpperBound,
      ambiguousHiddenCoveredCount,
      candidateKnownCards: cards.candidateCards,
      exactHiddenCards: cards.exactHiddenCards,
      detachedKnownCards,
      unknownCardCount,
      anonymousMissingCount: anonymousBalance === null ? null : Math.max(0, anonymousBalance),
      anonymousExcessCount: anonymousBalance === null ? null : Math.max(0, -anonymousBalance),
      canReconcileAnonymous
    })
  }
  return allocations
}

/**
 * 明牌候选在一个座位上最多可覆盖的槽位数，不代表这些身份已确定属于该座位。
 * 每张身份只计一次，同时满足所有组的剩余名额；不同座位分别计算可能上界。
 */
function countCandidateHandSlots(
  slots: readonly ConstraintHandSlotState[],
  seatID: SeatID,
  candidateCards: readonly Card[]
): number {
  if (candidateCards.length === 0) return 0
  const allowedCards = new Set(candidateCards)
  const budgets: HandSlotBudget[] = []
  for (const slot of slots) {
    if (slot.location.type !== 'player' || slot.location.seatID !== seatID) continue
    const cards = slot.candidateCards.filter((card) => allowedCards.has(card))
    if (cards.length === 0) continue
    budgets.push({ cards: new Set(cards), count: slot.remainingMax })
  }

  // 不相交的组独立求值，避免把多个小问题乘成全局状态空间。
  const remaining = new Set(budgets)
  let count = 0
  while (remaining.size > 0) {
    const first = remaining.values().next().value as HandSlotBudget
    const component = [first]
    const cards = new Set<Card>(first.cards)
    remaining.delete(first)
    for (let index = 0; index < component.length; index += 1) {
      for (const budget of remaining) {
        if (!Array.from(budget.cards).some((card) => cards.has(card))) continue
        component.push(budget)
        budget.cards.forEach((card) => cards.add(card))
        remaining.delete(budget)
      }
    }
    count += countBudgetComponent(component, cards)
  }
  return count
}

function countBudgetComponent(budgets: HandSlotBudget[], cards: Set<Card>): number {
  // 相同实体集合只保留最紧的名额，重复历史组不会增加额度。
  const uniqueBudgets = new Map<string, HandSlotBudget>()
  for (const budget of budgets) {
    if (budget.count >= budget.cards.size) continue
    const key = Array.from(budget.cards, (card) => card.entityID)
      .sort((a, b) => a - b)
      .join(',')
    const previous = uniqueBudgets.get(key)
    if (!previous || budget.count < previous.count) uniqueBudgets.set(key, budget)
  }
  const constraints = Array.from(uniqueBudgets.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, budget]) => budget)
  if (constraints.length === 0) return cards.size
  if (constraints.length === 1) {
    return cards.size - constraints[0].cards.size + constraints[0].count
  }

  // 同时属于相同约束的身份可以按数量一起求解，无需枚举具体 CardID 组合。
  const buckets = new Map<string, { indices: number[]; count: number }>()
  for (const card of cards) {
    const indices = constraints.flatMap((budget, index) => (budget.cards.has(card) ? [index] : []))
    const key = indices.join(',')
    const bucket = buckets.get(key)
    if (bucket) bucket.count += 1
    else buckets.set(key, { indices, count: 1 })
  }
  const patterns = Array.from(buckets.values()).sort(
    (left, right) =>
      right.indices.length - left.indices.length ||
      left.indices.join(',').localeCompare(right.indices.join(','))
  )
  const suffixCounts = new Array<number>(patterns.length + 1).fill(0)
  const suffixByConstraint = Array.from({ length: patterns.length + 1 }, () =>
    new Array<number>(constraints.length).fill(0)
  )
  for (let index = patterns.length - 1; index >= 0; index -= 1) {
    suffixCounts[index] = suffixCounts[index + 1] + patterns[index].count
    suffixByConstraint[index] = suffixByConstraint[index + 1].slice()
    patterns[index].indices.forEach((constraint) => {
      suffixByConstraint[index][constraint] += patterns[index].count
    })
  }
  const memo = new Map<string, number>()
  const solve = (index: number, capacities: number[]): number => {
    if (index === patterns.length) return 0
    const key = `${index}:${capacities.join(',')}`
    const cached = memo.get(key)
    if (cached !== undefined) return cached
    const upper = Math.min(
      suffixCounts[index],
      ...capacities.map(
        (capacity, constraint) =>
          capacity + suffixCounts[index] - suffixByConstraint[index][constraint]
      )
    )
    const pattern = patterns[index]
    const maximum = Math.min(
      pattern.count,
      ...pattern.indices.map((constraint) => capacities[constraint])
    )
    let best = 0
    for (let used = maximum; used >= 0; used -= 1) {
      if (used + suffixCounts[index + 1] <= best) break
      const next = capacities.slice()
      pattern.indices.forEach((constraint) => {
        next[constraint] -= used
      })
      best = Math.max(best, used + solve(index + 1, next))
      if (best === upper) break
    }
    memo.set(key, best)
    return best
  }
  return solve(
    0,
    constraints.map((budget) => budget.count)
  )
}

interface HiddenHandCoveragePackage {
  coverageBySeat: Map<SeatID, number>
  hiddenCards: Set<Card>
  hiddenCardsBySeat: Map<SeatID, Set<Card>>
}

/** 剩余名额中明牌候选无法覆盖的部分，才由未决暗实体承接。 */
function collectHiddenHandCoverage(
  slots: readonly ConstraintHandSlotState[],
  countKnownSlots: (seatID: SeatID, cards: readonly Card[]) => number
): { coveredBySeat: Map<SeatID, number>; unresolvedSeats: Set<SeatID> } {
  const packagesByGroup = new Map<ConstraintGroup, HiddenHandCoveragePackage>()
  const unresolvedSeats = new Set<SeatID>()
  for (const slot of slots) {
    if (slot.location.type !== 'player') continue
    const seatID = slot.location.seatID
    // 暗实体的区间占用还不能确定，补位可能和它重复承担物理手牌。
    if (
      slot.remainingMin !== slot.remainingMax &&
      slot.candidateCards.some((card) => !card.isKnown)
    ) {
      unresolvedSeats.add(seatID)
    }
    if (slot.remainingMin === 0) continue
    const knownCount = countKnownSlots(
      seatID,
      slot.candidateCards.filter((card) => card.isKnown)
    )
    const hiddenCards = slot.candidateCards.filter((card) => !card.isKnown)
    const count = Math.min(hiddenCards.length, Math.max(0, slot.remainingMin - knownCount))
    if (count === 0) continue
    const coverage = packagesByGroup.get(slot.group) ?? {
      coverageBySeat: new Map<SeatID, number>(),
      hiddenCards: new Set<Card>(),
      hiddenCardsBySeat: new Map<SeatID, Set<Card>>()
    }
    coverage.coverageBySeat.set(seatID, (coverage.coverageBySeat.get(seatID) ?? 0) + count)
    const seatCards = coverage.hiddenCardsBySeat.get(seatID) ?? new Set<Card>()
    hiddenCards.forEach((card) => {
      seatCards.add(card)
      coverage.hiddenCards.add(card)
    })
    coverage.hiddenCardsBySeat.set(seatID, seatCards)
    packagesByGroup.set(slot.group, coverage)
  }
  const coverageBySeat = new Map<SeatID, number>()
  collectCoverageComponents(Array.from(packagesByGroup.values())).forEach((component) => {
    if (addCoverageComponent(component, coverageBySeat)) return
    component.forEach((coverage) =>
      coverage.coverageBySeat.forEach((_, seatID) => {
        unresolvedSeats.add(seatID)
      })
    )
  })
  return { coveredBySeat: coverageBySeat, unresolvedSeats }
}

function haveHiddenCardOverlap(
  left: HiddenHandCoveragePackage,
  right: HiddenHandCoveragePackage
): boolean {
  for (const card of left.hiddenCards) {
    if (right.hiddenCards.has(card)) return true
  }
  return false
}

function collectCoverageComponents(
  packages: HiddenHandCoveragePackage[]
): HiddenHandCoveragePackage[][] {
  const remaining = new Set(packages)
  const components: HiddenHandCoveragePackage[][] = []

  // 重叠关系具有传递性：A 与 B、B 与 C 共享实体时，三者必须在同一分量内统一分配。
  while (remaining.size > 0) {
    const first = remaining.values().next().value as HiddenHandCoveragePackage
    const component: HiddenHandCoveragePackage[] = []
    const queue = [first]
    remaining.delete(first)

    while (queue.length > 0) {
      const current = queue.pop()
      if (!current) continue
      component.push(current)

      for (const candidate of remaining) {
        if (!haveHiddenCardOverlap(current, candidate)) continue
        remaining.delete(candidate)
        queue.push(candidate)
      }
    }

    components.push(component)
  }

  return components
}

function addCoverageComponent(
  component: HiddenHandCoveragePackage[],
  coverageBySeat: Map<SeatID, number>
): boolean {
  const requiredBySeat = new Map<SeatID, number>()
  const eligibleCardsBySeat = new Map<SeatID, Set<Card>>()

  component.forEach((coveragePackage) => {
    coveragePackage.coverageBySeat.forEach((count, seatID) => {
      // 同一席位的历史组可能重复描述同一事实，取最大需求可避免把重复约束相加。
      requiredBySeat.set(seatID, Math.max(requiredBySeat.get(seatID) ?? 0, count))
      const eligibleCards = eligibleCardsBySeat.get(seatID) ?? new Set<Card>()
      coveragePackage.hiddenCardsBySeat.get(seatID)?.forEach((card) => eligibleCards.add(card))
      eligibleCardsBySeat.set(seatID, eligibleCards)
    })
  })

  const slots = Array.from(requiredBySeat.entries())
    .flatMap(([seatID, count]) =>
      Array.from({ length: count }, () => ({
        seatID,
        eligibleCards: eligibleCardsBySeat.get(seatID) ?? new Set<Card>()
      }))
    )
    .sort((left, right) => left.eligibleCards.size - right.eligibleCards.size)
  const matchedSlotByCard = new Map<Card, number>()

  // 用增广路径为席位槽寻找不同实体；重新安置旧匹配可避免共享实体造成贪心误判。
  const matchSlot = (slotIndex: number, visitedCards: Set<Card>): boolean => {
    for (const card of slots[slotIndex].eligibleCards) {
      if (visitedCards.has(card)) continue
      visitedCards.add(card)

      const previousSlotIndex = matchedSlotByCard.get(card)
      if (previousSlotIndex === undefined || matchSlot(previousSlotIndex, visitedCards)) {
        matchedSlotByCard.set(card, slotIndex)
        return true
      }
    }
    return false
  }

  slots.forEach((_, slotIndex) => {
    matchSlot(slotIndex, new Set<Card>())
  })

  // 不完整匹配下，哪一个座位“缺实体”依赖遍历顺序，不能据此补牌或释放牌。
  if (matchedSlotByCard.size < slots.length) return false

  matchedSlotByCard.forEach((slotIndex) => {
    const seatID = slots[slotIndex].seatID
    coverageBySeat.set(seatID, (coverageBySeat.get(seatID) ?? 0) + 1)
  })
  return true
}
