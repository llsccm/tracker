import { laya } from '../runtime/gameAdapter'
import { CharacterConfig } from '@/config/CharacterConfig'
import { UI } from './state'
import { GameState } from './gameState'
import { trackerLogger } from '@/utils/logger'
import type { RecordOptions } from './gameState'
import type { SeatID } from './types'
import type { Player } from './Player'

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

  protected onInit(): void {
    trackerLogger.info('GameState 游戏已重置并开始')

    UI.seatUIs = []
    UI.friendGeneral = 0

    laya.reset()
    // retry(() => laya.init())
  }

  protected onEnd(): void {
    trackerLogger.info('GameState 游戏已结束')
  }

  protected onStart(): void {
    const seatIDs = this.room ? this.room.seatIDs : []
    const mySeatID = this.room ? this.room.mySeatID : undefined
    trackerLogger.info('GameState 游戏开始', { seatIDs, mySeatID })

    laya.init()
  }

  protected onEnter(round: number, _seat: SeatID): void {
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

  protected onRecord({ use = 0, mo = 0 }: RecordOptions): void {
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
}

export const Game = new BrowserGameState()
