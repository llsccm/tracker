import { Card } from './Card'
import { Player } from './Player'
import { Zone } from './Zone'
import { CardCounter, CARD_INSTANCE_STATUS } from './CardCounter'
import { GameState } from './gameState'
import { AmbiguousKnownIndex } from './AmbiguousKnownIndex'
import { CardLocationIndex } from './CardLocationIndex'
import { summarizeMoveContext, summarizeMoveEvent } from './helper/moveSummary'
import { RoomConstraints } from './roomConstraints'
import { RoomMovement } from './roomMovement'
import { type PlayerHandCardIDOptions, RoomPublicZones } from './roomPublicZones'
import { normalizeLocationCandidate } from './candidate/locationCandidate'
import type { LocationCandidateInput } from './candidate/locationCandidate'
import { collectHandSlotCardsBySeat, getHandSlotKindForSeat } from './candidate/handSlotCounts'
import { recordTraversal } from './traversalStats'
import { trackerLogger } from '@/utils/logger'
import type { ConstraintGroup } from './ConstraintGroup'
import type {
  CardID,
  MoveOptions,
  PublicZoneName,
  SeatID,
  SeatInfo,
  SpellID,
  SubZoneCandidate
} from './types'

// 收敛轮数看门狗阈值：正常收敛 ≤2 轮，超过即疑似某处虚报 changed 的非终止回归（见 #2）。
const CONVERGENCE_ROUNDS_WARN = 8

interface RoomOptions {
  gameState?: GameState
}

interface HandSlotCountSummary {
  knownCount: number
  candidateCount: number
  candidateCards: Card[]
}

interface PreservedPlayerPlaceholderSummary {
  sourceCardID: CardID
  placeholderCardID: CardID
  sourceLocation: Card['location']
  sourceSubZone: Card['subZone']
  sourceSpellID: SpellID | null
  sourceSeats: SeatID[]
}

interface PlayerHandPlaceholderValidationIssue {
  seatID: SeatID
  observedHandCount: number
  knownCount: number
  candidateCount: number
  expectedUnknownCount: number
  actualUnknownCount: number
  actualSlotCount: number
  unknownCardIDs: CardID[]
}

interface ShufflePileOptions {
  cardCount?: number | null
}

export interface DirtyCardEvent {
  seq: number
  card: Card
  detail: Record<string, unknown>
}

const DIRTY_CARD_EVENT_LIMIT = 500

/**
 * 重构版房间类
 * 充当单局游戏的状态隔离生命周期容器与顶层事件分发协调者
 */
export class Room {
  /** 房间内分配的物理座位，为 0-7 之间的数字 */
  seatIDs: SeatID[] = []
  /** 房间玩家人数 */
  size = 0
  /** 牌局先手位置 (一号位的 seatID) */
  firstID: SeatID | undefined = undefined
  /** 当前运行客户端的主视角座位 ID (ClientID 对应 user.userID 的座位) */
  mySeatID: SeatID | undefined = undefined
  /** 牌堆是否已经通过 MsgGamePlayCardNtf 完成初始化 */
  isDeckReady = false
  cards: Card[] = []
  cardIndex: Map<CardID, Card> = new Map()
  anonymousEntitySeq = -1
  declare players: Map<SeatID, Player>
  declare zones: Map<PublicZoneName, Zone>
  declare skillHandlers: Map<SpellID, (...args: any[]) => unknown>
  declare moveEventHandlers: Map<SpellID | '*', ((event: any, room: Room) => any)[]>
  declare skillState: Map<SpellID | string, any>
  declare constraintGroups: Map<string | number, ConstraintGroup>
  declare constraintGroupSeq: number
  declare constraintGroupsDirty: boolean
  declare ambiguousKnownIndex: AmbiguousKnownIndex
  declare locationIndex: CardLocationIndex
  declare suspendedKnownCards: Set<Card>
  /** 收敛轮内被触碰过的座位集合；仅在 resolveConstraints 循环内非空，供约束三跳过未触碰玩家。 */
  declare resolveTouchedSeats: Set<SeatID> | null
  /** 最近一次 resolveConstraints 的收敛轮数；配合 maxResolveRounds 作非终止回归看门狗。 */
  declare lastResolveRounds: number
  /** 本局至今 resolveConstraints 的最大收敛轮数（可查询的 tripwire，正常 ≤2）。 */
  declare maxResolveRounds: number
  declare viewDirty: boolean
  /** 本局曾发生状态变化的卡牌集合；只在房间销毁时清理，不作为视图消费队列。 */
  declare dirtyCards: Set<Card>
  /** 供视图按游标增量消费的有序脏牌日志，避免每次渲染扫描完整 dirtyCards。 */
  declare dirtyCardEvents: DirtyCardEvent[]
  declare dirtyCardSeq: number
  /** 本次收敛前累积的受影响公共区集合；供 locationIndex 增量刷新，收敛尾部消费后清空。 */
  declare dirtyPublicZones: Set<PublicZoneName>
  declare cardChangeEvents: Record<string, unknown>[]
  /**
   * A2：resolveConstraints 增量维护的 player 快照（成员严格等于 `location === 'player'`），
   * 保持 room.cards 顺序，替代每轮 `this.cards.filter(...)` 全量过滤。
   */
  declare playerCardsSnapshot: Card[]
  /** playerCardsSnapshot 的成员集合，O(1) 判断某牌是否已在快照中。 */
  declare playerCardsSnapshotSet: Set<Card>
  /** 已消费到的 dirtyCardSeq 游标；< 0 表示未初始化，断档时回退全量重建。 */
  declare playerSnapshotSeq: number
  /** player 快照排序键（= room.cards 下标）；rebuild 后新建牌用 this.cards 下标兜底。 */
  declare playerSnapshotOrder: Map<Card, number>
  declare publicZones: RoomPublicZones
  declare constraints: RoomConstraints
  declare movement: RoomMovement
  declare game: GameState
  /** 计数器 */
  declare counter: CardCounter

  /**
   * @param cardIDs - 卡牌的物理 ID 列表，用以初始化卡牌池
   */
  constructor({ gameState = new GameState() }: RoomOptions = {}) {
    // 2. 初始化逻辑分区与公共区域
    this.players = new Map() // seatID -> Player
    this.zones = new Map([
      ['outside', new Zone('outside', this)],
      ['pile', new Zone('pile', this)],
      ['discard', new Zone('discard', this)],
      ['exile', new Zone('exile', this)],
      ['process', new Zone('process', this)],
      ['exchange', new Zone('exchange', this)]
    ])

    // 5. 武将特判技能过滤注册表 (开闭原则解耦)
    this.skillHandlers = new Map()
    this.moveEventHandlers = new Map()
    this.skillState = new Map()

    // 6. 局部约束组与明牌反查索引
    this.constraintGroups = new Map()
    this.constraintGroupSeq = 0
    this.constraintGroupsDirty = false
    this.lastResolveRounds = 0
    this.maxResolveRounds = 0
    this.ambiguousKnownIndex = new AmbiguousKnownIndex(this)
    this.locationIndex = new CardLocationIndex()
    this.suspendedKnownCards = new Set()
    this.resolveTouchedSeats = null
    this.viewDirty = false
    this.dirtyCards = new Set()
    this.dirtyCardEvents = []
    this.dirtyCardSeq = 0
    this.dirtyPublicZones = new Set()
    this.cardChangeEvents = []
    this.playerCardsSnapshot = []
    this.playerCardsSnapshotSet = new Set()
    this.playerSnapshotSeq = -1
    this.playerSnapshotOrder = new Map()

    // 7. 挂载 Room 行为模块，保留 Room 作为稳定公开入口
    this.publicZones = new RoomPublicZones(this)
    this.constraints = new RoomConstraints(this)
    this.movement = new RoomMovement(this)

    // 8. 绑定当前房间的对局状态；浏览器入口会注入真实 Game，测试可注入纯状态对象。
    this.game = gameState
    this.game?.bindRoom?.(this)
  }

