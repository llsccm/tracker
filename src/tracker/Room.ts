import { trackerLogger } from '@/utils/logger'
import { POSITION_RANDOM } from './candidate/cardPositions'
import type { LocationCandidateInput } from './candidate/locationCandidate'
import { normalizePublicPosition } from './candidate/publicCandidate'
import type { ConstraintGroup } from './constraint/ConstraintGroup'
import { GameState } from './Game'
import { summarizeMoveContext } from './helper/moveSummary'
import { Card, Player, Zone } from './model'
import {
  PileIdentityLedger,
  type AmbiguousDiscardRecycleGroup,
  type PileIdentityConsistencyIssue,
  type PileIdentityLedgerMove,
  type PileIdentityRevealLocation,
  type PileIdentityShuffleTransition
} from './PileIdentityLedger'
import { AmbiguousKnownIndex } from './projection/AmbiguousKnownIndex'
import { CardCounter } from './projection/CardCounter'
import { CardLocationIndex } from './projection/CardLocationIndex'
import { PlayerSnapshot } from './projection/playerSnapshot'
import {
  RoomBase,
  RoomConstraints,
  RoomDiagnostics,
  RoomIdentity,
  RoomMoveEvents,
  RoomMovement,
  RoomPublicZones
} from './room/index'
import type {
  AnonymizeLocatedIdentityOptions,
  MoveEventHandler,
  PlayerHandCardIDOptions,
  RoomSkillPlugin,
  SkillHandler
} from './room/index'
import type {
  CardID,
  MoveOptions,
  NormalizedMoveEvent,
  PatchedMoveCardFields,
  RawMoveCardEvent,
  PublicPosition,
  PublicLocationCandidate,
  PublicZoneName,
  SeatID,
  SeatInfo,
  SpellID,
  SubZoneCandidate
} from './types'
import type { PendingSkillMove, SkillProtocolEvent } from './skill/protocolEvents'

interface RoomOptions {
  gameState?: GameState
}

interface ShufflePileOptions {
  cardCount?: number | null
  ambiguousDiscardRecycleGroups?: readonly AmbiguousDiscardRecycleGroup[]
}

export interface DirtyCardEvent {
  seq: number
  card: Card
  detail: Record<string, unknown>
}

const DIRTY_CARD_EVENT_LIMIT = 500

/**
 * 充当单局游戏的状态隔离生命周期容器与顶层事件分发协调者
 */
export class Room extends RoomBase {
  /** 牌堆是否已经通过 MsgGamePlayCardNtf 完成初始化 */
  isDeckReady = false
  cards: Card[] = []
  /** 只有范围位置证据的公开身份，不占用或增加物理槽。 */
  readonly detachedKnownCards = new Set<Card>()
  private detachedIdentitySeq = 0
  private detachedCardOrder = new WeakMap<Card, number>()
  /** 身份推断与投影读面；物理容量继续读取 cards。 */
  get trackedCards(): readonly Card[] {
    return this.detachedKnownCards.size === 0
      ? this.cards
      : [...this.cards, ...this.detachedKnownCards]
  }
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
  declare zones: Map<PublicZoneName, Zone>
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
  declare publicZones: RoomPublicZones
  declare constraints: RoomConstraints
  declare movement: RoomMovement
  declare pileIdentityLedger: PileIdentityLedger
  /** 计数器 */
  declare counter: CardCounter
  /** 仅在 DEV 分支挂载；生产环境不创建诊断实例。 */
  declare private readonly diagnostics: RoomDiagnostics
  private readonly playerSnapshot = new PlayerSnapshot(this)
  private readonly identity = new RoomIdentity(this)
  private readonly moveEvents = new RoomMoveEvents(this)

  get skillHandlers(): ReadonlyMap<SpellID, SkillHandler> {
    return this.moveEvents.skillHandlers
  }

  get moveEventHandlers(): ReadonlyMap<SpellID | '*', readonly MoveEventHandler[]> {
    return this.moveEvents.moveEventHandlers
  }

  /** 玩家区快照的兼容只读入口；缓存仅由 PlayerSnapshot 维护。 */
  get playerCardsSnapshot(): readonly Card[] {
    return this.playerSnapshot.cards
  }

