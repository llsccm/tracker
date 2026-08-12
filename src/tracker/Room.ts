import { Card, hasRealIdentity, isAnonymous } from './Card'
import { Player } from './Player'
import { Zone } from './Zone'
import { CardCounter } from './CardCounter'
import { GameState } from './Game'
import { AmbiguousKnownIndex } from './AmbiguousKnownIndex'
import { CardLocationIndex } from './CardLocationIndex'
import {
  PileIdentityLedger,
  type PileIdentityConsistencyIssue,
  type AmbiguousDiscardRecycleGroup,
  type PileIdentityLedgerMove,
  type PileIdentityRevealLocation,
  type PileIdentityShuffleTransition
} from './PileIdentityLedger'
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
}

interface HandSlotCountSummary {
  knownCount: number
  candidateCount: number
  candidateCards: Card[]
}

interface AnonymizeLocatedIdentityOptions {
  preservePlacement?: boolean
}

interface PendingDiscardGain {
  seatID: SeatID
  cards: Card[]
  sourceEvent?: MoveOptions['sourceEvent']
}

export type PendingDiscardGainSettlementResult = 'settled' | 'duplicate' | 'missing' | 'invalid'

export interface PendingDiscardGainSettlement {
  /** pending 是否完成结算；`missing` 由调用方走普通明牌同步，`invalid` 不推进状态。 */
  result: PendingDiscardGainSettlementResult
  /** 相对于结算前有效快照的新增身份；快照推进后调用方不能再重新计算该差量。 */
  newCardIDs: CardID[]
}

/**
 * 3709 上报的是“当前仍持有的身份集合”，不是只追加的事件日志。这里按集合求差，
 * 只返回本次快照中新出现的身份；旧牌删除和列表顺序变化均由通用移动路径处理。
 */
function diffGuiFuRevealSnapshot(
  previousCardIDs: readonly CardID[],
  receivedCardIDs: readonly CardID[]
): CardID[] {
  const previousCardIDSet = new Set(previousCardIDs)
  return receivedCardIDs.filter((cardID) => !previousCardIDSet.has(cardID))
}

interface ShufflePileOptions {
  cardCount?: number | null
  /** Controller 归一化后的同一条洗牌事件，由 Room 在物理重建前提交给身份账本。 */
  identityMove?: Omit<PileIdentityLedgerMove, 'pileCountAfter' | 'discardCountAfter'>
  ambiguousDiscardRecycleGroups?: readonly AmbiguousDiscardRecycleGroup[]
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
  /** 3709 等待相邻角色数据提供 CardID 的匿名手牌 FIFO。 */
  declare pendingDiscardGains: PendingDiscardGain[]
  /** 3709 最近一次已接受的当前角色数据快照，按座位保留一份用于识别旧尾部和重复通知。 */
  declare guiFuRevealSnapshots: Map<SeatID, CardID[]>
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
    this.pendingDiscardGains = []
    this.guiFuRevealSnapshots = new Map()

    // 7. 挂载 Room 行为模块，保留 Room 作为稳定公开入口
    this.publicZones = new RoomPublicZones(this)
    this.constraints = new RoomConstraints(this)
    this.movement = new RoomMovement(this)
    this.pileIdentityLedger = new PileIdentityLedger({
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
    this.pendingDiscardGains = []
    this.guiFuRevealSnapshots.clear()

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
    this.assertPileIdentityLedgerConsistency('initDeck')

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
      const context = `move:${move.eventType}`
      this.pileIdentityLedger.applyMove({
        ...move,
        pileCountAfter: this.zones.get('pile')?.cards.length ?? 0,
        discardCountAfter: this.zones.get('discard')?.cards.length ?? 0
      })
      this.anonymizePileCohortIdentityEntities(context)
      this.assertPileIdentityLedgerConsistency(context)
    } catch (error) {
      trackerLogger.warn('牌堆身份账本移动更新失败', { error, move })
    }
  }

  registerAmbiguousOutsideIdentityGroup(cardIDs: readonly CardID[]): void {
    this.pileIdentityLedger.registerAmbiguousOutsideGroup(cardIDs)
  }

  /**
   * 将 ledger 已释放回 cohort 的牌堆身份同步投影成匿名物理槽。
   *
   * 典型场景是已知牌被随机混入牌堆：ledger 只能把身份放回 cohort，而 Room 的物理槽也
   * 必须同步解绑正 ID。无 CardIDs 的 MoveType=18 不走该转换，它只消费匿名槽并保留全部
   * knownPileIdentityIDs。
   *
   * 这里严格限制为“当前仍在物理牌堆”与“最终 cohort 身份”的交集。玩家区、mark、discard
   * 或 suspended 实体不在本方法中自动修复，避免把其它移动错误误判成牌堆投影更新。
   */
  private anonymizePileCohortIdentityEntities(context: string): CardID[] {
    const pile = this.zones.get('pile')
    if (!pile) return []

    const cohortIdentityIDs = new Set(this.pileIdentityLedger.getUnresolvedIdentityIDs())
    if (cohortIdentityIDs.size === 0) return []

    const anonymizedIdentityIDs: CardID[] = []
    pile.cards.slice().forEach((card) => {
      const cardID = card.id
      if (!(cardID > 0) || !cohortIdentityIDs.has(cardID)) return

      const releasedIdentityID = this.anonymizeLocatedIdentity(
        card,
        `${context}:cohortPileProjection`
      )
      if (releasedIdentityID === null) {
        trackerLogger.warn('牌堆 cohort 身份投影匿名化失败', {
          context,
          cardID,
          entityID: card.entityID,
          location: card.location
        })
        return
      }

      anonymizedIdentityIDs.push(releasedIdentityID)
    })

    if (anonymizedIdentityIDs.length > 0) {
      trackerLogger.debug('牌堆 cohort 身份已投影为匿名槽', {
        context,
        cardIDs: anonymizedIdentityIDs
      })
    }

    return anonymizedIdentityIDs
  }

