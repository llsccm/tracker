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
 * 浏览器 DOM/Laya/UI 副作用由 Game.js 中的运行时适配层补充。
 */
export class GameState {
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
  declare mySeats: SeatID[]
  declare isShanHeTu: boolean
  declare isGuoZhan: boolean
  declare isDouDiZhu: boolean
  declare isRoguelike1v1: boolean
  declare isSWJG: boolean
  declare size: number | undefined
  declare isDuanXian: boolean

  declare currentID: SeatID | undefined
  myGenerals: number[] = []

  constructor({ orderLabels = ORDER_LABELS }: { orderLabels?: string[] } = {}) {
    this.orderLabels = orderLabels
    this.turn = 0
    this.round = 0
    this.phase = 0
    this.currentID = undefined
    this.spellSpace = {}

    this.configHandCards = []
    this.configHandCardsMode = 'all'
    this.configHandCardsRejected = false

    this.room = null
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
    return this.room?.mySeatID ?? this.mySeats[0] ?? this.seatIDs[0]
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
    this.mySeats = []
    this.myGenerals.length = 0

    this.isShanHeTu = false
    this.isGuoZhan = false
    this.isDouDiZhu = false
    this.isRoguelike1v1 = false
    this.isSWJG = false

    this.size = undefined
    this.isDuanXian = false
  }

  seatPos(size = 8): number[] {
    return SEAT_UI_POSITIONS[size] ?? []
  }

  getSeatUI(seatID: SeatID): SeatUIRuntime {
    return this.seatUIs.find((ui) => ui.seatID == seatID) || {}
  }

  // TODO 需要废弃
  setMyID(seatID: SeatID | undefined): void {
    if (seatID === undefined) {
      this.mySeats = []
      return
    }

    const normalized = Number(seatID)
    if (!Number.isFinite(normalized) || this.mySeats[0] === normalized) return

    const index = this.mySeats.indexOf(normalized)
    if (index > -1) this.mySeats.splice(index, 1)
    this.mySeats.unshift(normalized)
  }

  setGeneral(seatID: SeatID, generalID: number | undefined, _index = 0): void {}

  updateSeatLabel(_player: Player): void {}

  getGeneralNames(): (number | undefined)[] {
    // 不使用 laya 获取武将名
    return []
  }

  name(_seatID: SeatID): string {
    return ''
  }

  syncRoomSeats(room: Room | null = this.room): void {
    if (!room) return
    this.seatIDs = room.seatIDs.slice()
    this.size = room.size
    this.setMyID(room.mySeatID)
  }

  resetConfigHandCards(): void {
    this.configHandCards = []
    this.configHandCardsMode = 'all'
    this.configHandCardsRejected = false
  }

  init(): void {
    this.resetRoomState()
    this.isGameStart = true
    this.isPassed = false

    this.turn = 0
    this.round = 0
    this.phase = 0

    this.currentID = undefined
    this.spellSpace = {}
    this.resetConfigHandCards()
  }

  end(): void {
    if (this.isGameStart && !this.isPassed) {
      this.isGameStart = false
      this.isPassed = true
      this.resetRoomState()
    }
  }

  start(): void {
    if (this.isGameStart) return

    this.isGameStart = true
    this.isPassed = false
  }

  enter(round: number, seat: SeatID): void {
    if (round === 0) {
      if (!this.turn) {
        this.start()
      } else if (this.currentID === this.myID) {
        this.spellSpace['手到擒来'] = this.spellSpace['多多益善'] = 0
      }

      this.resetZhanFa(this.currentID)

      this.currentID = seat
      this.round++
      this.phase = 0
      // 此处应该补注释
      ;[7011, 2143, 3271, 3659].forEach((id) => delete this.spellSpace[id])

      this.clear('round')
    } else {
      this.phase++
    }

    this.clear('phase')
  }

  setTurn(turn: number): void {
    if (turn > 0) {
      this.turn = turn
      this.round = 0
      this.clear('turn')
      this.resetTurnZhanFa()
      if (turn === 1) this.start()
      delete this.spellSpace[3090]
      delete this.spellSpace[3821]
    }
  }

  record(): void {}

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
    this.turn = 0
    this.round = 0
    this.phase = 0
    this.currentID = undefined
    this.isGameStart = false
    this.isPassed = true
    this.spellSpace = {}
    this.resetConfigHandCards()
    this.resetRoomState()
    new Set(Object.values(this.domContainer)).forEach((list) => {
      list.length = 0
    })
  }
}
