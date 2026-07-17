import { ConstraintGroup } from './ConstraintGroup'
import { isAmbiguousKnownCard } from './AmbiguousKnownIndex'
import { createSubZoneCandidateKey } from './candidate/subZoneCandidate'
import {
  createLocationCandidateKey,
  fromSubZoneCandidate,
  getPlayerLocationCandidates,
  parseLocationCandidateKey,
  toSubZoneCandidate
} from './candidate/locationCandidate'
import { trackerLogger } from '@/utils/logger'
import type { Card } from './Card'
import type { Player } from './Player'
import type { Room } from './Room'
import type {
  LocationCandidate,
  MoveSourceEvent,
  SeatID,
  SpellID,
  SubZone,
  SubZoneCandidate
} from './types'

const MAX_TRACKED_CANDIDATE_SEATS = 4

// 约束组 dirty 标记只关心实际结构变化；集合等价时避免让高频移动回退全量 rebuild。
function areNumberSetsEqual(left: Set<number>, right: Set<number>): boolean {
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

// Map 中的期望槽位值如果没有变化，就不应触发 AmbiguousKnownIndex 全量重建。
function areNumberMapsEqual<Key>(left: Map<Key, number>, right: Map<Key, number>): boolean {
  if (left.size !== right.size) return false
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false
  }
  return true
}

function areSourceEventsEqual(
  left: MoveSourceEvent | string | null | undefined,
  right: MoveSourceEvent | string | null | undefined
): boolean {
  if (left === right) return true
  if (left === null || left === undefined || right === null || right === undefined) {
    return left === right
  }
  if (typeof left === 'string' || typeof right === 'string') {
    return left === right
  }
  return left.type === right.type && left.label === right.label
}

interface ConstraintCardOptions {
  cards?: Card | Card[]
  cardIDs?: number[] | number
  candidateSeats?: SeatID[] | SeatID
  seatID?: SeatID | SeatID[]
  subZone?: SubZone
  spellID?: SpellID | null
  known?: boolean
  [key: string]: unknown
}

interface ConstraintGroupCreateOptions extends ConstraintCardOptions {
  id?: string | number
  combinationID?: string | number
  expectedSlotsBySeat?: Map<SeatID, number> | Record<string, number>
  expectedSlotsBySubZone?: Map<string, number> | Record<string, number>
  expectedSlotsByLocation?: Map<string, number> | Record<string, number>
  sourceEvent?: MoveSourceEvent | string | null
}

interface AmbiguousHiddenHandCoveragePackage {
  coverageBySeat: Map<SeatID, number>
  hiddenCards: Set<Card>
  hiddenCardsBySeat: Map<SeatID, Set<Card>>
}

function haveHiddenCardOverlap(
  left: AmbiguousHiddenHandCoveragePackage,
  right: AmbiguousHiddenHandCoveragePackage
): boolean {
  for (const card of left.hiddenCards) {
    if (right.hiddenCards.has(card)) return true
  }
  return false
}

