import { createSubZoneCandidateKey, parseSubZoneCandidateKey } from './candidate/subZoneCandidate'
import {
  createLocationCandidateKey,
  fromSubZoneCandidate,
  parseLocationCandidateKey,
  toSubZoneCandidate
} from './candidate/locationCandidate'
import type { LocationCandidateInput } from './candidate/locationCandidate'
import type { SubZoneCandidateInput } from './candidate/subZoneCandidate'
import type { Card } from './Card'
import type { MoveSourceEvent, SeatID } from './types'

type CountMapInput<Key extends string | number | object> =
  | Map<Key, number | string>
  | Record<string, number | string>

interface ConstraintGroupOptions {
  id?: string | number
  cards?: Card[]
  candidateSeats?: SeatID[]
  expectedSlotsBySeat?: CountMapInput<SeatID>
  expectedSlotsBySubZone?: CountMapInput<string | SubZoneCandidateInput>
  expectedSlotsByLocation?: CountMapInput<string | LocationCandidateInput>
  known?: boolean
  sourceEvent?: MoveSourceEvent | string | null
}

/**
 * 局部约束组，表达一次移动、分配或模糊明牌事件形成的候选包。
 *
 * expectedSlotsBySeat 约束“这组牌里有几张属于某个座位”。
 * expectedSlotsByLocation 约束“这组牌里有几张落在某个完整位置”。
 * expectedSlotsBySubZone 是迁移期兼容镜像；两类约束不能混用语义：
 * owner 确定不代表手牌/标记区位置确定。
 */
export class ConstraintGroup {
  declare id: string | number | undefined
  declare cards: Set<Card>
  declare candidateSeats: Set<SeatID>
  declare expectedSlotsBySeat: Map<SeatID, number>
  declare expectedSlotsBySubZone: Map<string, number>
  declare expectedSlotsByLocation: Map<string, number>
  declare known: boolean
  declare sourceEvent: MoveSourceEvent | string | null

  constructor(options: ConstraintGroupOptions = {}) {
    const hasExpectedSlotsByLocation = Object.prototype.hasOwnProperty.call(
      options,
      'expectedSlotsByLocation'
    )
    const {
      id,
      cards = [],
      candidateSeats = [],
      expectedSlotsBySeat = new Map(),
      expectedSlotsBySubZone = new Map(),
      expectedSlotsByLocation = new Map(),
      known = false,
      sourceEvent = null
    } = options

    this.id = id
    this.cards = new Set(cards)
    this.candidateSeats = new Set(candidateSeats.map((seat) => Number(seat)))
    this.expectedSlotsBySeat = this.normalizeExpectedSlots(expectedSlotsBySeat)
    this.expectedSlotsBySubZone = this.normalizeExpectedSubZoneSlots(expectedSlotsBySubZone)
    this.expectedSlotsByLocation = this.normalizeExpectedLocationSlots(expectedSlotsByLocation)
    this.syncExpectedSlotCompatibility(hasExpectedSlotsByLocation ? 'location' : 'subZone')
    this.known = known
    this.sourceEvent = sourceEvent
  }

  normalizeExpectedSlots(expectedSlotsBySeat: CountMapInput<SeatID>): Map<SeatID, number> {
    if (expectedSlotsBySeat instanceof Map) {
      return new Map(
        Array.from(expectedSlotsBySeat.entries()).map(([seat, count]) => [
          Number(seat),
          Math.max(0, Number(count) || 0)
        ])
      )
    }

    return new Map(
      Object.entries(expectedSlotsBySeat ?? {}).map(([seat, count]) => [
        Number(seat),
        Math.max(0, Number(count) || 0)
      ])
    )
  }

