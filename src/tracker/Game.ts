import { laya } from '../runtime/gameAdapter'
import { CharacterConfig } from '@/config/CharacterConfig'
import { UI } from './state'
import { GameState } from './gameState'
import { trackerLogger } from '@/utils/logger'
import type { Room } from './Room'
import type { SeatID } from './types'
import type { Player } from './Player'

interface RecordOptions {
  use?: number
  mo?: number
}

interface ZhanFaItem {
  PlotID: number
  Value: number
  n?: number
}

// 战法 ID 常量定义
const zhanfa1 = [2100, 2101, 2108, 2109, 2110, 2312, 2313, 2317, 2319, 2320, 2321, 2322]
const zhanfa2 = [2079, 2080, 2081, 2082, 2083, 2084]
const TURNZHANFA = [2033, 2034, 2035, 2036, 2037, 2038, 2048, 2049, 2050, 2196, 2197, 2300, 2301]

class BrowserGameState extends GameState {
  constructor() {
    super({ orderLabels: UI.ORDER_LABELS })
  }

  /** 需要废弃 */
  setMyID(seatID: SeatID | undefined): void {
    super.setMyID(seatID)
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

    // 先手座位可能还没有定义
    this.updateSeatLabel(player)
  }

  /** 渲染武将名和牌局座位 */
  updateSeatLabel(player: Player): void {
    const fixedViewId = player.fixedViewId ?? 1
    const seatDiv = document.getElementById(String(fixedViewId))
    if (!seatDiv) return

    seatDiv.style.setProperty('--No-content', `"${this.getLabel(player)}"`)
  }

  getLabel(player: Player): string {
    const { fixedViewId, generals } = player

    const generalNames = generals.map(
      (generalID) => CharacterConfig.GetInstance().generalDict[generalID] || ''
    )

    // 主公选择武将时 先手座位消息还没收到 但是主公就是一号位不是吗
    const orderLabel = fixedViewId
      ? (UI.ORDER_LABELS[fixedViewId] || String(fixedViewId)) + '号位'
      : '一号位'
    const seatName = generalNames.some(Boolean) ? generalNames.join(' ') : orderLabel

    return seatName + '|' + orderLabel
  }

  // 座位名 只是兼容糜竺
  name(seatID: SeatID): string {
    const displayID = this.room?.getDisplayID(seatID)
    if (!displayID) return ''

    const orderLabel =
      displayID < UI.ORDER_LABELS.length ? UI.ORDER_LABELS[displayID] : String(displayID)

    return orderLabel
  }

  syncRoomSeats(room: Room | null = this.room): void {
    if (!room) return
    this.seatIDs = room.seatIDs.slice()
    this.size = room.size
    this.setMyID(room.mySeatID)
  }

