import { POSITION_BOTTOM, POSITION_TOP } from '../candidate/cardPositions'
import { fromPublicCandidate } from '../candidate/locationCandidate'
import { createPublicCandidate } from '../candidate/publicCandidate'
import type { Card } from '@/tracker/model/Card'
import { Game, type GameState } from '../Game'
import { summarizeMoveEvent } from '../helper/moveSummary'
import { getProtocolMoveSpecialLabel, normalizeMoveEvent } from '../protocol/MoveEventNormalizer'
import {
  getProtocolMarkSpellID,
  getProtocolPlayerSubZone,
  getProtocolPublicZone,
  isProtocolPlayerZone
} from '../protocol/protocolZones'
import { Room } from '../Room'
import type {
  CardID,
  MoveOptions,
  NormalizedMoveEvent,
  PatchedMoveCardFields,
  PublicPosition,
  PublicZoneName,
  RawMoveCardEvent,
  SeatID,
  SeatInfo,
  SpellID,
  TrackerControllerOptions,
  TrackerLogger,
  TrackerView
} from '../types'
import { registerDefaultMoveEventHandlers } from '../skill/registerHandlers'
import type { SkillProtocolEvent } from '../skill/protocolEvents'
import {
  hasMixedTrackerMoveVisibility,
  normalizeTrackerMovePosition
} from '../protocol/protocolRules'
import { trackerLogger } from '@/utils/logger'

interface RevealTarget {
  type?: 'player' | 'public' | string
  seatID?: SeatID
  fromSeatID?: SeatID
  fromZone?: PublicZoneName | null
  fromSubZone?: string
  subZone?: string
  spellID?: SpellID | null
  fullHand?: boolean
  handCount?: number
  // 协议已经通过其它消息同步过手牌数量时，只补充已知身份，不重复增加手牌总数。
  handMoveCount?: number
  zoneName?: PublicZoneName
  position?: PublicPosition
  // 已在公共区中的牌是否也需要重新定位到指定端点。
  reposition?: boolean
  // CardIDs 是否按牌堆顶向内排列；Zone 写入前需要转换为内部的底到顶顺序。
  cardIDsTopFirst?: boolean
  sourceEvent?: MoveOptions['sourceEvent']
}

interface ProtocolZoneInput {
  zone: number
  id: number
  spellID?: SpellID | null
  pos?: PublicPosition
}

const MOVE_EVENT_SUMMARY_OPTIONS = {
  normalizeCardIDs: true,
  includeEventCardCount: true,
  includeSourceCards: true
}

// Controller 在测试中会注入空视图/日志；默认对象保证浏览器依赖缺席时仍能实例化。
const noopView: TrackerView = {
  mount(_room: Room) {},
  unmount() {},
  scheduleRender() {}
}

