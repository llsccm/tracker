import {
  createLocationCandidateKey,
  parseLocationCandidateKey
} from '../candidate/locationCandidate'
import type { LocationCandidateInput } from '../candidate/locationCandidate'
import { getConstraintSlotState } from './constraintSlots'
import type { Card } from '@/tracker/model'
import type { MoveSourceEvent, SeatID } from '../types'

export interface SlotCountRange {
  readonly min: number
  readonly max: number
}

export type SlotCountInput = number | string | SlotCountRange

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

  constructor(options: ConstraintGroupOptions = {}) {
    const { id, cards = [], candidateSeats = [], known = false, sourceEvent = null } = options

    this.id = id
    this.cards = new Set(cards)
    this.candidateSeats = new Set(candidateSeats.map((seat) => Number(seat)))
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

    return new Map<string, SlotCountRange>(
      entries
        .map(([candidate, count]): [string, SlotCountRange] => {
          const key =
            typeof candidate === 'string'
              ? createLocationCandidateKey(parseLocationCandidateKey(candidate))
              : createLocationCandidateKey(candidate)
          const range =
            typeof count === 'object' ? count : { min: Number(count), max: Number(count) }
          if (range.min < 0 || range.max < range.min) {
            throw new RangeError('位置名额必须满足 0 <= min <= max')
          }
          return [key, { min: range.min, max: range.max }]
        })
        .filter(([key]) => key)
    )
  }

  addCards(cards: Card | Card[]): void {
    const nextCards = Array.isArray(cards) ? cards : [cards]
    nextCards.forEach((card) => {
      if (card) {
        this.cards.add(card)
      }
    })
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
      const location = parseLocationCandidateKey(key)
      if (!location) return
      const { candidateCards, remainingMin, remainingMax } = getConstraintSlotState(
        this.cards,
        location,
        expectedCount
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
        card.locationCandidates.every((candidate) =>
          slotEntries.has(createLocationCandidateKey(candidate))
        )
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
