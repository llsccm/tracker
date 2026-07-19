import type { Player } from './Player'
import type { Room } from './Room'
import type { SeatID } from './types'

interface SeatUIRuntime {
  seatID?: SeatID
  seat?: {
    general?: {
      CardName?: string
    }
  }
  [key: string]: unknown
}

interface DomContainerItem {
  SpellID?: unknown
  SeatID?: unknown
  count: number
  element?: {
    remove?: () => void
  }
}

type DomContainerMap = Record<string, DomContainerItem[]>

export interface RecordOptions {
  use?: number
  mo?: number
}

export const SEAT_UI_POSITIONS: Record<number, number[]> = {
  0: [],
  1: [0],
  2: [0, 4],
  3: [0, 3, 5],
  4: [0, 1, 4, 7],
  5: [0, 1, 3, 5, 7],
  6: [0, 1, 3, 4, 5, 7],
  7: [0, 1, 2, 3, 5, 6, 7],
  8: [0, 1, 2, 3, 4, 5, 6, 7]
}

export const ORDER_LABELS: string[] = ['一', '二', '三', '四', '五', '六', '七', '八']

/**
 * 纯对局状态对象。
 *
 * 这里只维护记牌器核心需要读取的时间、座位与技能计数数据；
 * 浏览器 DOM/Laya/UI 副作用由 Game.ts 中的运行时适配层补充。
 */
export class GameState {
  isRecord = false
  isGameStart = false
  isPassed = true
  seatUIs: SeatUIRuntime[] = []
  declare orderLabels: string[]
  declare turn: number
  declare round: number
  declare phase: number
  declare spellSpace: Record<string | number, number>
  declare configHandCards: unknown[]
  declare configHandCardsMode: string
  declare configHandCardsRejected: boolean
  declare room: Room | null
  declare domContainer: DomContainerMap
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

  declare currentID: SeatID | undefined
  myGenerals: number[] = []
  /** 阵营 统率占位 替代mySeats */
  camps: number[] = []

  constructor({ orderLabels = ORDER_LABELS }: { orderLabels?: string[] } = {}) {
    this.orderLabels = orderLabels
    this.room = null
    this.resetSessionState()
    this.resetRoomState()

    this.domContainer = ['temp', 'phase', 'round', 'turn', 'game', 'long'].reduce<DomContainerMap>(
      (acc, key, i) => {
        const list: DomContainerItem[] = []
        acc[key] = list
        acc[i] = list
        return acc
      },
      {}
    )
  }

  /** 子类只通过这些钩子接入运行时副作用，公共状态转换保持在基类。 */
  protected onInit(): void {}

  protected onEnd(): void {}

  protected onStart(): void {}

  protected onEnter(_round: number, _seat: SeatID): void {}

  protected onRecord(_options: RecordOptions): void {}

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

  private clearDomContainers(): void {
    new Set(Object.values(this.domContainer)).forEach((list) => {
      list.length = 0
    })
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
    this.seatUIs = []
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
  }

  getSeatUI(seatID: SeatID): SeatUIRuntime {
    return this.seatUIs.find((ui) => ui.seatID == seatID) || {}
  }

  setGeneral(seatID: SeatID, generalID: number | undefined, _index = 0): void {}

  updateSeatLabel(_player: Player): void {}

  name(_seatID: SeatID): string {
    return ''
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
    this.resetSessionState()
    this.resetRoomState()
    this.clearDomContainers()
    this.isGameStart = true
    this.isPassed = false
    this.onInit()
  }

  end(): void {
    if (this.isGameStart && !this.isPassed) {
      this.isRecord = false
      this.isGameStart = false
      this.isPassed = true
      this.resetRoomState()
      this.onEnd()
    }
  }

  start(): void {
    this.onStart()
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

      this.resetZhanFa(this.currentID)

      this.currentID = seat
      this.round++
      this.phase = 0
      // 此处应该补注释
      ;[2143, 3271, 3659].forEach((id) => delete this.spellSpace[id])

      this.clear('round')
    } else {
      this.phase++
    }

    this.clear('phase')
    this.onEnter(round, seat)
  }

  /** 每轮 */
  setTurn(turn: number): void {
    // 第一轮开始时 似乎比角色开始阶段还要晚一点
    if (turn > 0) {
      this.turn = turn
      this.round = 0
      this.clear('turn')
      this.resetTurnZhanFa()

      // 第一轮开始时 检测开始状态
      // if (turn === 1) this.start()

      delete this.spellSpace[3090]
      delete this.spellSpace[3821]
    }
  }

  record(options: RecordOptions = {}): void {
    this.onRecord(options)
  }

  clear(type: string, SpellID?: unknown, SeatID?: unknown): void {
    const arr = this.domContainer[type]
    if (!arr) return

    for (let i = arr.length - 1; i >= 0; i--) {
      if (SeatID === undefined && SpellID !== arr[i].SpellID) {
        arr[i].count--
      }
      if (!(arr[i].count > 0) || (SpellID === arr[i].SpellID && SeatID === arr[i].SeatID)) {
        if (arr[i].element && typeof arr[i].element.remove === 'function') {
          arr[i].element.remove()
        }
        arr.splice(i, 1)
      }
    }
  }

  resetZhanFa(_seatID?: SeatID): void {}

  resetTurnZhanFa(): void {}

  reset(): void {
    this.resetSessionState()
    this.resetRoomState()
    this.clearDomContainers()
  }
}