  getCurrentTimestamp(): { turn: number; round: number; phase: number } {
    return {
      turn: this.game?.turn ?? 0,
      round: this.game?.round ?? 0,
      phase: this.game?.phase ?? 0
    }
  }

  initDeck(cardIDs: CardID[]): void {
    this.isDeckReady = false
    this.cards.length = 0
    this.cardIndex.clear()
    this.anonymousEntitySeq = -1

    // 初始化摸牌堆
    const pile = this.zones.get('pile')
    this.zones.forEach((zone) => zone.clear())

    const deckCards: Card[] = []
    for (const id of cardIDs) {
      const card = new Card(id, this)
      this.cards.push(card)
      deckCards.push(card)
      this.cardIndex.set(card.id, card)
    }
    pile.replaceAll(deckCards)

    this.locationIndex.rebuild(this)
    this.ambiguousKnownIndex.rebuild(Array.from(this.constraintGroups.values()))
    // A2：与区域索引一同 seed player 快照，使后续 resolveConstraints 走增量刷新。
    this.rebuildPlayerSnapshot()
    this.constraintGroupsDirty = false
    // 全量重建已覆盖所有索引与公共区，丢弃建牌堆阶段累积的 dirty 标记。
    this.dirtyPublicZones.clear()

    // 关联计数器实例
    this.counter = new CardCounter(this)
    this.isDeckReady = true
    this.publicZones.assertPublicZoneConsistency('initDeck')
  }

  /**
   * 根据 GsCModifyUserseatNtf 座位列表数据注册并初始化玩家座位
   * 兼容 msg.Infos 及 msg.Infos[i].SeatID 结构，并自动根据 ClientID 设定当前主视角座位
   * @param infos - 包含 { SeatID, ClientID } 的座位信息数组
   * @param currentUserID - 当前客户端玩家的物理 userID
   */
  registerPlayers(infos: SeatInfo[], currentUserID?: number): void {
    // 1. 清理之前的临时座位记录
    this.seatIDs = []
    this.players.clear()
    this.mySeatID = undefined

    // 2. 遍历注册各个玩家
    infos.forEach((info) => {
      // 新协议中可能是 undefined 代表座位0
      const seatNum = info.seat_id ?? info.SeatID ?? 0
      if (!this.seatIDs.includes(seatNum)) {
        this.seatIDs.push(seatNum)
      }

      const player = new Player(seatNum, this)
      this.players.set(seatNum, player)

      const uuid = info.user_temp_id ?? info.ClientID ?? undefined

      // 3. 自动匹配并记录主视角座位 ID
      if (currentUserID !== undefined && uuid === currentUserID) {
        this.setMySeatID(seatNum)
      }
    })

    // 排序物理座位
    this.seatIDs.sort((a, b) => a - b)
    this.size = this.seatIDs.length
    this.game?.syncRoomSeats?.(this)

    // 观看别人录像时
    this.game.isRecord = this.mySeatID === undefined

    trackerLogger.info('Room 注册玩家', {
      seatIDs: this.seatIDs,
      currentUserID,
      mySeatID: this.mySeatID
    })
  }

  getPlayer(seatID: SeatID) {
    return this.players.get(seatID)
  }

  /**
   * 设定当前客户端的主视角座位 ID (对应 user.userID)
   *
   * 注册时设置
   */
  setMySeatID(seatID: SeatID): void {
    this.mySeatID = seatID
    trackerLogger.info('Room 设置主视角座位', { mySeatID: this.mySeatID })
  }

  /** 主视角在牌局中的顺位 */
  getMyDisplayID(): number | undefined {
    return this.getDisplayID(this.mySeatID)
  }

  getMyPlayer(): Player | undefined {
    return this.getPlayer(this.mySeatID)
  }

  /**
   * 设定先手位置，并据此决定牌局的一号位
   * 先手位置为 firstID，其对应的顺位序号 order 为 0 (一号位)
   * 顺位加1则是二号位等，以此类推
   */
  setFirstHand(firstID: SeatID): void {
    this.firstID = firstID
    this.updateFixedViewIds()
    trackerLogger.info('Room 设置先手', { firstID })
  }

  /**
   * 主动根据当前的先手位置 and 分配的房间座位计算并设定每一个玩家的 fixedViewId
   *
   * fixedViewId 用于定位玩家在牌局中的顺位序号 一号位开始
   */
  updateFixedViewIds(): void {
    this.players.forEach((player) => {
      const viewId = this.getFixedViewId(player.seatID)
      player.fixedViewId = viewId !== undefined ? viewId + 1 : undefined
    })
  }

  /** 牌局中的顺位 一号位开始 */
  getDisplayID(seatID: SeatID): number | undefined {
    const player = this.getPlayer(seatID)
    return player?.fixedViewId
  }

  /** 格式化玩家位置描述前缀，例如“一号位”或“座位3”。 */
  formatSeatPrefix(seatID: SeatID): string {
    const displayID = this.getDisplayID(seatID)
    return displayID !== undefined ? `${displayID}号位` : `座位${seatID}`
  }

  /** 牌局中的顺位 0开始 */
  getFixedViewId(seatID: SeatID): number | undefined {
    if (!this.seatIDs.includes(seatID)) return undefined

    // 顺位基准位置
    const firstSeat = this.firstID !== undefined ? this.firstID : this.seatIDs[0]
    const originIndex = this.seatIDs.indexOf(firstSeat)
    const targetIndex = this.seatIDs.indexOf(seatID)

    if (targetIndex !== -1 && originIndex !== -1) {
      return (targetIndex - originIndex + this.size) % this.size
    }

    return undefined
  }

  /**
   * 注册特定的技能过滤器
   */
  registerSkillHandler(spellID: SpellID, handler: (...args: any[]) => unknown): void {
    this.skillHandlers.set(spellID, handler)
  }

  /**
   * 注册完整移动事件处理器，用于在 Room.moveCards() 前修正批量移动语义。
   */
  registerMoveEventHandler(spellID: SpellID | '*', handler: (event: any, room: Room) => any): void {
    const key = spellID === '*' ? '*' : Number(spellID)

    if (!this.moveEventHandlers.has(key)) {
      this.moveEventHandlers.set(key, [])
    }

    this.moveEventHandlers.get(key).push(handler)
  }

  /**
   * 获取技能级记牌器推理状态，只保存影响卡牌身份/候选/区域的状态。
   */
  getSkillState(spellID: SpellID | string, createState: () => any = () => ({})): any {
    // skillState 既支持具体技能 ID，也支持房间级通用账本（字符串 key）。
    const numericKey = Number(spellID)
    const key = Number.isNaN(numericKey) ? String(spellID) : numericKey

    if (!this.skillState.has(key)) {
      this.skillState.set(key, createState())
    }

    return this.skillState.get(key)
  }

  clearSkillState(spellID: SpellID | string): void {
    // 与 getSkillState 使用相同 key 规整逻辑，避免字符串账本无法清理。
    const numericKey = Number(spellID)
    const key = Number.isNaN(numericKey) ? String(spellID) : numericKey
    this.skillState.delete(key)
  }