  /**
   * 将明牌同步后的实体位置投影给身份账本。
   *
   * `outside` 不是协议区名，而是“确认已离开牌堆和弃牌堆”的账本语义；公共区展示
   * 可能因为实体仍在 discard/process 而跳过物理搬运，所以这里必须依据同步后的实际
   * Card.location 分组，不能把所有非 pile 调用统一标成 outside。
   * 第二参数仅作为实体尚未物化时的兼容提示；一旦 Card 存在，实际位置始终优先。
   */
  applyPileIdentityReveal(cardIDs: readonly CardID[], location?: PileIdentityRevealLocation): void {
    try {
      const normalizedCardIDs = cardIDs.map(Number).filter((cardID) => cardID > 0)
      // 保持固定分组顺序，便于每个账本事务独立对账并输出稳定的诊断上下文。
      const revealGroups: [PileIdentityRevealLocation, CardID[]][] = [
        ['pile', []],
        ['discard', []],
        ['outside', []]
      ]
      const groupByLocation = new Map(revealGroups)
      normalizedCardIDs.forEach((cardID) => {
        const actualLocation = this.cardIndex.get(cardID)?.location
        // 协议目标只是“在哪里展示”，不一定触发物理搬运；同步完成后的 Card.location
        // 才能证明该身份是否仍在弃牌堆，并决定洗牌时是否继续计入已知弃牌身份。
        const revealLocation: PileIdentityRevealLocation | undefined =
          actualLocation === 'pile'
            ? 'pile'
            : actualLocation === 'discard'
              ? 'discard'
              : actualLocation
                ? 'outside'
                : location
        if (!revealLocation) {
          // 没有实体也没有调用方位置证据时，跳过比猜成 outside 更安全；解析入口已有缺失诊断。
          return
        }
        groupByLocation.get(revealLocation)!.push(cardID)
      })

      for (const [revealLocation, groupedCardIDs] of revealGroups) {
        if (groupedCardIDs.length === 0) continue
        this.pileIdentityLedger.applyReveal({
          cardIDs: groupedCardIDs,
          location: revealLocation,
          pileCountAfter: this.zones.get('pile')?.cards.length ?? 0,
          discardCountAfter: this.zones.get('discard')?.cards.length ?? 0
        })
        this.assertPileIdentityLedgerConsistency(`reveal:${revealLocation}`)
      }
    } catch (error) {
      trackerLogger.warn('牌堆身份账本揭示更新失败', { error, cardIDs, location })
    }
  }

  /**
   * 取得 3709 当前角色数据相对于上次快照的新增 CardID。
   *
   * 旧身份可以从列表中删除，列表顺序变化也不影响差量识别。该方法只读，供没有弃牌堆
   * pending 时的兼容回退使用；真正接受快照仍由 settlePendingDiscardGain 完成。
   */
  getGuiFuRevealDelta(seatID: SeatID, cardIDs: readonly CardID[]): CardID[] {
    const normalizedSeatID = Number(seatID)
    const normalizedCardIDs = cardIDs.map(Number)
    if (
      !Number.isInteger(normalizedSeatID) ||
      normalizedSeatID === 255 ||
      normalizedCardIDs.length === 0 ||
      normalizedCardIDs.some((cardID) => !Number.isInteger(cardID) || cardID <= 0) ||
      new Set(normalizedCardIDs).size !== normalizedCardIDs.length
    ) {
      return []
    }

    const previousCardIDs = this.getActiveGuiFuRevealSnapshot(normalizedSeatID)
    if (!previousCardIDs) return normalizedCardIDs
    return diffGuiFuRevealSnapshot(previousCardIDs, normalizedCardIDs)
  }

  private getActiveGuiFuRevealSnapshot(seatID: SeatID): CardID[] | undefined {
    const snapshot = this.guiFuRevealSnapshots.get(seatID)
    if (!snapshot) return undefined

    // 快照中的旧牌可能已通过普通移动离开手牌；过滤后再求差，允许同一身份日后重新获得。
    return snapshot.filter((cardID) => {
      const card = this.cardIndex.get(cardID)
      return card?.location === 'player' && card.subZone === 'hand' && card.seats.has(seatID)
    })
  }

