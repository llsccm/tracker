import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/dom', () => ({ resetSeatUIs: vi.fn() }))
vi.mock('@/handler', async () => ({
  ...(await import('@/handler/MsgGameTurnNtf')),
  ...(await import('@/handler/PubGsCMoveCard'))
}))
vi.mock('@/handler/gameFlowState', () => ({ handleGameFlowState: vi.fn() }))
vi.mock('@/handler/specialZones', () => ({
  handleSpecialZones: () => ({ handled: false })
}))
vi.mock('@/handler/spellEffects', () => ({ applySpellEffect: vi.fn() }))
vi.mock('@/handler/MsgGameOver', () => ({ cancelGameOverTask: vi.fn() }))
vi.mock('@/handler/chat', () => ({}))
vi.mock('@/runtime/gameAdapter', () => ({ laya: { zhanfaReset: vi.fn() } }))
vi.mock('@/tracker/runtime/browser', async () => {
  const { TrackerController } = await import('@/tracker/runtime/trackerController')
  const { Game } = await import('@/tracker')
  return { tracker: new TrackerController({ gameState: Game }) }
})
vi.mock('@/ui/seatOverlay', () => ({ resetOrderContainer: vi.fn(), hideOrderContainer: vi.fn() }))
vi.mock('@/ui/statusTip', () => ({}))
vi.mock('@/utils', () => ({}))
vi.mock('@/utils/notification', () => ({}))
vi.mock('@/tracker/runtime/protocolRecorder', () => ({ recordTrackerProtocol: vi.fn() }))
vi.mock('@/tracker', async () => {
  const { GameState } = await import('@/tracker/Game')
  return { Game: new GameState(), user: { userID: 100 }, globalConfig: { showNameSwitch: false } }
})

import { logic } from '@/logic'
import { Game } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'
import { recordTrackerProtocol } from '@/tracker/runtime/protocolRecorder'
import { protocolMove } from '../helpers/trackerController'

const gameId = { low: -1804863040, high: 207369892, unsigned: true }
const reconnectSeats = {
  className: 'decodeGsClientUserSeatFlagNtf',
  data: {
    protoObj: {
      seatinfo: [
        { seat_id: 0, user_temp_id: 100 },
        { seat_id: 1, user_temp_id: 101 }
      ]
    }
  }
}

