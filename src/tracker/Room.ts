import { Card, hasRealIdentity, isAnonymous } from './Card'
import { Player } from './Player'
import { Zone } from './Zone'
import { CardCounter, CARD_INSTANCE_STATUS } from './CardCounter'
import { GameState } from './gameState'
import { AmbiguousKnownIndex } from './AmbiguousKnownIndex'
import { CardLocationIndex } from './CardLocationIndex'
import { PileIdentityLedger, type PileIdentityLedgerMove } from './PileIdentityLedger'
import { normalizePublicPosition } from './candidate/publicCandidate'
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
  PublicPosition,
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
  pileIdentityLedgerEnabled?: boolean
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
  /**
   * 尚未绑定到任何 Card 实体的真实身份，是 deckIdentities 的动态子集。
   * 匿名槽只表达位置与数量；身份首次揭示后从这里移除并写入 cardIndex。
   */
  unlocatedIdentities: Set<CardID> = new Set()
  /**
   * 本局已发现的真实身份全集，用作身份守恒的稳定基准。
   * 初始来自牌组；游戏外首次出现的新身份也会加入，但不会因物化或移动而移除。
   */
  deckIdentities: Set<CardID> = new Set()
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
  declare pileIdentityLedger: PileIdentityLedger
  declare game: GameState
  /** 计数器 */
  declare counter: CardCounter

  /**
   * @param cardIDs - 卡牌的物理 ID 列表，用以初始化卡牌池
   */
  constructor({ gameState = new GameState(), pileIdentityLedgerEnabled = true }: RoomOptions = {}) {
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
    this.pileIdentityLedger = new PileIdentityLedger({
      enabled: pileIdentityLedgerEnabled,
      onWarning(message, detail) {
        trackerLogger.warn(message, detail)
      }
    })

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
    this.unlocatedIdentities = new Set(cardIDs.filter((id) => id > 0))
    this.deckIdentities = new Set(this.unlocatedIdentities)
    this.anonymousEntitySeq = -1

    // 牌堆只保存匿名物理槽，真实身份在揭示前统一留在 unlocatedIdentities。
    const pile = this.zones.get('pile')
    this.zones.forEach((zone) => zone.clear())

    const deckCards: Card[] = []
    for (let index = 0; index < cardIDs.length; index += 1) {
      const card = new Card(0, this)
      this.cards.push(card)
      deckCards.push(card)
    }

    pile.replaceAll(deckCards)
    this.pileIdentityLedger.initialize(cardIDs)

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

  applyPileIdentityMove(
    move: Omit<PileIdentityLedgerMove, 'pileCountAfter' | 'discardCountAfter'>
  ): void {
    try {
      this.pileIdentityLedger.applyMove({
        ...move,
        pileCountAfter: this.zones.get('pile')?.cards.length ?? 0,
        discardCountAfter: this.zones.get('discard')?.cards.length ?? 0
      })
    } catch (error) {
      trackerLogger.warn('牌堆身份账本移动双写失败', { error, move })
    }
  }

  applyPileIdentityReveal(cardIDs: readonly CardID[], location: 'pile' | 'outside'): void {
    try {
      this.pileIdentityLedger.applyReveal({
        cardIDs,
        location,
        pileCountAfter: this.zones.get('pile')?.cards.length ?? 0,
        discardCountAfter: this.zones.get('discard')?.cards.length ?? 0
      })
    } catch (error) {
      trackerLogger.warn('牌堆身份账本揭示双写失败', { error, cardIDs, location })
    }
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
    this.game?.syncRoomSeats(this)

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
   * 按协议端点顺序取得公共区槽位；返回顺序始终是“端点向内”。
   */
  getPublicEndpointCards(zoneID: PublicZoneName, count: number, position: PublicPosition): Card[] {
    const cards = this.zones.get(zoneID)?.cards ?? []
    if (!(count > 0)) return []
    // PublicPosition 兼容数值常量与 'bottom'/'top' 字符串；未归一化的 bottom 必须走牌底。
    if (normalizePublicPosition(position) === 'bottom') return cards.slice(0, count)
    return cards.slice(-count).reverse()
  }

  /**
   * 把手气卡回牌堆等路径上的已定位正 ID 槽真正匿名化：
   * 实体保留在牌堆位置，身份回到 unlocatedIdentities，供后续揭示时再物化。
   *
   * 这是「解绑身份」的唯一原语。materialize、materializeExistingIdentityAtTarget、
   * releaseUnknownPlaceholderToOutside 与洗牌路径全部经由此处，因此身份分区守恒
   * （一个 deckIdentity 必须恰好处于 cardIndex 或 unlocatedIdentities 之一）
   * 只需在这里断言一次。
   *
   * 返回 `null` 表示**未发生任何变更**：入参不是已定位的正 ID 实体，或 cardIndex
   * 与实体不一致。调用方必须处理该情况，不能假定身份已被释放——否则会出现
   * “实体已移出、身份仍被 cardIndex 认为已定位”的漏出（历史上 147 号身份即由此丢失）。
   */
  anonymizeLocatedIdentity(card: Card, reason = 'anonymizeLocatedIdentity'): CardID | null {
    if (!card || !hasRealIdentity(card) || card.id <= 0) return null
    if (this.cardIndex.get(card.id) !== card) return null

    const previousCardID = card.id
    const previousEntityID = card.entityID

    this.cardIndex.delete(previousCardID)
    this.unlocatedIdentities.add(previousCardID)
    this.deckIdentities.add(previousCardID)

    const nextEntityID = this.allocateAnonymousEntityID()
    card.entityID = nextEntityID
    card.setCardInfo(nextEntityID)
    card.isKnown = false
    card.suspended = false
    card.combinationID = null
    card.spellID = null
    // 必须走候选写路径：直接清空 locationCandidates 不会同步 clear owner，
    // seats 在 location 仍为 player 时会回退到旧座位投影。
    card.setLocationCandidates([], `${reason}:candidates`)
    card.clearSeats(`${reason}:seats`)
    card.subZone = null
    this.suspendedKnownCards.delete(card)

    this.notifyCardChanged(card, {
      type: 'card-identity-anonymized',
      previousCardID,
      previousEntityID,
      entityID: nextEntityID,
      reason
    })

    if (this.counter) {
      this.counter.releaseLocatedIdentityToUnknown(card, previousCardID)
    } else {
      this.markCounterDirty(card)
    }

    this.assertIdentityReleased(previousCardID, reason)

    return previousCardID
  }

  /**
   * 身份解绑后的分区守恒断言（开发期，生产零成本）。
   *
   * 解绑完成时该身份必须恰好处于「未定位」一侧：既不能仍被 cardIndex 认为已定位，
   * 也不能从 deckIdentities 中消失。这两种漏出都会让后续洗牌再也找不到该身份。
   */
  private assertIdentityReleased(cardID: CardID, reason: string): void {
    if (!import.meta.env.DEV) return

    const issues: string[] = []
    if (this.cardIndex.has(cardID)) issues.push('still-in-card-index')
    if (!this.unlocatedIdentities.has(cardID)) issues.push('missing-from-unlocated')
    if (!this.deckIdentities.has(cardID)) issues.push('missing-from-deck-identities')

    if (issues.length > 0) {
      trackerLogger.warn('身份解绑后分区守恒被破坏', {
        reason,
        cardID,
        issues
      })
    }
  }

  /**
   * 移除不再承担位置数量的暗占位，同时保住它携带的真实身份。
   *
   * 洗牌后的正 ID 暗实体只表示一次本地身份绑定，并不表示牌面已经公开。
   * 若直接把它移到 outside，cardIndex 仍会认为该身份已定位，但 CardCounter 会把它归为
   * REMOVED，下一次洗牌便无法从“未定位身份”或“暗位置身份”中重新找到它。
   * 因此先把身份退回 unlocatedIdentities，再移出已经多余的匿名物理槽。
   */
  releaseUnknownPlaceholderToOutside(card: Card, reason: string): CardID | null {
    const previousCardID = card.id
    if (previousCardID > 0 && card.isKnown === true) {
      trackerLogger.warn('拒绝将已知正 ID 卡牌按暗占位移出追踪区', {
        reason,
        cardID: previousCardID,
        entityID: card.entityID,
        location: card.location
      })
      return null
    }

    const shouldReleaseIdentity = previousCardID > 0 && card.isKnown !== true
    const releasedIdentityID = shouldReleaseIdentity
      ? this.anonymizeLocatedIdentity(card, `${reason}:releaseIdentity`)
      : null

    if (shouldReleaseIdentity && releasedIdentityID === null) {
      // 索引已经异常时宁可保留一个 suspended 身份，也不能继续移出并永久漏掉该 ID。
      trackerLogger.warn('正 ID 暗占位移出追踪区前释放身份失败，改为暂停身份', {
        reason,
        cardID: previousCardID,
        entityID: card.entityID,
        indexedCardID: this.cardIndex.get(previousCardID)?.id ?? null
      })
      card.confirmKnown()
      this.constraints.suspendKnownCard(card, `${reason}:releaseIdentityFailed`)
      return null
    }

    card.moveToPublicZone('outside')
    if (releasedIdentityID !== null) {
      trackerLogger.info('正 ID 暗占位移出追踪区前已释放身份', {
        reason,
        releasedIdentityID,
        replacementEntityID: card.entityID
      })
    }
    return releasedIdentityID
  }

  private findPublicZoneEntry(card: Card): [PublicZoneName, Zone] | null {
    const zoneID = card.location
    const zone = this.zones.get(zoneID)
    if (!zone || !zone.cards.includes(card)) return null
    return [zoneID, zone]
  }

  /**
   * 将真实身份绑定到匿名槽或正 ID 暗槽，并同步身份守恒账本与查询索引。
   * 已定位身份命中玩家暗槽时，仅允许阶段 1 的旧式暗手牌 interop 纠正槽位；
   * 未定位身份命中公共区正 ID 暗槽时，会在同一物理实体上释放旧身份并物化新身份。
   */
  materialize(cardID: CardID, target: Card | null = null): Card | null {
    const normalizedCardID = Number(cardID)
    if (!(normalizedCardID > 0)) return null

    const existing = this.cardIndex.get(normalizedCardID)
    if (existing) {
      // 洗牌后牌顶可能是 reset() 过的正 ID 暗槽。它与匿名槽一样代表一个可消费的
      // 物理牌堆位置；明摸已有暂停身份时必须占据该槽，不能只移动身份而保留牌堆张数。
      if (target && target !== existing && target.isKnown !== true) {
        this.materializeExistingIdentityAtTarget(existing, target)
      }

      existing.confirmKnown()
      return existing
    }

    if (!target || target.isKnown === true) return null

    const wasDeckIdentity = this.deckIdentities.has(normalizedCardID)
    // 只有初始牌组中尚未定位的身份才能占用洗牌后的正 ID 暗槽。
    // 牌组外首次出现的技能生成牌仍走 createExternal 兜底，不能凭一个 pile 来源字段
    // 挤走已有牌组身份；部分技能/测试会用 pile 作为动画来源但并不消耗真实牌堆槽。
    if (!isAnonymous(target) && !wasDeckIdentity) return null

    // 游戏外首次出现的合法正 ID 不在初始牌组中，发现时扩展身份全集。
    if (!wasDeckIdentity) {
      this.deckIdentities.add(normalizedCardID)
      this.unlocatedIdentities.add(normalizedCardID)
    }

    if (!this.unlocatedIdentities.has(normalizedCardID)) return null

    if (!isAnonymous(target)) {
      // 正 ID 暗槽上的身份只是本地洗牌后随机保留的内部绑定，不代表该身份确定处于此槽。
      // 当另一个 unlocated 身份被协议明确揭示在这里时，两者应交换“已定位/未定位”状态：
      // 旧身份退回 unlocated，新身份复用同一个物理实体。若把旧身份转为 suspended，
      // 每次明摸都会凭本地随机牌序制造新的场上候选（例如 160 挤出 146）。
      if (!this.findPublicZoneEntry(target)) return null

      this.removeCardsFromConstraintGroups([target])
      const displacedIdentityID = this.anonymizeLocatedIdentity(
        target,
        'materialize:replaceHiddenPublicIdentity'
      )
      if (displacedIdentityID === null) return null

      trackerLogger.debug('未定位身份复用正 ID 暗公共槽', {
        cardID: normalizedCardID,
        displacedIdentityID,
        targetEntityID: target.entityID,
        targetLocation: target.location
      })
    }

    target.materializeIdentity(normalizedCardID)
    target.confirmKnown()
    this.cardIndex.set(normalizedCardID, target)
    this.unlocatedIdentities.delete(normalizedCardID)
    this.counter?.addCard(target)

    this.notifyCardChanged(target, {
      type: 'card-identity-materialized',
      cardID: normalizedCardID
    })

    return target
  }

  /**
   * 依次把公开身份物化到公共区端点的匿名槽，保持协议给出的展示顺序。
   */
  materializeAtPublicEndpoint(
    cardIDs: CardID[],
    zoneID: PublicZoneName,
    position: PublicPosition
  ): Card[] {
    const targets = this.getPublicEndpointCards(zoneID, cardIDs.length, position)
    const cardIDSet = new Set(cardIDs.map(Number))
    // 与 moveCards 的公共来源解析保持一致：洗牌后的正 ID 暗槽同样是可消费端点，
    // 但不能让本批明确身份互相充当目标，否则会把同批后一张错误转为 suspended。
    const availableTargets = targets.filter(
      (card) =>
        isAnonymous(card) ||
        (card.id > 0 && card.isKnown !== true && !cardIDSet.has(Number(card.id)))
    )

    return cardIDs
      .map((cardID) => {
        const existing = this.cardIndex.get(cardID)
        const target = existing && targets.includes(existing) ? existing : availableTargets.shift()
        return this.materialize(cardID, target ?? null)
      })
      .filter((card): card is Card => Boolean(card))
  }

  /**
   * 阶段 1 兼容旧式“暗手牌借用真实 ID”模型。
   * 将真实实体放入目标公共槽，并让被替换的匿名槽接管原玩家位置与候选。
   */
  private materializeExistingIdentityAtTarget(existing: Card, target: Card): void {
    if (existing.location === 'player' && existing.isKnown !== true) {
      const oldSubZone = existing.subZone ?? 'hand'
      const oldSeats = Array.from(existing.seats, Number)
      const oldSpellID = existing.spellID
      const oldCombinationID = existing.combinationID
      const oldLocationCandidates = existing.getLocationCandidates()
      const targetZoneEntry = this.findPublicZoneEntry(target)

      if (!targetZoneEntry) return

      const [targetZoneID, targetZone] = targetZoneEntry
      this.removeCardsFromConstraintGroups([target])
      this.constraints.replaceCardInConstraintGroups(existing, target)
      existing.setLocationCandidates([], 'materialize:interop:known')
      existing.combinationID = null
      existing.moveToPublicZone(targetZoneID)
      targetZone.replaceCard(target, existing)

      if (oldLocationCandidates.length > 0) {
        target.location = 'player'
        target.subZone = oldSubZone
        target.spellID = oldSpellID
        target.suspended = false
        target.setLocationCandidates(oldLocationCandidates, 'materialize:interop:placeholder')
        target.setSeats(oldSeats, 'materialize:interop:placeholder')
        target.combinationID = oldCombinationID
        this.markCounterDirty(target)
        this.notifyCardChanged(target, {
          type: 'card-bound',
          subZone: oldSubZone,
          spellID: oldSpellID
        })
      } else {
        target.bindCandidates(oldSeats, oldSubZone, oldSpellID, { known: false })
        target.combinationID = oldCombinationID
      }

      this.movement.replaceHiddenMarkPlaceholder(existing, target)
      return
    }

    // 已知玩家实体（isKnown===true，未命中上面的暗手牌分支）或其它非 outside/suspended
    // 位置命中此处：此时无 interop 可做，直接返回。注意调用方（resolveKnownMoveCards /
    // materializeAtPublicEndpoint）已通过 shift 消费了传入的匿名 target，本分支不会接管它，
    // 该匿名槽会被“浪费”一格；若下游出现匿名目标提前耗尽，应从这里的空操作路径排查。
    if (existing.location !== 'outside' && existing.location !== 'suspended') return

    const targetZoneEntry = this.findPublicZoneEntry(target)
    if (!targetZoneEntry) return

    const [targetZoneID, targetZone] = targetZoneEntry
    const transfersSuspendedRole =
      existing.location === 'suspended' ||
      existing.suspended === true ||
      this.suspendedKnownCards.has(existing)
    const displacedHiddenIdentity = target.id > 0 && target.isKnown !== true
    existing.moveToPublicZone(targetZoneID)
    targetZone.replaceCard(target, existing)
    if (displacedHiddenIdentity && transfersSuspendedRole) {
      // suspended 身份从牌堆再次出现，说明原先分配给它的“场外暗身份名额”仍需由
      // 被挤出的牌堆暗身份承接。这里转移 suspended 角色，随后调用方会恢复 existing，
      // 因而活动 suspended 总数保持不变。
      target.confirmKnown()
      this.constraints.suspendKnownCard(target, 'materialize:displacedHiddenPublicIdentity')
      return
    }

    if (displacedHiddenIdentity) {
      // outside 的已有身份没有 suspended 名额需要转移。被挤身份只需回到 unlocated；
      // 直接以正 ID 移出会让 cardIndex 继续宣称它已定位，并在下次洗牌永久漏掉该身份。
      this.releaseUnknownPlaceholderToOutside(target, 'materialize:displacedHiddenPublicIdentity')
      return
    }

    target.moveToPublicZone('outside')
  }

  /**
   * 为游戏外新出现的牌创建实体；用于回收区、临时区缺失等兜底场景。
   */
  allocateAnonymousEntityID(): number {
    return this.anonymousEntitySeq--
  }

  /**
   * 从游戏外补建实体：正 ID 身份牌和/或匿名占位。
   *
   * 调用场景（节选）：
   * - known 路径物化失败后的缺口补齐（process/pile 等公共区端点没有可 materialize 的匿名槽，
   *   且 cardIndex 尚无该正 ID 时，resolveKnownMoveCards 会 createExternalCards(missingIDs)）
   * - outside/exile 来源的新出现正 ID
   * - 匿名手牌对账、来源占位、洗牌替身等数量守恒兜底
   *
   * 重要语义：
   * - 新建 Card 默认 isKnown=false。正 ID 只表示“牌面身份实体已存在”，不等于“已对玩家公开”。
   * - 若协议路径是 knownIDs / discardKnown，调用方必须在落区前 confirmKnown()；
   *   RoomMovement.resolveKnownMoveCards 尾部已对 knownCards 统一确认，避免正 ID 暗实体进弃牌/处理区；
   *   其中 outside/exile 来源的新正 ID 初始暗状态属于正常过渡；
   *   其它来源的缺口补建虽复用本方法，仍需由 known-fallback 语义单独诊断。
   * - 匿名占位（id/entityID 为负）本就应保持 isKnown=false。
   */
  createExternalCards(cardIDs: CardID[] = [], count = cardIDs.length): Card[] {
    const ids = cardIDs.filter((id) => id > 0)
    const unknownCount = Math.max(0, Number(count) || 0, cardIDs.length) - ids.length

    const cards = [
      ...ids.map((id) => {
        const card = new Card(id, this)
        this.cards.push(card)
        this.deckIdentities.add(card.id)
        this.cardIndex.set(card.id, card)
        this.unlocatedIdentities.delete(card.id)
        return card
      }),
      ...Array.from({ length: unknownCount }, () => {
        const card = new Card(0, this)
        this.cards.push(card)
        return card
      })
    ]

    // 增量索引必须按 room.cards 的创建顺序登记新实体；否则实体首次进入手牌的事件顺序
    // 会成为排序依据，第二次洗牌后的增量桶顺序便可能与全量 rebuild 不同。
    cards.forEach((card) => this.locationIndex.registerCard(card))
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
    const ambiguousHiddenCoverageBySeat = this.constraints.collectAmbiguousHiddenHandCoverage()

    this.players.forEach((player, seatID) => {
      if (!player.hasObservedHandCount) return
      const slotCounts = slotCountsBySeat.get(seatID)
      if ((slotCounts?.candidateCards.length ?? 0) > 0 && slotCounts?.candidateCount === 0) {
        return
      }

      const unknownHandCards = hiddenHandCardsBySeat.get(seatID) ?? []
      const ambiguousHiddenCoverage = ambiguousHiddenCoverageBySeat.get(seatID) ?? 0
      const coveredUnknownCount = unknownHandCards.length + ambiguousHiddenCoverage
      const missingCount = Math.max(0, player.unknownCardCount - coveredUnknownCount)

      if (missingCount > 0) {
        const placeholders = this.createExternalCards([], missingCount)
        placeholders.forEach((card) => {
          card.bindCandidates([seatID], 'hand', null, { known: false })
        })
        created.push(...placeholders)
      }

      let excessCount = Math.max(0, coveredUnknownCount - player.unknownCardCount)
      if (excessCount <= 0) return

      for (const card of unknownHandCards) {
        if (excessCount <= 0) break
        if (!isAnonymous(card)) continue

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
    this.markViewDirty(`public-zone:${zoneID}`)
  }

  markConstraintGroupsDirty(_reason = 'constraint-groups-dirty'): void {
    this.constraintGroupsDirty = true
  }

  deleteConstraintGroup(groupID: string | number): boolean {
    return this.constraintGroups.delete(groupID)
  }

  /**
   * 将牌堆和弃牌堆中的实体牌重置后洗回牌堆。
   * 洗牌时实际牌堆只由“剩余牌堆 + 弃牌堆”组成，不再为了协议张数补匿名占位。
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
    const hasDiscardCards = recycledCards.length > 0

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

    // 只有弃牌堆确实有牌时才是“弃牌堆洗回牌堆”；首次空弃牌堆调用只保留原牌堆，
    // 不应据协议张数把场上身份分类为暂停追踪。
    if (!hasProtocolPileCount || !hasDiscardCards) {
      recycledCards.forEach((card) => card.reset())
      this.removeCardsFromConstraintGroups(remainingPileCards)
      this.removeCardsFromConstraintGroups(recycledCards)

      rebuildPileAfterShuffle()

      // 触发收敛
      this.resolveConstraints()
      return
    }

    // suspendedKnownCards 会跨洗牌保留。后续诊断必须把这些沿用身份和本轮新增身份合并，
    // 不能只报告本轮重新分类出来的卡牌。
    const carriedSuspendedCards = Array.from(this.suspendedKnownCards).filter(
      (card) => card.id > 0 && card.suspended === true
    )

    // 弃牌堆通常远大于剩余牌堆，且它的身份状态本就属于 DISCARD。
    // 分类只需用剩余牌堆中的少量正 ID 排除仍有明确牌堆位置的身份。
    const remainingPileIdentityIDs = new Set(
      remainingPileCards.filter((card) => card.id > 0).map((card) => card.id)
    )
    let preShufflePilePlaceholderCount = remainingPileCards.filter(isAnonymous).length
    const statusIndex = this.counter?.statusIndex
    const statusBuckets = this.counter?.cardsByStatus
    const unknownStatusIdentityIDs = Array.from(statusIndex?.[CARD_INSTANCE_STATUS.UNKNOWN] ?? [])
    const appearedCards = Array.from(statusBuckets?.[CARD_INSTANCE_STATUS.APPEARED] ?? [])
    const candidateIdentityIDs = new Set<CardID>()
    unknownStatusIdentityIDs.forEach((cardID) => candidateIdentityIDs.add(cardID))
    this.unlocatedIdentities.forEach((cardID) => candidateIdentityIDs.add(cardID))

    const suspendedIdentityByID = new Map<CardID, Card>()
    const neverAppearedCards: Card[] = []
    const appearedHiddenIdentityCards: Card[] = []
    const addSuspendedIdentity = (card: Card, target: Card[]) => {
      if (
        card.id <= 0 ||
        card.isKnown === true ||
        remainingPileIdentityIDs.has(card.id) ||
        suspendedIdentityByID.has(card.id)
      ) {
        return
      }

      suspendedIdentityByID.set(card.id, card)
      target.push(card)
    }

    // 未定位身份没有 Card 实体。洗牌后它们仍可能来自“剩余牌堆 + 玩家未知牌”，
    // 需要先创建脱离区域的正 ID 实体，才能沿用暂停追踪与场上候选展示链路。
    candidateIdentityIDs.forEach((cardID) => {
      if (!(cardID > 0) || remainingPileIdentityIDs.has(cardID)) return

      const existing = this.cardIndex.get(cardID)
      if (existing) {
        addSuspendedIdentity(existing, neverAppearedCards)
        return
      }

      if (!this.unlocatedIdentities.has(cardID)) return
      const detachedIdentity = this.createExternalCards([cardID], 1)[0]
      if (detachedIdentity) addSuspendedIdentity(detachedIdentity, neverAppearedCards)
    })

    // CardCounter 的 UNKNOWN/APPEARED 是“位置状态”，不能直接表示“牌面身份是否出现过”。
    // 例如木牛流马里的暗牌实体处于 player/mark，会被 CardCounter 归为 APPEARED，
    // 但它的牌面并未明示，仍应按 neverAppeared 身份处理。
    appearedCards.forEach((card) => {
      addSuspendedIdentity(card, appearedHiddenIdentityCards)
    })
    // suspended 身份在第一次洗牌时会 confirmKnown()，但这只为候选视图提供牌面，
    // 并不代表它已经出现在场上；第二次洗牌不能把这类身份误列为 visible。
    const visibleKnownCards = appearedCards.filter(
      (card) =>
        card.id > 0 &&
        card.isKnown &&
        card.suspended !== true &&
        !this.suspendedKnownCards.has(card)
    )
    // 洗牌不会把这些正 ID 迁入实际牌堆；若它们原本承载玩家区暗槽位，
    // 会按暂停前实体所在的玩家/子区/技能空间创建匿名替身，避免丢失位置数量账本。
    // 正 ID 自身暂停前会 confirmKnown()，表示身份已明确；后续协议再次出现该 ID 时恢复具体位置追踪。
    const suspendedIdentityCards = [...neverAppearedCards, ...appearedHiddenIdentityCards]
    const knownPileCount = remainingPileCards.length + recycledCards.length

    recordTraversal('shufflePile:classify', suspendedIdentityCards.length)

    recycledCards.forEach((card) => {
      if (isAnonymous(card)) preShufflePilePlaceholderCount += 1
      card.reset()
    })
    this.removeCardsFromConstraintGroups(remainingPileCards)
    this.removeCardsFromConstraintGroups(recycledCards)
    this.removeCardsFromConstraintGroups(suspendedIdentityCards)

    // 实际牌堆只重建 pile + discard。协议张数仅用于判断哪些正 ID 身份应暂停，
    // 不再为了“凑长度”向 pile.cards 填入匿名占位或玩家暗手牌实体。
    const rebuiltPileCards = rebuildPileAfterShuffle()

    const newlySuspendedCardIDs: CardID[] = []
    const preservedPlayerPlaceholders: PreservedPlayerPlaceholderSummary[] = []
    let preservedPlayerHandPlaceholderCount = 0
    suspendedIdentityCards.forEach((card) => {
      // 正 ID 暂停前若仍承担玩家区暗槽位，必须先按实体当前位置复制匿名替身；
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
      newlySuspendedCardIDs.push(card.id)
    })

    // newlySuspendedCardIDs 只描述本轮新分类结果；面板与数量守恒需要使用
    // “上一轮仍未恢复 + 本轮新增”的完整活动集合。
    const activeSuspendedCards = Array.from(this.suspendedKnownCards).filter(
      (card) => card.id > 0 && card.suspended === true
    )
    const activeSuspendedCardIDs = activeSuspendedCards.map((card) => card.id)
    const activeSuspendedCardSet = new Set(activeSuspendedCards)
    const carriedSuspendedCardIDs = carriedSuspendedCards
      .filter((card) => activeSuspendedCardSet.has(card))
      .map((card) => card.id)

    const playerHandPlaceholderValidationIssues =
      preservedPlayerHandPlaceholderCount > 0
        ? this.validateObservedPlayerHandPlaceholdersForShuffle()
        : []

    const actualPileCount = pile.cards.length
    const rebuiltPileCount = rebuiltPileCards.length
    const discardCountAfterShuffle = discard.cards.length
    const actualPilePlaceholderCount = rebuiltPileCards.filter(isAnonymous).length
    // 这是“协议牌堆空间”的解释数量，不是实际 pile.cards。第二次及后续洗牌必须包含
    // 上一轮仍未恢复的暂停身份，否则日志会把完整活动集合误报成本轮新增子集。
    const pileSpaceRemainingCount = knownPileCount + activeSuspendedCards.length
    const explainedPileSpaceCount = actualPileCount + activeSuspendedCards.length

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
      // 这里仍然不创建匿名占位，因为缺口已经无法由本局已知身份解释，补占位会制造错误实体。
      trackerLogger.warn('洗牌后可枚举正 ID 仍少于协议牌堆空间张数，未创建匿名牌堆占位', {
        reason: 'shufflePile:remainingIdentityShortage',
        cardCount: normalizedCardCount,
        actualPileCount,
        explainedPileSpaceCount,
        knownPileCount,
        pileSpaceRemainingCount,
        neverAppearedCount: neverAppearedCards.length,
        appearedHiddenIdentityCount: appearedHiddenIdentityCards.length,
        rebuiltPileCount,
        carriedSuspendedCardIDs,
        newlySuspendedCardIDs,
        activeSuspendedCardIDs,
        knownPileCardIDs: [
          ...remainingPileCards.map((card) => card.id).filter((id) => id > 0),
          ...recycledCards.map((card) => card.id).filter((id) => id > 0)
        ],
        neverAppearedCardIDs: neverAppearedCards.map((card) => card.id),
        appearedHiddenIdentityCardIDs: appearedHiddenIdentityCards.map((card) => card.id)
      })
    }

    // 校验点 3：洗牌不新增匿名牌堆占位。
    // 如果洗牌前实际牌堆/弃牌堆中已有匿名占位，它会随实际牌一起洗回；
    // 但洗牌流程本身不应为了协议张数创建新的匿名占位并塞入 pile.cards。
    if (actualPilePlaceholderCount > preShufflePilePlaceholderCount) {
      trackerLogger.warn('洗牌后实际牌堆出现新增匿名占位', {
        reason: 'shufflePile:unexpectedZeroPlaceholder',
        preShufflePilePlaceholderCount,
        actualPilePlaceholderCount,
        actualPileCardIDs: rebuiltPileCards.map((card) => card.id)
      })
    }

    if (activeSuspendedCardIDs.length > 0) {
      // suspendedCardIDs 保持“当前完整集合”的直观语义，另外两个字段只负责解释其来源。
      trackerLogger.info('洗牌后暂停追踪非实际牌堆内正 ID 暗身份', {
        cardCount: normalizedCardCount,
        actualPileCardIDs: rebuiltPileCards.map((card) => card.id).filter((id) => id > 0),
        neverAppearedCardIDs: neverAppearedCards.map((card) => card.id),
        appearedHiddenIdentityCardIDs: appearedHiddenIdentityCards.map((card) => card.id),
        visibleKnownCardIDs: visibleKnownCards.map((card) => card.id),
        suspendedCardIDs: activeSuspendedCardIDs,
        carriedSuspendedCardIDs,
        newlySuspendedCardIDs,
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
    trackerLogger.info('洗牌暂停正 ID 暗身份时创建匿名玩家区占位替身', {
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

    this.assertConservation('resolveConstraints')
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
  /**
   * 开发期身份与槽位守恒观测：阶段 0 只告警，不抛错、不自愈。
   * I1 检查真实身份与 cardIndex 的唯一性；I2 复用公共区实体槽位一致性检查。
   */
  assertConservation(context = ''): void {
    if (!import.meta.env.DEV) return

    const cardsSet = new Set(this.cards)
    const entityOwnerByID = new Map<number, Card>()
    const realCardsByID = new Map<number, Card[]>()
    const identityIssues: Record<string, unknown>[] = []

    this.cards.forEach((card) => {
      const previousEntity = entityOwnerByID.get(card.entityID)
      if (previousEntity) {
        identityIssues.push({
          type: 'duplicated-entity-id',
          entityID: card.entityID,
          cardIDs: [previousEntity.id, card.id]
        })
      } else {
        entityOwnerByID.set(card.entityID, card)
      }

      if (hasRealIdentity(card)) {
        const realCards = realCardsByID.get(card.id) ?? []
        realCards.push(card)
        realCardsByID.set(card.id, realCards)

        if (card.entityID !== card.id) {
          identityIssues.push({
            type: 'real-card-entity-mismatch',
            cardID: card.id,
            entityID: card.entityID
          })
        }

        if (this.cardIndex.get(card.id) !== card) {
          identityIssues.push({
            type: 'card-index-mismatch',
            cardID: card.id,
            cardEntityID: card.entityID
          })
        }
        return
      }

      if (card.id !== card.entityID || card.entityID >= 0) {
        identityIssues.push({
          type: 'anonymous-card-identity-mismatch',
          cardID: card.id,
          entityID: card.entityID
        })
      }
    })

    realCardsByID.forEach((cards, cardID) => {
      if (cards.length <= 1) return
      identityIssues.push({
        type: 'duplicated-real-id',
        cardID,
        entityIDs: cards.map((card) => card.entityID)
      })
    })

    this.cardIndex.forEach((card, cardID) => {
      if (
        !hasRealIdentity(card) ||
        card.id !== cardID ||
        !cardsSet.has(card) ||
        card.entityID !== cardID
      ) {
        identityIssues.push({
          type: 'invalid-card-index-entry',
          cardID,
          entityID: card.entityID,
          cardIsTracked: cardsSet.has(card)
        })
      }
    })

    this.deckIdentities.forEach((cardID) => {
      const located = this.cardIndex.has(cardID)
      const unlocated = this.unlocatedIdentities.has(cardID)
      if (located === unlocated) {
        identityIssues.push({
          type: located ? 'identity-both-located-and-unlocated' : 'identity-missing',
          cardID
        })
      }
    })

    this.unlocatedIdentities.forEach((cardID) => {
      if (cardID <= 0 || !this.deckIdentities.has(cardID)) {
        identityIssues.push({
          type: 'invalid-unlocated-identity',
          cardID
        })
      }
    })

    const slotIssues = this.publicZones.getPublicZoneConsistencyIssues()
    const issues = [
      ...identityIssues.map((issue) => ({ domain: 'identity', ...issue })),
      ...slotIssues.map((issue) => ({ domain: 'slot', ...issue }))
    ]

    if (issues.length > 0) {
      trackerLogger.warn('Room 身份/槽位守恒观测发现不一致', {
        context,
        issues
      })
    }
  }

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
    // 整手完整揭示时先把木马/标记弱候选反向收敛（并挤回被占用的手牌占位），
    // 必须早于 resolveKnownMoveCards，否则匿名槽数量已错、明牌会被 createExternal。
    this.movement.resolveHiddenMarkCandidatesFromFullHandReveal(context)
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
    this.unlocatedIdentities.clear()
    this.deckIdentities.clear()
    this.anonymousEntitySeq = -1
    this.isDeckReady = false
    this.seatIDs = []
    this.size = 0
    this.firstID = undefined
    this.mySeatID = undefined
    trackerLogger.info('Room destroy 完成')
  }
}