const noopLogger: TrackerLogger = {
  debug() {},
  info() {},
  warn() {}
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

/**
 * 记牌器控制器默认实现。
 *
 * 这里是浏览器桥接层和 Node/Vitest 回归之间的边界：外部依赖都通过参数注入，
 * 内部只维护当前 trackerRoom 生命周期和协议同步流程，避免测试时触碰真实 DOM/Laya。
 */
export class TrackerController {
  private readonly controllerView: TrackerView
  private readonly controllerLogger: TrackerLogger
  private readonly gameState: GameState
  private readonly getSeatUIs: NonNullable<TrackerControllerOptions['getSeatUIs']>
  private readonly registerMoveEventHandlers: NonNullable<
    TrackerControllerOptions['registerMoveEventHandlers']
  >
  private trackerRoom: Room | null = null

  constructor({
    view = noopView,
    gameState = Game,
    getSeatUIs = () => {},
    logger = noopLogger,
    registerMoveEventHandlers = registerDefaultMoveEventHandlers
  }: TrackerControllerOptions = {}) {
    this.controllerView = {
      ...noopView,
      ...view
    }
    this.controllerLogger = {
      ...noopLogger,
      ...logger
    }
    this.gameState = gameState
    this.getSeatUIs = getSeatUIs
    this.registerMoveEventHandlers = registerMoveEventHandlers
  }

  getTrackerRoom(): Room | null {
    return this.trackerRoom
  }

  isTrackerReady(): boolean {
    return Boolean(this.trackerRoom?.isDeckReady && !this.gameState.isDuanXian)
  }

  getReadyTrackerRoom(): Room | null {
    return this.isTrackerReady() ? this.trackerRoom : null
  }

  /** 读取当前已跟踪且已知的指定玩家手牌 ID。 */
  getTrackedPlayerHandCardIDs(seatID: SeatID): CardID[] {
    return this.getReadyTrackerRoom()?.getPlayerHandCardIDs(seatID) ?? []
  }

  /**
   * 开局协议到达后创建单局 Room。
   * 旧 Room 必须先销毁，避免断线/重进导致上一局约束组继续影响新牌局。
   */
  initTrackerRoom(): void {
    try {
      this.trackerRoom?.destroy()
      this.trackerRoom = new Room({ gameState: this.gameState })
      this.gameState.beginPlayback()
      this.gameState.bindRoom(this.trackerRoom)
      this.controllerLogger.info('Room 初始化')
      this.registerMoveEventHandlers(this.trackerRoom)
    } catch (e) {
      trackerLogger.error('Room 初始化失败', e)
      this.controllerView.unmount()
      this.trackerRoom?.destroy()
      this.gameState.bindRoom(null)
      this.trackerRoom = null
    }
  }

  /**
   * 牌堆协议到达后初始化物理牌池，并在牌池可用后挂载视图。
   * 断线重连局面暂不重建牌堆，因为宿主只给局部状态，强行初始化会制造错误确定性。
   */
  initTrackerDeck(cardIDs: CardID[]): void {
    if (!this.trackerRoom) return

    if (this.gameState.isDuanXian) {
      this.controllerLogger.warn('断线重连状态，跳过 Room 牌堆初始化')
      this.controllerView.unmount()
      return
    }

    this.trackerRoom.initDeck(cardIDs)
    this.controllerView.mount(this.trackerRoom)
    this.controllerLogger.info('Room 牌堆初始化完成', { cardIDs })
  }

  /**
   * 注册座位数据并同步 Game 兼容层。
   * 玩家数据注册一定早于先手协议；这里先建立座位集合，后续先手协议只补固定视角顺序。
   *
   */
  registerTrackerPlayers(infos: unknown[], currentUserID?: number): void {
    if (!this.trackerRoom) return
    // 玩家数据注册
    this.trackerRoom.registerPlayers(infos as SeatInfo[], currentUserID)
    this.gameState.syncRoomSeats(this.trackerRoom)
    this.controllerView.mount(this.trackerRoom)
    this.controllerView.scheduleRender()
  }

  /**
   * 主视角和先手协议到达后补齐固定视角座位顺序。
   * Seat UI 依赖固定视角；setTrackerFirstHand() 调用 getSeatUIs() 后，
   * 由 drawSeatUIs() 提交实际 DOM 布局，首轮回合只显示已经布局的容器。
   */
  setTrackerMySeatID(seatID: SeatID): void {
    if (!this.trackerRoom || this.trackerRoom.mySeatID !== undefined) return

    const normalizedSeatID = Number(seatID)
    if (!this.trackerRoom.players.has(normalizedSeatID)) return

    this.trackerRoom.setMySeatID(normalizedSeatID)
    this.trackerRoom.updateFixedViewIds()
    this.gameState.syncRoomSeats(this.trackerRoom)
    this.getSeatUIs()
    this.controllerView.scheduleRender()
  }

  setTrackerPlayerShowStatuses(statuses: readonly [SeatID, number][]): void {
    if (!this.trackerRoom?.setPlayerShowStatuses(statuses)) return
    this.getSeatUIs()
    this.controllerView.scheduleRender()
  }

  setTrackerFirstHand(seatID: SeatID): void {
    if (!this.trackerRoom) return

    try {
      const firstID = this.trackerRoom.firstID
      if (firstID !== undefined) {
        if (firstID !== seatID) {
          this.controllerLogger.warn('先手座位重复设置且不一致，已忽略', {
            currentSeatID: firstID,
            receivedSeatID: seatID
          })
        }

        return
      }

      this.trackerRoom.setFirstHand(seatID)
      this.gameState.syncRoomSeats(this.trackerRoom)
      this.getSeatUIs()
      this.controllerView.scheduleRender()
    } catch (e) {
      trackerLogger.error('先手同步失败', e)
    }
  }

  scheduleTrackerRender(): void {
    const readyRoom = this.getReadyTrackerRoom()
    if (!readyRoom) return

    readyRoom.markViewDirty('tracker-controller-render')
    this.controllerView.scheduleRender()
  }

  /**
   * 同步底层 PubGsCMoveCard 协议到 Room。
   *
   * 直接接收完整 patched：标准化、结合当前 Room 状态修正、交给 Room 执行；不再拼接协议。
   * 这层不直接改卡牌状态，状态变更统一收口在 Room.moveCards()/shufflePile()/showCards。
   */
  syncTrackerMove(
    input: Readonly<RawMoveCardEvent>,
    source: Readonly<RawMoveCardEvent> = input
  ): void {
    const readyRoom = this.getReadyTrackerRoom()
    if (!readyRoom) return

    const raw = Object.freeze({ ...source, CardIDs: Object.freeze([...source.CardIDs]) })
    const patched: PatchedMoveCardFields = { ...input, CardIDs: [...input.CardIDs] }

    try {
      Object.assign(patched, normalizeTrackerMovePosition(patched))
      this.controllerLogger.info(getProtocolMoveSpecialLabel(patched) ?? '移动协议输入', {
        raw: this.summarizeProtocolMove(raw),
        patched: this.summarizeProtocolMove(patched)
      })

      if (readyRoom.beforeNormalizeMove(patched, raw) === 'defer') return
      if (hasMixedTrackerMoveVisibility(patched)) {
        this.controllerLogger.warn('移动协议明暗牌混合，按暗牌处理', { raw, patched })
        patched.CardIDs = []
      }
      const normalizedEvent = normalizeMoveEvent(patched, raw)

      // 来源区域由协议给出；本地代表子区可能仍为 mark，不能覆盖 hand/mark 完整位置候选。
      if (normalizedEvent.options.fromSubZone === 'hand') {
        normalizedEvent.cardIDs.forEach((cardID) => {
          const card = readyRoom.cardIndex.get(cardID)
          if (
            !card ||
            card.suspended ||
            card.hasLocationCandidates() ||
            card.resolvedSeat !== normalizedEvent.options.fromSeatID ||
            !['equip', 'judge', 'mark'].includes(card.subZone)
          ) {
            return
          }

          this.controllerLogger.warn('协议手牌来源与本地确定子区冲突，仍按协议处理', {
            cardID,
            fromSeatID: normalizedEvent.options.fromSeatID,
            fromSubZone: normalizedEvent.options.fromSubZone,
            localSubZone: card.subZone,
            localSpellID: card.spellID,
            raw: this.summarizeProtocolMove(raw),
            patched: this.summarizeProtocolMove(patched)
          })
        })
      }
      this.controllerLogger.debug(
        '移动事件归一化',
        summarizeMoveEvent(normalizedEvent, MOVE_EVENT_SUMMARY_OPTIONS)
      )

      // 技能处理器
      const event = readyRoom.decorateMoveEvent(normalizedEvent)

      this.controllerLogger.debug('移动事件装饰完成', {
        before: summarizeMoveEvent(normalizedEvent, MOVE_EVENT_SUMMARY_OPTIONS),
        after: summarizeMoveEvent(event, MOVE_EVENT_SUMMARY_OPTIONS)
      })

      if (normalizedEvent.options.fromSubZone !== event.options.fromSubZone) {
        this.controllerLogger.info('移动事件来源修正', {
          cardIDs: event.cardIDs,
          fromSubZone: normalizedEvent.options.fromSubZone,
          correctedFromSubZone: event.options.fromSubZone
        })
      }

      if (event.type === 'revealPublicCandidate') {
        this.controllerLogger.info(
          '移动事件分支: revealPublicCandidate',
          summarizeMoveEvent(event, MOVE_EVENT_SUMMARY_OPTIONS)
        )
        if (!this.revealPublicCandidateCards(event)) return
      } else if (event.type === 'noop') {
        this.controllerLogger.info(
          '移动事件跳过',
          summarizeMoveEvent(event, MOVE_EVENT_SUMMARY_OPTIONS)
        )
        return
      } else if (event.type === 'showCards') {
        this.controllerLogger.info(
          '移动事件分支: showCards',
          summarizeMoveEvent(event, MOVE_EVENT_SUMMARY_OPTIONS)
        )
        if (!this.showTrackerCards(event)) return
      } else if (event.type === 'shuffleDiscardIntoPile') {
        this.controllerLogger.info(
          '移动事件分支: shuffleDiscardIntoPile',
          summarizeMoveEvent(event, MOVE_EVENT_SUMMARY_OPTIONS)
        )

        readyRoom.shufflePile({
          cardCount: event.cardCount
        })
      } else {
        this.controllerLogger.info(
          '移动事件分支: moveCards',
          summarizeMoveEvent(event, MOVE_EVENT_SUMMARY_OPTIONS)
        )
        const moveCompleted = readyRoom.moveCards(event.cardIDs, event.toZone, {
          ...event.options,
          pileIdentityEvent: event
        })
        if (!moveCompleted) {
          this.controllerLogger.warn('移动来源解析失败，已取消本次 tracker 移动', {
            cardIDs: event.cardIDs
          })
          return
        }
      }

      readyRoom.afterMoveCommitted(event)
      readyRoom.notifyCardsRevealed(event.cardIDs)
      this.controllerView.scheduleRender()
    } catch (e) {
      trackerLogger.error(
        '移动同步异常，已跳过本次 tracker 更新',
        e,
        this.summarizeProtocolMove(raw)
      )
    }
  }

  /**
   * 记录公共区范围揭示。
   * 与普通 showCards 不同，这里只确认身份属于某个端点范围，不占用或重排具体公共区槽位。
   *
   * 实体与身份处理原则：
   * - 优先复用已物化的实体（`cardIndex`）。
   * - 未定位身份由 Room 创建 detached 载体，不增加物理容量，也不重排匿名槽。
   * - 后续精确揭示或移动由 Room 在真实匿名槽上物化，并回收临时载体。
   */
  private revealPublicCandidateCards(event: NormalizedMoveEvent): boolean {
    const readyRoom = this.getReadyTrackerRoom()
    const reveal = event.options.publicCandidateReveal
    if (!readyRoom || !reveal || !(Number(reveal.count) > 0)) return false

    const ids = this.normalizeIDs(event.cardIDs).filter((id) => id > 0)
    const locationCandidate = fromPublicCandidate(
      createPublicCandidate(reveal.zone, reveal.position, Number(reveal.count))
    )
    if (ids.length === 0 || !locationCandidate) return false

    const cards = readyRoom.revealPublicCandidates(ids, locationCandidate)

    this.controllerLogger.info('公共区范围揭示完成', {
      ids,
      zone: reveal.zone,
      position: locationCandidate.position,
      count: reveal.count,
      resolvedCount: cards.length
    })
    return cards.length > 0
  }

  /**
   * 处理“展示/看牌”类移动事件。
   * 这类协议只说明卡牌变为可见，不一定意味着发生了普通移动，因此单独走明牌同步路径。
   */
  private showTrackerCards(event: NormalizedMoveEvent): boolean {
    const readyRoom = this.getReadyTrackerRoom()
    if (!readyRoom) return false

    const ids = this.normalizeIDs(event.cardIDs).filter((id) => id > 0)
    if (ids.length === 0) return false

    const raw = event.raw ?? event.options?.sourceEvent?.raw ?? {}
    const move = event.protocol
    const zone = move.ToZone ?? move.FromZone
    const seatID = move.ToID ?? move.FromID
    const subZone = getProtocolPlayerSubZone(zone, null)
    const spellID = getProtocolMarkSpellID(
      zone,
      {
        toZoneParam: move.ToZoneParam,
        fromZoneParam: move.FromZoneParam,
        spellID: move.SpellID
      },
      move.SpellID
    )

    if (subZone && seatID != null && seatID !== 255) {
      this.controllerLogger.info('展示明牌进入玩家区', {
        ids,
        seatID,
        subZone,
        spellID
      })

      return readyRoom.moveCards(ids, 'player', {
        toSeatID: seatID,
        fromSeatID: seatID,
        fromZone: null,
        fromSubZone: subZone,
        subZone,
        spellID,
        cardCount: ids.length,
        sourceEvent: event.options?.sourceEvent ?? {
          type: 'showCards',
          raw
        }
      })
    }

    const zoneName = getProtocolPublicZone(zone, event.toZone ?? 'process')
    const position = event.options?.position ?? event.options?.fromPosition ?? POSITION_TOP
    const sourceZoneName = getProtocolPublicZone(move.FromZone)
    const materializationZone =
      sourceZoneName && sourceZoneName !== zoneName ? sourceZoneName : zoneName
    const knownCards = this.resolveKnownCards(ids, {
      zoneName: materializationZone,
      position: event.options?.fromPosition ?? position
    })

    this.controllerLogger.info('展示明牌进入公共区', {
      ids,
      zoneName,
      position,
      resolvedCount: knownCards.length
    })

    if (sourceZoneName && sourceZoneName !== zoneName) {
      // 判定获得既会展示牌面，也会把实体移出来源公共区；复用标准移动链路完成来源置换，
      // 并清空协议残留的玩家槽位，避免公共区来源被误判为手牌。
      knownCards.forEach((card) => card.confirmKnown())
      return readyRoom.moveCards(ids, zoneName, {
        ...event.options,
        fromZone: sourceZoneName,
        fromSeatID: null,
        fromSubZone: null,
        cardCount: ids.length
      })
    }

    // 牌堆同区展示描述的是端点明牌事实，不能只确认牌面而保留原随机位置。
    // CardIDs 按牌顶向内排列，与 revealPileCards / 权变看牌保持一致。
    const shouldRepositionPile =
      zoneName === 'pile' && (position === POSITION_TOP || position === POSITION_BOTTOM)

    this.placePublicRevealCards(knownCards, zoneName, {
      position,
      reposition: shouldRepositionPile,
      cardIDsTopFirst: shouldRepositionPile && position === POSITION_TOP
    })
    readyRoom.applyPileIdentityReveal(ids)
    return true
  }

  /**
   * 将外部技能/协议确认的明牌写入指定目标。
   * target.type 决定进入玩家区候选还是公共区；已有物理牌会复用，缺失物理牌才补建。
   */
  revealTrackerCards(target: RevealTarget = {}, cardIDs: CardID[] | CardID = []): void {
    const readyRoom = this.getReadyTrackerRoom()
    if (!readyRoom) return

    const ids = this.normalizeIDs(cardIDs).filter((id) => id > 0)
    if (ids.length === 0) return

    try {
      this.controllerLogger.info('明牌同步输入', { target, cardIDs: ids })

      if (target.type === 'player') {
        const seatID = Number(target.seatID)
        if (Number.isNaN(seatID) || seatID === 255) return

        const subZone = target.subZone ?? 'hand'
        if (target.fullHand && subZone === 'hand') {
          const handCount = Number(target.handCount ?? ids.length)
          readyRoom.syncObservedPlayerHandCount(seatID, handCount, { resolve: false })
        }

        const completed = readyRoom.moveCards(ids, 'player', {
          toSeatID: seatID,
          fromSeatID: target.fromSeatID ?? (target.fromZone == null ? seatID : undefined),
          fromZone: target.fromZone ?? null,
          fromSubZone: target.fromSubZone ?? subZone,
          subZone,
          spellID: target.spellID ?? null,
          cardCount: ids.length,
          handMoveCount: target.handMoveCount,
          sourceEvent: target.sourceEvent ?? {
            type: 'revealCards',
            raw: { target, cardIDs: ids }
          }
        })
        if (!completed) return
      } else if (target.type === 'public') {
        const zoneName = target.zoneName ?? 'pile'
        const position = target.position ?? POSITION_TOP
        const knownCards = this.resolveKnownCards(ids, { zoneName, position })
        this.placePublicRevealCards(knownCards, zoneName, {
          position,
          reposition: target.reposition === true,
          cardIDsTopFirst: target.cardIDsTopFirst === true
        })
      } else {
        return
      }

      // target 只描述展示目标，不能证明已有实体真的离开原公共区；例如弃牌区重复明示
      // 仍会保持在 discard。让 Room 根据同步完成后的 Card.location 写入账本分区。
      readyRoom.applyPileIdentityReveal(ids)
      readyRoom.notifyCardsRevealed(ids)
      this.controllerView.scheduleRender()
    } catch (e) {
      trackerLogger.error('明牌同步失败', e, { target, cardIDs: ids })
    }
  }

  /** 分发非移动技能事实；插件补齐的待提交移动仍走同一条移动管线。 */
  dispatchSkillProtocolEvent(event: SkillProtocolEvent): void {
    const readyRoom = this.getReadyTrackerRoom()
    if (!readyRoom) return
    try {
      const moves = readyRoom.dispatchSkillProtocolEvent(event)
      for (const move of moves) this.syncTrackerMove(move.patched, move.raw)
    } catch (error) {
      trackerLogger.error('技能协议处理失败', error, event)
    }
  }

  /**
   * 公共区明牌落点：确认牌面，并按需把已有实体纠正到指定端点。
   * 普通明牌只补缺失实体；牌堆端点明牌还要纠正已有实体的位置。
   * 先比较端点序列，避免重复协议再次改动 Zone 并制造无效脏渲染。
   */
  private placePublicRevealCards(
    knownCards: Card[],
    zoneName: PublicZoneName,
    options: {
      position?: PublicPosition
      reposition?: boolean
      cardIDsTopFirst?: boolean
    } = {}
  ): void {
    const readyRoom = this.getReadyTrackerRoom()
    if (!readyRoom) return

    const position = options.position ?? POSITION_TOP
    const targetZone = readyRoom.zones.get(zoneName)

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

      if (!readyRoom.zones.has(card.location as PublicZoneName)) {
        placeableCards.push(card)
        return
      }

      // 其它公共区（如 discard/process）留给跨区移动分支，避免把弃牌直接拽回牌顶。
      skippedCards.push(card)
    })

    if (skippedCards.length > 0) {
      this.controllerLogger.info('公共区展示跳过无法回收的实体', {
        zoneName,
        skippedIDs: skippedCards.map((card) => card.id),
        skippedLocations: skippedCards.map((card) => card.location)
      })
    }

    placeableCards.forEach((card) => {
      readyRoom.removeCardsFromConstraintGroups([card])
      card.confirmKnown()
    })

    const missingCards = placeableCards.filter((card) => !targetZone?.cards.includes(card))
    const repositionCards =
      options.cardIDsTopFirst === true && position === POSITION_TOP
        ? [...placeableCards].reverse()
        : placeableCards
    const shouldReposition =
      options.reposition === true &&
      Boolean(targetZone) &&
      placeableCards.length > 0 &&
      !hasCardsAtPublicPosition(targetZone.cards, repositionCards, position)
    const cardsToPlace = shouldReposition ? repositionCards : missingCards

    if (cardsToPlace.length > 0) {
      targetZone?.add(cardsToPlace, position)
    }

    readyRoom.resolveConstraints()
  }

  /**
   * 把旧协议 Zone 标识转换为 revealTrackerCards 可理解的目标。
   * 该入口用于知己知彼、观星类“按协议区明示卡牌”的技能。
   */
  revealTrackerCardsInZone(protocolZone: ProtocolZoneInput, cardIDs: CardID[] | CardID = []): void {
    const ids = this.normalizeIDs(cardIDs).filter((id) => id > 0)
    const { zone, id, spellID = null, pos } = protocolZone

    if (isProtocolPlayerZone(zone) && id !== 255) {
      const subZone = getProtocolPlayerSubZone(zone)
      this.revealTrackerCards(
        {
          type: 'player',
          seatID: id,
          fromSeatID: id,
          fromZone: null,
          fromSubZone: subZone,
          subZone,
          spellID,
          sourceEvent: {
            type: 'revealCards',
            label: 'protocolZone.reveal',
            raw: { protocolZone, cardIDs: ids }
          }
        },
        ids
      )
      return
    }

    this.revealTrackerCards(
      {
        type: 'public',
        zoneName: getProtocolPublicZone(zone, 'process'),
        // 协议端点直接透传；未指定时默认牌顶，不做顶底互换。
        position: pos ?? POSITION_TOP,
        // 牌堆观看协议描述的是端点事实，不能只确认牌面而保留原随机位置。
        reposition: zone === 1,
        // 未携带 pos 的牌堆观看结果按“第一张是牌顶”解释。
        cardIDsTopFirst: zone === 1 && pos == null,
        sourceEvent: {
          type: 'revealCards',
          label: 'protocolZone.reveal',
          raw: { protocolZone, cardIDs: ids }
        }
      },
      ids
    )
  }

  private normalizeIDs(cardIDs: readonly CardID[] | CardID = []): CardID[] {
    return typeof cardIDs === 'number' ? [cardIDs] : [...cardIDs]
  }

  /**
   * 移动日志摘要只保留协议定位字段，避免日志里展开完整原始对象。
   */
  private summarizeProtocolMove(msg: RawMoveCardEvent) {
    return {
      CardIDs: this.normalizeIDs(msg.CardIDs),
      CardCount: msg.CardCount,
      FromZone: msg.FromZone,
      FromID: msg.FromID,
      FromZoneParam: msg.FromZoneParam,
      FromPosition: msg.FromPosition,
      ToZone: msg.ToZone,
      ToID: msg.ToID,
      ToZoneParam: msg.ToZoneParam,
      ToPosition: msg.ToPosition,
      MoveType: msg.MoveType,
      SpellID: msg.SpellID
    }
  }

  /**
   * 按物理 ID 取得 Card 实体；公共区展示优先在端点匿名槽物化。
   * 只有身份既未定位、也不属于本局待定位集合时，才按游戏外新牌补建实体。
   */
  private resolveKnownCards(
    ids: CardID[],
    target: { zoneName: PublicZoneName; position: PublicPosition } | null = null
  ): Card[] {
    const readyRoom = this.getReadyTrackerRoom()
    if (!readyRoom) return []

    if (target) {
      readyRoom.materializeAtPublicEndpoint(ids, target.zoneName, target.position)
    }

    const existingCards = readyRoom
      .findCardsByIDs(ids)
      .filter((card) => !readyRoom.detachedKnownCards.has(card))
    const existingIDs = new Set(existingCards.map((card) => card.id))
    const missingIDs = ids.filter(
      (id) =>
        !existingIDs.has(id) &&
        !readyRoom.unlocatedIdentities.has(id) &&
        !readyRoom.cardIndex.has(id)
    )
    const createdCards =
      missingIDs.length > 0 ? readyRoom.createExternalCards(missingIDs, missingIDs.length) : []
    const cardMap = new Map<CardID, Card>()
    existingCards.forEach((card) => cardMap.set(card.id, card))
    createdCards.forEach((card) => cardMap.set(card.id, card))

    // 仍停留在 unlocatedIdentities 的正 ID：既未物化到匿名槽（端点无匿名槽可用），
    // 也不会被当作游戏外缺失身份补建，最终会静默从 knownCards 掉出。
    // 这里补一条告警让「揭示丢失」可观测，而不是无声短少。
    const unresolvedIdentityIDs = ids.filter(
      (id) => !cardMap.has(id) && readyRoom.unlocatedIdentities.has(id)
    )
    if (unresolvedIdentityIDs.length > 0) {
      this.controllerLogger.warn('揭示身份未能物化到匿名槽，已从已知牌集合中略过', {
        reason: 'resolveKnownCards:unresolvedUnlocatedIdentity',
        unresolvedIdentityIDs,
        target
      })
    }

    return ids.map((id) => cardMap.get(id)).filter((card): card is Card => Boolean(card))
  }

  destroyTrackerRoom(): void {
    try {
      this.controllerView.unmount()
      this.trackerRoom?.destroy()
      this.gameState.bindRoom(null)
      this.trackerRoom = null
      this.controllerLogger.info('Room 销毁')
    } catch (e) {
      trackerLogger.error('Room 销毁失败', e)
    }
  }
}
