import { POSITION_BOTTOM, POSITION_TOP } from '../candidate/cardPositions'
import type { Card } from '../Card'
import { summarizeMoveEvent } from '../helper/moveSummary'
import { getProtocolMoveSpecialLabel, normalizeMoveEvent } from '../MoveEventNormalizer'
import {
  getProtocolMarkSpellID,
  getProtocolPlayerSubZone,
  getProtocolPublicZone,
  isProtocolPlayerZone
} from '../protocolZones'
import { Room } from '../Room'
import type {
  CardID,
  MoveOptions,
  NormalizedMoveEvent,
  PublicPosition,
  PublicZoneName,
  RawMoveCardEvent,
  SeatID,
  SeatInfo,
  SpellID,
  TrackerControllerOptions,
  TrackerLogger,
  TrackerRuntime,
  TrackerView
} from '../types'
import { registerDefaultMoveEventHandlers } from './moveEventHandlers'

interface RevealTarget {
  type?: 'player' | 'public' | string
  seatID?: SeatID
  fromSeatID?: SeatID
  fromZone?: PublicZoneName | null
  fromSubZone?: string
  subZone?: string
  spellID?: SpellID | string | null
  fullHand?: boolean
  handCount?: number | string
  zoneName?: PublicZoneName
  position?: PublicPosition
  sourceEvent?: MoveOptions['sourceEvent']
}

interface ProtocolZoneInput {
  zoneID?: string
  zone?: number | string
  id?: number | string
  spellID?: SpellID | string | null
  pos?: PublicPosition
}

