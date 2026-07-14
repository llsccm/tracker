import { trackerLogger } from '@/utils/logger'
import { CARD_INSTANCE_STATUS } from './CardCounter'
import type { Card } from './Card'
import type { Room } from './Room'
import type { CardID, PublicZoneName, SeatID } from './types'

const ORDERED_PUBLIC_ZONE_IDS = new Set<PublicZoneName>(['pile', 'discard', 'process', 'exchange'])
const PLAYER_HAND_CARD_STATUSES = [CARD_INSTANCE_STATUS.UNKNOWN, CARD_INSTANCE_STATUS.APPEARED]

interface PublicZoneIssue {
  type: string
  cardID?: CardID
  cardName?: string
  zoneID?: PublicZoneName
  previousZoneID?: PublicZoneName
  index?: number
  previousIndex?: number
  location?: string
}

export interface PlayerHandCardIDOptions {
  includeCandidates?: boolean
  knownOnly?: boolean
}

interface CardLocationInfo {
  card: Card | null
  keys: CardID[]
  zones: string[]
  description: string
}

/**
 * Room 的公共区查询与旧协议兼容读面辅助模块。
 * getPublicZone 作为高频入口保留在 Room，这里集中处理一致性检查和旧 zoneID 转换。
 */
export class RoomPublicZones {
  declare room: Room

  constructor(room: Room) {
    this.room = room
  }

  /**
   * 从所有公共区数组中移除指定实体牌，避免同一实体同时留在多个公共区。
   */
  clearCardsFromPublicZones(cards: Card[] = []): void {
    cards.forEach((card) => {
      this.room.zones.forEach((zone) => zone.removeCard(card))
    })
  }

  /**
   * 检查 Card.location 与公共区有序关系是否一致。
   * outside/exile 允许仅通过 Card.location 表达，不做反向强制检查。
   */
  getPublicZoneConsistencyIssues(): PublicZoneIssue[] {
    const issues: PublicZoneIssue[] = []
    const orderedZoneByCard = new Map<Card, { zoneID: PublicZoneName; index: number }>()

    this.room.zones.forEach((zone, zoneID) => {
      zone.cards.forEach((card, index) => {
        if (!card) {
          issues.push({
            type: 'empty-zone-slot',
            zoneID,
            index
          })
          return
        }

        const previous = orderedZoneByCard.get(card)
        if (previous) {
          issues.push({
            type: 'duplicated-public-zone-card',
            cardID: card.id,
            cardName: card.name,
            zoneID,
            previousZoneID: previous.zoneID,
            index,
            previousIndex: previous.index
          })
        } else {
          orderedZoneByCard.set(card, { zoneID, index })
        }

        if (card.location !== zoneID) {
          issues.push({
            type: 'zone-card-location-mismatch',
            cardID: card.id,
            cardName: card.name,
            zoneID,
            index,
            location: card.location
          })
        }
      })
    })

    this.room.cards.forEach((card) => {
      if (!ORDERED_PUBLIC_ZONE_IDS.has(card.location)) return

      const zone = this.room.zones.get(card.location)
      if (!zone?.cards.includes(card)) {
        issues.push({
          type: 'missing-public-zone-order',
          cardID: card.id,
          cardName: card.name,
          location: card.location
        })
      }
    })

    return issues
  }

  /**
   * 开发期公共区一致性检查。生产环境仅返回空数组，不影响运行。
   */
  assertPublicZoneConsistency(context = ''): PublicZoneIssue[] {
    if (!import.meta.env.DEV) return []

    const issues = this.getPublicZoneConsistencyIssues()
    if (issues.length > 0) {
      trackerLogger.warn('公共区顺序关系不一致', {
        context,
        issues
      })
    }
    return issues
  }

  /**
   * 获取公共区中已知物理牌 ID 顺序。
   */
  getPublicZoneCardIDs(zoneID: PublicZoneName = 'pile'): CardID[] {
    return (this.room.zones.get(zoneID)?.cards ?? []).map((card) => card.id).filter((id) => id > 0)
  }

  /**
   * 获取当前牌堆中的已知物理牌 ID 顺序。
   */
  getPileCardIDs(): CardID[] {
    return this.getPublicZoneCardIDs('pile')
  }

  /**
   * 获取指定玩家手牌中的物理牌 ID。
   */
  getPlayerHandCardIDs(seatID: SeatID, options: PlayerHandCardIDOptions = {}): CardID[] {
    const { includeCandidates = false, knownOnly = true } = options
    const normalizedSeat = Number(seatID)
    const cardsByStatus = this.room.counter?.cardsByStatus
    const appearedCards = cardsByStatus?.[CARD_INSTANCE_STATUS.APPEARED]
    const sourceCards = knownOnly
      ? appearedCards
        ? Array.from(appearedCards)
        : this.room.cards
      : cardsByStatus
        ? PLAYER_HAND_CARD_STATUSES.flatMap((status) => Array.from(cardsByStatus[status] ?? []))
        : this.room.cards

    return sourceCards
      .filter(
        (card) =>
          card.location === 'player' &&
          card.subZone === 'hand' &&
          // 默认只返回确定手牌，避免技能辅助把 A 手牌/A 标记候选误读成确定手牌。
          (includeCandidates || !card.hasSubZoneCandidates?.()) &&
          card.seats.has(normalizedSeat) &&
          (!knownOnly || card.isKnown === true)
      )
      .map((card) => card.id)
      .filter((id) => id > 0)
  }

  /**
   * 获取卡牌旧辅助兼容所需的位置读面。
   */
  getCardLocationInfo(cardID: CardID | string): CardLocationInfo {
    const card = this.room.cardIndex.get(Number(cardID)) ?? null
    if (!card)
      return {
        card: null,
        keys: [],
        zones: [],
        description: ''
      }

    return {
      card,
      keys: [card.isKnown ? card.id : 0],
      zones: this.getLegacyZoneIDsForCard(card),
      description: card.getLocationDescription()
    }
  }

  /**
   * 将新版卡牌位置转换为旧辅助可读的 zoneID。
   */
  getLegacyZoneIDsForCard(card: Card | null): string[] {
    if (!card) return []

    if (card.location === 'pile') return ['1-255']
    if (card.location === 'discard') return ['2-255']
    if (card.location === 'process') return ['3-255']
    if (card.location === 'exchange') return ['10-255']
    if (card.location === 'exile') return ['12-255']
    if (card.location === 'outside') return ['0-255']
    if (card.location !== 'player') return ['?']

    const zone =
      card.subZone === 'equip' ? 6 : card.subZone === 'judge' ? 7 : card.subZone === 'mark' ? 4 : 5

    return Array.from(card.seats).map((seatID) =>
      zone === 4 && card.spellID !== null
        ? `${zone}-${seatID}-${card.spellID}`
        : `${zone}-${seatID}`
    )
  }
}