function collectCoverageComponents(
  packages: AmbiguousHiddenHandCoveragePackage[]
): AmbiguousHiddenHandCoveragePackage[][] {
  const remaining = new Set(packages)
  const components: AmbiguousHiddenHandCoveragePackage[][] = []

  // 重叠关系具有传递性：A 与 B、B 与 C 共享实体时，三者必须在同一分量内统一分配。
  while (remaining.size > 0) {
    const first = remaining.values().next().value as AmbiguousHiddenHandCoveragePackage
    const component: AmbiguousHiddenHandCoveragePackage[] = []
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
  component: AmbiguousHiddenHandCoveragePackage[],
  coverageBySeat: Map<SeatID, number>
): void {
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

  matchedSlotByCard.forEach((slotIndex) => {
    const seatID = slots[slotIndex].seatID
    coverageBySeat.set(seatID, (coverageBySeat.get(seatID) ?? 0) + 1)
  })
}

/**
 * Room 的局部约束与视图同步辅助模块。
 * 收敛主循环保留在 Room；这里负责约束组维护、稳定列表同步和暂停追踪等细节。
 */
export class RoomConstraints {
  declare room: Room

  constructor(room: Room) {
    this.room = room
  }

  /**
   * 约束组移除实体牌时，尽量解析唯一完整位置；container 候选也保持为 location。
   */
  getResolvedExpectedLocationCandidate(card: Card): LocationCandidate | null {
    if (card.hasLocationCandidates?.()) {
      const locationCandidates = card.getLocationCandidates()
      if (locationCandidates.length === 1) return locationCandidates[0]
    }

    const subZoneCandidate = this.getResolvedExpectedSubZoneCandidate(card)
    return subZoneCandidate ? fromSubZoneCandidate(subZoneCandidate) : null
  }

  /**
   * 约束组移除实体牌时，尽量把卡牌解析为唯一完整位置。
   * 若仍有多个完整位置候选，则不能猜测扣减哪个 expected slot。
   */
  getResolvedExpectedSubZoneCandidate(card: Card): SubZoneCandidate | null {
    if (card.location !== 'player' || card.seats.size !== 1) return null

    const ownerSeat = Number(Array.from(card.seats)[0])

    if (card.hasLocationCandidates?.()) {
      const locationCandidates = card.getLocationCandidates()
      if (locationCandidates.length !== 1) return null

      const playerCandidates = getPlayerLocationCandidates(locationCandidates).filter(
        (candidate) => Number(candidate.seatID) === Number(ownerSeat)
      )
      if (playerCandidates.length !== 1) return null

      return toSubZoneCandidate(playerCandidates[0])
    }

    if (card.hasSubZoneCandidates?.()) {
      const ownerCandidates = card
        .getSubZoneCandidates()
        .filter((candidate) => Number(candidate.seatID) === Number(ownerSeat))

      if (ownerCandidates.length !== 1) return null
      return ownerCandidates[0]
    }

    if (typeof card.subZone !== 'string') return null

    return {
      seatID: ownerSeat,
      subZone: card.subZone,
      spellID: card.spellID
    }
  }

  /**
   * 收集精确手牌位置约束中必然由跨位置暗实体占用的槽位。
   *
   * 这些实体没有唯一 resolvedSeat，不能当作某个玩家的确定暗手牌；但约束已经保证其中
   * 至少若干张会落到对应手牌位置，因此匿名对账不能为同一批槽位再次补建实体。
   */
  collectAmbiguousHiddenHandCoverage(): Map<SeatID, number> {
    const packages: AmbiguousHiddenHandCoveragePackage[] = []

    this.room.constraintGroups.forEach((group) => {
      const coverageBySeat = new Map<SeatID, number>()
      const hiddenCards = new Set<Card>()
      const hiddenCardsBySeat = new Map<SeatID, Set<Card>>()
      const groupCards = Array.from(group.cards)

      group.expectedSlotsByLocation.forEach((expectedCount, key) => {
        const locationCandidate = parseLocationCandidateKey(key)
        const handCandidate = toSubZoneCandidate(locationCandidate)
        if (!handCandidate || handCandidate.subZone !== 'hand' || expectedCount <= 0) return

        const subZoneKey = createSubZoneCandidateKey(handCandidate)
        const exactCards = groupCards.filter(
          (card) =>
            card.location === 'player' &&
            !card.hasLocationCandidates?.() &&
            !card.hasSubZoneCandidates?.() &&
            card.seats.size === 1 &&
            card.seats.has(handCandidate.seatID) &&
            card.subZone === 'hand'
        )
        const candidateCards = groupCards.filter(
          (card) =>
            card.hasLocationCandidate?.(key) ||
            (subZoneKey && card.hasSubZoneCandidate?.(subZoneKey))
        )
        const knownCandidateCount = candidateCards.filter(
          (card) => card.isKnown === true && card.suspended !== true
        ).length
        const ambiguousHiddenCards = candidateCards.filter(
          (card) => card.isKnown !== true && card.suspended !== true && card.resolvedSeat === null
        )
        const remainingExpected = Math.max(0, expectedCount - exactCards.length)
        const hiddenCoverage = Math.min(
          ambiguousHiddenCards.length,
          Math.max(0, remainingExpected - knownCandidateCount)
        )

        if (hiddenCoverage <= 0) return
        coverageBySeat.set(
          handCandidate.seatID,
          (coverageBySeat.get(handCandidate.seatID) ?? 0) + hiddenCoverage
        )
        hiddenCardsBySeat.set(handCandidate.seatID, new Set(ambiguousHiddenCards))
        ambiguousHiddenCards.forEach((card) => hiddenCards.add(card))
      })

      if (coverageBySeat.size > 0) {
        packages.push({ coverageBySeat, hiddenCards, hiddenCardsBySeat })
      }
    })

    // 历史组与后续扩展组可能共享部分暗实体。按重叠连通分量合并需求，再通过匹配确保
    // 每个实体最多覆盖一个席位槽；同一席位的重复约束取最大值，互不相交的分量继续累加。
    const coverageBySeat = new Map<SeatID, number>()
    collectCoverageComponents(packages).forEach((component) => {
      addCoverageComponent(component, coverageBySeat)
    })

    return coverageBySeat
  }

  /**
   * 用另一个暗实体接管原实体参与的全部约束组，不改变任何期望槽位。
   * 用于未公开正 ID 仅作为身份占位、后续明牌协议需要交换身份但不能确认候选位置的场景。
   */
  replaceCardInConstraintGroups(previousCard: Card, nextCard: Card): boolean {
    if (previousCard === nextCard) return false

    let changed = false
    this.room.constraintGroups.forEach((group) => {
      if (!group.cards.has(previousCard)) return

      group.cards.delete(previousCard)
      group.cards.add(nextCard)
      nextCard.combinationID = group.id ?? previousCard.combinationID
      changed = true
    })

    if (changed) {
      this.room.markConstraintGroupsDirty('replaceCardInConstraintGroups')
    }
    return changed
  }

  /**
   * 将指定实体牌从所有局部约束组中摘除，并清理空约束组。
   */
  removeCardsFromConstraintGroups(cards: Card[] = []): boolean {
    const cardSet = new Set<Card>(cards)
    let changed = false
    let affectsAmbiguousKnownIndex = false

    // 只有确实从组内删牌或删空组时才算结构变化；无命中的高频调用保持增量路径。
    for (const [groupID, group] of this.room.constraintGroups.entries()) {
      cardSet.forEach((card) => {
        if (group.cards.has(card)) {
          affectsAmbiguousKnownIndex =
            affectsAmbiguousKnownIndex || this.affectsAmbiguousKnownIndex(card)
          const resolvedLocationCandidate = this.getResolvedExpectedLocationCandidate(card)
          const resolvedCandidate = toSubZoneCandidate(resolvedLocationCandidate)

          if (resolvedCandidate) {
            // 牌已锁定到单个手牌槽位时，同步扣减该席位在本组内的期望槽位。
            if (
              resolvedCandidate.subZone === 'hand' &&
              group.expectedSlotsBySeat.has(resolvedCandidate.seatID)
            ) {
              const currentExpected = group.expectedSlotsBySeat.get(resolvedCandidate.seatID)
              group.expectedSlotsBySeat.set(
                resolvedCandidate.seatID,
                Math.max(0, currentExpected - 1)
              )
            }

            // 确认移动离开约束组时，同步扣减该牌已锁定的完整位置名额。
            const subZoneKey = createSubZoneCandidateKey(resolvedCandidate)

            if (subZoneKey && group.expectedSlotsBySubZone.has(subZoneKey)) {
              const currentExpected = group.expectedSlotsBySubZone.get(subZoneKey)
              group.expectedSlotsBySubZone.set(subZoneKey, Math.max(0, currentExpected - 1))
            }
          }

          // container 候选没有 subZone 镜像，但仍应扣减 expectedSlotsByLocation 名额。
          const locationKey = createLocationCandidateKey(resolvedLocationCandidate)
          if (locationKey && group.expectedSlotsByLocation.has(locationKey)) {
            const currentExpected = group.expectedSlotsByLocation.get(locationKey)
            group.expectedSlotsByLocation.set(locationKey, Math.max(0, currentExpected - 1))
          }
          group.cards.delete(card)
          changed = true
        }
      })

      if (group.cards.size === 0) {
        this.room.deleteConstraintGroup(groupID)
        changed = true
      }
    }

    if (changed && affectsAmbiguousKnownIndex) {
      this.room.markConstraintGroupsDirty('removeCardsFromConstraintGroups')
    }
    return changed
  }

  /**
   * 将约束组参数中的实体牌和物理 ID 统一解析为 Card 实体，并按需绑定候选席位。
   */
  resolveConstraintCards(options: ConstraintCardOptions = {}, targetSeats: SeatID[] = []): Card[] {
    const optionCards = options.cards
      ? Array.isArray(options.cards)
        ? options.cards
        : [options.cards]
      : []
    const cardIDs = Array.isArray(options.cardIDs)
      ? options.cardIDs
      : options.cardIDs === undefined
        ? []
        : [options.cardIDs]
    const idCards = this.room.findCardsByIDs(cardIDs)
    const cards = Array.from(new Set([...optionCards, ...idCards])).filter(Boolean)

    if (options.cardIDs && targetSeats.length > 0) {
      cards.forEach((card) => {
        this.room.clearCardsFromPublicZones([card])

        if (card.location !== 'player' || card.seats.size === 0) {
          const bindOptions = { known: options.known === true }
          card.bindCandidates(
            targetSeats,
            options.subZone ?? 'hand',
            options.spellID ?? null,
            bindOptions
          )
        } else {
          card.setSeats(
            this.room.mergeCandidateSeats(card.seats, targetSeats),
            'resolveConstraintCards:mergeCandidateSeats'
          )

          const previousSubZone = card.subZone
          const previousSpellID = card.spellID

          if (options.subZone) {
            card.subZone = options.subZone
          }

          if (options.spellID !== undefined) {
            card.spellID = options.spellID
          }

          if (card.subZone !== previousSubZone || card.spellID !== previousSpellID) {
            this.room.notifyCardChanged(card, {
              type: 'card-player-zone-changed',
              reason: 'resolveConstraintCards:zoneChanged',
              previousSubZone,
              nextSubZone: card.subZone,
              previousSpellID,
              nextSpellID: card.spellID
            })
          }

          if (options.known === true) {
            card.confirmKnown()
          }
        }
      })
    }

    return cards
  }

  /**
   * 稳定差量同步卡牌列表：保留已有项顺序，移除失效项，新项追加到尾部。
   */
  syncStableCardList(existingCards: Card[] = [], currentCards: Card[] = []): Card[] {
    const currentSet = new Set(currentCards)
    const existingSet = new Set(existingCards)
    const nextCards = existingCards.filter((card) => currentSet.has(card))

    currentCards.forEach((card) => {
      if (!existingSet.has(card)) {
        nextCards.push(card)
      }
    })

    return nextCards
  }

  /**
   * 响应式同步：约束收敛完毕后，将最新的卡牌分配状态同步至各个玩家的物理数组与标记区映射中，
   * 并使用稳定排序（维持原有顺序，新摸入/移入的追加到尾部），以便于视图渲染。
   * 传入 `seatIDs` 时只刷新指定玩家，供快路径/A2 只同步受影响座位（C1）。
   */
  syncViewGroups(seatIDs?: Iterable<SeatID>): void {
    const idx = this.room.locationIndex
    const targetPlayers =
      seatIDs === undefined
        ? Array.from(this.room.players.values())
        : Array.from(seatIDs, (seatID) => this.room.getPlayer(Number(seatID))).filter(
            (player): player is Player => Boolean(player)
          )

    targetPlayers.forEach((player) => {
      const seat = player.seatID
      const knownHand = idx.knownHandBySeat.get(seat) ?? []
      const candidateHand = idx.candidateHandBySeat.get(seat) ?? []
      const equip = idx.equipBySeat.get(seat) ?? []
      const judge = idx.judgeBySeat.get(seat) ?? []
      const mark = idx.markBySeatAndSpell.get(seat) ?? new Map()

      player.knownHandCards = this.syncStableCardList(player.knownHandCards, knownHand)
      player.candidateHandCards = this.syncStableCardList(player.candidateHandCards, candidateHand)
      player.equipCards = this.syncStableCardList(player.equipCards, equip)
      player.judgeCards = this.syncStableCardList(player.judgeCards, judge)

      for (const spellID of player.markCards.keys()) {
        if (!mark.has(spellID)) {
          player.markCards.delete(spellID)
        }
      }

      mark.forEach((spellCards, spellID) => {
        player.markCards.set(
          spellID,
          this.syncStableCardList(player.markCards.get(spellID) ?? [], spellCards)
        )
      })
    })
  }

  /**
   * 创建或合并局部约束组，并立即应用一次组内约束。
   * 该方法只维护组结构；是否进行全局收敛由 Room.resolveConstraints() 决定。
   */
  createConstraintGroup(options: ConstraintGroupCreateOptions = {}): ConstraintGroup {
    const groupID = options.id ?? options.combinationID ?? `group_${++this.room.constraintGroupSeq}`
    const targetSeats = this.room.normalizeSeats(options.candidateSeats ?? options.seatID)
    const cards = this.resolveConstraintCards(options, targetSeats)
    let group = this.room.constraintGroups.get(groupID)
    let structureChanged = false
    // 普通确定牌组不影响模糊明牌描述；只对相关明牌置 dirty，保留高频路径收益。
    let affectsAmbiguousKnownIndex = cards.some((card) => this.affectsAmbiguousKnownIndex(card))

    if (!group) {
      group = new ConstraintGroup({
        ...options,
        id: groupID,
        candidateSeats: targetSeats,
        cards
      })
      this.room.constraintGroups.set(groupID, group)
      structureChanged = true
    } else {
      affectsAmbiguousKnownIndex =
        affectsAmbiguousKnownIndex ||
        Array.from(group.cards).some((card) => this.affectsAmbiguousKnownIndex(card))
      const previousCardCount = group.cards.size
      group.addCards(cards)
      if (group.cards.size !== previousCardCount) structureChanged = true

      if (targetSeats.length > 0) {
        const nextCandidateSeats = this.room.mergeCandidateSeats(group.candidateSeats, targetSeats)
        if (!areNumberSetsEqual(group.candidateSeats, nextCandidateSeats)) {
          group.candidateSeats = nextCandidateSeats
          structureChanged = true
        }
      }

      if (options.expectedSlotsBySeat) {
        const nextExpectedSlotsBySeat = group.normalizeExpectedSlots(options.expectedSlotsBySeat)
        if (!areNumberMapsEqual(group.expectedSlotsBySeat, nextExpectedSlotsBySeat)) {
          group.expectedSlotsBySeat = nextExpectedSlotsBySeat
          structureChanged = true
        }
      }

      const hasExpectedSlotsBySubZone = Object.prototype.hasOwnProperty.call(
        options,
        'expectedSlotsBySubZone'
      )
      const hasExpectedSlotsByLocation = Object.prototype.hasOwnProperty.call(
        options,
        'expectedSlotsByLocation'
      )
      const previousExpectedSlotsBySubZone = new Map(group.expectedSlotsBySubZone)
      const previousExpectedSlotsByLocation = new Map(group.expectedSlotsByLocation)

      if (hasExpectedSlotsBySubZone) {
        // 同一分组可能先记录 seats 约束，后续再补充子区域约束。
        group.expectedSlotsBySubZone = group.normalizeExpectedSubZoneSlots(
          options.expectedSlotsBySubZone
        )
      }

      if (hasExpectedSlotsByLocation) {
        group.expectedSlotsByLocation = group.normalizeExpectedLocationSlots(
          options.expectedSlotsByLocation
        )
      }

      if (hasExpectedSlotsBySubZone || hasExpectedSlotsByLocation) {
        group.syncExpectedSlotCompatibility(hasExpectedSlotsByLocation ? 'location' : 'subZone')
        if (
          !areNumberMapsEqual(previousExpectedSlotsBySubZone, group.expectedSlotsBySubZone) ||
          !areNumberMapsEqual(previousExpectedSlotsByLocation, group.expectedSlotsByLocation)
        ) {
          structureChanged = true
        }
      }

      const nextKnown = group.known || options.known === true
      if (nextKnown !== group.known) {
        group.known = nextKnown
        structureChanged = true
      }

      if (options.sourceEvent !== null && options.sourceEvent !== undefined) {
        if (!areSourceEventsEqual(options.sourceEvent, group.sourceEvent)) structureChanged = true
        group.sourceEvent = options.sourceEvent
      }
    }

    group.apply()
    if (structureChanged && affectsAmbiguousKnownIndex) {
      this.room.markConstraintGroupsDirty('createConstraintGroup')
    }
    return group
  }

  /**
   * 判断约束组结构变化是否会影响 AmbiguousKnownIndex 的描述或 membership。
   * 已在索引中的牌也算相关，避免删除 group 后 source label 残留。
   */
  private affectsAmbiguousKnownIndex(card: Card): boolean {
    if (this.room.ambiguousKnownIndex.items.has(card.id)) return true
    return isAmbiguousKnownCard(card)
  }

  /**
   * 暂停追踪候选席位过度发散的明牌。
   * 当一张明牌可能在 4 个及以上玩家手里时，继续传播会污染后续推断，
   * 因此将它移入 suspendedKnownCards，直到协议再次明确出现该牌。
   */
  isOverbroadKnownCard(card: Card): boolean {
    return (
      card.isKnown === true &&
      card.suspended !== true &&
      card.location === 'player' &&
      card.seats.size >= MAX_TRACKED_CANDIDATE_SEATS
    )
  }

  suspendOverbroadKnownCards(cards: Iterable<Card> = this.room.cards): void {
    for (const card of cards) {
      if (this.isOverbroadKnownCard(card)) {
        this.suspendKnownCard(card, 'candidateSeats>=4')
      }
    }
  }

  /**
   * 将指定正 ID 身份从候选推断体系中摘除，放入房间级暂停追踪集合。
   * 洗牌路径会先 confirmKnown()，表示身份已经明确、只是具体位置暂停维护；
   * 后续协议再次携带该 ID 时再恢复普通追踪。
   */
  suspendKnownCard(card: Card, reason: string): void {
    if (!card || card.suspended) return

    this.removeCardsFromConstraintGroups([card])
    card.clearSeats(`suspendKnownCard:${reason}`)
    card.setLocationCandidates([], `suspendKnownCard:${reason}:candidates`)
    card.combinationID = null
    card.location = 'suspended'
    card.subZone = null
    card.suspended = true
    this.room.markCounterDirty(card)
    this.room.suspendedKnownCards.add(card)

    trackerLogger.info('卡牌身份位置发散，暂停追踪', {
      id: card.id,
      name: card.name,
      reason,
      suspendedCount: this.room.suspendedKnownCards.size
    })
  }

  /**
   * 当协议再次明确出现某张暂停追踪的正 ID 身份时，恢复该牌的普通追踪状态。
   */
  resumeSuspendedKnownCard(card: Card): void {
    if (!card || (card.suspended !== true && !this.room.suspendedKnownCards.has(card))) return

    card.suspended = false
    this.room.suspendedKnownCards.delete(card)
    trackerLogger.info('卡牌身份再次出现，恢复追踪', {
      id: card.id,
      name: card.name
    })
  }
}