interface NormalizedProtocolZoneTarget {
  zone: number
  id: number
  spellID: SpellID | null
  position: PublicPosition
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

function defaultErrorHandler(...args: unknown[]): void {
  console.error(...args)
}

function createDefaultRoom({ gameState }: { gameState?: TrackerRuntime | null } = {}): Room {
  return gameState == null ? new Room() : new Room({ gameState } as any)
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
  private readonly gameState: TrackerRuntime | null
  private readonly runtime: TrackerRuntime | null
  private readonly roomFactory: NonNullable<TrackerControllerOptions['roomFactory']>
  private readonly getSeatUIs: NonNullable<TrackerControllerOptions['getSeatUIs']>
  private readonly onError: NonNullable<TrackerControllerOptions['onError']>
  private readonly registerMoveEventHandlers: NonNullable<
    TrackerControllerOptions['registerMoveEventHandlers']
  >
  private trackerRoom: Room | null = null

  constructor({
    view = noopView,
    gameState = null,
    runtime = gameState,
    roomFactory = createDefaultRoom,
    getSeatUIs = () => {},
    logger = noopLogger,
    onError = defaultErrorHandler,
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
    this.runtime = runtime
    this.roomFactory = roomFactory
    this.getSeatUIs = getSeatUIs
    this.onError = onError
    this.registerMoveEventHandlers = registerMoveEventHandlers
  }

  private getRuntime(): TrackerRuntime | null | undefined {
    return this.runtime ?? this.trackerRoom?.game
  }

  getTrackerRoom(): Room | null {
    return this.trackerRoom
  }

  isTrackerReady(): boolean {
    return Boolean(this.trackerRoom?.isDeckReady && !this.getRuntime()?.isDuanXian)
  }

  getReadyTrackerRoom(): Room | null {
    return this.isTrackerReady() ? this.trackerRoom : null
  }

  /**
   * 开局协议到达后创建单局 Room。
   * 旧 Room 必须先销毁，避免断线/重进导致上一局约束组继续影响新牌局。
   */
  initTrackerRoom(): void {
    try {
      this.trackerRoom?.destroy()
      this.trackerRoom = this.roomFactory({ gameState: this.gameState })
      this.getRuntime()?.bindRoom?.(this.trackerRoom)
      this.controllerLogger.info('Room 初始化')
      this.registerMoveEventHandlers(this.trackerRoom)
    } catch (e) {
      this.onError('[Refactor] Room 初始化失败:', e)
      this.controllerView.unmount()
      this.trackerRoom?.destroy()
      this.getRuntime()?.bindRoom?.(null)
      this.trackerRoom = null
    }
  }

  /**
   * 牌堆协议到达后初始化物理牌池，并在牌池可用后挂载视图。
   * 断线重连局面暂不重建牌堆，因为宿主只给局部状态，强行初始化会制造错误确定性。
   */
  initTrackerDeck(cardIDs: CardID[]): void {
    if (!this.trackerRoom) return

    if (this.getRuntime()?.isDuanXian) {
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
    this.getRuntime()?.syncRoomSeats?.(this.trackerRoom)
    this.controllerView.mount(this.trackerRoom)
    this.controllerView.scheduleRender()
  }

  /**
   * 先手协议到达后补齐固定视角座位顺序。
   * Seat UI 依赖固定视角，必须在这里主动刷新宿主座位覆盖层。
   */
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
      this.getRuntime()?.syncRoomSeats?.(this.trackerRoom)
      this.getSeatUIs()
      this.controllerView.scheduleRender()
    } catch (e) {
      this.onError('[Refactor] 先手同步失败:', e)
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
   * 流程分四步：协议字段补丁、标准化、结合当前 Room 状态修正、交给 Room 执行。
   * 这层不直接改卡牌状态，状态变更统一收口在 Room.moveCards()/shufflePile()/showCards。
   */
  syncTrackerMove(msg: RawMoveCardEvent, finalMove: Partial<RawMoveCardEvent> = {}): void {
    const readyRoom = this.getReadyTrackerRoom()
    if (!readyRoom) return

    try {
      const patchedMsg = {
        ...msg,
        ...finalMove,
        CardIDs: finalMove.CardIDs ?? msg.CardIDs
      }

      this.controllerLogger.info(getProtocolMoveSpecialLabel(patchedMsg) ?? '移动协议输入', {
        raw: this.summarizeProtocolMove(msg),
        patched: this.summarizeProtocolMove(patchedMsg)
      })

      const rawEvent = normalizeMoveEvent(patchedMsg)

      // rawEvent 只代表协议文本；下一步还要根据当前卡牌状态修正来源子区。
      this.controllerLogger.debug(
        '移动事件归一化',
        summarizeMoveEvent(rawEvent, MOVE_EVENT_SUMMARY_OPTIONS)
      )

      const stateEvent = this.normalizeEventWithTrackerState(rawEvent)
      const event = readyRoom.decorateMoveEvent(stateEvent)
      this.controllerLogger.debug('移动事件装饰完成', {
        before: summarizeMoveEvent(stateEvent, MOVE_EVENT_SUMMARY_OPTIONS),
        after: summarizeMoveEvent(event, MOVE_EVENT_SUMMARY_OPTIONS)
      })

      if (rawEvent.options.fromSubZone !== event.options.fromSubZone) {
        this.controllerLogger.info('移动事件来源修正', {
          cardIDs: event.cardIDs,
          fromSubZone: rawEvent.options.fromSubZone,
          correctedFromSubZone: event.options.fromSubZone
        })
      }

      if (event.type === 'noop') {
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
        this.showTrackerCards(event)
      } else if (event.type === 'shuffleDiscardIntoPile') {
        this.controllerLogger.info(
          '移动事件分支: shuffleDiscardIntoPile',
          summarizeMoveEvent(event, MOVE_EVENT_SUMMARY_OPTIONS)
        )
        readyRoom.shufflePile({ cardCount: event.cardCount })
      } else {
        this.controllerLogger.info(
          '移动事件分支: moveCards',
          summarizeMoveEvent(event, MOVE_EVENT_SUMMARY_OPTIONS)
        )
        readyRoom.moveCards(event.cardIDs, event.toZone, event.options)
      }

      this.controllerView.scheduleRender()
    } catch (e) {
      this.controllerLogger.warn('移动同步异常，已跳过本次 tracker 更新', {
        error: e,
        raw: this.summarizeProtocolMove(msg)
      })
      this.onError('[Refactor] 移动同步失败:', e, msg)
    }
  }

  /**
   * 处理“展示/看牌”类移动事件。
   * 这类协议只说明卡牌变为可见，不一定意味着发生了普通移动，因此单独走明牌同步路径。
   */
  private showTrackerCards(event: NormalizedMoveEvent): void {
    const readyRoom = this.getReadyTrackerRoom()
    if (!readyRoom) return

    const ids = this.normalizeIDs(event.cardIDs).filter((id) => id > 0)
    if (ids.length === 0) return

    const raw = event.raw ?? event.options?.sourceEvent?.raw ?? {}
    const zone = Number(raw.ToZone ?? raw.FromZone)
    const seatID = Number(raw.ToID ?? raw.FromID)
    const subZone = getProtocolPlayerSubZone(zone, null)
    const spellID = getProtocolMarkSpellID(
      zone,
      {
        toZoneParam: raw.ToZoneParam,
        fromZoneParam: raw.FromZoneParam,
        spellID: raw.SpellID
      },
      (raw.SpellID as SpellID | string | null | undefined) ?? null
    )

    if (subZone && !Number.isNaN(seatID) && seatID !== 255) {
      this.controllerLogger.info('展示明牌进入玩家区', {
        ids,
        seatID,
        subZone,
        spellID
      })

      readyRoom.moveCards(ids, 'player', {
        seatID,
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

      return
    }

    const zoneName = getProtocolPublicZone(zone, event.toZone ?? 'process')
    const targetZone = readyRoom.zones.get(zoneName)
    const knownCards = this.resolveKnownCards(ids)
    this.controllerLogger.info('展示明牌进入公共区', {
      ids,
      zoneName,
      position: event.options?.position ?? POSITION_TOP,
      resolvedCount: knownCards.length
    })

    knownCards.forEach((card) => {
      readyRoom.removeCardsFromConstraintGroups([card])
      card.confirmKnown()
    })

    const missingCards = knownCards.filter((card) => !targetZone?.cards.includes(card))

    if (missingCards.length > 0) {
      targetZone?.add(missingCards, event.options?.position ?? POSITION_TOP)
    }

    readyRoom.resolveConstraints()
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

        readyRoom.moveCards(ids, 'player', {
          seatID,
          fromSeatID: target.fromSeatID ?? seatID,
          fromZone: target.fromZone ?? null,
          fromSubZone: target.fromSubZone ?? subZone,
          subZone,
          spellID: target.spellID ?? null,
          cardCount: ids.length,
          sourceEvent: target.sourceEvent ?? {
            type: 'revealCards',
            raw: { target, cardIDs: ids }
          }
        })
      } else if (target.type === 'public') {
        const zoneName = target.zoneName ?? 'pile'
        const position = target.position ?? POSITION_TOP
        const knownCards = this.resolveKnownCards(ids)
        const targetZone = readyRoom.zones.get(zoneName)

        knownCards.forEach((card) => {
          readyRoom.removeCardsFromConstraintGroups([card])
          card.confirmKnown()
        })

        const missingCards = knownCards.filter((card) => !targetZone?.cards.includes(card))

        if (missingCards.length > 0) {
          targetZone?.add(missingCards, position)
        }

        readyRoom.resolveConstraints()
      } else {
        return
      }

      this.controllerView.scheduleRender()
    } catch (e) {
      this.onError('[Refactor] 明牌同步失败:', e, { target, cardIDs: ids })
    }
  }

  /**
   * 把旧协议 Zone 标识转换为 revealTrackerCards 可理解的目标。
   * 该入口用于知己知彼、观星类“按协议区明示卡牌”的技能。
   */
  revealTrackerCardsInZone(protocolZone: ProtocolZoneInput, cardIDs: CardID[] | CardID = []): void {
    const ids = this.normalizeIDs(cardIDs).filter((id) => id > 0)
    const zoneInfo = this.normalizeProtocolZoneTarget(protocolZone)

    if (isProtocolPlayerZone(zoneInfo.zone) && zoneInfo.id !== 255) {
      const subZone = getProtocolPlayerSubZone(zoneInfo.zone)
      this.revealTrackerCards(
        {
          type: 'player',
          seatID: zoneInfo.id,
          fromSeatID: zoneInfo.id,
          fromZone: null,
          fromSubZone: subZone,
          subZone,
          spellID: zoneInfo.spellID,
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
        zoneName: getProtocolPublicZone(zoneInfo.zone, 'process'),
        position: zoneInfo.position,
        sourceEvent: {
          type: 'revealCards',
          label: 'protocolZone.reveal',
          raw: { protocolZone, cardIDs: ids }
        }
      },
      ids
    )
  }

  /**
   * 根据当前 Room 中已知卡牌位置修正移动来源子区。
   * 协议有时把装备/判定/标记区移动写成手牌来源；若不修正，会错误扣减手牌额度。
   */
  private normalizeEventWithTrackerState(event: NormalizedMoveEvent): NormalizedMoveEvent {
    const readyRoom = this.getReadyTrackerRoom()
    if (!readyRoom || event.options.fromSubZone !== 'hand') return event

    const fromSeat = Number(event.options.fromSeatID)
    if (Number.isNaN(fromSeat)) return event

    const actualSubZones = new Set(
      readyRoom
        .findCardsByIDs(event.cardIDs)
        .filter(
          (card) =>
            card.location === 'player' &&
            card.seats.has(fromSeat) &&
            card.subZone &&
            card.subZone !== 'hand'
        )
        .map((card) => card.subZone)
    )

    if (actualSubZones.size !== 1) return event

    const fromSubZone = Array.from(actualSubZones)[0]
    return {
      ...event,
      options: {
        ...event.options,
        fromSubZone,
        subZone: event.toZone === 'player' ? event.options.subZone : fromSubZone
      }
    }
  }

  private normalizeIDs(cardIDs: CardID[] | CardID = []): CardID[] {
    return (Array.isArray(cardIDs) ? cardIDs : [cardIDs]).map((id) => Number(id) || 0)
  }

  /**
   * 移动日志摘要只保留协议定位字段，避免日志里展开完整原始对象。
   */
  private summarizeProtocolMove(msg: RawMoveCardEvent = {}) {
    return {
      CardIDs: this.normalizeIDs(msg.CardIDs),
      CardCount: msg.CardCount,
      FromZone: msg.FromZone,
      FromID: msg.FromID,
      FromZoneParam: msg.FromZoneParam,
      ToZone: msg.ToZone,
      ToID: msg.ToID,
      ToZoneParam: msg.ToZoneParam,
      MoveType: msg.MoveType,
      SpellID: msg.SpellID
    }
  }

  /**
   * 按物理 ID 取得 Card 实体；若明牌来自游戏外区域且牌池没有实体，则补建外部牌。
   */
  private resolveKnownCards(ids: CardID[]): Card[] {
    const readyRoom = this.getReadyTrackerRoom()
    if (!readyRoom) return []

    const existingCards = readyRoom.findCardsByIDs(ids)
    const existingIDs = new Set(existingCards.map((card) => card.id))
    const missingIDs = ids.filter((id) => !existingIDs.has(id))
    const createdCards =
      missingIDs.length > 0 ? readyRoom.createExternalCards(missingIDs, missingIDs.length) : []
    const cardMap = new Map<CardID, Card>()
    existingCards.forEach((card) => cardMap.set(card.id, card))
    createdCards.forEach((card) => cardMap.set(card.id, card))

    return ids.map((id) => cardMap.get(id)).filter((card): card is Card => Boolean(card))
  }

  /**
   * 兼容旧 zoneID 字符串和新版结构化 protocolZone。
   * 牌堆顶/底方向在协议和 Zone 内部表示相反，所以这里统一翻转。
   */
  private normalizeProtocolZoneTarget(
    protocolZone: ProtocolZoneInput = {}
  ): NormalizedProtocolZoneTarget {
    const parts = String(protocolZone.zoneID ?? '').split('-')
    const zone = Number(protocolZone.zone ?? parts[0])
    const id = Number(String(protocolZone.id ?? parts[1] ?? 255).split('-')[0])
    const spellID = Number(parts[2] ?? protocolZone.spellID)
    const normalizedZone = Number.isFinite(zone) ? zone : 5
    let position = protocolZone.pos ?? POSITION_TOP

    // 协议牌堆端点和 Zone.add/remove 的内部端点约定相反，进入记牌器前先交换方向。
    if (normalizedZone === 1) {
      if (position === POSITION_BOTTOM) position = POSITION_TOP
      else if (position === POSITION_TOP) position = POSITION_BOTTOM
    }

    return {
      zone: normalizedZone,
      id: Number.isFinite(id) ? id : 255,
      spellID: Number.isFinite(spellID) ? spellID : null,
      position
    }
  }

  destroyTrackerRoom(): void {
    try {
      this.controllerView.unmount()
      this.trackerRoom?.destroy()
      this.getRuntime()?.bindRoom?.(null)
      this.trackerRoom = null
      this.controllerLogger.info('Room 销毁')
    } catch (e) {
      this.onError('[Refactor] Room 销毁失败:', e)
    }
  }
}