  /**
   * 判断角色数据前是否已经出现未登记进弃牌 FIFO 的匿名手牌槽。
   *
   * 仅“身份仍在 unlocatedIdentities”不足以证明它来自牌堆，因为任意尚未出现的牌都满足
   * 该条件；额外匿名槽才是非弃牌来源移动已经发生的物理证据。这样既允许牌堆获得与
   * discard pending 交错，又不会把没有对应手牌槽的错误 CardID 当作合法回退。
   */
  private hasUntrackedGuiFuAnonymousHandSlots(seatID: SeatID, requiredCount: number): boolean {
    if (requiredCount <= 0) return false

    const pendingCards = new Set(
      this.pendingDiscardGains
        .filter((pending) => pending.seatID === seatID)
        .flatMap((pending) => pending.cards)
    )
    let availableCount = 0
    for (const card of this.refreshPlayerSnapshot()) {
      if (
        card.subZone !== 'hand' ||
        card.seats.has(seatID) !== true ||
        !isAnonymous(card) ||
        pendingCards.has(card)
      ) {
        continue
      }

      availableCount += 1
      if (availableCount >= requiredCount) return true
    }

    return false
  }

  /**
   * 记录“已用匿名手牌占位、等待角色数据确认弃牌身份”的一次获得。
   *
   * 当前只由 3709 使用。第一条移动不消费弃牌堆；FIFO 只保存后续需要替换的匿名
   * 手牌实体。牌堆来源的同技能移动不会进入该 FIFO，因此角色数据到达前允许两类来源交错。
   */
  registerPendingDiscardGain(
    seatID: SeatID,
    cards: readonly Card[],
    sourceEvent?: MoveOptions['sourceEvent']
  ): boolean {
    const normalizedSeatID = Number(seatID)
    const uniqueCards = Array.from(new Set(cards)).filter(Boolean)
    if (
      !Number.isInteger(normalizedSeatID) ||
      normalizedSeatID === 255 ||
      uniqueCards.length === 0 ||
      uniqueCards.length !== cards.length
    ) {
      trackerLogger.warn('诡伏匿名获得未进入待结算 FIFO：座位或匿名槽无效', {
        seatID,
        cardCount: cards.length,
        uniqueCardCount: uniqueCards.length,
        sourceEvent
      })
      return false
    }

    const hasInvalidCard = uniqueCards.some(
      (card) =>
        card.location !== 'player' ||
        card.subZone !== 'hand' ||
        card.seats.has(normalizedSeatID) !== true ||
        !isAnonymous(card)
    )
    if (hasInvalidCard) {
      trackerLogger.warn('诡伏匿名获得未进入待结算 FIFO：手牌占位状态不完整', {
        seatID: normalizedSeatID,
        cardIDs: uniqueCards.map((card) => card.id),
        cards: uniqueCards.map((card) => ({
          id: card.id,
          entityID: card.entityID,
          location: card.location,
          subZone: card.subZone,
          isKnown: card.isKnown,
          seats: Array.from(card.seats, Number)
        })),
        sourceEvent
      })
      return false
    }

    if (this.pendingDiscardGains.length > 0) {
      const head = this.pendingDiscardGains[0]
      trackerLogger.warn('诡伏移动与角色数据未相邻，待结算 FIFO 已出现积压', {
        pendingCount: this.pendingDiscardGains.length,
        headSeatID: head.seatID,
        headCardCount: head.cards.length,
        nextSeatID: normalizedSeatID,
        nextCardCount: uniqueCards.length,
        headSourceEvent: head.sourceEvent,
        sourceEvent
      })
    }

    this.pendingDiscardGains.push({
      seatID: normalizedSeatID,
      cards: uniqueCards,
      sourceEvent
    })
    return true
  }

