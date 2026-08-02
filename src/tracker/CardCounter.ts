import { BaseCard } from './BaseCard'
import { recordTraversal } from './traversalStats'
import type { Card } from './Card'
import type { Room } from './Room'
import type { CardID } from './types'

export const CARD_INSTANCE_STATUS = {
  UNKNOWN: 0,
  APPEARED: 1,
  DISCARD: 2,
  REMOVED: 3
} as const

export const CARD_INSTANCE_STATUSES = [
  CARD_INSTANCE_STATUS.UNKNOWN,
  CARD_INSTANCE_STATUS.APPEARED,
  CARD_INSTANCE_STATUS.DISCARD,
  CARD_INSTANCE_STATUS.REMOVED
] as const

export type CardInstanceStatus = (typeof CARD_INSTANCE_STATUSES)[number]
type CardIDSet = Set<CardID>
type QueryDimension = 'nameIndex' | 'colorIndex' | 'numberIndex' | 'typeIndex'

/**
 * 重构版卡牌副本实例类
 * 用于代替旧版的 CardInstance，并在 Qcard 面板中保存当前推断所得的位置状态
 */
export class CardInstance extends BaseCard {
  declare status: CardInstanceStatus

  /**
   * @param id - 卡牌 ID
   */
  constructor(id: CardID) {
    super(id)
    this.status = CARD_INSTANCE_STATUS.UNKNOWN
  }
}

/**
 * 重构版记牌器统计逻辑类
 * 负责解析 Room 中的 Card 状态，生成 Qcard 查询面板所需的分类索引和过滤集
 */
export class CardCounter {
  declare room: Room
  declare nameIndex: Record<string, CardIDSet>
  declare colorIndex: CardIDSet[]
  declare numberIndex: CardIDSet[]
  declare typeIndex: CardIDSet[]
  private statusIndexCache: CardIDSet[]
  private cardsByStatusCache: Set<Card>[]
  private cardInstancesCache: CardInstance[]
  private registeredCards: Set<Card>
  // 计数器自己的增量队列；不要复用 Room.dirtyCards，后者是本局级累积集合。
  private dirtyCards: Set<Card>
  // room.cards 只追加实体牌；游标用于发现未显式 addCard 的新增牌并补建倒排索引。
  private roomCardCursor: number
  declare querySet: CardIDSet

  /**
   * @param room - 所属 Room 引用
   */
  constructor(room: Room) {
    this.room = room

    // 查询条件倒排索引集
    this.nameIndex = {}
    this.colorIndex = Array.from({ length: 7 }, () => new Set())
    this.numberIndex = Array.from({ length: 14 }, () => new Set())
    this.typeIndex = Array.from({ length: 4 }, () => new Set())
    this.statusIndexCache = this.createStatusIndex()
    this.cardsByStatusCache = this.createCardsByStatus()

    // 当前选中查询集与过滤状态
    this.querySet = new Set()
    this.cardInstancesCache = [] // 以 ID 为索引的 CardInstance 实例数组
    this.registeredCards = new Set()
    this.dirtyCards = new Set()
    this.roomCardCursor = 0

    this.initInstances()
    this.roomCardCursor = this.room.cards.length
  }

  // 公开读面统一在读取时刷新，避免视图或事件处理器读到卡牌移动后的旧状态桶。
  get statusIndex(): CardIDSet[] {
    this.update()
    return this.statusIndexCache
  }

  get cardsByStatus(): Set<Card>[] {
    this.update()
    return this.cardsByStatusCache
  }

  get cardInstances(): CardInstance[] {
    this.update()
    return this.cardInstancesCache
  }

  /**
   * 依据 Room 物理卡牌池生成查询副本实例并建立索引
   */
  initInstances(): void {
    // 未定位身份没有 Card 实体，但仍属于完整牌表，必须以 UNKNOWN 状态参与查询。
    this.room.unlocatedIdentities.forEach((cardID) => {
      this.registerIdentity(cardID)
    })

    this.room.cards.forEach((card) => {
      this.addCard(card)
    })
  }

  /**
   * 增量注册后续从游戏外产生的明牌实体。
   */
  addCard(card: Card): void {
    if (!card) return

    this.registerCard(card)

    // 无论是否新增实体，身份登记的唯一条件都是正 ID；负 ID 占位不登记身份。
    if (card.id > 0) this.registerIdentity(card.id)

    this.syncCardStatus(card)
    this.dirtyCards.delete(card)
    this.advanceRoomCardCursor()
  }

  /**
   * 标记单张牌状态需要同步。只影响 CardCounter 自己的缓存生命周期，
   * 不消费 Room.dirtyCards / dirtyCardEvents。
   */
  markDirty(card: Card | null | undefined): void {
    if (!card) return
    this.dirtyCards.add(card)
  }

  /**
   * 触发更新：只同步新增实体与状态发生变化的牌。
   */
  update(): void {
    const newRoomCards = this.collectNewRoomCards()
    const newRoomCardSet = new Set(newRoomCards)
    const dirtyCards = Array.from(this.dirtyCards).filter((card) => !newRoomCardSet.has(card))
    if (newRoomCards.length === 0 && dirtyCards.length === 0) return

    recordTraversal('cardCounter:update', newRoomCards.length + dirtyCards.length)

    // 先注册新牌：正 ID 需要补建 name/color/number/type 倒排索引，匿名牌只进入状态桶。
    newRoomCards.forEach((card) => this.addCard(card))
    dirtyCards.forEach((card) => {
      if (this.registeredCards.has(card)) {
        this.syncCardStatus(card)
      } else {
        this.addCard(card)
      }
      this.dirtyCards.delete(card)
    })
  }

