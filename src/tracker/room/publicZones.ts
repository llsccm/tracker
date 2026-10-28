import { trackerLogger } from '@/utils/logger'
import { POSITION_BOTTOM, POSITION_TOP } from '../candidate/cardPositions'
import { CARD_INSTANCE_STATUS } from '../projection/CardCounter'
import type { Card } from '@/tracker/model'
import type { Room } from '../Room'
import type { CardID, PublicPosition, PublicZoneName, SeatID, TrackerLogger } from '../types'

const ORDERED_PUBLIC_ZONE_IDS = new Set<PublicZoneName>(['pile', 'discard', 'process', 'exchange'])
const PLAYER_HAND_CARD_STATUSES = [CARD_INSTANCE_STATUS.UNKNOWN, CARD_INSTANCE_STATUS.APPEARED]

export interface PublicRevealPlacementOptions {
  position?: PublicPosition
  reposition?: boolean
  cardIDsTopFirst?: boolean
}

/**
 * 判断目标牌组是否已经位于公共区指定端点。
 * Zone 内部按底到顶保存；插入底部时会反转输入，所以底部比较也要使用反序。
 */
function hasCardsAtPublicPosition(
  zoneCards: Card[],
  cards: Card[],
  position: PublicPosition
): boolean {
  if (cards.length === 0 || zoneCards.length < cards.length) return false

  if (position === POSITION_TOP) {
    const offset = zoneCards.length - cards.length
    return cards.every((card, index) => zoneCards[offset + index] === card)
  }

  if (position === POSITION_BOTTOM) {
    const len = cards.length
    return cards.every((_, index) => zoneCards[index] === cards[len - 1 - index])
  }

  return false
}

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

/**
 * Room 的公共区查询。
 * getPublicZone 作为高频入口保留在 Room，这里集中处理一致性检查。
 */
export class RoomPublicZones {
  declare room: Room

  constructor(room: Room) {
    this.room = room
  }

  getExchangeBatch(batchKey: string) {
    return this.room.getZone('exchange').getExchangeBatch(batchKey)
  }

  deleteExchangeBatch(batchKey: string): void {
    this.room.getZone('exchange').deleteExchangeBatch(batchKey)
  }

  /**
   * 公共区明牌落点：确认牌面，并按需把已有实体纠正到指定端点。
   * 普通明牌只补缺失实体；牌堆端点明牌还要纠正已有实体的位置。
   * 先比较端点序列，避免重复协议再次改动 Zone 并制造无效脏渲染。
   */
  placePublicRevealCards(
    knownCards: Card[],
    zoneName: PublicZoneName,
    options: PublicRevealPlacementOptions = {},
    logger: Pick<TrackerLogger, 'info'> = trackerLogger
  ): void {
    const room = this.room
    const position = options.position ?? POSITION_TOP
    const targetZone = room.zones.get(zoneName)

    const placeableCards: Card[] = []
    const skippedCards: Card[] = []

    knownCards.forEach((card) => {
      if (card.location === 'player') {
        skippedCards.push(card)
        return
      }

      if (targetZone?.cards.includes(card) || card.location === zoneName) {
        placeableCards.push(card)
        return
      }

      if (card.location === 'outside' || card.location === 'suspended') {
        placeableCards.push(card)
        return
      }

      if (!room.zones.has(card.location as PublicZoneName)) {
        placeableCards.push(card)
        return
      }

      // 其它公共区（如 discard/process）留给跨区移动分支，避免把弃牌直接拽回牌顶。
      skippedCards.push(card)
    })

    if (skippedCards.length > 0) {
      logger.info('公共区展示跳过无法回收的实体', {
        zoneName,
        skippedIDs: skippedCards.map((card) => card.id),
        skippedLocations: skippedCards.map((card) => card.location)
      })
    }

    placeableCards.forEach((card) => {
      room.removeCardsFromConstraintGroups([card])
      card.confirmKnown()
    })

    const missingCards = placeableCards.filter((card) => !targetZone?.cards.includes(card))
    const repositionCards =
      options.cardIDsTopFirst === true && position === POSITION_TOP
        ? [...placeableCards].reverse()
        : placeableCards
    const shouldReposition =
      options.reposition === true &&
      targetZone !== undefined &&
      placeableCards.length > 0 &&
      !hasCardsAtPublicPosition(targetZone.cards, repositionCards, position)
    const cardsToPlace = shouldReposition ? repositionCards : missingCards

    if (cardsToPlace.length > 0) {
      targetZone?.add(cardsToPlace, position)
    }

    room.resolveConstraints()
  }

  restorePileCount(cardCount: number): void {
    const pile = this.room.getZone('pile')
    const knownCards = pile.cards.filter((card) => card.id > 0 && card.isKnown)
    // 数量快照不能证明旧牌顶/牌底身份仍在原处，先释放这些过时的位置事实。
    this.room.pileIdentityLedger.registerAmbiguousOutsideGroup(knownCards.map((card) => card.id))
    knownCards.forEach((card) => {
      this.room.anonymizeLocatedIdentity(card, 'reconnect:pileCount')
    })
    pile.replaceAll(this.resizeShuffledPile([...pile.cards], cardCount, 'reconnect:pileCount'))
    this.room.pileIdentityLedger.reconcilePileCount(cardCount)
  }

  resizeShuffledPile(
    cards: Card[],
    cardCount: number,
    reason = 'shufflePile:protocolCount'
  ): Card[] {
    const missingCount = cardCount - cards.length
    if (missingCount >= 0) {
      return missingCount === 0
        ? cards
        : [...this.room.createExternalCards([], missingCount), ...cards]
    }

    const retiredCards: Card[] = []
    let excessCount = -missingCount
    // 洗回身份已先释放到候选池；只裁减暗槽，保留仍有效的公开牌堆身份与相对顺序。
    const retainedCards = cards.filter((card) => {
      if (excessCount === 0 || card.isKnown === true) return true
      retiredCards.push(card)
      excessCount -= 1
      return false
    })
    this.clearCardsFromPublicZones(retiredCards)
    retiredCards.forEach((card) => {
      this.room.releaseUnknownPlaceholderToOutside(card, reason)
    })
    return retainedCards
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

      const zone = this.room.getZone(card.location)
      if (!zone.cards.includes(card)) {
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
          (includeCandidates || !card.hasSubZoneCandidates()) &&
          card.seats.has(normalizedSeat) &&
          (!knownOnly || card.isKnown === true)
      )
      .map((card) => card.id)
      .filter((id) => id > 0)
  }
}
