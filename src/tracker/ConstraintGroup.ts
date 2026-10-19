import {
  createLocationCandidateKey,
  parseLocationCandidateKey
} from './candidate/locationCandidate'
import type { LocationCandidateInput } from './candidate/locationCandidate'
import type { Card } from './Card'
import type { MoveSourceEvent, SeatID } from './types'

type CountMapInput<Key extends string | number | object> =
  | Map<Key, number | string>
  | Record<string, number | string>

export interface ConstraintGroupOptions {
  id?: string | number
  cards?: Card[]
  candidateSeats?: SeatID[]
  expectedSlotsBySeat?: CountMapInput<SeatID>
  expectedSlotsByLocation?: CountMapInput<string | LocationCandidateInput>
  known?: boolean
  sourceEvent?: MoveSourceEvent | string | null
}

/**
 * 局部约束组，表达一次移动、分配或模糊明牌事件形成的候选包。
 *
 * expectedSlotsBySeat 约束“这组牌里有几张属于某个座位”。
 * expectedSlotsByLocation 约束“这组牌里有几张落在某个完整位置”。
 * 两类约束不能混用语义：owner 确定不代表手牌/标记区位置确定。
 */
export class ConstraintGroup {
  declare id: string | number | undefined
  declare cards: Set<Card>
  declare candidateSeats: Set<SeatID>
  declare expectedSlotsBySeat: Map<SeatID, number>
  declare expectedSlotsByLocation: Map<string, number>
  declare known: boolean
  declare sourceEvent: MoveSourceEvent | string | null

  constructor(options: ConstraintGroupOptions = {}) {
    const {
      id,
      cards = [],
      candidateSeats = [],
      expectedSlotsBySeat = new Map(),
      expectedSlotsByLocation = new Map(),
      known = false,
      sourceEvent = null
    } = options

    this.id = id
    this.cards = new Set(cards)
    this.candidateSeats = new Set(candidateSeats.map((seat) => Number(seat)))
    this.expectedSlotsBySeat = this.normalizeExpectedSlots(expectedSlotsBySeat)
    this.expectedSlotsByLocation = this.normalizeExpectedLocationSlots(expectedSlotsByLocation)
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
      // seat 约束只处理没有完整子区域候选的普通手牌。subZoneCandidates 表示牌仍可能位于
      // “A 手牌 / A 标记 / B 手牌”等不同完整位置，seats 只是这些位置的座位投影：
      // 1. seats.size === 1 只代表 owner 已确定，不能据此把“A 手牌 / A 标记”计为锁定手牌；
      // 2. 若 A 的手牌名额已满，按 seat 删除 A 会同时误删“A 标记”，造成过度收敛。
      // 因此带 subZoneCandidates 的牌必须跳过本层，由 expectedSlotsByLocation
      // 按 seatID + subZone + spellID 的完整位置名额收敛。创建这类
      // 候选的调用方也必须提供对应的位置层约束，不能只设置 expectedSlotsBySeat，否则该牌
      // 会被本层有意跳过，又没有位置层负责消元。
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
            const allLocationCandidates = card.locationCandidates
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
            const allLocationCandidates = card.locationCandidates
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

      if (locationCandidate.type !== 'player') return
      const candidate = locationCandidate

      const exactCards = Array.from(this.cards).filter(
        (card) =>
          card.location === 'player' &&
          !card.hasLocationCandidates?.() &&
          card.seats.size === 1 &&
          card.seats.has(candidate.seatID) &&
          card.subZone === candidate.subZone &&
          (candidate.subZone !== 'mark' || card.spellID === candidate.spellID)
      )

      const candidateCards = Array.from(this.cards).filter((card) => card.hasLocationCandidate(key))

      const remainingExpected = expectedCount - exactCards.length

      if (remainingExpected <= 0) {
        // 完整位置名额已被确定牌占满，仍带此候选的位置必须剔除。
        candidateCards.forEach((card) => {
          changed = card.removeLocationCandidate(key, 'constraintGroup:expectedLocation') || changed
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
          const allLocationCandidates = card.locationCandidates
          if (allLocationCandidates.length === 0) return true

          return allLocationCandidates.every((lc) => {
            const lcKey = createLocationCandidateKey(lc)
            return lcKey && this.expectedSlotsByLocation.has(lcKey)
          })
        })

        if (constrainedCandidateCards.length === candidateCards.length) {
          candidateCards.forEach((card) => {
            changed =
              card.resolveLocationCandidate(
                locationCandidate,
                'constraintGroup:expectedLocation'
              ) || changed
            ownerSyncedCards.add(card)
          })
        }
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
