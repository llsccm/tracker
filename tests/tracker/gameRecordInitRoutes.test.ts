import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/config', () => ({}))
vi.mock('@/dom', () => ({ resetSeatUIs: vi.fn() }))
vi.mock('@/handler', () => ({}))
vi.mock('@/handler/MsgGameOver', () => ({ cancelGameOverTask: vi.fn() }))
vi.mock('@/handler/chat', () => ({}))
vi.mock('@/runtime/gameAdapter', () => ({}))
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

const gameId = { low: -1804863040, high: 207369892, unsigned: true }

describe('初始化消息路由', () => {
  beforeEach(() => {
    tracker.destroyTrackerRoom()
    Game.reset()
    vi.clearAllMocks()
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
