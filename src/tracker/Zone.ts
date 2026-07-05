import { POSITION_BOTTOM, POSITION_TOP } from './candidate/cardPositions'
import type { Card } from './Card'
import type { Room } from './Room'
import type { PublicPosition, PublicZoneName } from './types'

/**
 * 公共区域类
 * Zone 只保存公共区的有序关系；Card.location 才是卡牌当前位置事实。
 */
export class Zone {
  declare zoneID: PublicZoneName
  declare room: Room
  /** 私有有序关系索引：外部只通过 cards getter 与方法访问。 */
  declare _orderedCards: Card[]

  /**
   * @param zoneID - 区域 ID ('outside' | 'pile' | 'discard' | 'exile' | 'process' | 'exchange')
   * @param room - 所属 Room 引用
   */
  constructor(zoneID: PublicZoneName, room: Room) {
    this.zoneID = zoneID
    this.room = room
    this._orderedCards = []
  }

  /**
   * 计算属性：返回当前公共区域的有序 Card 关系。
   */
  get cards(): Card[] {
    return this._orderedCards
  }

  /**
   * 从当前区域关系中移除指定卡牌，不改变 Card.location。
   * @returns 是否发生移除
   */
  removeCard(card: Card): boolean {
    const idx = this._orderedCards.indexOf(card)
    if (idx === -1) return false
    this._orderedCards.splice(idx, 1)
    this.room.markPublicZoneDirty(this.zoneID)
    return true
  }

  /**
   * 将当前区域关系中的一张牌替换为另一张牌，不改变两张牌自身状态。
   * 若旧牌已不在当前关系中，则按历史兼容语义追加新牌。
   * @returns 是否命中旧牌并完成替换
   */
  replaceCard(oldCard: Card, nextCard: Card): boolean {
    this.room.zones.forEach((zone) => {
      if (zone !== this) {
        zone.removeCard(nextCard)
      }
    })
    if (nextCard !== oldCard) {
      this.removeCard(nextCard)
    }

    const idx = this._orderedCards.indexOf(oldCard)
    if (idx === -1) {
      this._orderedCards.push(nextCard)
      this.room.markPublicZoneDirty(this.zoneID)
      return false
    }

    this._orderedCards[idx] = nextCard
    this.room.markPublicZoneDirty(this.zoneID)
    return true
  }

  /**
   * 向该区域放入一张或多张牌，并同步 Card.location 至当前公共区。
   * @param position - 顶/底位置指示器
   */
  add(nodes: Card | Card[], position: PublicPosition = POSITION_TOP): void {
    const cardsToAdd = Array.isArray(nodes) ? nodes : [nodes]

    cardsToAdd.forEach((card) => {
      this.room.zones.forEach((zone) => {
        if (zone !== this) {
          zone.removeCard(card)
        }
      })

      card.moveToPublicZone(this.zoneID)
      this.removeCard(card)
    })

    if (position === POSITION_BOTTOM) {
      // 插入到底部
      this._orderedCards.splice(0, 0, ...[...cardsToAdd].reverse())
    } else if (position === POSITION_TOP) {
      // 插入到顶部
      this._orderedCards.push(...cardsToAdd)
    } else {
      // 随机/无序：直接推入尾部
      this._orderedCards.push(...cardsToAdd)
    }

    if (cardsToAdd.length > 0) this.room.markPublicZoneDirty(this.zoneID)
  }

  /**
   * 批量替换当前区域的全部有序关系，适用于牌堆初始化、洗牌等整区重建。
   * 普通协议移动仍使用 add，以保留单张移动的兼容清理语义。
   * @param position - 顶/底位置指示器
   */
  replaceAll(cards: Card[], position: PublicPosition = POSITION_TOP): void {
    const orderedCards = position === POSITION_BOTTOM ? [...cards].reverse() : [...cards]
    const incomingCards = new Set(orderedCards)

    this.room.zones.forEach((zone) => {
      if (zone === this) return
      zone._orderedCards = zone._orderedCards.filter((card) => !incomingCards.has(card))
    })

    this._orderedCards.forEach((card) => {
      if (!incomingCards.has(card)) {
        card.moveToPublicZone('exile')
      }
    })

    orderedCards.forEach((card) => {
      card.moveToPublicZone(this.zoneID)
    })

    this._orderedCards = orderedCards

    // 整区重建会同时影响本区与被抽走牌的其它区，保守标记全部公共区为 dirty。
    this.room.zones.forEach((_zone, zoneID) => this.room.markPublicZoneDirty(zoneID))
  }

  /**
   * 从本区域关系中移走/弹出卡牌，不改变 Card.location。
   * @param count - 弹出张数
   * @param position - 从顶/底移除
   * @returns 弹出的卡牌实体
   */
  remove(count: number, position: PublicPosition = POSITION_TOP): Card[] {
    const zoneCards = this._orderedCards
    if (zoneCards.length === 0) return []

    const toRemoveCount = Math.min(count, zoneCards.length)
    let popped: Card[]

    if (position === POSITION_BOTTOM) {
      // 从底部弹出（前几张）
      popped = zoneCards.splice(0, toRemoveCount)
    } else {
      // 从顶部弹出（后几张）
      popped = zoneCards.splice(-toRemoveCount).reverse()
    }

    if (toRemoveCount > 0) this.room.markPublicZoneDirty(this.zoneID)

    return popped
  }

  /**
   * 清空该区域
   */
  clear(): void {
    const hadCards = this._orderedCards.length > 0
    this._orderedCards.forEach((card) => {
      card.moveToPublicZone('exile')
    })

    this._orderedCards = []
    if (hadCards) this.room.markPublicZoneDirty(this.zoneID)
  }
}