  private registerCard(card: Card): boolean {
    if (this.registeredCards.has(card)) return false
    this.registeredCards.add(card)
    return true
  }

  /**
   * 为真实身份建立静态牌面索引；身份尚未定位时状态保持 UNKNOWN。
   */
  private registerIdentity(cardID: CardID): CardInstance {
    const existing = this.cardInstancesCache[cardID]
    if (existing) return existing

    const instance = new CardInstance(cardID)
    this.cardInstancesCache[cardID] = instance

    if (!(instance.name in this.nameIndex)) {
      this.nameIndex[instance.name] = new Set()
    }
    this.nameIndex[instance.name].add(cardID)
    this.colorIndex[instance.color].add(cardID)
    this.numberIndex[instance.number].add(cardID)
    this.typeIndex[instance.type].add(cardID)

    if (instance.color === 3 && instance.number >= 2 && instance.number <= 9) {
      this.numberIndex[0].add(cardID)
    }

    if (instance.name.match(/^(冰|火|雷)?杀$/)) {
      this.colorIndex[Math.ceil(instance.color / 2) + 4].add(cardID)
    }

    this.statusIndexCache[CARD_INSTANCE_STATUS.UNKNOWN].add(cardID)
    return instance
  }

  private collectNewRoomCards(): Card[] {
    if (this.roomCardCursor > this.room.cards.length) {
      // 房间重置或测试直接替换数组时回到保守路径；已注册牌会被过滤掉。
      this.roomCardCursor = 0
    }

    const appendedCards = this.room.cards.slice(this.roomCardCursor)
    if (appendedCards.length > 0) {
      recordTraversal('cardCounter:collectNewRoomCards', appendedCards.length)
    }
    const newCards = appendedCards.filter((card) => !this.registeredCards.has(card))
    this.roomCardCursor = this.room.cards.length
    return newCards
  }

  /**
   * createExternalCards 等入口会先把实体追加到 room.cards，再显式调用 addCard() 注册。
   * 连续推进已经注册的尾部可避免下一次 update() 再扫描同一批实体；若出现乱序注册，
   * 游标停在第一个未注册实体，仍由 collectNewRoomCards() 的保守路径补齐。
   */
  private advanceRoomCardCursor(): void {
    if (this.roomCardCursor > this.room.cards.length) this.roomCardCursor = 0

    while (
      this.roomCardCursor < this.room.cards.length &&
      this.registeredCards.has(this.room.cards[this.roomCardCursor])
    ) {
      this.roomCardCursor += 1
    }
  }

  private createStatusIndex(): CardIDSet[] {
    return Array.from(CARD_INSTANCE_STATUSES, () => new Set<CardID>())
  }

  private createCardsByStatus(): Set<Card>[] {
    return Array.from(CARD_INSTANCE_STATUSES, () => new Set<Card>())
  }

  private getCardStatus(card: Card): CardInstanceStatus {
    if (
      card.location === 'pile' ||
      (card.location === 'player' && card.subZone === 'hand' && card.isKnown !== true)
    ) {
      return CARD_INSTANCE_STATUS.UNKNOWN
    }

    if (
      card.location === 'player' ||
      card.location === 'process' ||
      card.location === 'exchange' ||
      card.location === 'suspended'
    ) {
      return CARD_INSTANCE_STATUS.APPEARED
    }

    if (card.location === 'discard') {
      return CARD_INSTANCE_STATUS.DISCARD
    }

    return CARD_INSTANCE_STATUS.REMOVED
  }

  syncCardStatus(card: Card): void {
    this.removeCardStatus(card)
    this.addCardStatus(card)
  }

  private addCardStatus(card: Card): void {
    const status = this.getCardStatus(card)
    const instance = card.id > 0 ? (this.cardInstancesCache[card.id] ?? null) : null

    this.cardsByStatusCache[status].add(card)

    if (!instance) return

    instance.status = status
    if (card.id > 0) {
      this.statusIndexCache[status].add(card.id)
    }
  }

  private removeCardStatus(card: Card): void {
    this.cardsByStatusCache.forEach((set) => set.delete(card))
    if (card.id > 0) {
      this.statusIndexCache.forEach((set) => set.delete(card.id))
    }
  }

  /**
   * 手气卡等路径把已定位正 ID 槽匿名化后：实体离开 identity 索引，身份回到 UNKNOWN 未定位桶。
   */
  releaseLocatedIdentityToUnknown(card: Card, previousCardID: CardID): void {
    if (!(previousCardID > 0) || !card) return

    this.cardsByStatusCache.forEach((set) => set.delete(card))
    this.statusIndexCache.forEach((set) => set.delete(previousCardID))

    const instance = this.cardInstancesCache[previousCardID]
    if (instance) {
      instance.status = CARD_INSTANCE_STATUS.UNKNOWN
    }
    this.statusIndexCache[CARD_INSTANCE_STATUS.UNKNOWN].add(previousCardID)
    this.cardsByStatusCache[CARD_INSTANCE_STATUS.UNKNOWN].add(card)
    this.dirtyCards.delete(card)
  }

  /**
   * 单维度快速过滤查询
   * @param dimension 'nameIndex' | 'colorIndex' | 'numberIndex' | 'typeIndex'
   */
  query(dimension: QueryDimension, key: string | number): void {
    const index = this[dimension] as Record<string | number, CardIDSet | undefined>
    if (index && index[key]) {
      this.querySet = new Set(Array.from(index[key]))
    } else {
      this.querySet.clear()
    }
  }
}