  /**
   * 规整完整位置的期望槽位数。
   * key 由 seatID/subZone/spellID 三元组组成，例如 `1:mark:1234`。
   */
  normalizeExpectedSubZoneSlots(
    expectedSlotsBySubZone: CountMapInput<string | SubZoneCandidateInput>
  ): Map<string, number> {
    const entries =
      expectedSlotsBySubZone instanceof Map
        ? Array.from(expectedSlotsBySubZone.entries())
        : Object.entries(expectedSlotsBySubZone ?? {})

    return new Map<string, number>(
      entries
        .map(([candidate, count]): [string, number] => {
          const key =
            typeof candidate === 'string'
              ? createSubZoneCandidateKey(parseSubZoneCandidateKey(candidate))
              : createSubZoneCandidateKey(candidate)
          return [key, Math.max(0, Number(count) || 0)]
        })
        .filter(([key]) => key)
    )
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

  /**
   * 在迁移期保持 expectedSlotsBySubZone 与 expectedSlotsByLocation 双向镜像。
   */
  syncExpectedSlotCompatibility(source: 'location' | 'subZone' = 'location'): void {
    const nextLocationSlots = new Map<string, number>()

    if (source === 'subZone') {
      this.expectedSlotsByLocation.forEach((count, key) => {
        const candidate = parseLocationCandidateKey(key)
        if (candidate?.type !== 'player') {
          const locationKey = createLocationCandidateKey(candidate)
          if (locationKey) nextLocationSlots.set(locationKey, count)
        }
      })

      this.expectedSlotsBySubZone.forEach((count, key) => {
        const locationCandidate = fromSubZoneCandidate(parseSubZoneCandidateKey(key))
        const locationKey = createLocationCandidateKey(locationCandidate)
        if (locationKey) nextLocationSlots.set(locationKey, count)
      })
    } else {
      this.expectedSlotsByLocation.forEach((count, key) => {
        const locationKey = createLocationCandidateKey(parseLocationCandidateKey(key))
        if (locationKey) nextLocationSlots.set(locationKey, count)
      })
    }

    this.expectedSlotsByLocation = nextLocationSlots

    const nextSubZoneSlots = new Map<string, number>()

    this.expectedSlotsByLocation.forEach((count, key) => {
      const candidate = toSubZoneCandidate(parseLocationCandidateKey(key))
      if (!candidate) return

      const subZoneKey = createSubZoneCandidateKey(candidate)
      if (subZoneKey) {
        nextSubZoneSlots.set(subZoneKey, count)
      }
    })

    this.expectedSlotsBySubZone = nextSubZoneSlots
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
   * 只在当前局部分组内做候选席位收敛
   *
   * 收敛顺序刻意分层：
   * 1. candidateSeats 先把候选压回本组允许的座位集合。
   * 2. expectedSlotsBySeat 只处理“手牌属于某座位”的 owner 层约束。
   * 3. expectedSlotsByLocation 再处理手牌/标记/公共候选等完整位置约束。
   * 这样可以避免 seats.size === 1 时误把“owner 已知”当成“子区域已知”。
   * @returns 是否发生变化
   */
  resolve(): boolean {
    let changed = this.apply()
    const ownerSyncedCards = new Set<Card>()

    if (this.candidateSeats.size > 0) {
      this.cards.forEach((card) => {
        if (card.location !== 'player' || card.seats.size === 0) return

        const nextSeats = new Set(
          Array.from(card.seats, Number).filter((seat) => this.candidateSeats.has(Number(seat)))
        )
        if (nextSeats.size === 0) return

        changed = card.setSeats(nextSeats, 'constraintGroup:candidateSeats') || changed
        ownerSyncedCards.add(card)
      })
    }

    this.expectedSlotsBySeat.forEach((expectedCount, seatID) => {
      // seat 约束只看普通手牌候选；带 subZoneCandidates 的牌还需要位置层约束继续判断。
      const groupCards = Array.from(this.cards).filter(
        (card) =>
          card.location === 'player' &&
          card.subZone === 'hand' &&
          !card.hasSubZoneCandidates?.() &&
          card.seats.has(seatID)
      )

      const lockedCount = groupCards.filter(
        (card) => card.seats.size === 1 && card.seats.has(seatID)
      ).length

      if (lockedCount >= expectedCount) {
        groupCards.forEach((card) => {
          if (card.seats.size <= 1) return
          changed = card.deleteSeat(seatID, 'constraintGroup:expectedSlots') || changed
          ownerSyncedCards.add(card)
        })
      }
    })

    this.expectedSlotsByLocation.forEach((expectedCount, key) => {
      const locationCandidate = parseLocationCandidateKey(key)
      if (!locationCandidate) return

      if (locationCandidate.type === 'public') {
        const exactCards = Array.from(this.cards).filter((card) => {
          if (card.hasLocationCandidates?.()) return false

          // 确定公共牌只保存 zone；完整 key 匹配可避免具体 top/count 名额被同区牌提前占满。
          const exactLocationKey = createLocationCandidateKey({
            type: 'public',
            zone: card.location
          })
          return exactLocationKey === key
        })
        const candidateCards = Array.from(this.cards).filter((card) =>
          card.hasLocationCandidate?.(key)
        )
        const remainingExpected = expectedCount - exactCards.length

        if (remainingExpected <= 0) {
          candidateCards.forEach((card) => {
            changed =
              card.removeLocationCandidate(key, 'constraintGroup:expectedLocation') || changed
            ownerSyncedCards.add(card)
          })

          return
        }

        if (candidateCards.length <= remainingExpected) {
          const constrainedCandidateCards = candidateCards.filter((card) => {
            const allLocationCandidates = card.locationCandidates ?? []
            if (allLocationCandidates.length === 0) return true

            return allLocationCandidates.every((lc) => {
              const lcKey = createLocationCandidateKey(lc)
              return lcKey && this.expectedSlotsByLocation.has(lcKey)
            })
          })

          if (constrainedCandidateCards.length === candidateCards.length) {
            candidateCards.forEach((card) => {
              changed =
                card.setLocationCandidates(
                  [locationCandidate],
                  'constraintGroup:expectedLocation'
                ) || changed
              ownerSyncedCards.add(card)
            })
          }
        }

        return
      }

      if (locationCandidate.type === 'container') {
        // 装备容器不是确定玩家子区；数量约束只看候选牌本身，展示座位由索引投影决定。
        const candidateCards = Array.from(this.cards).filter((card) =>
          card.hasLocationCandidate?.(key)
        )
        const remainingExpected = expectedCount

        if (remainingExpected <= 0) {
          candidateCards.forEach((card) => {
            changed =
              card.removeLocationCandidate(key, 'constraintGroup:expectedLocation') || changed
            ownerSyncedCards.add(card)
          })

          return
        }

        if (candidateCards.length <= remainingExpected) {
          const constrainedCandidateCards = candidateCards.filter((card) => {
            const cardLocationCandidates = card.locationCandidates ?? []
            const subZoneLocationCandidates = card.hasSubZoneCandidates?.()
              ? (card.getSubZoneCandidates?.() ?? [])
                  .map((subZoneCandidate) => fromSubZoneCandidate(subZoneCandidate))
                  .filter(Boolean)
              : []
            const allLocationCandidates = cardLocationCandidates.concat(subZoneLocationCandidates)
            if (allLocationCandidates.length === 0) return true

            return allLocationCandidates.every((lc) => {
              const lcKey = createLocationCandidateKey(lc)
              return lcKey && this.expectedSlotsByLocation.has(lcKey)
            })
          })

          if (constrainedCandidateCards.length === candidateCards.length) {
            candidateCards.forEach((card) => {
              // 只锁定为单一容器候选，不解析成 player mark，避免装备后续迁移时丢候选。
              changed =
                card.setLocationCandidates(
                  [locationCandidate],
                  'constraintGroup:expectedLocation'
                ) || changed
              ownerSyncedCards.add(card)
            })
          }
        }

        return
      }

      const candidate = toSubZoneCandidate(locationCandidate)
      if (!candidate) return

      const subZoneKey = createSubZoneCandidateKey(candidate)
      const exactCards = Array.from(this.cards).filter(
        (card) =>
          card.location === 'player' &&
          !card.hasLocationCandidates?.() &&
          !card.hasSubZoneCandidates?.() &&
          card.seats.size === 1 &&
          card.seats.has(candidate.seatID) &&
          card.subZone === candidate.subZone &&
          (candidate.subZone !== 'mark' || card.spellID === candidate.spellID)
      )

      const candidateCards = Array.from(this.cards).filter(
        (card) =>
          card.hasLocationCandidate?.(key) || (subZoneKey && card.hasSubZoneCandidate?.(subZoneKey))
      )

      const remainingExpected = expectedCount - exactCards.length

      if (remainingExpected <= 0) {
        // 完整位置名额已被确定牌占满，仍带此候选的位置必须剔除。
        candidateCards.forEach((card) => {
          if (card.hasLocationCandidate?.(key)) {
            changed =
              card.removeLocationCandidate(key, 'constraintGroup:expectedLocation') || changed
          } else if (subZoneKey) {
            changed =
              card.removeSubZoneCandidate(subZoneKey, 'constraintGroup:expectedLocation') || changed
          }
          ownerSyncedCards.add(card)
        })

        return
      }

      if (candidateCards.length <= remainingExpected) {
        // 只有所有候选牌的位置候选都被本约束组 expectedSlotsByLocation 覆盖时，
        // 才能使用“候选数不超过剩余名额”的强锁推理。
        // 任意一张牌还有公共区或组外玩家位置候选时，都可能逃逸到那些位置，
        // 不能借它参与数量判断并强制锁定其它候选牌。
        const constrainedCandidateCards = candidateCards.filter((card) => {
          const cardLocationCandidates = card.locationCandidates ?? []
          const subZoneLocationCandidates = card.hasSubZoneCandidates?.()
            ? (card.getSubZoneCandidates?.() ?? [])
                .map((subZoneCandidate) => fromSubZoneCandidate(subZoneCandidate))
                .filter(Boolean)
            : []
          const allLocationCandidates = cardLocationCandidates.concat(subZoneLocationCandidates)
          if (allLocationCandidates.length === 0) return true

          return allLocationCandidates.every((lc) => {
            const lcKey = createLocationCandidateKey(lc)
            return lcKey && this.expectedSlotsByLocation.has(lcKey)
          })
        })

        if (constrainedCandidateCards.length === candidateCards.length) {
          candidateCards.forEach((card) => {
            if (card.hasLocationCandidate?.(key)) {
              changed =
                card.resolveLocationCandidate(
                  locationCandidate,
                  'constraintGroup:expectedLocation'
                ) || changed
            } else {
              changed =
                card.resolveSubZoneCandidate(candidate, 'constraintGroup:expectedLocation') ||
                changed
            }
            ownerSyncedCards.add(card)
          })
        }
      }
    })

    // 子区域约束只在完整位置层面收敛：
    // 即使 card.seats.size 已经是 1，只要还有多个 subZoneCandidates，也不能算作锁定位置。
    const fallbackExpectedSlotsBySubZone =
      this.expectedSlotsByLocation.size > 0
        ? new Map<string, number>()
        : this.expectedSlotsBySubZone
    fallbackExpectedSlotsBySubZone.forEach((expectedCount, key) => {
      const candidate = parseSubZoneCandidateKey(key)
      if (!candidate) return

      const exactCards = Array.from(this.cards).filter(
        (card) =>
          card.location === 'player' &&
          !card.hasSubZoneCandidates?.() &&
          card.seats.size === 1 &&
          card.seats.has(candidate.seatID) &&
          card.subZone === candidate.subZone &&
          (candidate.subZone !== 'mark' || card.spellID === candidate.spellID)
      )

      const candidateCards = Array.from(this.cards).filter((card) =>
        card.hasSubZoneCandidate?.(key)
      )

      const remainingExpected = expectedCount - exactCards.length

      if (remainingExpected <= 0) {
        // 该完整位置名额已满，组内其他候选牌不可能再落到此位置。
        candidateCards.forEach((card) => {
          changed = card.removeSubZoneCandidate(key, 'constraintGroup:expectedSubZone') || changed
          ownerSyncedCards.add(card)
        })

        return
      }

      if (candidateCards.length <= remainingExpected) {
        // 候选数量刚好不足/等于剩余名额，则这些候选全部锁定到该完整位置。
        candidateCards.forEach((card) => {
          changed =
            card.resolveSubZoneCandidate(candidate, 'constraintGroup:expectedSubZone') || changed
          ownerSyncedCards.add(card)
        })
      }
    })

    this.cards.forEach((card) => {
      if (card.location === 'player' && !ownerSyncedCards.has(card)) {
        changed = card.syncOwnerFromSeats('constraintGroup:resolveOwner') || changed
      }
    })

    return changed
  }
}
