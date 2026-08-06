import { UI } from './state'
import { trackerLogger } from '@/utils/logger'
import { getDisplayIdLabel, ORDER_LABELS } from './helper/seatLabel'
import type { Player } from './Player'
import type { Room } from './Room'
import type { SeatID } from './types'

export { ORDER_LABELS } from './helper/seatLabel'

type GeneralChangeListener = (player: Player, orderLabels: readonly string[]) => void

/**
 * 纯对局状态与运行时适配对象。
 *
 * 维护记牌器核心需要读取的时间、座位与技能计数数据，并通过注入监听器通知展示层。
 */
export class GameState {
  isRecord = false
  isGameStart = false
  isPassed = true

  declare orderLabels: string[]
  /** 轮次 */
  declare turn: number
  /** 更像是行动过的回合数 */
  declare round: number
  /** 用于记录当前回合阶段 */
  declare phase: number
  declare spellSpace: Record<string | number, unknown>
  declare configHandCards: unknown[]
  declare configHandCardsMode: string
  declare configHandCardsRejected: boolean
  declare room: Room | null
  declare seatIDs: SeatID[]
  declare orderIDs: SeatID[]
  /** 己方座位 比如22 队友明牌 */
  declare mySeats: SeatID[]
  declare isShanHeTu: boolean
  declare isGuoZhan: boolean
  declare isDouDiZhu: boolean
  declare isRoguelike1v1: boolean
  declare isSWJG: boolean
  /** 房间人数 由 Room 同步 */
  declare size: number | undefined
  declare isDuanXian: boolean

  /** 排位赛斗地主展示名字 */
  needShowName = false

  declare currentID: SeatID | undefined
  myGenerals: number[] = []
  /** 阵营 统率占位 替代mySeats */
  camps: number[] = []
  // 目前没用 打算这里存筛选后的战法
  zhanfaSet = new Set()
  private generalChangeListener: GeneralChangeListener | null = null

  constructor({ orderLabels = ORDER_LABELS }: { orderLabels?: string[] } = {}) {
    this.orderLabels = orderLabels
    this.room = null
    this.resetSessionState()
    this.resetRoomState()
  }

  private resetSessionState(): void {
    this.turn = 0
    this.round = 0
    this.phase = 0
    this.currentID = undefined
    this.isRecord = false
    this.isGameStart = false
    this.isPassed = true
    this.spellSpace = {}
    this.resetConfigHandCards()
  }

  bindRoom(room: Room | null): void {
    this.room = room ?? null
    if (!room) {
      this.resetRoomState()
      return
    }

    this.syncRoomSeats(room)
  }

  /** 获取主视角房间座位 */
  get myID(): SeatID | undefined {
    return this.room?.mySeatID ?? undefined
  }

  getCurrentTimestamp(): { turn: number; round: number; phase: number } {
    return {
      turn: this.turn ?? 0,
      round: this.round ?? 0,
      phase: this.phase ?? 0
    }
  }

  resetRoomState(): void {
    this.seatIDs = []
    this.orderIDs = []
    // this.mySeats = []
    this.myGenerals.length = 0

    this.isShanHeTu = false
    this.isGuoZhan = false
    this.isDouDiZhu = false
    this.isRoguelike1v1 = false
    this.isSWJG = false

    this.size = undefined
    this.isDuanXian = false
    this.needShowName = false

    this.zhanfaSet.clear()
  }

  setGeneral(seatID: SeatID, generalID: number | undefined, index = 0, _an = false): void {
    if (generalID === undefined) return

    const player = this.room?.getPlayer(seatID)
    if (!player) return

    if (player.generals.length === 0) {
      player.generals = Array(this.isGuoZhan ? 2 : 1).fill(0)
    }

    player.generals[index] = generalID

    if (seatID === this.myID) {
      this.myGenerals[index] = generalID
    }

    this.generalChangeListener?.(player, this.orderLabels)
  }

