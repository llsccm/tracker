import {
  createLocationCandidateKey,
  normalizeLocationCandidate,
  parseLocationCandidateKey
} from '../candidate/locationCandidate'
import type { LocationCandidateInput } from '../candidate/locationCandidate'
import { getConstraintSlotState } from './constraintSlots'
import type { Card } from '@/tracker/model'
import type { LocationCandidate, MoveSourceEvent, SeatID } from '../types'

export interface SlotCountRange {
  readonly min: number
  readonly max: number
}

export type SlotCountInput = number | SlotCountRange

type CountMapInput<Key extends string | number | object> =
  | Map<Key, SlotCountInput>
  | Record<string, SlotCountInput>

export interface ConstraintGroupOptions {
  id?: string | number
  cards?: Card[]
  /** 分组涉及的座位快照，仅用于建立/描述分组，不限制牌的当前候选全集。 */
  candidateSeats?: SeatID[]
  expectedSlotsByLocation?: CountMapInput<string | LocationCandidateInput>
  known?: boolean
  sourceEvent?: MoveSourceEvent | string | null
}

/**
 * 局部约束组，表达一次移动、分配或模糊明牌事件形成的候选包。
 *
 * expectedSlotsByLocation 约束“这组牌里有几张落在某个完整位置”。
 * 运行时只保存完整位置名额；owner 确定不代表手牌/标记区位置确定。
 */
export class ConstraintGroup {
  declare id: string | number | undefined
  declare cards: Set<Card>
  declare candidateSeats: Set<SeatID>
  declare expectedSlotsByLocation: Map<string, SlotCountRange>
  declare known: boolean
  declare sourceEvent: MoveSourceEvent | string | null
  private readonly expectedLocations = new WeakMap<
    Map<string, SlotCountRange>,
    Map<string, LocationCandidate | null>
  >()

  constructor(options: ConstraintGroupOptions = {}) {
    const { id, cards = [], candidateSeats = [], known = false, sourceEvent = null } = options

    this.id = id
    this.cards = new Set(cards)
    this.candidateSeats = new Set(candidateSeats)
    this.expectedSlotsByLocation = this.normalizeExpectedLocationSlots(
      options.expectedSlotsByLocation ?? new Map()
    )
    this.known = known
    this.sourceEvent = sourceEvent
  }

  /**
   * 规整完整位置的期望槽位数。
   */
  normalizeExpectedLocationSlots(
    expectedSlotsByLocation: CountMapInput<string | LocationCandidateInput>
  ): Map<string, SlotCountRange> {
    const entries =
      expectedSlotsByLocation instanceof Map
        ? Array.from(expectedSlotsByLocation.entries())
        : Object.entries(expectedSlotsByLocation ?? {})

    const slots = new Map<string, SlotCountRange>()
    const locations = new Map<string, LocationCandidate | null>()
    for (const [candidate, count] of entries) {
      const location =
        typeof candidate === 'string'
          ? parseLocationCandidateKey(candidate)
          : normalizeLocationCandidate(candidate)
      // 名额只保存 Key 语义；公共候选的展示 label 不属于位置键。
      if (location?.type === 'public') location.label = null
      const key = createLocationCandidateKey(location ? Object.freeze(location) : null)
      const range = typeof count === 'number' ? { min: count, max: count } : count
      if (
        !Number.isSafeInteger(range.min) ||
        !Number.isSafeInteger(range.max) ||
        range.min < 0 ||
        range.max < range.min
      ) {
        throw new RangeError('位置名额必须为安全整数且满足 0 <= min <= max')
      }
      if (!key) continue
      slots.set(key, { min: range.min, max: range.max })
      locations.set(key, location)
    }
    this.expectedLocations.set(slots, locations)
    return slots
  }

  addCards(cards: Card | Card[]): void {
    const nextCards = Array.isArray(cards) ? cards : [cards]
    nextCards.forEach((card) => {
      if (card) {
        this.cards.add(card)
      }
    })
  }

  /** 位置只由 key 决定；名额原地扣减或删除不会使解析缓存失效。 */
  getExpectedLocation(key: string): LocationCandidate | null {
    let locations = this.expectedLocations.get(this.expectedSlotsByLocation)
    if (!locations) {
      locations = new Map()
      this.expectedLocations.set(this.expectedSlotsByLocation, locations)
    }
    const cached = locations.get(key)
    if (cached !== undefined) return cached
    const location = parseLocationCandidateKey(key)
    locations.set(key, location ? Object.freeze(location) : null)
    return location
  }

  /**
   * 将分组基础状态写回卡牌
   * @returns 是否发生变化
   */
  apply(): boolean {
    let changed = false

    this.cards.forEach((card) => {
      if (this.known && !card.isKnown) {
        card.confirmKnown()
        changed = true
      }
    })

    return changed
  }

  /**
   * 只在当前局部分组内按完整位置名额消元。
   * candidateSeats 是历史座位快照，不能裁剪后续事件添加的完整位置候选。
   * @returns 是否发生变化
   */
  resolve(): boolean {
    let changed = this.apply()
    const ownerSyncedCards = new Set<Card>()
    const slotEntries = this.expectedSlotsByLocation

    slotEntries.forEach((expectedCount, key) => {
      const location = this.getExpectedLocation(key)
      if (!location) return
      const { candidateCards, remainingMin, remainingMax } = getConstraintSlotState(
        this.cards,
        location,
        expectedCount,
        key
      )

      if (remainingMax === 0) {
        candidateCards.forEach((card) => {
          changed = card.removeLocationCandidate(key, 'constraintGroup:expectedLocation') || changed
          ownerSyncedCards.add(card)
        })
        return
      }

      // 组外位置仍然可能承接这些牌，局部名额不足以把它们锁定在本组。
      if (candidateCards.length > remainingMin) return
      const coversAllCandidates = candidateCards.every((card) =>
        card.areLocationCandidatesCoveredBy(slotEntries)
      )
      if (!coversAllCandidates) return

      candidateCards.forEach((card) => {
        // 公共端点和装备容器仍保留完整候选，不能丢掉端点范围或绑定到承载座位。
        changed =
          (location.type === 'player' || location.type === 'popup'
            ? card.resolveLocationCandidate(location, 'constraintGroup:expectedLocation')
            : card.setLocationCandidates([location], 'constraintGroup:expectedLocation')) || changed
        ownerSyncedCards.add(card)
      })
    })

    this.cards.forEach((card) => {
      if (card.location === 'player' && !ownerSyncedCards.has(card)) {
        changed = card.syncOwnerFromSeats('constraintGroup:resolveOwner') || changed
      }
    })
    return changed
  }
}
