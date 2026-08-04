import { CharacterConfig } from '@/config/CharacterConfig'
import { UI } from './state'
import { GameState } from './gameState'
import { trackerLogger } from '@/utils/logger'
import type { SeatID } from './types'
import type { Player } from './Player'

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
  }

  protected onEnd(): void {
    trackerLogger.info('GameState 游戏已结束')
  }

  protected onStart(): void {
    const seatIDs = this.room?.seatIDs ?? []
    const mySeatID = this.room?.mySeatID ?? undefined
    trackerLogger.info('GameState 游戏开始', { seatIDs, mySeatID })
  }
}

export const Game = new BrowserGameState()