  /**
   * 在实际移动前，让技能处理器有机会修正 cardIDs/来源牌/组合约束。
   */
  decorateMoveEvent(event: any): any {
    if (!event) return event

    const collectSpellIDs = (value: any): any[] => {
      if (value === null || value === undefined) return []
      if (typeof value !== 'string' && typeof value?.[Symbol.iterator] === 'function') {
        return Array.from(value).flatMap((item) => collectSpellIDs(item))
      }

      return [value]
    }

    const spellIDs = Array.from(
      new Set(
        [event.raw?.SpellID, event.options?.spellID]
          .flatMap((id) => collectSpellIDs(id))
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id))
      )
    )

    const handlers = [
      ...(this.moveEventHandlers.get('*') ?? []),
      ...spellIDs.flatMap((spellID) => this.moveEventHandlers.get(spellID) ?? [])
    ]

    return handlers.reduce((nextEvent, handler) => {
      try {
        return handler(nextEvent, this) ?? nextEvent
      } catch (e) {
        trackerLogger.warn('移动事件装饰失败', {
          spellIDs,
          event: summarizeMoveEvent(nextEvent)
        })

        console.error('[Refactor] 移动事件装饰失败:', e, nextEvent)
        return nextEvent
      }
    }, event)
  }

  /**
   * 将座位入参标准化为数字数组，过滤空值和非法数字。
   */
  normalizeSeats(seatID: SeatID | SeatID[]): SeatID[] {
    return (Array.isArray(seatID) ? seatID : [seatID])
      .map((seat) => Number(seat))
      .filter(
        (seat) =>
          Number.isInteger(seat) &&
          seat >= 0 &&
          seat < 8 &&
          (this.seatIDs.length === 0 || this.seatIDs.includes(seat))
      )
  }

  /**
   * 合并候选座位集合；优先取交集，若完全无交集则采用下一组候选。
   * 这样可以在保守收敛和乱序自愈之间保持弹性。
   */
  mergeCandidateSeats(
    currentSeats: Set<SeatID> | null | undefined,
    nextSeats: SeatID[] = []
  ): Set<SeatID> {
    const normalizedNextSeats = this.normalizeSeats(nextSeats)
    if (normalizedNextSeats.length === 0) {
      return new Set(Array.from(currentSeats ?? []).map((seat) => Number(seat)))
    }

    if (!currentSeats || currentSeats.size === 0) return new Set(normalizedNextSeats)

    const nextSeatSet = new Set(normalizedNextSeats)
    const intersection = Array.from(currentSeats)
      .map((seat) => Number(seat))
      .filter((seat) => nextSeatSet.has(seat))

    return new Set(intersection.length > 0 ? intersection : normalizedNextSeats)
  }

  /**
   * 按物理 ID 查找当前房间内已有的实体牌。
   */
  findCardsByIDs(cardIDs: CardID[] = []): Card[] {
    return cardIDs
      .filter((id) => id > 0)
      .map((id) => this.cardIndex.get(id))
      .filter(Boolean)
  }

  /**
   * 为游戏外新出现的牌创建实体；用于回收区、临时区缺失等兜底场景。
   */
  allocateAnonymousEntityID(): number {
    return this.anonymousEntitySeq--
  }

  createExternalCards(cardIDs: CardID[] = [], count = cardIDs.length): Card[] {
    const ids = cardIDs.filter((id) => id > 0)
    const unknownCount = Math.max(0, Number(count) || 0, cardIDs.length) - ids.length
    const cards = [
      ...ids.map((id) => {
        const card = new Card(id, this)
        this.cards.push(card)
        this.cardIndex.set(card.id, card)
        return card
      }),
      ...Array.from({ length: unknownCount }, () => {
        const card = new Card(0, this)
        this.cards.push(card)
        return card
      })
    ]

    cards.forEach((card) => card.moveToPublicZone('outside'))
    cards.forEach((card) => this.counter?.addCard(card))
    return cards
  }

  reconcileAnonymousHandCards(slotCountsBySeat: Map<SeatID, HandSlotCountSummary>): {
    created: Card[]
    released: Card[]
  } {
    const created: Card[] = []
    const released: Card[] = []

    // 没有任何已观测玩家时直接返回：与旧“逐玩家 early-return”等价，避免无谓的归组扫描。
    let hasObservedPlayer = false
    for (const player of this.players.values()) {
      if (player.hasObservedHandCount) {
        hasObservedPlayer = true
        break
      }
    }
    if (!hasObservedPlayer) return { created, released }

    // 一次性按归属座位归组“单一归属的暗手牌”，取代过去对每个已观测玩家各扫一遍 Room.cards。
    // 复用 resolveConstraints 增量维护的 player 快照（成员严格等于 card.location==='player'），
    // 把每条移动尾部的 O(玩家数 × 全牌数) 降为 O(玩家区牌数)。
    const playerCards = this.playerCardsSnapshot
    recordTraversal('reconcileAnonymousHandCards:group', playerCards.length)
    const hiddenHandCardsBySeat = new Map<SeatID, Card[]>()
    for (const card of playerCards) {
      if (card.subZone !== 'hand' || card.isKnown === true || card.suspended === true) {
        continue
      }
      const ownerSeatID = card.resolvedSeat
      if (ownerSeatID === null) continue
      const existing = hiddenHandCardsBySeat.get(ownerSeatID)
      if (existing) existing.push(card)
      else hiddenHandCardsBySeat.set(ownerSeatID, [card])
    }

    this.players.forEach((player, seatID) => {
      if (!player.hasObservedHandCount) return
      const slotCounts = slotCountsBySeat.get(seatID)
      if ((slotCounts?.candidateCards.length ?? 0) > 0 && slotCounts?.candidateCount === 0) {
        return
      }

      const unknownHandCards = hiddenHandCardsBySeat.get(seatID) ?? []
      const missingCount = Math.max(0, player.unknownCardCount - unknownHandCards.length)

      if (missingCount > 0) {
        const placeholders = this.createExternalCards([], missingCount)
        placeholders.forEach((card) => {
          card.bindCandidates([seatID], 'hand', null, { known: false })
        })
        created.push(...placeholders)
      }

      let excessCount = Math.max(0, unknownHandCards.length - player.unknownCardCount)
      if (excessCount <= 0) return

      for (const card of unknownHandCards) {
        if (excessCount <= 0) break
        if (card.id !== 0) continue

        this.removeCardsFromConstraintGroups([card])
        card.moveToPublicZone('outside')
        released.push(card)
        excessCount -= 1
      }
    })

    if (created.length > 0 || released.length > 0) {
      trackerLogger.info('匿名手牌实体对账', {
        created: created.map((card) => ({
          entityID: card.entityID,
          seatID: card.resolvedSeat
        })),
        released: released.map((card) => ({
          entityID: card.entityID
        }))
      })
    }

    return { created, released }
  }

  // 公共区主入口与兼容查询；低频查询辅助位于 roomPublicZones.js。
  clearCardsFromPublicZones(...args) {
    return (this.publicZones.clearCardsFromPublicZones as any)(...args)
  }

  /**
   * 获取公共 Zone；协议未给出来源或给出未知来源时，默认回退到牌堆。
   * 这是 Room 的高频基础读入口，保留在 Room 中便于追踪移动主流程。
   */
  getPublicZone(zoneID: PublicZoneName | null | undefined): Zone {
    if (!zoneID || !this.zones.has(zoneID)) return this.zones.get('pile')
    return this.zones.get(zoneID)
  }

  /**
   * 将装备容器候选按当前装备承载座位投影为玩家标记区候选。
   * 容器候选本身不绑定 seat，装备移动后读取投影即可自然迁移。
   */
  resolveEquipmentContainerLocationCandidates(
    candidate: LocationCandidateInput
  ): SubZoneCandidate[] {
    const normalized = normalizeLocationCandidate(candidate)
    if (normalized?.type !== 'container' || normalized.containerType !== 'equipment') return []

    const equipment = this.cardIndex.get(Number(normalized.cardID))
    if (equipment?.location !== 'player' || equipment.subZone !== 'equip') return []

    return Array.from(equipment.seats)
      .map((seatID) => Number(seatID))
      .filter((seatID) => Number.isFinite(seatID))
      .map((seatID) => ({
        type: 'player',
        seatID,
        subZone: 'mark',
        spellID: normalized.spellID
      }))
  }

  /** 获取指定玩家手牌中的物理牌 ID
   *
   * 缓存更新慢 不太适用渲染
   */
  getPlayerHandCardIDs(seatID: SeatID, options: PlayerHandCardIDOptions = {}) {
    return this.publicZones.getPlayerHandCardIDs(seatID, options)
  }

  // 约束收敛主入口与辅助方法；低频约束辅助位于 roomConstraints.js。
  removeCardsFromConstraintGroups(...args) {
    return (this.constraints.removeCardsFromConstraintGroups as any)(...args)
  }

  notifyCardChanged(card: Card | null, event: Record<string, unknown> = {}): void {
    if (!card) return

    // 收敛轮内记录事件触碰过的座位（变更前后席位并集 + owner 派生字段，只多不少），
    // 供约束三从第二轮起跳过输入未变的玩家。
    const touchedSeats = this.resolveTouchedSeats
    if (touchedSeats) {
      card.seats.forEach((seatID) => touchedSeats.add(seatID))
      if (Array.isArray(event.previousSeats)) {
        for (const seatID of event.previousSeats) {
          if (typeof seatID === 'number') touchedSeats.add(seatID)
        }
      }
      for (const key of [
        'previousOwner',
        'nextOwner',
        'previousResolvedSeat',
        'nextResolvedSeat'
      ]) {
        const seatID = event[key]
        if (typeof seatID === 'number') touchedSeats.add(seatID)
      }
    }

    this.markCounterDirty(card)
    this.markViewDirty('card-changed')
    this.dirtyCards.add(card)
    // dirtyCards 是本局级集合；事件日志用于视图按游标消费本次之后的新变化。
    this.dirtyCardSeq += 1
    this.dirtyCardEvents.push({
      seq: this.dirtyCardSeq,
      card,
      detail: event
    })
    if (this.dirtyCardEvents.length > DIRTY_CARD_EVENT_LIMIT) {
      this.dirtyCardEvents.splice(0, this.dirtyCardEvents.length - DIRTY_CARD_EVENT_LIMIT)
    }

    this.cardChangeEvents.push({
      cardID: card.id,
      ...event
    })

    if (this.cardChangeEvents.length > 100) {
      this.cardChangeEvents.splice(0, this.cardChangeEvents.length - 100)
    }
  }

  markCounterDirty(card: Card | null | undefined): void {
    this.counter?.markDirty(card)
  }

  markViewDirty(_reason = 'view-dirty'): void {
    this.viewDirty = true
  }

  /**
   * 记录本次收敛前受影响的公共区，供 locationIndex 增量只刷新变化的公共桶。
   * 由 Zone 的有序关系变更调用；收敛尾部消费后清空。
   */
  markPublicZoneDirty(zoneID: PublicZoneName | null | undefined): void {
    if (zoneID === null || zoneID === undefined) return
    this.dirtyPublicZones?.add(zoneID)
  }

  markConstraintGroupsDirty(_reason = 'constraint-groups-dirty'): void {
    this.constraintGroupsDirty = true
  }

  deleteConstraintGroup(groupID: string | number): boolean {
    return this.constraintGroups.delete(groupID)
  }

  /**
   * 将牌堆和弃牌堆中的实体牌重置后洗回牌堆。
   * 洗牌时实际牌堆只由“剩余牌堆 + 弃牌堆”组成，不再为了协议张数补 id=0 占位。
   * 协议牌堆空间剩余身份由实际牌堆与从未在场上出现的牌共同解释；
   * 非实际牌堆内的正 ID 暗身份暂停具体位置追踪，等待后续明示/交互时恢复。
   */
  shufflePile(options: ShufflePileOptions = {}): void {
    const pile = this.zones.get('pile')
    const discard = this.zones.get('discard')
    if (!pile || !discard) return

    const normalizedCardCount =
      options.cardCount !== null && options.cardCount !== undefined
        ? Math.floor(Number(options.cardCount))
        : NaN
    const hasProtocolPileCount = Number.isFinite(normalizedCardCount) && normalizedCardCount >= 0
    const remainingPileCards = [...pile.cards]
    const recycledCards = [...discard.cards]
    const pileCards = [...remainingPileCards, ...recycledCards]

    // 洗牌
    const rebuildPileAfterShuffle = () => {
      // 只随机洗回弃牌堆；原本仍留在牌堆里的部分保持相对顺序，避免已知牌堆顶被误重排。
      for (let i = recycledCards.length - 1; i > 0; i -= 1) {
        const randomIndex = Math.floor(Math.random() * (i + 1))
        const recycledCard = recycledCards[randomIndex]
        recycledCards[randomIndex] = recycledCards[i]
        recycledCards[i] = recycledCard
      }

      const rebuiltPileCards = [...recycledCards, ...remainingPileCards]
      pile.replaceAll(rebuiltPileCards)
      return rebuiltPileCards
    }

    if (!hasProtocolPileCount) {
      recycledCards.forEach((card) => card.reset())
      this.removeCardsFromConstraintGroups(pileCards)

      rebuildPileAfterShuffle()

      // 触发收敛
      this.resolveConstraints()
      return
    }

    const knownPileCards = [...remainingPileCards, ...recycledCards]
    const knownPileSet = new Set(knownPileCards)
    const preShufflePilePlaceholderCount = knownPileCards.filter((card) => card.id === 0).length
    const statusBuckets = this.counter?.cardsByStatus
    const unknownStatusCards = Array.from(statusBuckets?.[CARD_INSTANCE_STATUS.UNKNOWN] ?? [])
    const appearedCards = Array.from(statusBuckets?.[CARD_INSTANCE_STATUS.APPEARED] ?? [])
    const identityStatusCards = Array.from(new Set([...unknownStatusCards, ...appearedCards]))
    const nonPileIdentityStatusCards = identityStatusCards.filter(
      (card) => card.id > 0 && !knownPileSet.has(card)
    )
    // CardCounter 的 UNKNOWN/APPEARED 是“位置状态”，不能直接表示“牌面身份是否出现过”。
    // 例如木牛流马里的暗牌实体处于 player/mark，会被 CardCounter 归为 APPEARED，
    // 但它的牌面并未明示，仍应按 neverAppeared 身份处理。
    const neverAppearedCards = nonPileIdentityStatusCards.filter((card) => card.isKnown !== true)
    // 场上明牌
    const visibleKnownCards = appearedCards.filter((card) => card.id > 0 && card.isKnown)
    // 只有“身份曾经明示但当前位置又变成暗态”的牌才属于 appearedHidden；当前模型没有可靠历史字段，
    // 因此洗牌分类先保持为空，避免把木马/手牌暗实体误记为已出现身份。
    const appearedHiddenIdentityCards: Card[] = []
    // 洗牌不会把这些正 ID 迁入实际牌堆；若它们原本承载玩家区暗槽位，
    // 会按暂停前实体所在的玩家/子区/技能空间创建 id=0 替身，避免丢失位置数量账本。
    // 正 ID 自身暂停前会 confirmKnown()，表示身份已明确；后续协议再次出现该 ID 时恢复具体位置追踪。
    const suspendedIdentityCards = [...neverAppearedCards, ...appearedHiddenIdentityCards]
    // 这是“协议牌堆空间”的解释集合，不是实际 pile.cards。
    const pileSpaceRemainingCards = [...knownPileCards, ...suspendedIdentityCards]

    recordTraversal('shufflePile:classify', nonPileIdentityStatusCards.length)

    recycledCards.forEach((card) => card.reset())
    this.removeCardsFromConstraintGroups([...knownPileCards, ...suspendedIdentityCards])

    // 实际牌堆只重建 pile + discard。协议张数仅用于判断哪些正 ID 身份应暂停，
    // 不再为了“凑长度”向 pile.cards 填入 id=0 或玩家暗手牌实体。
    const rebuiltPileCards = rebuildPileAfterShuffle()

    const suspendedCardIDs: CardID[] = []
    const preservedPlayerPlaceholders: PreservedPlayerPlaceholderSummary[] = []
    let preservedPlayerHandPlaceholderCount = 0
    suspendedIdentityCards.forEach((card) => {
      // 正 ID 暂停前若仍承担玩家区暗槽位，必须先按实体当前位置复制 id=0 替身；
      // observedHandCount 只用于后置校验，不参与主动补位，避免掩盖实体位置链路异常。
      const placeholder = this.preserveUnknownPlaceholderForShuffle(card)
      if (placeholder) {
        const sourceSubZone = card.subZone ?? 'hand'
        if (sourceSubZone === 'hand') preservedPlayerHandPlaceholderCount += 1
        preservedPlayerPlaceholders.push({
          sourceCardID: card.id,
          placeholderCardID: placeholder.id,
          sourceLocation: card.location,
          sourceSubZone,
          sourceSpellID: card.spellID,
          sourceSeats: Array.from(card.seats, Number)
        })
      }
      // 暂停追踪的对象是明确的正 ID 身份；设置为已知，方便计数器与场上候选视图展示牌面。
      card.confirmKnown()
      this.constraints.suspendKnownCard(card, 'shufflePile:remainingIdentity')
      suspendedCardIDs.push(card.id)
    })

    const playerHandPlaceholderValidationIssues =
      preservedPlayerHandPlaceholderCount > 0
        ? this.validateObservedPlayerHandPlaceholdersForShuffle()
        : []

    const actualPileCount = pile.cards.length
    const rebuiltPileCount = rebuiltPileCards.length
    const discardCountAfterShuffle = discard.cards.length
    const actualPilePlaceholderCount = rebuiltPileCards.filter((card) => card.id === 0).length
    const explainedPileSpaceCount = actualPileCount + suspendedIdentityCards.length

    // 校验点 1：实际牌堆一致性。
    // rebuiltPileCards 是本次写入 pile.replaceAll() 的实体列表；写入后它应与 pile.cards 长度一致，
    // 且 discard 中被洗回的牌应已被 replaceAll() 从弃牌堆移除。
    if (actualPileCount !== rebuiltPileCount || discardCountAfterShuffle !== 0) {
      trackerLogger.warn('洗牌后实际牌堆实体数量不一致', {
        reason: 'shufflePile:actualPileConsistency',
        actualPileCount,
        rebuiltPileCount,
        discardCountAfterShuffle,
        rebuiltPileCardIDs: rebuiltPileCards.map((card) => card.id),
        actualPileCardIDs: pile.cards.map((card) => card.id)
      })
    }

    // 校验点 2：协议牌堆空间解释能力。
    // 协议 cardCount 先按“需要能被实际牌堆 + 暂停追踪的正 ID 暗身份覆盖”校验；
    // 现阶段不要求严格相等，避免把多出的暗身份误迁回实际牌堆。
    if (explainedPileSpaceCount < normalizedCardCount) {
      // 只有当“实际牌堆 + 可解释的正 ID 暗身份”仍少于协议张数时才告警；
      // 这里仍然不创建 id=0，因为缺口已经无法由本局已知身份解释，补占位会制造错误实体。
      trackerLogger.warn('洗牌后可枚举正 ID 仍少于协议牌堆空间张数，未创建 id=0 牌堆占位', {
        reason: 'shufflePile:remainingIdentityShortage',
        cardCount: normalizedCardCount,
        actualPileCount,
        explainedPileSpaceCount,
        knownPileCount: knownPileCards.length,
        pileSpaceRemainingCount: pileSpaceRemainingCards.length,
        neverAppearedCount: neverAppearedCards.length,
        appearedHiddenIdentityCount: appearedHiddenIdentityCards.length,
        rebuiltPileCount,
        knownPileCardIDs: knownPileCards.map((card) => card.id).filter((id) => id > 0),
        neverAppearedCardIDs: neverAppearedCards.map((card) => card.id),
        appearedHiddenIdentityCardIDs: appearedHiddenIdentityCards.map((card) => card.id)
      })
    }

    // 校验点 3：洗牌不新增 id=0 牌堆占位。
    // 如果洗牌前实际牌堆/弃牌堆中已有 id=0，占位会随实际牌一起洗回；
    // 但洗牌流程本身不应为了协议张数创建新的 id=0 并塞入 pile.cards。
    if (actualPilePlaceholderCount > preShufflePilePlaceholderCount) {
      trackerLogger.warn('洗牌后实际牌堆出现新增 id=0 占位', {
        reason: 'shufflePile:unexpectedZeroPlaceholder',
        preShufflePilePlaceholderCount,
        actualPilePlaceholderCount,
        actualPileCardIDs: rebuiltPileCards.map((card) => card.id)
      })
    }

    if (suspendedCardIDs.length > 0) {
      trackerLogger.info('洗牌后暂停追踪非实际牌堆内正 ID 暗身份', {
        cardCount: normalizedCardCount,
        actualPileCardIDs: rebuiltPileCards.map((card) => card.id).filter((id) => id > 0),
        neverAppearedCardIDs: neverAppearedCards.map((card) => card.id),
        appearedHiddenIdentityCardIDs: appearedHiddenIdentityCards.map((card) => card.id),
        visibleKnownCardIDs: visibleKnownCards.map((card) => card.id),
        suspendedCardIDs,
        preservedPlayerPlaceholders,
        playerHandPlaceholderValidationIssues
      })
    }

    // 触发收敛
    this.resolveConstraints()
  }

  preserveUnknownPlaceholderForShuffle(card: Card): Card | null {
    const sourceSubZone = card.subZone ?? 'hand'
    if (card.location !== 'player' || card.isKnown === true) return null

    const placeholder = this.createExternalCards([], 1)[0]
    if (!placeholder) return null

    // 正 ID 将被 confirmKnown()+suspended，不能继续承担玩家区暗槽位；
    // 替身必须继承暂停前实体所在的位置，而不是按玩家手牌缺口另行推导。
    /* prettier-ignore */
    placeholder.bindCandidates(
      Array.from(card.seats),
      sourceSubZone,
      card.spellID,
      { known: false }
    )
    this.movement.replaceHiddenMarkPlaceholder(card, placeholder)
    trackerLogger.info('洗牌暂停正 ID 暗身份时创建 id=0 玩家区占位替身', {
      reason: 'shufflePile:preserveUnknownPlayerPlaceholder',
      sourceCardID: card.id,
      sourceLocation: card.location,
      sourceSubZone,
      sourceSpellID: card.spellID,
      sourceSeats: Array.from(card.seats, Number),
      placeholderCardID: placeholder.id
    })

    return placeholder
  }

  private validateObservedPlayerHandPlaceholdersForShuffle(): PlayerHandPlaceholderValidationIssue[] {
    const issues: PlayerHandPlaceholderValidationIssue[] = []

    this.players.forEach((player, seatID) => {
      if (!player.hasObservedHandCount) return

      const handSlotCounts = this.collectPlayerHandSlotCounts(this.cards, [seatID]).get(seatID)
      const knownCount = handSlotCounts?.knownCount ?? 0
      const candidateCount = handSlotCounts?.candidateCount ?? 0
      const expectedUnknownCount = Math.max(
        0,
        player.observedHandCount - knownCount - candidateCount
      )
      const unknownCards = this.cards.filter(
        (card) =>
          card.location === 'player' &&
          card.subZone === 'hand' &&
          card.isKnown !== true &&
          card.seats.has(seatID)
      )
      const actualUnknownCount = unknownCards.length
      const actualSlotCount = knownCount + candidateCount + actualUnknownCount

      player.refreshUnknownCardCount({ knownCount, candidateCount })
      if (
        actualUnknownCount === expectedUnknownCount &&
        actualSlotCount === player.observedHandCount
      ) {
        return
      }

      issues.push({
        seatID,
        observedHandCount: player.observedHandCount,
        knownCount,
        candidateCount,
        expectedUnknownCount,
        actualUnknownCount,
        actualSlotCount,
        unknownCardIDs: unknownCards.map((card) => card.id)
      })
    })

    if (issues.length > 0) {
      trackerLogger.warn('洗牌后玩家手牌实体槽位与观测手牌数不一致', {
        reason: 'shufflePile:playerHandPlaceholderValidation',
        issues
      })
    }

    return issues
  }

  createConstraintGroup(...args) {
    return (this.constraints.createConstraintGroup as any)(...args)
  }

  collectPlayerHandSlotCounts(
    cards: Card[] = this.cards,
    seatIDs: Iterable<SeatID> = this.players.keys()
  ): Map<SeatID, HandSlotCountSummary> {
    const countsBySeat = new Map<SeatID, HandSlotCountSummary>()
    // E1：调用方可只传需要重算的 seat，避免每轮为所有玩家重复分类同一批 playerCards。
    const targetSeatIDs = Array.from(seatIDs, Number).filter((seatID) => this.players.has(seatID))
    const handSlotCardsBySeat = collectHandSlotCardsBySeat(cards, targetSeatIDs)

    targetSeatIDs.forEach((seatID) => {
      const player = this.players.get(seatID)
      if (!player) return

      const slotCards = handSlotCardsBySeat.get(seatID)
      countsBySeat.set(seatID, {
        knownCount: slotCards?.knownCards.length ?? 0,
        candidateCount: player.getCandidateHandSlotCount(slotCards?.candidateCards ?? []),
        candidateCards: slotCards?.candidateCards ?? []
      })
    })

    return countsBySeat
  }

  private createHandSlotCountResolver(
    playerCards: Card[],
    observedSeatIDs: SeatID[],
    previousTouchedSeats: Set<SeatID> | null,
    handSlotCountsCache: Map<SeatID, HandSlotCountSummary>
  ): (seatID: SeatID) => HandSlotCountSummary | undefined {
    const handSlotCountsBySeat =
      previousTouchedSeats === null
        ? this.collectPlayerHandSlotCounts(playerCards, observedSeatIDs)
        : new Map<SeatID, HandSlotCountSummary>()

    if (previousTouchedSeats === null) {
      handSlotCountsBySeat.forEach((summary, seatID) => {
        handSlotCountsCache.set(seatID, summary)
      })
    }

    return (seatID: SeatID): HandSlotCountSummary | undefined => {
      if (handSlotCountsBySeat.has(seatID)) {
        return handSlotCountsBySeat.get(seatID)
      }

      if (previousTouchedSeats === null) {
        return handSlotCountsCache.get(seatID)
      }

      // 后续轮次只会走到 E2 判定为受影响的 seat，这里按单 seat 懒重算。
      const summary = this.collectPlayerHandSlotCounts(playerCards, [seatID]).get(seatID)
      if (summary) {
        handSlotCountsBySeat.set(seatID, summary)
        handSlotCountsCache.set(seatID, summary)
      }

      return summary ?? handSlotCountsCache.get(seatID)
    }
  }

  /**
   * 执行房间级约束收敛，并同步玩家视图组、模糊明牌索引与计数器。
   * 这里保留三类核心收敛规则；低频的组创建、暂停追踪和列表同步在 RoomConstraints 中实现。
   */
  resolveConstraints(): void {
    let changed = true
    let limit = 100 // 限制循环上限防死锁
    let overbroadKnownCards: Card[] = []
    // E1：收敛循环内复用未触碰 seat 的手牌槽统计；触碰 seat 会按需刷新。
    const handSlotCountsCache = new Map<SeatID, HandSlotCountSummary>()
    // A2：入口读取增量维护的 player 快照（消费上次收敛以来的 dirtyCardEvents）。
    // 非 player 牌不存在陈旧 owner，对约束一/三是严格 no-op；轮内 location 漂移必把
    // changed 置真，由轮末增量刷新兜底。游标断档时 refreshPlayerSnapshot 内部回退全量。
    let playerCards = this.refreshPlayerSnapshot()
    // E2：上一轮触碰座位集；null 表示首轮，约束三无条件处理全部玩家。
    let previousTouchedSeats: Set<SeatID> | null = null
    // 收敛轮数：喂给非终止回归看门狗（正常 ≤2 轮）。
    let rounds = 0

    try {
      while (changed && limit-- > 0) {
        changed = false
        overbroadKnownCards = []
        const touchedSeats = new Set<SeatID>()
        this.resolveTouchedSeats = touchedSeats
        rounds += 1

        // === 约束一：候选席位变化后同步确定拥有者 ===
        recordTraversal('resolveConstraints:constraint1', playerCards.length)
        for (const card of playerCards) {
          changed = card.syncOwnerFromSeats('room:resolveOwner') || changed
          // 判断是否过渡发散 停止追踪
          if (this.constraints.isOverbroadKnownCard(card)) {
            overbroadKnownCards.push(card)
          }
        }

        // === 约束二：局部 ConstraintGroup 收敛 ===
        for (const group of this.constraintGroups.values()) {
          changed = group.resolve() || changed
        }

        // === 约束三：暗牌额度降为 0 时的排他排除 ===
        // E1：首轮只批量计算有观测手牌数的座位；后续轮次按触碰座位懒重算，
        // 未触碰座位复用上一轮缓存，并由 E2 直接跳过。
        const observedSeatIDs = Array.from(this.players.entries())
          .filter(([, player]) => player.hasObservedHandCount)
          .map(([seatID]) => seatID)
        const getHandSlotCounts = this.createHandSlotCountResolver(
          playerCards,
          observedSeatIDs,
          previousTouchedSeats,
          handSlotCountsCache
        )

        for (const [seatID, player] of this.players.entries()) {
          // 座位的 knownCount/candidateCount/排他目标只随触碰它的卡牌变化；
          // 上一轮和本轮至今都未触碰时，重算与排他必是幂等 no-op，直接跳过。
          if (
            previousTouchedSeats &&
            !previousTouchedSeats.has(seatID) &&
            !touchedSeats.has(seatID)
          ) {
            continue
          }

          if (!player.hasObservedHandCount) {
            continue
          }

          const handSlotCounts = getHandSlotCounts(seatID)
          changed = player.refreshUnknownCardCount(handSlotCounts) || changed

          const lockedKnownCount = handSlotCounts?.knownCount ?? 0

          // 只有确定明牌已经占满手牌总数时，才排除该玩家的候选明牌。
          if (player.hasObservedHandCount && player.observedHandCount - lockedKnownCount <= 0) {
            recordTraversal('resolveConstraints:constraint3:exclusion', playerCards.length)
            for (const card of playerCards) {
              if (
                card.location === 'player' &&
                card.hasLocationCandidates?.() &&
                getHandSlotKindForSeat(card, seatID) === 'candidate'
              ) {
                const handLocationCandidates = card
                  .getLocationCandidates()
                  .filter(
                    (candidate) =>
                      candidate.type === 'player' &&
                      candidate.seatID === seatID &&
                      candidate.subZone === 'hand'
                  )

                handLocationCandidates.forEach((candidate) => {
                  changed =
                    card.removeLocationCandidate(candidate, 'room:unknownQuotaExclusion') || changed
                })

                continue
              }

              if (
                card.location === 'player' &&
                card.subZone === 'hand' &&
                // 完整位置候选由 expectedSlotsBySubZone 处理，不参与旧 seats 排除。
                !card.hasSubZoneCandidates?.() &&
                card.seats.size > 1 &&
                card.seats.has(seatID)
              ) {
                changed = card.deleteSeat(seatID, 'room:unknownQuotaExclusion') || changed
              }
            }
          }
        }

        // 匿名实体增减会改变玩家区快照，必须纳入本轮 changed 并重新执行全部约束。
        const anonymousHandChanges = this.reconcileAnonymousHandCards(handSlotCountsCache)
        if (anonymousHandChanges.created.length > 0 || anonymousHandChanges.released.length > 0) {
          changed = true
        }

        previousTouchedSeats = touchedSeats

        // A2：轮内发生变化时增量刷新快照，兜住全部 location 漂移（含轮内新进入 player 的牌）。
        if (changed) {
          playerCards = this.refreshPlayerSnapshot()
        }
      }
    } finally {
      this.resolveTouchedSeats = null
    }

    this.lastResolveRounds = rounds
    if (rounds > this.maxResolveRounds) this.maxResolveRounds = rounds
    // 看门狗：正常收敛 ≤2 轮。轮数异常偏高几乎必然是某处虚报 changed（收敛无不动点），
    // 即 #2 修复的那类非终止 bug；DEV 下告警，硬上限 limit=100 仍兜底。
    if (import.meta.env.DEV && rounds > CONVERGENCE_ROUNDS_WARN) {
      trackerLogger.warn('resolveConstraints 收敛轮数异常偏高，疑似虚报 changed 的非终止回归', {
        rounds,
        constraintGroupCount: this.constraintGroups.size
      })
    }

    this.assertPlayerSnapshotConsistency(playerCards)

    // changed=true 说明本轮可能新增过渡发散明牌，需全量扫描；稳定时只检查本轮收集的集合。
    if (changed) {
      this.constraints.suspendOverbroadKnownCards()
    } else {
      this.constraints.suspendOverbroadKnownCards(overbroadKnownCards)
    }

    // 增量维护区域投影索引；游标断档时 applyDirtyCardEvents 内部回退全量 rebuild。
    // 纯公共区之间的暗牌移动不发脏牌事件，靠 Zone 变更累积的 dirtyPublicZones 补齐。
    this.locationIndex.applyDirtyCardEvents(this, { dirtyPublicZones: this.dirtyPublicZones })
    this.dirtyPublicZones.clear()
    this.assertLocationIndexConsistency()

    // 约束收敛完毕后同步视图物理组排序
    this.constraints.syncViewGroups()

    // 增量维护已知明牌的模糊反查索引；约束组结构变化会影响 source label / membership，
    // 单牌 dirty 事件无法覆盖这些跨牌描述变化，因此只在结构 dirty 时全量回退。
    const constraintGroups = Array.from(this.constraintGroups.values())
    if (this.constraintGroupsDirty) {
      this.ambiguousKnownIndex.rebuild(constraintGroups)
      this.constraintGroupsDirty = false
    } else {
      this.ambiguousKnownIndex.applyDirtyCardEvents(constraintGroups)
    }
    this.assertAmbiguousKnownIndexConsistency()

    // 触发计数器与视图订阅更新
    this.counter.update()

    this.publicZones.assertPublicZoneConsistency('resolveConstraints')
  }

  /**
   * A2：全量重建 player 快照（initDeck seed / 游标断档回退）。
   * 顺序键取 room.cards 下标；后续增量插入沿用同一顺序键，保证与全量 filter 顺序一致。
   */
  rebuildPlayerSnapshot(): Card[] {
    recordTraversal('resolveConstraints:playerSnapshot', this.cards.length)
    this.playerSnapshotOrder = new Map()
    this.playerCardsSnapshot = []
    this.playerCardsSnapshotSet = new Set()
    this.cards.forEach((card, index) => {
      this.playerSnapshotOrder.set(card, index)
      if (card.location === 'player') {
        this.playerCardsSnapshot.push(card)
        this.playerCardsSnapshotSet.add(card)
      }
    })
    this.playerSnapshotSeq = this.dirtyCardSeq
    return this.playerCardsSnapshot
  }

  /**
   * A2：按 dirtyCardEvents 游标增量刷新 player 快照并返回。
   * 成员定义严格等于 `card.location === 'player'`，是 CardLocationIndex 已用同一事件流
   * 追踪的子集；未初始化或游标断档（被 DIRTY_CARD_EVENT_LIMIT splice）时回退全量重建。
   */
  refreshPlayerSnapshot(): Card[] {
    if (this.playerSnapshotSeq < 0) return this.rebuildPlayerSnapshot()

    const events = this.dirtyCardEvents
    // 断档检测：需要的下一条事件已被 splice 掉时无法追平，只能全量回退。
    if (events.length > 0 && events[0].seq > this.playerSnapshotSeq + 1) {
      return this.rebuildPlayerSnapshot()
    }

    const affectedCards = new Set<Card>()
    // 事件按 seq 升序，新事件是连续后缀：逆序遍历，遇已消费事件即停，避免全量扫描缓冲。
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].seq <= this.playerSnapshotSeq) break
      affectedCards.add(events[i].card)
    }

    affectedCards.forEach((card) => {
      const isPlayer = card.location === 'player'
      const inSnapshot = this.playerCardsSnapshotSet.has(card)
      if (isPlayer && !inSnapshot) {
        this.playerCardsSnapshotSet.add(card)
        this.insertPlayerCardOrdered(card)
      } else if (!isPlayer && inSnapshot) {
        this.playerCardsSnapshotSet.delete(card)
        const index = this.playerCardsSnapshot.indexOf(card)
        if (index >= 0) this.playerCardsSnapshot.splice(index, 1)
      }
    })

    recordTraversal('resolveConstraints:playerSnapshotIncremental', affectedCards.size)
    this.playerSnapshotSeq = this.dirtyCardSeq
    return this.playerCardsSnapshot
  }

  /** player 快照排序键：优先取 room.cards 下标，rebuild 后新建的牌用 this.cards 下标兜底。 */
  private orderOfPlayerCard(card: Card): number {
    const existing = this.playerSnapshotOrder.get(card)
    if (existing !== undefined) return existing
    // rebuild 后新建、首次进入 player 的牌（仅 createExternalCards，罕见）：
    // 用 this.cards 实际下标作顺序键，严格对齐全量 filter 顺序，避免同批多张新牌乱序。
    const index = this.cards.indexOf(card)
    const key = index >= 0 ? index : this.cards.length
    this.playerSnapshotOrder.set(card, key)
    return key
  }

  /** 按顺序键把新进入 player 的牌插入快照，保持与 room.cards filter 相同顺序。 */
  private insertPlayerCardOrdered(card: Card): void {
    const key = this.orderOfPlayerCard(card)
    const list = this.playerCardsSnapshot
    let index = list.length
    while (index > 0 && this.orderOfPlayerCard(list[index - 1]) > key) index -= 1
    list.splice(index, 0, card)
  }

  /**
   * 开发期 A2 等价性检查：收敛循环退出时，增量维护的 player 快照
   * 必须与全量过滤结果（含顺序）一致。生产环境零成本。
   */
  assertPlayerSnapshotConsistency(playerCards: Card[]): void {
    if (!import.meta.env.DEV) return

    const freshPlayerCards = this.cards.filter((card) => card.location === 'player')
    const consistent =
      freshPlayerCards.length === playerCards.length &&
      freshPlayerCards.every((card, index) => playerCards[index] === card)

    if (!consistent) {
      trackerLogger.warn('resolveConstraints player 快照与全量过滤结果不一致', {
        snapshotCardIDs: playerCards.map((card) => card.id),
        freshCardIDs: freshPlayerCards.map((card) => card.id)
      })
    }
  }

  /**
   * 开发期一致性检查：增量维护后的 locationIndex 必须与全量 rebuild 影子结果逐桶一致。
   * 仅告警不自愈，便于集成测试在收敛后用同一比对暴露分歧；生产环境零成本。
   */
  assertLocationIndexConsistency(): void {
    if (!import.meta.env.DEV) return

    const shadow = new CardLocationIndex()
    shadow.rebuild(this, { record: false })

    const live = JSON.stringify(this.locationIndex.toComparable(this))
    const expected = JSON.stringify(shadow.toComparable(this))

    if (live !== expected) {
      /* prettier-ignore */
      trackerLogger.warn('locationIndex 增量结果与全量 rebuild 不一致', { reason: 'resolveConstraints:incrementalLocationIndex' })
    }
  }

  /**
   * 开发期一致性检查：增量维护后的 ambiguousKnownIndex 必须与全量 rebuild 影子结果一致。
   */
  assertAmbiguousKnownIndexConsistency(): void {
    if (!import.meta.env.DEV) return

    const groups = Array.from(this.constraintGroups.values())
    const shadow = new AmbiguousKnownIndex(this)
    shadow.rebuild(groups, { record: false })

    const live = JSON.stringify(this.ambiguousKnownIndex.toComparable(this))
    const expected = JSON.stringify(shadow.toComparable(this))

    if (live !== expected) {
      /* prettier-ignore */
      trackerLogger.warn('ambiguousKnownIndex 增量结果与全量 rebuild 不一致', { reason: 'resolveConstraints:incrementalAmbiguousKnownIndex' })
    }
  }

  resumeSuspendedKnownCard(card: Card) {
    return this.constraints.resumeSuspendedKnownCard(card)
  }

  /**
   * 同步外部观测到的玩家手牌总数快照。
   * 该值不是由候选牌反推而来；它只来自协议快照或移动事件，并作为约束输入参与收敛。
   */
  syncObservedPlayerHandCount(
    seatID: SeatID,
    count: number,
    options: { resolve?: boolean } = {}
  ): void {
    const player = this.getPlayer(seatID)
    if (!player) return

    player.syncObservedHandCount(count)
    if (options.resolve !== false) {
      this.resolveConstraints()
    }
  }

  /**
   * 移动卡牌事件的房间级主流程。
   * Room 保留阶段编排，具体阶段逻辑委托给 RoomMovement，便于快速查看协议同步的全貌。
   */
  moveCards(
    cardIDs: CardID[] | CardID,
    toZone: PublicZoneName | 'player',
    opt: MoveOptions = {}
  ): void {
    const context = this.movement.createMoveContext(cardIDs, toZone, opt)

    // trackerLogger.info(
    //   'moveCards 开始',
    //   summarizeMoveContext(context, { includeKnownCardIDs: true })
    // )

    this.movement.applyHandTotalDelta(
      context.sourceHandSeat,
      context.targetHandSeat,
      context.handMoveCount
    )
    this.movement.resolveKnownMoveCards(context)
    this.movement.applyMoveCandidatePropagation(context)
    this.movement.moveUnknownCardsForContext(context)
    this.movement.moveKnownCardsForContext(context)
    this.movement.createPublicMoveConstraintGroup(context)

    // 执行状态收敛
    this.resolveConstraints()

    trackerLogger.info('moveCards 完成', {
      ...summarizeMoveContext(context, { includeKnownCardIDs: true }),
      publicMovedCardIDs: context.publicMovedCards.map((card) => card.id),
      movedUnknownCardIDs: context.movedUnknownCards.map((card) => card.id),
      dirtyCardCount: this.dirtyCards.size,
      constraintGroupCount: this.constraintGroups.size
    })
  }

  /**
   * 销毁房间，释放资源防止内存泄漏
   */
  destroy(): void {
    if (this.game?.room === this) {
      this.game.bindRoom(null)
    }

    trackerLogger.info('Room destroy 开始', {
      cardCount: this.cards.length,
      playerCount: this.players.size,
      constraintGroupCount: this.constraintGroups.size,
      suspendedCount: this.suspendedKnownCards.size
    })

    this.players.forEach((player) => player.reset())
    this.players.clear()
    this.zones.forEach((zone) => zone.clear())
    this.zones.clear()
    this.cards.forEach((card) => card.reset())
    this.constraintGroups.clear()
    this.constraintGroupsDirty = false
    this.maxResolveRounds = 0
    this.lastResolveRounds = 0
    this.moveEventHandlers.clear()
    this.skillState.clear()
    this.ambiguousKnownIndex.items.clear()
    this.ambiguousKnownIndex.containerDependentCards.clear()
    this.ambiguousKnownIndex.lastConsumedSeq = 0
    this.suspendedKnownCards.clear()
    this.dirtyCards.clear()
    this.dirtyCardEvents = []
    this.dirtyCardSeq = 0
    this.dirtyPublicZones.clear()
    this.playerCardsSnapshot = []
    this.playerCardsSnapshotSet = new Set()
    this.playerSnapshotSeq = -1
    this.playerSnapshotOrder = new Map()
    this.cardChangeEvents = []
    this.viewDirty = false
    this.cards = []
    this.cardIndex.clear()
    this.anonymousEntitySeq = -1
    this.isDeckReady = false
    this.seatIDs = []
    this.size = 0
    this.firstID = undefined
    this.mySeatID = undefined
    trackerLogger.info('Room destroy 完成')
  }
}
