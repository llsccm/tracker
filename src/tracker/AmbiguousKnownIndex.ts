import { getSubZoneName } from './candidate/subZoneCandidate'
import { recordTraversal } from './traversalStats'
import {
  getContainerLocationCandidates,
  getPlayerLocationCandidates,
  getPublicLocationCandidates,
  toPublicCandidate
} from './candidate/locationCandidate'
import type { Card } from './Card'
import type { ConstraintGroup } from './ConstraintGroup'
import type { Room } from './Room'
import type { CardID, SeatID } from './types'
import { getPublicCandidateLabel } from './candidate/publicCandidate'

export interface AmbiguousKnownItem {
  card: Card
  candidateSeats: SeatID[]
  groups: ConstraintGroup[]
  description: string
}

/**
 * 判断一张牌是否属于"已知但归属模糊"的牌：明牌且存在多座位、位置候选、子区候选或公共候选。
 * 供 AmbiguousKnownIndex 入库判定与 RoomConstraints 的脏标记判定共用，避免两处谓词漂移。
 */
export function isAmbiguousKnownCard(card: Card): boolean {
  const hasPlayerCandidates = card.location === 'player' && card.seats.size > 1
  const hasLocationCandidates = card.hasLocationCandidates?.() === true
  const hasSubZoneCandidates = card.hasSubZoneCandidates?.() === true
  const hasPublicCandidates = card.publicCandidates?.length > 0

  return (
    card.isKnown === true &&
    (hasPlayerCandidates || hasLocationCandidates || hasSubZoneCandidates || hasPublicCandidates)
  )
}

/**
 * 已知明牌但归属仍模糊的反查索引
 */
export class AmbiguousKnownIndex {
  declare room: Room
  declare items: Map<CardID, AmbiguousKnownItem>
  // 已消费的 dirtyCardEvents 游标；用于判断本次是否还能增量追上。
  declare lastConsumedSeq: number
  // 带装备容器候选的明牌描述依赖装备当前座位，装备移动时需被动重算。
  declare containerDependentCards: Set<Card>

  constructor(room: Room) {
    this.room = room
    this.items = new Map()
    this.lastConsumedSeq = 0
    this.containerDependentCards = new Set()
  }

  /**
   * 全量重建已知模糊牌反查索引。
   * @param options.record 是否记录遍历采样；DEV 影子对比传 false 避免污染基线。
   */
  rebuild(groups: ConstraintGroup[] = [], options: { record?: boolean } = {}): void {
    const { record = true } = options
    if (record) recordTraversal('ambiguousKnownIndex:rebuild', this.room.cards.length)
    this.items.clear()
    this.containerDependentCards.clear()

    this.room.cards.forEach((card) => {
      const item = this.buildItem(card, this.getRelatedGroups(card, groups))
      if (item) this.items.set(card.id, item)
      if (this.hasContainerLocationCandidates(card)) this.containerDependentCards.add(card)
    })

    this.lastConsumedSeq = this.room.dirtyCardSeq
  }

  /**
   * 按 Room dirtyCardEvents 游标增量维护索引；游标断档时回退全量 rebuild。
   * @returns 是否走了增量路径；false 表示检测到断档并已全量重建。
   */
  applyDirtyCardEvents(groups: ConstraintGroup[] = []): boolean {
    const events = this.room.dirtyCardEvents

    // 事件日志有长度上限；如果下一条应消费事件已被裁掉，只能全量重建兜底。
    if (events.length > 0 && events[0].seq > this.lastConsumedSeq + 1) {
      this.rebuild(groups)
      return false
    }

    const affectedCards = new Set<Card>()
    for (const event of events) {
      if (event.seq > this.lastConsumedSeq) affectedCards.add(event.card)
    }

    affectedCards.forEach((card) => this.applyCardChange(card, groups))

    // 装备容器候选的描述座位取决于装备当前承载座位；装备移动时候选牌自身可能不脏。
    if (this.containerDependentCards.size > 0) {
      for (const card of Array.from(this.containerDependentCards)) {
        if (!affectedCards.has(card)) this.applyCardChange(card, groups)
      }
    }

    recordTraversal('ambiguousKnownIndex:applyDirty', affectedCards.size)
    this.lastConsumedSeq = this.room.dirtyCardSeq
    return true
  }