  /**
   * 以 3709 角色数据结算前置匿名弃牌获得。
   *
   * 角色数据是按座位维护的当前快照，不是只描述本次移动。只消费快照中尚未确认的
   * 新 CardID，并按 FIFO 顺序替换匿名手牌占位；pending 顺序异常时保留状态并告警。
   *
   * 返回值同时携带结算前求出的 newCardIDs：`missing` 会接受并推进快照，再由调用方用
   * 这份差量走普通手牌揭示；`invalid` 则既不消费 FIFO，也不接受本次快照。
   */
  settlePendingDiscardGain(
    seatID: SeatID,
    cardIDs: readonly CardID[],
    sourceEvent?: MoveOptions['sourceEvent']
  ): PendingDiscardGainSettlement {
    const normalizedSeatID = Number(seatID)
    const normalizedCardIDs = cardIDs.map(Number)
    if (
      !Number.isInteger(normalizedSeatID) ||
      normalizedSeatID === 255 ||
      normalizedCardIDs.length === 0 ||
      normalizedCardIDs.some((cardID) => !Number.isInteger(cardID) || cardID <= 0) ||
      new Set(normalizedCardIDs).size !== normalizedCardIDs.length
    ) {
      return { result: 'invalid', newCardIDs: [] }
    }

    const previousCardIDs = this.getActiveGuiFuRevealSnapshot(normalizedSeatID) ?? []
    const newCardIDs = diffGuiFuRevealSnapshot(previousCardIDs, normalizedCardIDs)
    const pending = this.pendingDiscardGains[0]
    if (!pending) {
      this.guiFuRevealSnapshots.set(normalizedSeatID, normalizedCardIDs.slice())
      if (newCardIDs.length === 0) return { result: 'duplicate', newCardIDs }

      // 兼容前置移动缺失或牌堆来源的角色数据；调用方随后只回退同步 newCardIDs。
      return { result: 'missing', newCardIDs }
    }

    if (newCardIDs.length === 0) {
      this.guiFuRevealSnapshots.set(normalizedSeatID, normalizedCardIDs.slice())
      return { result: 'duplicate', newCardIDs }
    }

    // pending 只登记弃牌堆来源。如果新增身份仍未定位，且手中确有不属于 FIFO 的额外匿名槽，
    // 则牌堆获得已经与 discard pending 交错；保留 FIFO，并交给普通明牌路径物化这些身份。
    const hasUnlocatedSourceIDs = newCardIDs.every((cardID) => this.unlocatedIdentities.has(cardID))
    if (
      hasUnlocatedSourceIDs &&
      this.hasUntrackedGuiFuAnonymousHandSlots(normalizedSeatID, newCardIDs.length)
    ) {
      this.guiFuRevealSnapshots.set(normalizedSeatID, normalizedCardIDs.slice())
      return { result: 'missing', newCardIDs }
    }

    if (pending.seatID !== normalizedSeatID) {
      trackerLogger.warn('诡伏角色数据与待结算 FIFO 队首座位不一致', {
        pendingSeatID: pending.seatID,
        receivedSeatID: normalizedSeatID,
        pendingCardCount: pending.cards.length,
        receivedCardCount: normalizedCardIDs.length,
        cardIDs: normalizedCardIDs,
        pendingSourceEvent: pending.sourceEvent,
        sourceEvent
      })
      return { result: 'invalid', newCardIDs }
    }

    const discard = this.zones.get('discard')
    const sourceCards = newCardIDs.map((cardID) => this.cardIndex.get(cardID))
    const hasInvalidSource = sourceCards.some(
      (card) =>
        !card ||
        card.location !== 'discard' ||
        card.isKnown !== true ||
        discard?.cards.includes(card) !== true
    )
    if (!discard || hasInvalidSource) {
      trackerLogger.warn('诡伏弃牌堆来源角色数据中的身份无法定位，待结算 FIFO 保持不变', {
        seatID: normalizedSeatID,
        cardIDs: newCardIDs,
        sourceCards: sourceCards.map((card, index) => ({
          cardID: newCardIDs[index],
          entityID: card?.entityID ?? null,
          location: card?.location ?? null,
          isKnown: card?.isKnown === true,
          inDiscard: card ? discard?.cards.includes(card) === true : false
        })),
        pendingSourceEvent: pending.sourceEvent,
        sourceEvent
      })
      return { result: 'invalid', newCardIDs }
    }

    const allocations: {
      pending: PendingDiscardGain
      cards: Card[]
      cardIDs: CardID[]
    }[] = []
    // 先完成整段 FIFO 的配额规划和状态校验，再统一修改实体；任何 invalid 都不会留下半结算状态。
    let allocatedCount = 0
    for (const candidate of this.pendingDiscardGains) {
      if (allocatedCount >= newCardIDs.length) break

      if (candidate.seatID !== normalizedSeatID) {
        trackerLogger.warn('诡伏角色数据与待结算 FIFO 队列顺序不一致', {
          pendingSeatID: candidate.seatID,
          receivedSeatID: normalizedSeatID,
          pendingCardCount: candidate.cards.length,
          receivedCardCount: newCardIDs.length,
          cardIDs: newCardIDs,
          pendingSourceEvent: candidate.sourceEvent,
          sourceEvent
        })
        return { result: 'invalid', newCardIDs }
      }

      const count = Math.min(candidate.cards.length, newCardIDs.length - allocatedCount)
      if (count <= 0) continue

      const cards = candidate.cards.slice(0, count)
      const hasInvalidCard = cards.some(
        (card) =>
          card.location !== 'player' ||
          card.subZone !== 'hand' ||
          card.seats.has(normalizedSeatID) !== true ||
          !isAnonymous(card)
      )
      if (hasInvalidCard) {
        trackerLogger.warn('诡伏待结算 FIFO 已不再对应匿名手牌槽', {
          seatID: normalizedSeatID,
          cardIDs: newCardIDs,
          pendingCards: candidate.cards.map((card) => ({
            id: card.id,
            entityID: card.entityID,
            location: card.location,
            subZone: card.subZone,
            isKnown: card.isKnown,
            seats: Array.from(card.seats, Number)
          })),
          pendingSourceEvent: candidate.sourceEvent,
          sourceEvent
        })
        return { result: 'invalid', newCardIDs }
      }

      allocations.push({
        pending: candidate,
        cards,
        cardIDs: newCardIDs.slice(allocatedCount, allocatedCount + count)
      })
      allocatedCount += count
    }

    if (allocatedCount !== newCardIDs.length) {
      trackerLogger.warn('诡伏角色数据新增身份超过待结算 FIFO 槽位', {
        seatID: normalizedSeatID,
        pendingCardCount: this.pendingDiscardGains.reduce(
          (count, item) => count + item.cards.length,
          0
        ),
        receivedCardCount: newCardIDs.length,
        cardIDs: newCardIDs,
        pendingSourceEvent: pending.sourceEvent,
        sourceEvent
      })
      return { result: 'invalid', newCardIDs }
    }

    allocations.forEach(({ pending: allocation, cards, cardIDs: allocatedCardIDs }) => {
      const allocationSpellID = cards[0]?.spellID ?? null
      this.removeCardsFromConstraintGroups(cards)
      cards.forEach((card) => card.moveToPublicZone('outside'))

      // allocatedCardIDs 与本次 cards 切片一一对应。前置移动已经增加手牌总数；这里仅用
      // 真实弃牌实体替换这些匿名手牌槽，因此 handMoveCount 必须保持为 0。
      this.moveCards(allocatedCardIDs, 'player', {
        seatID: normalizedSeatID,
        fromZone: 'discard',
        subZone: 'hand',
        spellID: allocationSpellID,
        cardCount: allocatedCardIDs.length,
        handMoveCount: 0,
        moveType: allocation.sourceEvent?.moveType,
        sourceEvent: sourceEvent ?? allocation.sourceEvent
      })

      this.applyPileIdentityMove({
        eventType: 'moveKnown',
        fromZone: 2,
        toZone: 5,
        cardIDs: allocatedCardIDs,
        cardCount: allocatedCardIDs.length,
        pileCountBefore: this.zones.get('pile')?.cards.length ?? 0,
        moveType: allocation.sourceEvent?.moveType,
        spellID: allocationSpellID
      })
      allocation.cards.splice(0, cards.length)
    })

    this.guiFuRevealSnapshots.set(normalizedSeatID, normalizedCardIDs.slice())
    while (this.pendingDiscardGains[0]?.cards.length === 0) {
      this.pendingDiscardGains.shift()
    }
    return { result: 'settled', newCardIDs }
  }