  /** 注册武将更新后的运行时展示回调。 */
  setGeneralChangeListener(listener: GeneralChangeListener | null): void {
    this.generalChangeListener = listener
  }

  // 座位名 只是兼容糜竺
  name(seatID: SeatID): string {
    const displayID = this.room?.getDisplayID(seatID)
    if (!displayID) return ''

    return getDisplayIdLabel(displayID, this.orderLabels)
  }

  getSpellState<T = unknown>(spellID: PropertyKey): T | undefined {
    return (this.spellSpace as Record<PropertyKey, unknown>)[spellID] as T | undefined
  }

  setSpellState(spellID: PropertyKey, value: unknown): void {
    ;(this.spellSpace as Record<PropertyKey, unknown>)[spellID] = value
  }

  ensureSpellState<T>(spellID: PropertyKey, createState: () => T): T {
    const existingState = this.getSpellState<T>(spellID)
    if (existingState !== undefined) return existingState

    const state = createState()
    this.setSpellState(spellID, state)
    return state
  }

  deleteSpellState(spellID: PropertyKey): void {
    delete (this.spellSpace as Record<PropertyKey, unknown>)[spellID]
  }

  syncRoomSeats(room: Room | null = this.room): void {
    if (!room) return
    this.seatIDs = room.seatIDs.slice()
    this.size = room.size
  }

  /** 重置记牌器手牌配置会话状态 */
  resetConfigHandCards(): void {
    this.configHandCards = []
    this.configHandCardsMode = 'all'
    this.configHandCardsRejected = false
  }

  init(): void {
    this.reset()
    this.isGameStart = true
    this.isPassed = false
    trackerLogger.info('GameState 游戏已重置并开始')

    UI.seatUIs = []
    UI.friendGeneral = 0
  }

  end(): void {
    if (this.isGameStart && !this.isPassed) {
      this.isRecord = false
      this.isGameStart = false
      this.isPassed = true
      this.resetRoomState()
      trackerLogger.info('GameState 游戏已结束')
    }
  }

  start(): void {
    const seatIDs = this.room?.seatIDs ?? []
    const mySeatID = this.room?.mySeatID ?? undefined
    trackerLogger.info('GameState 游戏开始', { seatIDs, mySeatID })

    if (this.isGameStart) return

    this.isGameStart = true
    this.isPassed = false
  }

  /** 个人阶段 */
  enter(round: number, seat: SeatID): void {
    // round 是当前角色的阶段 4是出牌阶段
    // 0是回合开始时
    if (round === 0) {
      // 主公一号位开始阶段 此时turn还是0
      if (!this.turn) this.start()

      if (this.currentID === this.myID) {
        this.spellSpace['手到擒来'] = this.spellSpace['多多益善'] = 0
      }

      this.currentID = seat
      this.round++
      this.phase = 0
      // 国战乱击
      delete this.spellSpace[2143]
      // 畜鸣 3271
    } else {
      this.phase++
    }
  }

  /** 每轮 */
  setTurn(turn: number): void {
    // 当收到第一轮消息时 round 是 1
    this.turn = turn
    // 这里重置成0 或许不是很对
    this.round = 0

    // 博图
    delete this.spellSpace[3090]
  }

  shaCounter(): void {
    this.spellSpace['三板斧'] = ((this.spellSpace['三板斧'] as number) || 0) + 1
  }

  useCounter(): void {
    this.spellSpace['手到擒来'] = ((this.spellSpace['手到擒来'] as number) || 0) + 1
  }

  drawCounter(count: number): void {
    this.spellSpace['神龙摆尾'] = ((this.spellSpace['神龙摆尾'] as number) || 0) + count
    this.spellSpace['多多益善'] = ((this.spellSpace['多多益善'] as number) || 0) + 1
  }

  reset(): void {
    this.resetSessionState()
    this.resetRoomState()
  }
}

export const Game = new GameState({ orderLabels: UI.ORDER_LABELS })
