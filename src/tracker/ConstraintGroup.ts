import {
  createLocationCandidateKey,
  parseLocationCandidateKey
} from './candidate/locationCandidate'
import type { LocationCandidateInput } from './candidate/locationCandidate'
import { getConstraintSlotState } from './candidate/constraintSlots'
import type { Card } from './Card'
import type { MoveSourceEvent, SeatID } from './types'

type CountMapInput<Key extends string | number | object> =
  | Map<Key, number | string>
  | Record<string, number | string>

export interface ConstraintGroupOptions {
  id?: string | number
  cards?: Card[]
  /** 分组涉及的座位快照，仅用于建立/描述分组，不限制牌的当前候选全集。 */
  candidateSeats?: SeatID[]
  /** 仅入参糖：建组/更新时转换为普通手牌完整位置名额，不保留座位名额存储。 */
  expectedSlotsBySeat?: CountMapInput<SeatID>
  expectedSlotsByLocation?: CountMapInput<string | LocationCandidateInput>
  known?: boolean
  sourceEvent?: MoveSourceEvent | string | null
}

/**
 * 局部约束组，表达一次移动、分配或模糊明牌事件形成的候选包。
 *
 * expectedSlotsBySeat 仅作为普通手牌位置名额的入参糖。
 * expectedSlotsByLocation 约束“这组牌里有几张落在某个完整位置”。
 * 运行时只保存完整位置名额；owner 确定不代表手牌/标记区位置确定。
 */
export class ConstraintGroup {
  declare id: string | number | undefined
  declare cards: Set<Card>
  declare candidateSeats: Set<SeatID>
  declare expectedSlotsByLocation: Map<string, number>
  declare known: boolean
  declare sourceEvent: MoveSourceEvent | string | null

  constructor(options: ConstraintGroupOptions = {}) {
    const { id, cards = [], candidateSeats = [], known = false, sourceEvent = null } = options

    this.id = id
    this.cards = new Set(cards)
    this.candidateSeats = new Set(candidateSeats.map((seat) => Number(seat)))
    this.expectedSlotsByLocation = this.normalizeSlotOptions(options)
    this.known = known
    this.sourceEvent = sourceEvent
  }

  normalizeSlotOptions(
    options: Pick<ConstraintGroupOptions, 'expectedSlotsBySeat' | 'expectedSlotsByLocation'>,
    previous: ReadonlyMap<string, number> = new Map()
  ): Map<string, number> {
    const hasLocations = options.expectedSlotsByLocation !== undefined
    const locations = hasLocations
      ? this.normalizeExpectedLocationSlots(options.expectedSlotsByLocation ?? new Map())
      : new Map(previous)
    if (options.expectedSlotsBySeat === undefined) return locations

    // 单独更新座位糖等价于替换普通 hand:none 名额，保留标记、公共区和其它完整 hand key。
    if (!hasLocations) {
      for (const key of locations.keys()) {
        const candidate = parseLocationCandidateKey(key)
        if (
          candidate?.type === 'player' &&
          candidate.subZone === 'hand' &&
          candidate.spellID === null
        ) {
          locations.delete(key)
        }
      }
    }
    const handSeats = new Set<SeatID>()
    for (const key of locations.keys()) {
      const candidate = parseLocationCandidateKey(key)
      if (candidate?.type === 'player' && candidate.subZone === 'hand')
        handSeats.add(candidate.seatID)
    }
    const seatSlots = options.expectedSlotsBySeat ?? new Map()
    const entries = seatSlots instanceof Map ? seatSlots.entries() : Object.entries(seatSlots)
    for (const [seat, count] of entries) {
      const seatID = Number(seat)
      if (handSeats.has(seatID)) continue
      locations.set(
        createLocationCandidateKey({
          type: 'player',
          seatID,
          subZone: 'hand',
          spellID: null
        }),
        Math.max(0, Number(count) || 0)
      )
    }
    return locations
  }

  /**
   * 规整完整位置的期望槽位数。
   */
  normalizeExpectedLocationSlots(
    expectedSlotsByLocation: CountMapInput<string | LocationCandidateInput>
  ): Map<string, number> {
    const entries =
      expectedSlotsByLocation instanceof Map
        ? Array.from(expectedSlotsByLocation.entries())
        : Object.entries(expectedSlotsByLocation ?? {})

    return new Map<string, number>(
      entries
        .map(([candidate, count]): [string, number] => {
          const key =
            typeof candidate === 'string'
              ? createLocationCandidateKey(parseLocationCandidateKey(candidate))
              : createLocationCandidateKey(candidate)
          return [key, Math.max(0, Number(count) || 0)]
        })
        .filter(([key]) => key)
    )
  }

  addCards(cards: Card | Card[]): void {
    const nextCards = Array.isArray(cards) ? cards : [cards]
    nextCards.forEach((card) => {
      if (card) {
        this.cards.add(card)
        card.combinationID = this.id
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
      // combinationID 是展示/迁移用的最近分组标签；同一张牌可同时属于多个约束组，
      // 不能让这个单值标签在组间来回覆盖时驱动收敛继续循环。
      if (card.combinationID !== this.id) {
        card.combinationID = this.id
      }

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
   * expectedSlotsBySeat 在入参处已转换为完整手牌位置，不参与运行时消元。
   * @returns 是否发生变化
   */
  resolve(): boolean {
    let changed = this.apply()
    const ownerSyncedCards = new Set<Card>()
    const slotEntries = this.expectedSlotsByLocation

    slotEntries.forEach((expectedCount, key) => {
      const location = parseLocationCandidateKey(key)
      if (!location) return
      const { candidateCards, remainingCount } = getConstraintSlotState(
        this.cards,
        location,
        expectedCount
      )

      if (remainingCount === 0) {
        candidateCards.forEach((card) => {
          changed = card.removeLocationCandidate(key, 'constraintGroup:expectedLocation') || changed
          ownerSyncedCards.add(card)
        })
        return
      }

      // 组外位置仍然可能承接这些牌，局部名额不足以把它们锁定在本组。
      if (candidateCards.length > remainingCount) return
      const coversAllCandidates = candidateCards.every((card) =>
        card.locationCandidates.every((candidate) =>
          slotEntries.has(createLocationCandidateKey(candidate))
        )
      )
      if (!coversAllCandidates) return

      candidateCards.forEach((card) => {
        // 公共端点和装备容器仍保留完整候选，不能丢掉端点范围或绑定到承载座位。
        changed =
          (location.type === 'player'
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
