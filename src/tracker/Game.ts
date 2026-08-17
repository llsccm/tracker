import { UI } from './state'
import { trackerLogger } from '@/utils/logger'
import { getDisplayIdLabel, ORDER_LABELS } from './helper/seatLabel'
import type { Player } from './Player'
import type { Room } from './Room'
import type { SeatID } from './types'

export { ORDER_LABELS } from './helper/seatLabel'

type GeneralChangeListener = (player: Player, orderLabels: readonly string[]) => void

export type GameStateScope = 'spell' | 'tracker'
export type GameStateKey = string | number
type StoredGameStateKey = `${GameStateScope}:${string}`

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
  /**
   * 当前一局共用的临时状态仓库。
   *
   * Game 是跨模块通信使用的稳定单例门面，但这里保存的内容只属于当前一局。`spell` 与
   * `tracker` 仅作为 key 命名空间，分别兼容 handler/UI 状态和记牌器推断状态；两者在
   * GameState.end()、reset()/init() 以及 Room 替换或销毁时统一清理。
   */
  private readonly stateStore = new Map<StoredGameStateKey, unknown>()
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
    this.clearStateStore()
    this.resetConfigHandCards()
  }

  bindRoom(room: Room | null): void {
    const nextRoom = room ?? null
    if (nextRoom !== this.room) this.clearStateStore()

    this.room = nextRoom
    if (!nextRoom) {
      this.resetRoomState()
      return
    }

    this.syncRoomSeats(nextRoom)
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

  /** 判断当前一局的指定命名空间是否已经保存状态。 */
  hasState(scope: GameStateScope, stateKey: GameStateKey): boolean {
    return this.stateStore.has(this.getStateStoreKey(scope, stateKey))
  }

  /** 只读获取当前一局状态；不存在时不创建。 */
  readState<T = unknown>(scope: GameStateScope, stateKey: GameStateKey): T | undefined {
    return this.stateStore.get(this.getStateStoreKey(scope, stateKey)) as T | undefined
  }

  /** 取得当前一局状态，不存在时按需创建。 */
  ensureState<T>(scope: GameStateScope, stateKey: GameStateKey, createState: () => T): T {
    const storeKey = this.getStateStoreKey(scope, stateKey)
    if (this.stateStore.has(storeKey)) return this.stateStore.get(storeKey) as T

    const state = createState()
    this.stateStore.set(storeKey, state)
    return state
  }

  /** 写入当前一局状态。 */
  setState<T>(scope: GameStateScope, stateKey: GameStateKey, state: T): void {
    this.stateStore.set(this.getStateStoreKey(scope, stateKey), state)
  }

  /** 删除当前一局状态。 */
  deleteState(scope: GameStateScope, stateKey: GameStateKey): void {
    this.stateStore.delete(this.getStateStoreKey(scope, stateKey))
  }

  /** handler/UI 使用的 `spell` 命名空间兼容读取入口。 */
  getSpellState<T = unknown>(spellID: GameStateKey): T | undefined {
    return this.readState<T>('spell', spellID)
  }

  /** handler/UI 使用的 `spell` 命名空间兼容写入入口。 */
  setSpellState<T>(spellID: GameStateKey, value: T): void {
    this.setState('spell', spellID, value)
  }

  /** handler/UI 使用的 `spell` 命名空间兼容创建入口。 */
  ensureSpellState<T>(spellID: GameStateKey, createState: () => T): T {
    return this.ensureState('spell', spellID, createState)
  }

  /** handler/UI 使用的 `spell` 命名空间兼容删除入口。 */
  deleteSpellState(spellID: GameStateKey): void {
    this.deleteState('spell', spellID)
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
    // 对局结束即释放所有局内协议/UI 暂存和记牌器推断状态，避免下一局串状态。
    this.clearStateStore()

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
        this.setSpellState('手到擒来', 0)
        this.setSpellState('多多益善', 0)
      }

      this.currentID = seat
      this.round++
      this.phase = 0
      // 国战乱击
      this.deleteSpellState(2143)
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
    this.deleteSpellState(3090)
  }

  shaCounter(): void {
    const count = Number(this.getSpellState('三板斧')) || 0
    this.setSpellState('三板斧', count + 1)
  }

  useCounter(): void {
    const count = Number(this.getSpellState('手到擒来')) || 0
    this.setSpellState('手到擒来', count + 1)
  }

  drawCounter(count: number): void {
    const drawCount = Number(this.getSpellState('神龙摆尾')) || 0
    const drawTimes = Number(this.getSpellState('多多益善')) || 0
    this.setSpellState('神龙摆尾', drawCount + count)
    this.setSpellState('多多益善', drawTimes + 1)
  }

  reset(): void {
    this.resetSessionState()
    this.resetRoomState()
  }

  private getStateStoreKey(scope: GameStateScope, stateKey: GameStateKey): StoredGameStateKey {
    const numericKey = Number(stateKey)
    const normalizedKey = Number.isNaN(numericKey) ? String(stateKey) : String(numericKey)
    return `${scope}:${normalizedKey}` as StoredGameStateKey
  }

  private clearStateStore(): void {
    this.stateStore.clear()
  }
}

export const Game = new GameState({ orderLabels: UI.ORDER_LABELS })
