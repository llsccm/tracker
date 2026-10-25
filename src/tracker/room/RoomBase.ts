import type { GameState, GameStateKey } from '../Game'
import type { Player } from '@/tracker/model'
import type { SeatID } from '../types'
import { trackerLogger } from '@/utils/logger'

/**
 * Room 的基础座位、视角与对局上下文。
 * 仅保存基础字段和提供查询入口；玩家注册、GameState 绑定及销毁由完整 Room 协调。
 * 技能推断状态仍由 GameState 统一保存，不在基础类中维护第二套仓库。
 */
export abstract class RoomBase {
  /** 房间内分配的物理座位，为 0-7 之间的数字 */
  seatIDs: SeatID[] = []
  /** 房间玩家人数 */
  size = 0
  /** 牌局先手位置 (一号位的 seatID) */
  firstID: SeatID | undefined = undefined
  /** 当前运行客户端的主视角座位 ID (ClientID 对应 user.userID 的座位) */
  mySeatID: SeatID | undefined = undefined
  players = new Map<SeatID, Player>()
  declare game: GameState

  protected constructor(gameState: GameState) {
    this.game = gameState
  }

  getCurrentTimestamp(): { turn: number; round: number; phase: number } {
    return {
      turn: this.game.turn ?? 0,
      round: this.game.round ?? 0,
      phase: this.game.phase ?? 0
    }
  }

  getPlayer(seatID: SeatID) {
    return this.players.get(seatID)
  }

  /**
   * 设定当前客户端的主视角座位 ID (对应 user.userID)
   *
   * 注册时设置
   */
  setMySeatID(seatID: SeatID): void {
    this.mySeatID = seatID
    trackerLogger.info('Room 设置主视角座位', { mySeatID: this.mySeatID })
  }

  /** 主视角在牌局中的顺位 */
  getMyDisplayID(): number | undefined {
    return this.mySeatID === undefined ? undefined : this.getDisplayID(this.mySeatID)
  }

  getMyPlayer(): Player | undefined {
    return this.mySeatID === undefined ? undefined : this.getPlayer(this.mySeatID)
  }

  /**
   * 设定先手位置，并据此决定牌局的一号位
   * 先手位置为 firstID，其对应的顺位序号 order 为 0 (一号位)
   * 顺位加1则是二号位等，以此类推
   */
  setFirstHand(firstID: SeatID): void {
    this.firstID = firstID
    this.updateFixedViewIds()
    trackerLogger.info('Room 设置先手', { firstID })
  }

  /**
   * 根据先手位置和当前显示的座位重新计算 fixedViewId；隐藏座位不占顺位。
   *
   * fixedViewId 用于定位玩家在牌局中的顺位序号 一号位开始
   */
  updateFixedViewIds(): void {
    this.players.forEach((player) => {
      const viewId = this.getFixedViewId(player.seatID)
      player.fixedViewId = viewId !== undefined ? viewId + 1 : undefined
    })
  }

  /** 牌局中的顺位 一号位开始 */
  getDisplayID(seatID: SeatID): number | undefined {
    const player = this.getPlayer(seatID)
    return player?.fixedViewId
  }

  /** 格式化玩家位置描述前缀，例如“一号位”或“座位3”。 */
  formatSeatPrefix(seatID: SeatID): string {
    const displayID = this.getDisplayID(seatID)
    return displayID !== undefined ? `${displayID}号位` : `座位${seatID}`
  }

  /** 牌局中的顺位 0开始 */
  getFixedViewId(seatID: SeatID): number | undefined {
    const shownSeatIDs = this.seatIDs.filter((id) => this.getPlayer(id)?.isShown)
    const targetIndex = shownSeatIDs.indexOf(seatID)
    if (targetIndex < 0) return undefined

    const firstSeat = this.firstID ?? shownSeatIDs[0]
    const originIndex = shownSeatIDs.indexOf(firstSeat)
    if (originIndex < 0) return undefined

    return (targetIndex - originIndex + shownSeatIDs.length) % shownSeatIDs.length
  }

  /**
   * 只读获取当前 Room 的技能推断状态；数据实际位于 GameState 的统一单局状态仓库。
   *
   * 查询、结算和清理路径应优先使用本方法，避免一次只读检查留下空账本。
   */
  readSkillState<T = unknown>(stateKey: GameStateKey): T | undefined {
    if (!this.isCurrentGameRoom()) return undefined
    return this.game.readState<T>('tracker', stateKey)
  }

  /** 判断当前一局是否已经保存指定的记牌器推断状态。 */
  hasSkillState(stateKey: GameStateKey): boolean {
    if (!this.isCurrentGameRoom()) return false
    return this.game.hasState('tracker', stateKey)
  }

  /** 取得当前 Room 的技能推断状态，不存在时按需创建。 */
  ensureSkillState<T>(stateKey: GameStateKey, createState: () => T): T {
    if (!this.isCurrentGameRoom()) return createState()
    return this.game.ensureState('tracker', stateKey, createState)
  }

  /** 显式写入当前 Room 的技能推断状态。 */
  setSkillState<T>(stateKey: GameStateKey, state: T): void {
    if (!this.isCurrentGameRoom()) return
    this.game.setState('tracker', stateKey, state)
  }

  /** 删除当前 Room 的技能推断状态。 */
  deleteSkillState(stateKey: GameStateKey): void {
    if (!this.isCurrentGameRoom()) return
    this.game.deleteState('tracker', stateKey)
  }

  private isCurrentGameRoom(): boolean {
    return Object.is(this.game.room, this)
  }
}