describe('初始化消息路由', () => {
  beforeEach(() => {
    tracker.destroyTrackerRoom()
    Game.reset()
    vi.clearAllMocks()
  })

  it('首次登录和大厅重连的版本通知不创建 Room，随后正常开局仍为完整模式', () => {
    logic({ className: 'SsClientVersionNtf' })
    logic({ className: 'SsClientVersionNtf' })
    expect(tracker.getTrackerRoom()).toBeNull()
    expect(Game.isGameStart).toBe(false)

    logic(reconnectSeats)
    expect(tracker.getTrackerRoom()?.trackingMode).toBe('full')
  })

  it.each([0, 1])('已有 Room 重连时提前降级，晚到座位保留初始化结果并恢复视角 %s', (SeatIndex) => {
    logic(reconnectSeats)
    tracker.initTrackerDeck([11, 12, 13, 14, 15, 16, 17, 18])
    tracker.syncTrackerMove(protocolMove({ CardIDs: [11], ToID: 0 }))
    Game.setTurn(4)
    Game.setSpellState('before-disconnect', true)

    // 再次断线也必须重新恢复，不能复用上次已降级的牌局数据。
    for (let attempt = 0; attempt < 2; attempt++) {
      const previousRoom = tracker.getTrackerRoom()!
      logic({ className: 'SsClientVersionNtf' })
      const room = tracker.getTrackerRoom()!
      expect(room).not.toBe(previousRoom)
      expect(previousRoom.cards).toHaveLength(0)
      expect(previousRoom.players.size).toBe(0)
      expect(room.trackingMode).toBe('degraded')
      expect(room.isDeckReady).toBe(false)
      expect(Game.getSpellState('before-disconnect')).toBeUndefined()

      logic({ className: 'decodeGameRecordInitInfo', ProtoObj: { gameId } })
      logic({ className: 'GsCFirstPhaseRole', SeatID: 1 })
      logic({ className: 'MsgGameTurnNtf', TurnCnt: 7 })
      logic({ className: 'MsgGamePlayCardNtf', CardList: [11, 12, 13, 14, 15, 16, 17, 18] })
      logic({
        className: 'PubGsCMoveCard',
        ...protocolMove({
          CardIDs: [],
          CardCount: 3,
          FromID: 255,
          FromPosition: 65280,
          FromZone: 2,
          ToID: 255,
          ToPosition: 0,
          ToZone: 9,
          MoveType: 255
        })
      })
      const pileCards = [...room.getZone('pile').cards]

      logic(reconnectSeats)
      expect(tracker.getReadyTrackerRoom()).toBe(room)
      expect(room.trackingMode).toBe('degraded')
      expect(room.firstID).toBe(1)
      expect(Game.turn).toBe(7)
      expect(room.getZone('pile').cards).toEqual(pileCards)
      expect(room.getZone('pile').cards).toHaveLength(3)
      expect(room.isPileCountKnown).toBe(true)
      expect(room.getPlayer(0)?.fixedViewId).toBe(2)
      expect(room.getPlayer(1)?.fixedViewId).toBe(1)

      logic({
        className: 'MsgReconnectGame',
        CardPileCount: 3,
        SeatInfos: [
          {
            SeatID: SeatIndex,
            HandCardCount: 2,
            EquipCards: [{ CardId: 12 }],
            JudgeCards: [{ CardId: 13, SpellId: 0 }]
          }
        ]
      })
      logic({ className: 'MsgReconnectGameHand', SeatIndex, Count: 2, CardIDs: [11, 0] })
      expect(Game.myID).toBe(SeatIndex)
      expect(room.getPlayer(SeatIndex)?.knownHandCards.map((card) => card.id)).toEqual([11])
      expect(room.getPlayer(SeatIndex)?.observedHandCount).toBe(2)
      expect(room.getPlayer(SeatIndex)?.unknownCardCount).toBe(1)
      expect(room.getPlayer(SeatIndex)?.equipCards.map((card) => card.id)).toEqual([12])
      expect(room.getPlayer(SeatIndex)?.judgeCards.map((card) => card.id)).toEqual([13])

      logic({
        className: 'PubGsCMoveCard',
        ...protocolMove({ CardIDs: [], CardCount: 1, ToID: SeatIndex })
      })
      expect(room.getPlayer(SeatIndex)?.observedHandCount).toBe(3)
      expect(room.getZone('pile').cards).toHaveLength(2)
    }

    // 重连的座位复用只消费一次，同一录像重新播放仍走正常重建。
    const reconnectRoom = tracker.getTrackerRoom()
    logic(reconnectSeats)
    expect(tracker.getTrackerRoom()).not.toBe(reconnectRoom)
    expect(tracker.getTrackerRoom()?.trackingMode).toBe('full')
    expect(Game.turn).toBe(0)
  })

  it('恢复完成前再次收到版本通知会清理半成品，离桌也会清理待恢复座位标记', () => {
    logic(reconnectSeats)
    logic({ className: 'SsClientVersionNtf' })
    const interruptedRoom = tracker.getTrackerRoom()!
    logic({ className: 'GsCFirstPhaseRole', SeatID: 1 })
    logic({ className: 'MsgGamePlayCardNtf', CardList: [11, 12] })

    logic({ className: 'SsClientVersionNtf' })
    const room = tracker.getTrackerRoom()!
    expect(room).not.toBe(interruptedRoom)
    expect(room.trackingMode).toBe('degraded')
    expect(room.isDeckReady).toBe(false)
    expect(room.firstID).toBeUndefined()

    tracker.destroyTrackerRoom()
    logic({ className: 'SsClientVersionNtf' })
    expect(tracker.getTrackerRoom()).toBeNull()
    logic(reconnectSeats)
    expect(tracker.getTrackerRoom()?.trackingMode).toBe('full')
    expect(Game.seatIDs).toEqual([0, 1])
  })

  it('连续初始化消息仍可补充模式并完整进入录制器', () => {
    logic({ className: 'decodeGameRecordInitInfo', ProtoObj: { gameId } })
    Game.setTurn(2)
    logic({
      className: 'decodeGameRecordInitInfo',
      ProtoObj: { gameId: { ...gameId }, matchName: '新欢乐排位' }
    })

    expect(Game.needShowName).toBe(true)
    expect(Game.turn).toBe(2)
    expect(recordTrackerProtocol).toHaveBeenCalledTimes(2)
  })

  it('连续相同类名但不同 gameId 的消息只更新对局信息', () => {
    logic({ className: 'decodeGameRecordInitInfo', ProtoObj: { gameId, matchName: '单骑无双' } })
    Game.setTurn(4)
    logic({
      className: 'decodeGameRecordInitInfo',
      ProtoObj: { gameId: { ...gameId, low: gameId.low + 1 }, matchName: '新欢乐排位' }
    })

    expect(Game.turn).toBe(4)
    expect(Game.isRoguelike1v1).toBe(false)
    expect(Game.needShowName).toBe(true)
  })

  it('重连消息切换当前 Room 模式，重复初始化信息不会恢复完整追踪', () => {
    tracker.initTrackerRoom()
    tracker.registerTrackerPlayers([{ SeatID: 0, ClientID: 100 }], 100)
    const room = tracker.getTrackerRoom()!

    logic({ className: 'decodeGameRecordInitInfo', ProtoObj: { gameId } })
    logic({ className: 'MsgReconnectGame' })
    logic({ className: 'decodeGameRecordInitInfo', ProtoObj: { gameId } })

    expect(tracker.getTrackerRoom()).toBe(room)
    expect(room.trackingMode).toBe('degraded')
    expect(Game.room).toBe(room)
    expect(Game.seatIDs).toEqual([0])
    expect(recordTrackerProtocol).toHaveBeenCalledTimes(3)
  })

  it.each([0, 7])('旁观重连手牌通知以 SeatIndex=%s 确认主视角', (SeatIndex) => {
    tracker.initTrackerRoom()
    tracker.registerTrackerPlayers(
      [
        { SeatID: 0, ClientID: 101 },
        { SeatID: 7, ClientID: 107 }
      ],
      100
    )
    const room = tracker.getTrackerRoom()!
    const previousSeatID = SeatIndex === 0 ? 7 : 0
    logic({ className: 'MsgReconnectGame' })
    logic({ className: 'GsCUpdateRoleDataNtf', StateID: 58, SeatID: previousSeatID })
    expect(Game.myID).toBe(previousSeatID)

    logic({ className: 'MsgReconnectGameHand', CardIDs: [0], Count: 1, SeatIndex })
    logic({ className: 'GsCUpdateRoleDataNtf', StateID: 58, SeatID: previousSeatID })

    expect(tracker.getTrackerRoom()).toBe(room)
    expect(room.mySeatID).toBe(SeatIndex)
    expect(Game.myID).toBe(SeatIndex)
    expect(Game.isRecord).toBe(true)
    expect(room.trackingMode).toBe('degraded')
  })

  it.each([0, 7])('重连手牌路由同步座位 %s 的正 ID、暗牌和总数', (SeatIndex) => {
    tracker.initTrackerRoom()
    tracker.registerTrackerPlayers(
      [
        { SeatID: 0, ClientID: 101 },
        { SeatID: 7, ClientID: 107 }
      ],
      100
    )
    tracker.initTrackerDeck([11, 12, 13])
    const room = tracker.getReadyTrackerRoom()!
    logic({ className: 'MsgReconnectGame', CardPileCount: 3 })

    logic({ className: 'MsgReconnectGameHand', CardIDs: [11, 0, 12], Count: 3, SeatIndex })

    expect(Game.myID).toBe(SeatIndex)
    expect(room.getPlayer(SeatIndex)?.knownHandCards.map((card) => card.id)).toEqual([11, 12])
    expect(room.getPlayer(SeatIndex)?.observedHandCount).toBe(3)
    expect(room.getPlayer(SeatIndex)?.unknownCardCount).toBe(1)
    expect(room.getZone('pile').cards).toHaveLength(3)
  })

  it('初始化消息之间插入其他协议也不会重置同一局', () => {
    const message = {
      className: 'decodeGameRecordInitInfo',
      ProtoObj: { gameId, matchName: '斗地主' }
    }
    logic(message)
    Game.setSpellState('pending', { count: 3 })
    logic({ className: 'GsCModifyUserseatNtf' })
    logic(message)

    expect(Game.getSpellState('pending')).toEqual({ count: 3 })
    expect(Game.isDouDiZhu).toBe(true)
  })

  it('八座位注册和身份通知后更新显隐，并按显示玩家重排固定顺位', () => {
    logic({
      className: 'decodeGsClientUserSeatFlagNtf',
      data: {
        protoObj: {
          seatinfo: Array.from({ length: 8 }, (_, seat_id) => ({
            seat_id,
            user_temp_id: 100 + seat_id
          }))
        }
      }
    })
    for (let SeatID = 0; SeatID < 8; SeatID++) {
      logic({ className: 'MsgGameShowFigure', SeatID, Figure: SeatID === 2 ? 1 : 3 })
    }
    const room = tracker.getTrackerRoom()!
    const players = Array.from(room.players.values())
    expect(players.map((player) => player.fixedViewId)).toEqual([7, 8, 1, 2, 3, 4, 5, 6])
    expect(room.isDeckReady).toBe(false)
    expect(players.every((player) => player.isShown)).toBe(true)

    logic({
      className: 'MsgGamePlayerShowStatusNtf',
      Count: 3,
      SeatData: [
        [1, 0],
        [4, 0],
        [7, 0]
      ]
    })

    expect(players.filter((player) => player.isShown).map((player) => player.seatID)).toEqual([
      0, 2, 3, 5, 6
    ])
    expect(Array.from(room.players.values())).toEqual(players)
    expect(players.map((player) => player.fixedViewId)).toEqual([
      5,
      undefined,
      1,
      2,
      undefined,
      3,
      4,
      undefined
    ])
    expect(room.size).toBe(8)
    expect(Game.seatIDs).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(room.firstID).toBe(2)

    logic({ className: 'MsgGamePlayerShowStatusNtf', Count: 1, SeatData: [[4, 1]] })
    expect(players.filter((player) => player.isShown).map((player) => player.seatID)).toEqual([
      0, 2, 3, 4, 5, 6
    ])
    expect(players.map((player) => player.fixedViewId)).toEqual([
      6,
      undefined,
      1,
      2,
      3,
      4,
      5,
      undefined
    ])
    logic({ className: 'MsgGamePlayerShowStatusNtf', Count: 0, SeatData: [] })
    expect(room.getPlayer(0)?.isShown).toBe(true)
  })

  it('重新注册同一组座位时不继承上局隐藏状态', () => {
    const seats = {
      className: 'decodeGsClientUserSeatFlagNtf',
      data: { protoObj: { seatinfo: [{ seat_id: 0, user_temp_id: 100 }, { seat_id: 1 }] } }
    }
    logic(seats)
    logic({ className: 'MsgGamePlayerShowStatusNtf', Count: 1, SeatData: [[1, 0]] })
    expect(tracker.getTrackerRoom()?.getPlayer(1)?.isShown).toBe(false)

    logic(seats)
    expect(tracker.getTrackerRoom()?.getPlayer(1)?.isShown).toBe(true)
  })

  it('重新播放的相同 gameId 由座位消息触发重置，第二条初始化信息保留新播放状态', () => {
    const message = {
      className: 'decodeGameRecordInitInfo',
      ProtoObj: { gameId, matchName: '新欢乐排位' }
    }
    const seats = {
      className: 'decodeGsClientUserSeatFlagNtf',
      data: { protoObj: { seatinfo: [{ seat_id: 2, user_temp_id: 100 }] } }
    }
    logic(message)
    logic(seats)
    logic(message)
    const firstRoom = tracker.getTrackerRoom()
    expect(firstRoom).not.toBeNull()
    Game.setTurn(6)
    Game.setSpellState('old-playback', true)

    logic(message)
    expect(Game.turn).toBe(6)
    logic(seats)

    expect(tracker.getTrackerRoom()).not.toBe(firstRoom)
    expect(Game.turn).toBe(0)
    expect(Game.getSpellState('old-playback')).toBeUndefined()
    expect(Game.myID).toBe(2)
    expect(Game.needShowName).toBe(true)
    Game.setSpellState('new-playback', true)
    logic(message)
    expect(Game.getSpellState('new-playback')).toBe(true)
    expect(Game.seatIDs).toEqual([2])
  })
})