  /**
   * 单牌更新：先删除旧条目，再按当前状态重新判定是否应进入索引。
   */
  applyCardChange(card: Card, groups: ConstraintGroup[] = []): void {
    this.items.delete(card.id)

    const item = this.buildItem(card, this.getRelatedGroups(card, groups))
    if (item) this.items.set(card.id, item)

    if (this.hasContainerLocationCandidates(card)) this.containerDependentCards.add(card)
    else this.containerDependentCards.delete(card)
  }

  /**
   * 生成稳定可比较结构，供测试和 DEV 影子索引断言使用。
   */
  toComparable(room: Room = this.room): unknown {
    const order = new Map<Card, number>()
    room.cards.forEach((card, index) => order.set(card, index))
    const token = (card: Card) => order.get(card) ?? -card.id

    return Array.from(this.items.entries())
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([cardID, item]) => [
        Number(cardID),
        token(item.card),
        item.candidateSeats.map(Number),
        item.groups.map((group) => String(group.id)).sort(),
        item.description
      ])
  }

  get(cardID: CardID | string): AmbiguousKnownItem | null {
    return this.items.get(Number(cardID)) ?? null
  }

  describe(cardID: CardID | string): string {
    return this.get(cardID)?.description ?? ''
  }

  formatCardDescription(card: Card, groups: ConstraintGroup[]): string {
    const zoneName = this.getSubZoneName(card)
    const locations: string[] = []

    if (card.hasLocationCandidates?.()) {
      const playerCandidates = getPlayerLocationCandidates(card.getLocationCandidates())
      const containerCandidates = getContainerLocationCandidates(card.getLocationCandidates())
      const publicCandidates = getPublicLocationCandidates(card.getLocationCandidates())

      const projectedPlayerCandidates = [
        ...playerCandidates,
        ...containerCandidates.flatMap((candidate) =>
          this.room.resolveEquipmentContainerLocationCandidates(candidate)
        )
      ]

      // 用户侧描述展示当前承载座位；内部 container key 仍保持随装备实例绑定。
      projectedPlayerCandidates.forEach((candidate) => {
        const prefix = this.room.formatSeatPrefix(candidate.seatID)
        locations.push(`${prefix}${getSubZoneName(candidate.subZone)}`)
      })

      publicCandidates.forEach((candidate) => {
        const publicCandidate = toPublicCandidate(candidate, (zone, position, count) =>
          getPublicCandidateLabel(zone, position, count)
        )

        if (publicCandidate?.label) locations.push(publicCandidate.label)
      })
    } else if (card.location === 'player' && card.hasSubZoneCandidates?.()) {
      // 子区域候选优先展示完整位置，避免 seats.size === 1 时只显示“某玩家手牌”。
      card.getSubZoneCandidates().forEach((candidate) => {
        const prefix = this.room.formatSeatPrefix(candidate.seatID)
        locations.push(`${prefix}${getSubZoneName(candidate.subZone)}`)
      })
    } else if (card.location === 'player') {
      Array.from(card.seats).forEach((seatID) => {
        const prefix = this.room.formatSeatPrefix(seatID)
        locations.push(`${prefix}${zoneName}`)
      })
    }

    if (!card.hasLocationCandidates?.()) {
      card.publicCandidates?.forEach((candidate) => {
        locations.push(candidate.label)
      })
    }

    const sourceLabels = groups
      .map((group) => {
        if (typeof group.sourceEvent === 'string') return group.sourceEvent
        return group.sourceEvent?.label ?? group.sourceEvent?.type
      })
      .filter(Boolean)

    if (sourceLabels.length === 0) {
      return locations.join('/')
    }

    return `${locations.join('/')}（${Array.from(new Set(sourceLabels)).join('/')}）`
  }

  getSubZoneName(card: Card): string {
    return getSubZoneName(card.subZone)
  }

  private getRelatedGroups(card: Card, groups: ConstraintGroup[]): ConstraintGroup[] {
    return groups.filter((group) => group.cards.has(card))
  }

  private buildItem(card: Card, relatedGroups: ConstraintGroup[]): AmbiguousKnownItem | null {
    if (!isAmbiguousKnownCard(card)) return null

    return {
      card,
      candidateSeats: Array.from(card.seats, Number).sort((a, b) => a - b),
      groups: relatedGroups,
      description: this.formatCardDescription(card, relatedGroups)
    }
  }

  private hasContainerLocationCandidates(card: Card): boolean {
    if (!card.hasLocationCandidates?.()) return false
    return getContainerLocationCandidates(card.getLocationCandidates()).length > 0
  }
}
