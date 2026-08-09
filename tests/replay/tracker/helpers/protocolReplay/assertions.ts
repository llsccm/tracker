import { createLocationCandidateKey } from '@/tracker/candidate/locationCandidate'
import type { Room } from '@/tracker/Room'

export interface ReplayAssertionContext {
  seq: number
  className: string
  room: Room | null
}

/**
 * 可编程领域断言。
 *
 * `at` 为数字时表示“应用完该 seq 的协议之后”检查一次；
 * `'each'` 每条协议后检查；`'final'` 全部回放结束后检查一次。
 * `check` 返回 `null` 视为通过，返回字符串视为违反并作为原因输出。
 */
export interface ReplayAssertion {
  label: string
  at: number | 'each' | 'final'
  /** 断言关注的卡牌；首个违反时用于收敛因果闭包。 */
  cardIDs?: number[]
  check(context: ReplayAssertionContext): string | null
}

export interface ReplayAssertionViolation {
  seq: number
  className: string
  label: string
  message: string
  cardIDs: number[]
}

/**
 * 按 `at` 分派断言并记录哪些定点断言从未被求值。
 * 未求值的定点断言会在结束时视为违反，避免“回放没报错就等于通过”。
 */
export class ReplayAssertionRunner {
  private readonly bySeq = new Map<number, ReplayAssertion[]>()
  private readonly each: ReplayAssertion[] = []
  private readonly final: ReplayAssertion[] = []
  private readonly evaluated = new Set<ReplayAssertion>()

  constructor(assertions: ReplayAssertion[] = []) {
    assertions.forEach((assertion) => {
      if (assertion.at === 'each') {
        this.each.push(assertion)
        return
      }
      if (assertion.at === 'final') {
        this.final.push(assertion)
        return
      }
      const bucket = this.bySeq.get(assertion.at) ?? []
      bucket.push(assertion)
      this.bySeq.set(assertion.at, bucket)
    })
  }

  get isEnabled(): boolean {
    return this.bySeq.size > 0 || this.each.length > 0 || this.final.length > 0
  }

  /** 应用完一条协议后求值；返回本条协议上的全部违反。 */
  runAfterProtocol(context: ReplayAssertionContext): ReplayAssertionViolation[] {
    const pinned = this.bySeq.get(context.seq) ?? []
    return this.run([...this.each, ...pinned], context)
  }

  /** 全部协议回放结束后求值 `final` 断言。 */
  runFinal(context: ReplayAssertionContext): ReplayAssertionViolation[] {
    return this.run(this.final, context)
  }

  /**
   * 从未被求值的断言：定点断言对应的 seq 没出现，或回放提前停止导致 `final` 断言没跑。
   * 这些必须计为违反，否则“回放没报错”会被误读成“断言都通过了”。
   */
  collectUnevaluated(lastSeq: number, className: string): ReplayAssertionViolation[] {
    const violations: ReplayAssertionViolation[] = []
    this.bySeq.forEach((assertions, seq) => {
      assertions.forEach((assertion) => {
        if (this.evaluated.has(assertion)) return
        violations.push({
          seq,
          className,
          label: assertion.label,
          message: `断言未被求值：回放中没有出现 seq=${seq}（最后处理到 seq=${lastSeq}）`,
          cardIDs: assertion.cardIDs ?? []
        })
      })
    })
    this.final.forEach((assertion) => {
      if (this.evaluated.has(assertion)) return
      violations.push({
        seq: lastSeq,
        className,
        label: assertion.label,
        message: `断言未被求值：回放在 seq=${lastSeq} 提前停止，final 断言没有执行`,
        cardIDs: assertion.cardIDs ?? []
      })
    })
    return violations
  }

  private run(
    assertions: ReplayAssertion[],
    context: ReplayAssertionContext
  ): ReplayAssertionViolation[] {
    const violations: ReplayAssertionViolation[] = []
    assertions.forEach((assertion) => {
      this.evaluated.add(assertion)
      const message = assertion.check(context)
      if (message === null) return
      violations.push({
        seq: context.seq,
        className: context.className,
        label: assertion.label,
        message,
        cardIDs: assertion.cardIDs ?? []
      })
    })
    return violations
  }
}

/** 断言某张牌在指定 seq 之后的座位候选集合恰好等于 `seats`。 */
export function expectCardSeatsAt(
  at: number | 'final',
  cardID: number,
  seats: number[]
): ReplayAssertion {
  const expected = sortNumbers(seats)
  return {
    label: `card ${cardID} seats = [${expected.join(', ')}] @${at}`,
    at,
    cardIDs: [cardID],
    check: ({ room }) => {
      const card = room?.cardIndex.get(cardID)
      if (!card) return `卡牌 ${cardID} 不在 cardIndex 中`
      const actual = sortNumbers(Array.from(card.seats))
      if (sameNumbers(actual, expected)) return null
      return `期望 seats=[${expected.join(', ')}]，实际 [${actual.join(', ')}]（${card.getLocationDescription()}）`
    }
  }
}

/**
 * 断言某张牌在指定 seq 之后的完整位置候选 key 集合恰好等于 `candidates`。
 * key 由 {@link createLocationCandidateKey} 生成，例如 `player:7:hand:none`。
 */
export function expectCardLocationCandidatesAt(
  at: number | 'final',
  cardID: number,
  candidates: string[]
): ReplayAssertion {
  const expected = candidates.slice().sort()
  return {
    label: `card ${cardID} candidates = [${expected.join(', ')}] @${at}`,
    at,
    cardIDs: [cardID],
    check: ({ room }) => {
      const card = room?.cardIndex.get(cardID)
      if (!card) return `卡牌 ${cardID} 不在 cardIndex 中`
      const actual = card
        .getLocationCandidates()
        .map((candidate) => createLocationCandidateKey(candidate))
        .filter(Boolean)
        .sort()
      if (sameStrings(actual, expected)) return null
      return `期望 candidates=[${expected.join(', ')}]，实际 [${actual.join(', ')}]`
    }
  }
}

/** 断言某张牌在指定 seq 之后至少包含给定座位候选（允许存在其他候选）。 */
export function expectCardIncludesSeatsAt(
  at: number | 'final',
  cardID: number,
  seats: number[]
): ReplayAssertion {
  const expected = sortNumbers(seats)
  return {
    label: `card ${cardID} seats ⊇ [${expected.join(', ')}] @${at}`,
    at,
    cardIDs: [cardID],
    check: ({ room }) => {
      const card = room?.cardIndex.get(cardID)
      if (!card) return `卡牌 ${cardID} 不在 cardIndex 中`
      const missing = expected.filter((seatID) => !card.seats.has(seatID))
      if (missing.length === 0) return null
      const actual = sortNumbers(Array.from(card.seats))
      return `缺少座位候选 [${missing.join(', ')}]，实际 [${actual.join(', ')}]`
    }
  }
}

function sortNumbers(values: Iterable<number>): number[] {
  return Array.from(values).sort((left, right) => left - right)
}

function sameNumbers(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}