  /**
   * 重置记牌器手牌配置会话状态。
   */
  resetConfigHandCards(): void {
    this.configHandCards = []
    this.configHandCardsMode = 'all'
    this.configHandCardsRejected = false
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

  /*
   * 游戏初始化 此时加载房间信息
   */
  init(): void {
    trackerLogger.info('GameState 游戏已重置并开始')

    this.resetRoomState()
    this.isGameStart = true
    this.isPassed = false

    UI.seatUIs = []
    UI.friendGeneral = 0

    this.turn = 0
    this.round = 0
    this.phase = 0

    this.currentID = undefined
    this.myGenerals.length = 0
    this.spellSpace = {}
    this.resetConfigHandCards()
    laya.reset()
    // retry(() => laya.init())
  }

  /**
   * 游戏/局结束或离开房间的清理
   */
  end(): void {
    if (this.isGameStart && !this.isPassed) {
      this.isGameStart = false
      this.isPassed = true
      this.resetRoomState()

      // 重置 Laya 运行时

      trackerLogger.info('GameState 游戏已结束')
    }
  }

  /**
   * 启动游戏状态
   */
  start(): void {
    // 检测一次对局是否开始
    if (this.isGameStart) return

    this.isGameStart = true
    this.isPassed = false

    const seatIDs = this.room ? this.room.seatIDs : []
    const mySeatID = this.room ? this.room.mySeatID : undefined
    trackerLogger.info('GameState 游戏开始', { seatIDs, mySeatID })

    laya.init()
  }

  /**
   * 推进回合
   */
  enter(round: number, seat: SeatID): void {
    const mySeatID = this.room ? this.room.mySeatID : undefined

    if (round === 0) {
      // 回合开始
      if (!this.turn) {
        this.start()
      } else if (this.currentID === mySeatID) {
        this.spellSpace['手到擒来'] = this.spellSpace['多多益善'] = 0
      }

      // 下一个人的回合开始 重置上一个人的战法
      this.resetZhanFa(this.currentID)

      this.currentID = seat
      this.round++
      this.phase = 0

      // 如果主视角武将拥有【素俭】(ID 3031)，且当前行动玩家是自己，标记提示
      const selfSeat = this.seatUIs[0]?.seat as
        | { HasSkill?: (skillID: number) => boolean }
        | undefined
      if (selfSeat?.HasSkill?.(3031) && this.currentID === mySeatID) {
        laya.mark(true, '[素俭]待分配')
      }

      ;[7011, 2143, 3271, 3659].forEach((id) => delete this.spellSpace[id]) // 权变 博图 乱击 畜鸣

      this.clear('round')
    } else {
      this.phase++
    }

    this.clear('phase')

    const nav = document.getElementById('phrase')
    if (nav) {
      const lastMatch = nav.innerText.match(/\(([0-9])\)$/)
      const last = lastMatch ? parseInt(lastMatch[1]) : NaN

      if (this.phase === last) {
        nav.innerText = nav.innerText.replace(
          /(回合)?(.{2,3})(阶段)? ?\(([0-9])\)$/,
          `$2>${['开始时', '准备', '判定', '摸牌', '出牌', '弃牌', '结束', '结束时', '结束后'][round]}($4)`
        )
      } else {
        nav.innerText = `${['回合开始时', '准备阶段', '判定阶段', '摸牌阶段', '出牌阶段', '弃牌阶段', '结束阶段', '回合结束时', '回合结束后'][round]} (${this.phase})`
      }
    }
  }

  setTurn(turn: number): void {
    if (turn > 0) {
      // 每轮开始
      this.turn = turn
      this.round = 0
      this.clear('turn')
      this.resetTurnZhanFa()
      if (turn === 1) this.start()
      delete this.spellSpace[3090]
      delete this.spellSpace[3821]
    }
  }

  /**
   * 记录战法数据
   */
  record({ use = 0, mo = 0 }: RecordOptions = {}): void {
    const items = laya.gamescene?.SelfSeatUi?.zhanFaItems as ZhanFaItem[] | undefined
    if (!items?.length) return

    this.spellSpace['神龙摆尾'] = (this.spellSpace['神龙摆尾'] || 0) + mo
    this.spellSpace['多多益善'] = (this.spellSpace['多多益善'] || 0) + (mo ? 1 : 0)
    this.spellSpace['手到擒来'] = (this.spellSpace['手到擒来'] || 0) + (use ? 1 : 0)
    this.spellSpace['三板斧'] = (this.spellSpace['三板斧'] || 0) + (use === 1 ? 1 : 0)

    items.forEach((ui) => {
      if ([2042, 2043, 2044].includes(ui.PlotID)) {
        ui.Value = this.spellSpace['三板斧'] % 3
      } else if (ui.PlotID === 2143) {
        ui.Value = this.spellSpace['神龙摆尾'] % 6
      } else if (ui.PlotID === 2104) {
        ui.Value = this.spellSpace['神龙摆尾'] % 9
      } else if ([2079, 2080, 2081].includes(ui.PlotID)) {
        ui.Value = this.spellSpace['手到擒来']
      } else if ([2082, 2083, 2084].includes(ui.PlotID)) {
        ui.Value = this.spellSpace['多多益善']
      }
    })
  }

  /**
   * 清理弹窗或提示 DOM 元素
   */
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

  /**
   * 重置战法
   */
  resetZhanFa(currentID?: SeatID): void {
    const mySeatID = this.room ? this.room.mySeatID : undefined
    laya.gamescene?.SelfSeatUi?.zhanFaItems?.forEach((ui: ZhanFaItem) => {
      if (ui?.n !== undefined && zhanfa1.includes(ui.PlotID)) {
        ui.Value = ui.n = 0
      }
      // 自己回合结束后清空 手到擒来 多多益善
      if (currentID === mySeatID && zhanfa2.includes(ui.PlotID)) {
        ui.Value = 0
      }
    })
  }

  /**
   * 重置轮战法
   */
  resetTurnZhanFa(): void {
    laya.gamescene?.SelfSeatUi?.zhanFaItems?.forEach((ui: ZhanFaItem) => {
      if (ui?.n !== undefined && TURNZHANFA.includes(ui.PlotID)) {
        ui.Value = ui.n = 0
      }
    })
  }

  /**
   * 重置 GameState 自身状态
   */
  reset(): void {
    this.turn = 0
    this.round = 0
    this.phase = 0
    this.currentID = undefined
    this.myGenerals.length = 0
    this.isGameStart = false
    this.isPassed = true
    this.spellSpace = {}
    this.resetConfigHandCards()
    this.resetRoomState()
    // 清空 domContainer
    Object.keys(this.domContainer).forEach((key) => {
      this.domContainer[key] = []
    })
  }
}

export const Game = new BrowserGameState()