  /**
   * @param cardIDs - 卡牌的物理 ID 列表，用以初始化卡牌池
   */
  constructor({ gameState = new GameState() }: RoomOptions = {}) {
    super(gameState)
    if (import.meta.env.DEV) this.diagnostics = new RoomDiagnostics(this)

    // 2. 初始化逻辑分区与公共区域
    this.zones = new Map([
      ['outside', new Zone('outside', this)],
      ['pile', new Zone('pile', this)],
      ['discard', new Zone('discard', this)],
      ['exile', new Zone('exile', this)],
      ['process', new Zone('process', this)],
      ['exchange', new Zone('exchange', this)]
    ])

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

    // 7. 挂载 Room 行为模块，保留 Room 作为稳定公开入口
    this.publicZones = new RoomPublicZones(this)
    this.constraints = new RoomConstraints(this)
    this.movement = new RoomMovement(this)
    this.pileIdentityLedger = new PileIdentityLedger()

    // 8. 绑定当前房间的对局状态；浏览器入口会注入真实 Game，测试可注入纯状态对象。
    this.game?.bindRoom?.(this)
  }

  initDeck(cardIDs: CardID[]): void {
    this.isDeckReady = false
    if (import.meta.env.DEV) this.diagnostics.reset()

    this.cards.length = 0
    this.detachedKnownCards.clear()
    this.detachedIdentitySeq = 0
    this.detachedCardOrder = new WeakMap()
    this.playerSnapshot.reset()
    this.cardIndex.clear()
    this.unlocatedIdentities = new Set(cardIDs.filter((id) => id > 0))
    this.deckIdentities = new Set(this.unlocatedIdentities)
    this.anonymousEntitySeq = -1

    // 牌堆只保存匿名物理槽，真实身份在揭示前统一留在 unlocatedIdentities。
    const pile = this.zones.get('pile')
    this.zones.forEach((zone) => zone.clear())

    const deckCards: Card[] = []
    for (let i = 0; i < cardIDs.length; i += 1) {
      const card = new Card(0, this)
      this.registerCardEntity(card)
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
    this.moveEvents.onDeckInitialized()
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

      this.identity.anonymizePileCohortIdentityEntities(context)
      this.assertPileIdentityLedgerConsistency(context)
    } catch (error) {
      trackerLogger.warn('牌堆身份账本移动更新失败', { error, move })
    }
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
        const card = this.cardIndex.get(cardID)
        // 范围身份尚未物化时，展示目标不能覆盖原有候选位置证据。
        if (card && this.detachedKnownCards.has(card)) return
        const actualLocation = card?.location
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

        // 没有实体也没有调用方位置证据时，跳过比猜成 outside 更安全；解析入口已有缺失诊断。
        if (!revealLocation) return

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
   * 在物理 Room 与身份 ledger 都完成一次协议事务后检查最终目标态。
   *
   * 低层物化与揭示允许分阶段写入，因此在 init / move / reveal 事务完成后调用，而不对
   * 任意手工收敛检查未提交的身份事实。账本与实体同步后，要求每个
   * cohort 身份恰好由未定位池或 suspended 展示实体承载，并禁止牌堆继续承载正 ID 暗实体。
   */
  assertPileIdentityLedgerConsistency(context = ''): PileIdentityConsistencyIssue[] {
    if (!import.meta.env.DEV) return []
    return this.diagnostics.assertPileIdentityLedgerConsistency(context)
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

  setPlayerShowStatuses(statuses: readonly (readonly [SeatID, number])[]): boolean {
    let changed = false

    for (const [seatID, status] of statuses) {
      const player = this.getPlayer(seatID)
      if (!player || player.isShown === (status === 1)) continue
      player.isShown = status === 1
      changed = true
    }

    if (changed) {
      this.updateFixedViewIds()
      this.markViewDirty('player-show-status')
    }

    return changed
  }

  /**
   * 注册特定的技能过滤器
   */
  registerSkillHandler(spellID: SpellID, handler: SkillHandler): void {
    this.moveEvents.registerSkillHandler(spellID, handler)
  }

  /**
   * 注册完整移动事件处理器，用于在 Room.moveCards() 前修正批量移动语义。
   */
  registerMoveEventHandler(spellID: SpellID | '*', handler: MoveEventHandler): void {
    this.moveEvents.registerMoveEventHandler(spellID, handler)
  }

  registerSkillPlugin(plugin: RoomSkillPlugin): void {
    this.moveEvents.registerSkillPlugin(plugin)
  }

  beforeNormalizeMove(
    patched: PatchedMoveCardFields,
    raw: Readonly<RawMoveCardEvent>
  ): 'defer' | void {
    return this.moveEvents.beforeNormalizeMove(patched, raw)
  }

  afterMoveCommitted(event: NormalizedMoveEvent): void {
    this.moveEvents.afterMoveCommitted(event)
  }

  notifyCardsRevealed(cardIDs: readonly CardID[]): void {
    this.moveEvents.notifyCardsRevealed(cardIDs)
  }

  dispatchSkillProtocolEvent(event: SkillProtocolEvent): PendingSkillMove[] {
    return this.moveEvents.dispatchSkillProtocolEvent(event)
  }

  /**
   * 在实际移动前，让技能处理器有机会修正 cardIDs/来源牌/组合约束。
   */
  decorateMoveEvent(event: NormalizedMoveEvent): NormalizedMoveEvent {
    return this.moveEvents.decorateMoveEvent(event)
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
  findCardsByIDs(cardIDs: readonly CardID[] = []): Card[] {
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
    const releasedIdentityID = this.identity.anonymizeLocatedIdentity(card, reason, options)
    if (releasedIdentityID !== null) this.assertIdentityReleased(releasedIdentityID, reason)
    return releasedIdentityID
  }

  /**
   * 身份解绑后的分区守恒断言（开发期，生产零成本）。
   *
   * 解绑完成时该身份必须恰好处于「未定位」一侧：既不能仍被 cardIndex 认为已定位，
   * 也不能从 deckIdentities 中消失。这两种漏出都会让后续洗牌再也找不到该身份。
   */
  private assertIdentityReleased(cardID: CardID, reason: string): void {
    if (!import.meta.env.DEV) return
    this.diagnostics.assertIdentityReleased(cardID, reason)
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
    return this.identity.releaseUnknownPlaceholderToOutside(card, reason)
  }

  /**
   * 只读预测 materialize() 会返回的实体，不确认牌面，也不修改身份账本或物理位置。
   *
   * 返回已有实体表示本次调用会命中已定位身份；返回 target 表示新身份可占用该匿名槽。
   * 技能可据此先验证完整协议批次，再统一提交，避免失败校验留下半物化状态。
   */
  probeMaterialize(cardID: CardID, target: Card | null = null): Card | null {
    return this.identity.probeMaterialize(cardID, target)
  }

  /**
   * 将真实身份绑定到匿名物理槽，并同步身份守恒账本与查询索引。
   *
   * 公共区正 ID 实体只能证明它自身的身份，不能作为其它 CardID 的可替换物理代表。
   * 已定位身份命中玩家暗槽时，仍保留旧式暗手牌/mark interop；outside 或 suspended
   * 身份则可占用匿名公共槽重新进入物理区域。
   */
  materialize(cardID: CardID, target: Card | null = null): Card | null {
    return this.identity.materialize(cardID, target)
  }

  /**
   * 依次把公开身份物化到公共区端点的匿名槽，保持协议给出的展示顺序。
   */
  materializeAtPublicEndpoint(
    cardIDs: CardID[],
    zoneID: PublicZoneName,
    position: PublicPosition
  ): Card[] {
    return this.identity.materializeAtPublicEndpoint(cardIDs, zoneID, position)
  }

  /** 所有新实体统一追加并登记顺序；不触发脏事件或改变牌的位置。 */
  registerCardEntity(card: Card): void {
    this.cards.push(card)
    this.playerSnapshot.registerCard(card, this.cards.length - 1)
    this.locationIndex.registerCard(card, this.cards.length - 1)
  }

  registerDetachedKnownCard(card: Card): void {
    this.detachedKnownCards.add(card)
    // detached 载体排在物理实体之后；重建时复用同一顺序键，不改变后续新增载体的顺序。
    const order = 2 ** 32 + this.detachedIdentitySeq++
    this.detachedCardOrder.set(card, order)
    this.playerSnapshot.registerCard(card, order)
    this.locationIndex.registerCard(card, order)
  }

  getDetachedCardOrder(card: Card): number | undefined {
    return this.detachedKnownCards.has(card) ? this.detachedCardOrder.get(card) : undefined
  }

  allocateAnonymousEntityID(): number {
    return this.anonymousEntitySeq--
  }

  /**
   * 从游戏外补建实体：正 ID 身份牌和/或匿名占位。
   */
  createExternalCards(cardIDs: CardID[] = [], count = cardIDs.length): Card[] {
    return this.identity.createExternalCards(cardIDs, count)
  }

  // 公共区主入口；低频查询辅助位于 room/publicZones.ts。
  clearCardsFromPublicZones(cards: Card[] = []) {
    return this.publicZones.clearCardsFromPublicZones(cards)
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
   * 将装备容器候选按标记协议已观测座位投影为玩家标记区候选。
   * 容器身份不绑定 seat；装备本体移动不能提前改变内部牌投影。
   */
  resolveEquipmentContainerLocationCandidates(
    candidate: LocationCandidateInput
  ): SubZoneCandidate[] {
    return this.movement.hiddenMarks.resolveEquipmentContainerLocationCandidates(candidate)
  }

  /** 获取指定玩家手牌中的物理牌 ID
   *
   * 缓存更新慢 不太适用渲染
   */
  getPlayerHandCardIDs(seatID: SeatID, options: PlayerHandCardIDOptions = {}) {
    return this.publicZones.getPlayerHandCardIDs(seatID, options)
  }

  // 约束收敛主入口与辅助方法；低频约束辅助位于 room/constraints.ts。
  removeCardsFromConstraintGroups(cards: Card[] = []) {
    return this.constraints.removeCardsFromConstraintGroups(cards)
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

  ensureDetachedKnownIdentity(cardID: CardID): Card | null {
    return this.identity.ensureDetachedKnownIdentity(cardID)
  }

  revealPublicCandidates(cardIDs: readonly CardID[], candidate: PublicLocationCandidate): Card[] {
    const cards = cardIDs
      .map((cardID) => this.ensureDetachedKnownIdentity(cardID))
      .filter((card): card is Card => Boolean(card))
    cards.forEach((card) => card.setLocationCandidates([candidate], 'revealPublicCandidate'))
    this.pileIdentityLedger.applyReveal({
      cardIDs: cards.map((card) => card.id),
      location:
        candidate.zone === 'pile' ? 'pile' : candidate.zone === 'discard' ? 'discard' : 'outside',
      pileCountAfter: this.zones.get('pile')!.cards.length,
      discardCountAfter: this.zones.get('discard')!.cards.length
    })
    this.resolveConstraints()
    this.assertPileIdentityLedgerConsistency('revealPublicCandidate')
    return cards
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
    const projectedPileCount = remainingPileCards.length + recycledCards.length
    const targetPileCount = hasProtocolPileCount ? normalizedCardCount : projectedPileCount
    const knownRemainingPileCards = remainingPileCards.filter(
      (card) => card.id > 0 && card.isKnown === true
    )
    // 协议总数连现有明牌都容纳不了时，旧位置事实已失效，整组降级为候选而不猜测保留哪张。
    const ambiguousRemainingPileCards =
      knownRemainingPileCards.length > targetPileCount ? knownRemainingPileCards : []
    const shuffleIdentityCards = [...recycledCards, ...ambiguousRemainingPileCards]
    const knownDiscardIdentityIDsBefore = shuffleIdentityCards
      .map((card) => card.id)
      .filter((cardID) => cardID > 0)
    const identityMove = {
      eventType: 'shuffleDiscardIntoPile',
      fromZone: 2,
      toZone: 9,
      cardIDs: [],
      cardCount: targetPileCount,
      pileCountBefore: remainingPileCards.length,
      visiblePileIdentityIDsAfter:
        ambiguousRemainingPileCards.length > 0
          ? []
          : this.identity.collectVisiblePileTopIdentityIDs(),
      ambiguousDiscardRecycleGroups: options.ambiguousDiscardRecycleGroups
    }
    // 洗牌会同时关闭旧 cohort 与建立洗回批次；必须先让账本原子提交这次过渡，Room 才能
    // 把提交结果投影成 suspended/匿名实体，避免物理状态领先于身份权威。
    const shuffleTransition = this.applyPileIdentityShuffleBeforePhysicalMove(
      identityMove,
      targetPileCount,
      Math.max(0, targetPileCount - remainingPileCards.length),
      knownDiscardIdentityIDsBefore
    )
    const closesPileGeneration = shuffleTransition?.closesGeneration === true
    const recycledIdentityIDs = new Set(
      shuffleTransition?.recycledIdentityIDs ?? knownDiscardIdentityIDsBefore
    )
    const expiringIdentityIDs = shuffleTransition?.expiringIdentityIDs ?? []
    const identityContext = `move:${identityMove.eventType}`
    const newlySuspendedCardIDs: CardID[] = []

    const rebuildPileAfterShuffle = () => {
      // 只随机洗回弃牌堆；原本仍留在牌堆里的部分保持相对顺序，避免已知牌堆顶被误重排。
      for (let i = recycledCards.length - 1; i > 0; i -= 1) {
        const randomIndex = Math.floor(Math.random() * (i + 1))
        const recycledCard = recycledCards[randomIndex]
        recycledCards[randomIndex] = recycledCards[i]
        recycledCards[i] = recycledCard
      }

      const rebuiltPileCards = this.publicZones.resizeShuffledPile(
        [...recycledCards, ...remainingPileCards],
        targetPileCount
      )
      pile.replaceAll(rebuiltPileCards)
      return rebuiltPileCards
    }

    if (closesPileGeneration) {
      // 每个过期未决身份都需要一个 suspended 展示实体；这些实体不占牌堆物理槽。
      // 尚未物化的身份会直接按最终 suspended 状态注册，避免污染只服务既有投影的脏事件流。
      const suspensionResult = this.identity.suspendUnresolvedPileIdentitiesForShuffle(
        expiringIdentityIDs,
        recycledIdentityIDs
      )
      newlySuspendedCardIDs.push(...suspensionResult.suspendedIdentityIDs)
    }

    if (shuffleIdentityCards.length > 0) {
      // 无论是真实换代还是全量弃牌形态的初洗，洗回后的随机位置都不再承载正 ID；区别仅
      // 在于前者会暂停旧世代未出现身份，后者仍把全部身份保留在 generation 0 未决集合。
      // 全部身份都先保留到未定位分区，多余物理槽退出牌堆时不会带走候选身份。
      shuffleIdentityCards.forEach((card) => {
        if (card.id <= 0) return
        this.anonymizeLocatedIdentity(card, 'shufflePile:recycledIdentity')
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
    if (
      actualPileCount !== targetPileCount ||
      actualPileCount !== rebuiltPileCount ||
      discardCountAfterShuffle !== 0
    ) {
      trackerLogger.warn('洗牌后实际牌堆实体数量不一致', {
        reason: 'shufflePile:actualPileConsistency',
        targetPileCount,
        actualPileCount,
        rebuiltPileCount,
        discardCountAfterShuffle,
        rebuiltPileCardIDs: rebuiltPileCards.map((card) => card.id),
        actualPileCardIDs: pile.cards.map((card) => card.id)
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
    this.identity.anonymizePileCohortIdentityEntities(identityContext)
    this.resolveConstraints()
    this.assertPileIdentityLedgerConsistency(identityContext)
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

  createConstraintGroup(options: Parameters<RoomConstraints['createConstraintGroup']>[0] = {}) {
    return this.constraints.createConstraintGroup(options)
  }

  /** 房间级收敛的稳定入口；求解、座位懒缓存与稳定态同步由 RoomConstraints 实现。 */
  resolveConstraints(): void {
    this.constraints.resolveConstraints(import.meta.env.DEV ? this.diagnostics : undefined)
  }

  /**
   * A2：全量重建 player 快照（initDeck seed / 游标断档回退）。
   * 顺序键取 room.cards 下标；后续增量插入沿用同一顺序键，保证与全量 filter 顺序一致。
   */
  rebuildPlayerSnapshot(): Card[] {
    return this.playerSnapshot.rebuild()
  }

  /**
   * A2：按 dirtyCardEvents 游标增量刷新 player 快照并返回。
   * 成员定义严格等于 `card.location === 'player'`，是 CardLocationIndex 已用同一事件流
   * 追踪的子集；未初始化或游标断档（被 DIRTY_CARD_EVENT_LIMIT splice）时回退全量重建。
   */
  refreshPlayerSnapshot(): Card[] {
    return this.playerSnapshot.refresh()
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
    this.diagnostics.assertConservation(context)
  }

  assertPlayerSnapshotConsistency(playerCards: Card[]): void {
    if (!import.meta.env.DEV) return
    this.diagnostics.assertPlayerSnapshotConsistency(playerCards)
  }

  /**
   * 开发期一致性检查：增量维护后的 locationIndex 必须与全量 rebuild 影子结果逐桶一致。
   * 仅告警不自愈，便于集成测试在收敛后用同一比对暴露分歧；生产环境零成本。
   */
  assertLocationIndexConsistency(): void {
    if (!import.meta.env.DEV) return
    this.diagnostics.assertLocationIndexConsistency()
  }

  /**
   * 开发期一致性检查：增量维护后的 ambiguousKnownIndex 必须与全量 rebuild 影子结果一致。
   */
  assertAmbiguousKnownIndexConsistency(): void {
    if (!import.meta.env.DEV) return
    this.diagnostics.assertAmbiguousKnownIndexConsistency()
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
   * 移动卡牌事件的房间级主流程。只接收只读 ID 数组，单张牌使用 [cardID]。
   * Room 保留阶段编排，具体阶段逻辑委托给 RoomMovement，便于快速查看协议同步的全貌。
   */
  moveCards(
    cardIDs: readonly CardID[],
    toZone: PublicZoneName | 'player',
    opt: MoveOptions = {}
  ): boolean {
    const context = this.movement.createMoveContext(cardIDs, toZone, opt)
    const pileSnapshot = this.identity.capturePileMoveSnapshot(context)

    const anonymization = this.identity.anonymizeMoveSourceCards(
      context.anonymizeCards,
      context.requireAnonymizeSuccess
    )
    if (!anonymization.success) return false

    // 来源明牌失去定位时，实体与身份账本一起降级，再消费本次匿名移动的数量。
    if (anonymization.pileIdentityIDs.length > 0) {
      this.pileIdentityLedger.anonymizeKnownPileIdentities(
        anonymization.pileIdentityIDs,
        'moveCards:ambiguousSource'
      )
    }

    // trackerLogger.info(
    //   'moveCards 开始',
    //   summarizeMoveContext(context, { includeKnownCardIDs: true })
    // )

    this.movement.sources.applyHandTotalDelta(
      context.sourceHandSeat,
      context.targetHandSeat,
      context.handMoveCount
    )
    // 整手完整揭示时先把木马/标记弱候选反向收敛（并挤回被占用的手牌占位），
    // 必须早于 resolveKnownMoveCards，否则匿名槽数量已错、明牌会被 createExternal。
    this.movement.hiddenMarks.resolveHiddenMarkCandidatesFromFullHandReveal(context)
    this.movement.resolveKnownMoveCards(context)
    this.movement.applyMoveCandidatePropagation(context)
    this.movement.moveUnknownCardsForContext(context)
    this.movement.moveKnownCardsForContext(context)
    const inferredIdentityIDs = this.identity.anonymizeRandomPileReturn(context)
    if (inferredIdentityIDs.length > 0) {
      this.pileIdentityLedger.insertKnown(
        inferredIdentityIDs,
        inferredIdentityIDs.length,
        POSITION_RANDOM,
        'moveCards:inferredRandomPileReturn'
      )
    }

    context.postMovePublicCandidates?.forEach(({ card, candidate }) => {
      if (!context.publicMovedCards.includes(card) || card.location !== candidate.zone) return
      card.addPublicCandidate(candidate)
    })

    this.movement.createPublicMoveConstraintGroup(context)

    // 账本投影也可能匿名化实体，必须先提交，再统一同步稳定索引和计数器。
    this.identity.commitPileIdentityForMove(context, pileSnapshot)
    this.resolveConstraints()
    this.assertPileIdentityLedgerConsistency('moveCards')

    trackerLogger.info('moveCards 完成', {
      ...summarizeMoveContext(context, { includeKnownCardIDs: true }),
      publicMovedCardIDs: context.publicMovedCards.map((card) => card.id),
      movedUnknownCardIDs: context.movedUnknownCards.map((card) => card.id),
      dirtyCardCount: this.dirtyCards.size,
      constraintGroupCount: this.constraintGroups.size
    })

    return true
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
    this.trackedCards.forEach((card) => card.reset())
    this.detachedKnownCards.clear()
    this.detachedIdentitySeq = 0
    this.detachedCardOrder = new WeakMap()
    this.constraintGroups.clear()
    this.constraintGroupsDirty = false
    if (import.meta.env.DEV) this.diagnostics.reset()
    this.maxResolveRounds = 0
    this.lastResolveRounds = 0
    this.moveEvents.clear()
    this.ambiguousKnownIndex.items.clear()
    this.ambiguousKnownIndex.containerDependentCards.clear()
    this.ambiguousKnownIndex.lastConsumedSeq = 0
    this.suspendedKnownCards.clear()
    this.dirtyCards.clear()
    this.dirtyCardEvents = []
    this.dirtyCardSeq = 0
    this.dirtyPublicZones.clear()
    this.playerSnapshot.reset()
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