  /**
   * 在物理 Room 与身份 ledger 都完成一次协议事务后检查最终目标态。
   *
   * 这里刻意不挂到 `resolveConstraints()`：卡牌移动先于 Controller 写入 ledger，收敛尾部
   * 仍处于合法的事务中间态。只有 init / move / reveal 的账本写入完成后，才能要求每个
   * cohort 身份恰好由未定位池或 suspended 展示实体承载，并禁止牌堆继续承载正 ID 暗实体。
   */
  assertPileIdentityLedgerConsistency(context = ''): PileIdentityConsistencyIssue[] {
    if (!import.meta.env.DEV) return []

    const pile = this.zones.get('pile')
    const suspendedIdentityIDs = new Set(
      Array.from(this.suspendedKnownCards, (card) => card.id).filter((cardID) => cardID > 0)
    )
    const issues = this.pileIdentityLedger.assertConsistency(pile?.cards.length ?? 0, context, {
      deckIdentityIDs: this.deckIdentities,
      unlocatedIdentityIDs: this.unlocatedIdentities,
      suspendedIdentityIDs
    })
    const hiddenPileIdentityIDs = (pile?.cards ?? [])
      .filter((card) => card.id > 0 && card.isKnown !== true)
      .map((card) => card.id)

    hiddenPileIdentityIDs.forEach((cardID) => {
      issues.push({ context, reason: 'hidden-pile-identity', cardID })
    })

    if (hiddenPileIdentityIDs.length > 0) {
      trackerLogger.warn('牌堆仍存在正 ID 暗实体', {
        context,
        cardIDs: hiddenPileIdentityIDs
      })
    }

    return issues
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
   * 这是「解绑身份」的唯一原语。releaseUnknownPlaceholderToOutside、手气卡匿名化与
   * 洗牌路径全部经由此处，因此身份分区守恒
   * （一个 deckIdentity 必须恰好处于 cardIndex 或 unlocatedIdentities 之一）
   * 只需在这里断言一次。
   *
   * 返回 `null` 表示**未发生任何变更**：入参不是已定位的正 ID 实体，或 cardIndex
   * 与实体不一致。调用方必须处理该情况，不能假定身份已被释放——否则会出现
   * “实体已移出、身份仍被 cardIndex 认为已定位”的漏出（历史上 147 号身份即由此丢失）。
   */
  anonymizeLocatedIdentity(
    card: Card,
    reason = 'anonymizeLocatedIdentity',
    options: AnonymizeLocatedIdentityOptions = {}
  ): CardID | null {
    if (!card || !hasRealIdentity(card) || card.id <= 0) return null
    if (this.cardIndex.get(card.id) !== card) return null

    const { preservePlacement = false } = options
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
    if (!preservePlacement) {
      card.combinationID = null
      card.spellID = null
      // 必须走候选写路径：直接清空 locationCandidates 不会同步 clear owner，
      // seats 在 location 仍为 player 时会回退到旧座位投影。
      card.setLocationCandidates([], `${reason}:candidates`)
      card.clearSeats(`${reason}:seats`)
      card.subZone = null
    }
    this.suspendedKnownCards.delete(card)

    this.notifyCardChanged(card, {
      type: 'card-identity-anonymized',
      previousCardID,
      previousEntityID,
      entityID: nextEntityID,
      reason,
      preservePlacement
    })

    if (this.counter) {
      this.counter.releaseLocatedIdentityToUnknown(card, previousCardID)
      if (preservePlacement) this.counter.markDirty(card)
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
   * 玩家手牌或 mark 中的正 ID 暗实体只表示本机掌握身份，并不表示其具体位置已经公开。
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
   * 只读预测 materialize() 会返回的实体，不确认牌面，也不修改身份账本或物理位置。
   *
   * 返回已有实体表示本次调用会命中已定位身份；返回 target 表示新身份可占用该匿名槽。
   * 技能可据此先验证完整协议批次，再统一提交，避免失败校验留下半物化状态。
   */
  probeMaterialize(cardID: CardID, target: Card | null = null): Card | null {
    const normalizedCardID = Number(cardID)
    if (!(normalizedCardID > 0)) return null

    const existing = this.cardIndex.get(normalizedCardID)
    if (existing) return existing
    if (!target || !isAnonymous(target)) return null

    const wasDeckIdentity = this.deckIdentities.has(normalizedCardID)
    if (wasDeckIdentity && !this.unlocatedIdentities.has(normalizedCardID)) return null
    return target
  }

  /**
   * 将真实身份绑定到匿名物理槽，并同步身份守恒账本与查询索引。
   *
   * 公共区正 ID 实体只能证明它自身的身份，不能作为其它 CardID 的可替换物理代表。
   * 已定位身份命中玩家暗槽时，仍保留旧式暗手牌/mark interop；outside 或 suspended
   * 身份则可占用匿名公共槽重新进入物理区域。
   */
  materialize(cardID: CardID, target: Card | null = null): Card | null {
    const normalizedCardID = Number(cardID)
    const probedCard = this.probeMaterialize(normalizedCardID, target)
    if (!probedCard) return null

    const existing = this.cardIndex.get(normalizedCardID)
    if (existing) {
      // target 只有在匿名时才可承接已有身份。若 target 是其它正 ID，即使其牌面未公开，
      // 也不能用本次揭示覆盖该身份；调用方应保留原端点并走诊断/兜底路径。
      if (target && target !== existing && isAnonymous(target)) {
        this.materializeExistingIdentityAtTarget(existing, target)
      }

      existing.confirmKnown()
      // moveCards 会在 known 批次末尾再次调用恢复，直接公共揭示则不会；在物化原语内
      // 收口可确保 suspended 集合不会残留已重新出现的身份，重复恢复是幂等的。
      this.resumeSuspendedKnownCard(existing)
      return existing
    }

    // 未定位身份只能物化到没有真实身份的物理槽。正 ID 暗公共实体已不再是牌堆身份权威，
    // 但也不能被另一个身份覆盖；这条门槛把 Phase 4 的匿名洗牌结果固化为通用 known 契约。
    const wasDeckIdentity = this.deckIdentities.has(normalizedCardID)
    // 游戏外首次出现的合法正 ID 不在初始牌组中，发现时扩展身份全集。
    if (!wasDeckIdentity) {
      this.deckIdentities.add(normalizedCardID)
      this.unlocatedIdentities.add(normalizedCardID)
    }

    probedCard.materializeIdentity(normalizedCardID)
    probedCard.confirmKnown()
    this.cardIndex.set(normalizedCardID, probedCard)
    this.unlocatedIdentities.delete(normalizedCardID)
    this.counter?.addCard(probedCard)

    this.notifyCardChanged(probedCard, {
      type: 'card-identity-materialized',
      cardID: normalizedCardID
    })

    return probedCard
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
    // 端点中的同 ID 实体由 existing 分支直接确认；其它身份只能占用匿名槽。
    // 不跳过正 ID 暗端点去拿更深处匿名槽，否则会把协议端点顺序改写成本地选择。
    const availableTargets = targets.filter(isAnonymous)

    return cardIDs
      .map((cardID) => {
        const existing = this.cardIndex.get(cardID)
        const target = existing && targets.includes(existing) ? existing : availableTargets.shift()
        return this.materialize(cardID, target ?? null)
      })
      .filter((card): card is Card => Boolean(card))
  }

  /**
   * 将已有真实身份迁入匿名公共槽。
   *
   * 玩家暗手牌/mark 仍保留旧式正 ID interop：真实身份进入公共端点，匿名槽接管原玩家
   * 位置、候选与 mark 账本引用。outside/suspended 身份则直接替换匿名端点，匿名槽退出
   * 物理区域；这里不再支持任何正 ID 暗公共实体的 displaced/suspended 名额转交。
   */
  private materializeExistingIdentityAtTarget(existing: Card, target: Card): void {
    if (!isAnonymous(target)) return

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

    // 已知玩家实体或其它仍有确定物理位置的身份不能被公共揭示强行搬走；调用方按协议
    // 顺序保留本次匿名端点名额，后续 known 移动负责用来源占位修正陈旧位置。
    if (existing.location !== 'outside' && existing.location !== 'suspended') return

    const targetZoneEntry = this.findPublicZoneEntry(target)
    if (!targetZoneEntry) return

    const [targetZoneID, targetZone] = targetZoneEntry
    // existing 接管匿名槽的物理位置；target 没有真实身份，也不需要继承 suspended 角色。
    // materialize() 随后恢复 existing 的 suspended 集合状态，使身份与物理槽同时收敛。
    existing.moveToPublicZone(targetZoneID)
    targetZone.replaceCard(target, existing)
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
   *
   * 发生真实弃牌洗回时，旧 cohort 中仍未出现的身份会失去原世代归因。它们必须转入
   * suspendedKnownCards 继续展示，但 suspended 只保存身份，不占用牌堆或玩家物理槽；若
   * 身份仍由暗实体承载，原实体会先原地匿名化并保留位置，再创建 detached 展示实体。
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
    const hasAuthoritativeIdentityMove = options.identityMove !== undefined
    const hasDiscardCards = recycledCards.length > 0
    const projectedPileCount = remainingPileCards.length + recycledCards.length
    const knownDiscardIdentityIDsBefore = recycledCards
      .map((card) => card.id)
      .filter((cardID) => cardID > 0)
    const identityMove = options.identityMove ?? {
      eventType: 'shuffleDiscardIntoPile',
      fromZone: 2,
      toZone: 9,
      cardIDs: [],
      cardCount: hasProtocolPileCount ? normalizedCardCount : projectedPileCount,
      pileCountBefore: remainingPileCards.length
    }
    identityMove.ambiguousDiscardRecycleGroups = options.ambiguousDiscardRecycleGroups
    // 洗牌会同时关闭旧 cohort 与建立洗回批次；必须先让账本原子提交这次过渡，Room 才能
    // 把提交结果投影成 suspended/匿名实体，避免物理状态领先于身份权威。
    const shuffleTransition = this.applyPileIdentityShuffleBeforePhysicalMove(
      identityMove,
      projectedPileCount,
      recycledCards.length,
      knownDiscardIdentityIDsBefore
    )
    const closesPileGeneration = shuffleTransition?.closesGeneration === true
    const recycledIdentityIDs = new Set(
      shuffleTransition?.recycledIdentityIDs ?? knownDiscardIdentityIDsBefore
    )
    const expiringIdentityIDs = shuffleTransition?.expiringIdentityIDs ?? []
    const identityContext = `move:${identityMove.eventType}`
    const anonymizedIdentityIDs: CardID[] = []
    const newlySuspendedCardIDs: CardID[] = []

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

    if (closesPileGeneration) {
      // 每个过期未决身份都需要一个 suspended 展示实体；这些实体不占牌堆物理槽。
      // 尚未物化的身份会直接按最终 suspended 状态注册，避免污染只服务既有投影的脏事件流。
      const suspensionResult = this.suspendUnresolvedPileIdentitiesForShuffle(
        expiringIdentityIDs,
        recycledIdentityIDs
      )
      anonymizedIdentityIDs.push(...suspensionResult.anonymizedIdentityIDs)
      newlySuspendedCardIDs.push(...suspensionResult.suspendedIdentityIDs)
    }

    if (hasDiscardCards) {
      // 无论是真实换代还是全量弃牌形态的初洗，洗回后的随机位置都不再承载正 ID；区别仅
      // 在于前者会暂停旧世代未出现身份，后者仍把全部身份保留在 generation 0 未决集合。
      recycledCards.forEach((card) => {
        if (card.id <= 0) return
        const releasedIdentityID = this.anonymizeLocatedIdentity(
          card,
          'shufflePile:recycledIdentity'
        )
        if (releasedIdentityID) anonymizedIdentityIDs.push(releasedIdentityID)
      })
    }

    recycledCards.forEach((card) => card.reset())
    this.removeCardsFromConstraintGroups(remainingPileCards)
    this.removeCardsFromConstraintGroups(recycledCards)
    const rebuiltPileCards = rebuildPileAfterShuffle()

    const actualPileCount = pile.cards.length
    const rebuiltPileCount = rebuiltPileCards.length
    const discardCountAfterShuffle = discard.cards.length

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

    if (hasProtocolPileCount && actualPileCount < normalizedCardCount) {
      trackerLogger.warn('洗牌后实际牌堆实体少于协议牌堆张数，未创建匿名牌堆占位', {
        reason: 'shufflePile:pileSlotShortage',
        cardCount: normalizedCardCount,
        actualPileCount,
        rebuiltPileCount,
        remainingPileCount: remainingPileCards.length,
        recycledCardCount: recycledCards.length,
        anonymizedIdentityIDs
      })
    }

    if (newlySuspendedCardIDs.length > 0) {
      trackerLogger.info('洗牌后暂停追踪旧牌堆世代中尚未出现的身份', {
        suspendedCardIDs: newlySuspendedCardIDs,
        activeSuspendedCardIDs: Array.from(this.suspendedKnownCards, (card) => card.id).filter(
          (cardID) => cardID > 0
        )
      })
    }

    // 账本已经在物理事务前滚动；这里完成实体投影、收敛与最终态校验，事务中间态不告警。
    this.anonymizePileCohortIdentityEntities(identityContext)
    this.resolveConstraints()
    // 直接调用 Room 的历史测试可能绕过此前移动的账本事件；只有 Controller 提供完整事件时，
    // 才能要求 Room 分区与账本在本次事务末尾严格一致。
    if (hasAuthoritativeIdentityMove) this.assertPileIdentityLedgerConsistency(identityContext)
  }

  private applyPileIdentityShuffleBeforePhysicalMove(
    move: Omit<PileIdentityLedgerMove, 'pileCountAfter' | 'discardCountAfter'>,
    pileCountAfter: number,
    discardCountBefore: number,
    knownDiscardIdentityIDsBefore: readonly CardID[]
  ): PileIdentityShuffleTransition | null {
    try {
      const result = this.pileIdentityLedger.applyMove({
        ...move,
        discardCountBefore,
        knownDiscardIdentityIDsBefore,
        pileCountAfter,
        discardCountAfter: 0
      })
      if (result.committed && result.shuffleTransition) return result.shuffleTransition

      trackerLogger.warn('洗牌前牌堆身份账本事务未提交，已跳过旧世代身份暂停', {
        move,
        pileCountAfter,
        discardCountBefore,
        knownDiscardIdentityIDsBefore
      })
    } catch (error) {
      trackerLogger.warn('洗牌前牌堆身份账本更新失败，已跳过旧世代身份暂停', {
        error,
        move,
        pileCountAfter,
        discardCountBefore,
        knownDiscardIdentityIDsBefore
      })
    }
    return null
  }

  /**
   * 把一次真实洗牌前仍留在 cohort 中的身份转为可展示的 suspended 实体。
   *
   * cohort 身份可能尚未物化，也可能暂由玩家手牌、mark 或旧兼容牌堆槽中的正 ID 暗实体
   * 承载。后一种情况不能直接 suspend 原实体，否则会凭空删掉一个物理槽；必须先调用
   * anonymizeLocatedIdentity({ preservePlacement: true })，让同一对象继续承担匿名位置数量，
   * 再创建一个 detached 正 ID 实体负责展示。已经 suspended 的历史身份保持原对象，不重复
   * 创建；本轮洗回弃牌身份属于新世代，由调用方显式排除。
   */
  private suspendUnresolvedPileIdentitiesForShuffle(
    identityIDs: readonly CardID[],
    recycledIdentityIDs: ReadonlySet<CardID>
  ): { suspendedIdentityIDs: CardID[]; anonymizedIdentityIDs: CardID[] } {
    const suspendedIdentityIDs: CardID[] = []
    const anonymizedIdentityIDs: CardID[] = []

    identityIDs.forEach((cardID) => {
      if (!(cardID > 0) || recycledIdentityIDs.has(cardID)) return

      const existing = this.cardIndex.get(cardID)
      if (existing && (existing.suspended === true || this.suspendedKnownCards.has(existing))) {
        return
      }

      // 已经通过协议公开的身份不属于“尚未出现”。正常生产事务中 ledger 已把它移出 cohort；
      // 该分支同时让直接调用 Room 的测试/兼容路径不会把可见实体错误暂停。
      if (existing?.isKnown === true) return

      if (existing) {
        const releasedIdentityID = this.anonymizeLocatedIdentity(
          existing,
          'shufflePile:expiredCohortIdentity',
          { preservePlacement: true }
        )
        if (releasedIdentityID === null) {
          trackerLogger.warn('洗牌关闭旧牌堆世代时释放暗实体身份失败', {
            cardID,
            entityID: existing.entityID,
            location: existing.location
          })
          return
        }
        anonymizedIdentityIDs.push(releasedIdentityID)
      } else if (!this.unlocatedIdentities.has(cardID)) {
        trackerLogger.warn('洗牌关闭旧牌堆世代时身份不在 Room 分区中', { cardID })
        return
      }

      const displayCard = this.createDetachedSuspendedIdentity(cardID)
      if (!displayCard) {
        trackerLogger.warn('洗牌关闭旧牌堆世代时创建 suspended 展示实体失败', { cardID })
        return
      }
      suspendedIdentityIDs.push(cardID)
    })

    if (suspendedIdentityIDs.length > 0) this.markViewDirty('pile-generation-suspended')
    return { suspendedIdentityIDs, anonymizedIdentityIDs }
  }

  /**
   * 为旧牌堆世代中尚未物化的身份直接创建最终 suspended 展示实体。
   *
   * 这类实体从未进入玩家区或公共区，三个增量索引没有旧投影需要删除；若复用
   * createExternalCards() -> confirmKnown() -> suspendKnownCard()，中间态会产生无意义的通用
   * dirtyCardEvent。这里先写完最终状态再登记索引与计数器，只通过 viewDirty 通知候选区重绘。
   * 已经承担物理位置的身份仍由调用方先匿名化，其原实体变化继续走完整脏事件路径。
   */
  private createDetachedSuspendedIdentity(cardID: CardID): Card | null {
    if (!(cardID > 0) || this.cardIndex.has(cardID)) return null
    if (!this.unlocatedIdentities.has(cardID)) return null

    const card = new Card(cardID, this)
    card.location = 'suspended'
    card.isKnown = true
    card.suspended = true
    card.syncTimestamp()

    this.cards.push(card)
    this.deckIdentities.add(cardID)
    this.cardIndex.set(cardID, card)
    this.unlocatedIdentities.delete(cardID)
    this.suspendedKnownCards.add(card)
    // 动态实体仍需按 room.cards 创建顺序登记；它当前不参与任何位置投影，无需触发重投影。
    this.locationIndex.registerCard(card)
    this.counter?.addCard(card)
    return card
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

    context.anonymizeCards.forEach((card) => {
      this.anonymizeLocatedIdentity(card, 'moveCards:ambiguousSource', {
        preservePlacement: true
      })
    })

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
    context.postMovePublicCandidates?.forEach(({ card, candidate }) => {
      if (!context.publicMovedCards.includes(card) || card.location !== candidate.zone) return
      card.addPublicCandidate(candidate)
    })
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
    this.pendingDiscardGains = []
    this.guiFuRevealSnapshots.clear()
    this.anonymousEntitySeq = -1
    this.isDeckReady = false
    this.seatIDs = []
    this.size = 0
    this.firstID = undefined
    this.mySeatID = undefined
    trackerLogger.info('Room destroy 完成')
  }
}
