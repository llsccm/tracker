import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/ui/seatOverlay', () => ({ resetSeatOverlay: vi.fn() }))
vi.mock('@/ui/PeiXiuMapWindow', () => ({ destroyPeiXiuMapWindow: vi.fn() }))
vi.mock('@/ui/PingJianWindow', () => ({ destroyPingJianWindow: vi.fn() }))
vi.mock('@/runtime/gameAdapter', () => ({ laya: { zhanfaMap: new Map() } }))
vi.mock('@/utils', () => ({ wait: vi.fn() }))
vi.mock('@/tracker', async () => {
  const { GameState } = await import('@/tracker/Game')
  return { Game: new GameState(), globalConfig: { blockMvpSettlementSwitch: false } }
})
vi.mock('@/tracker/runtime/browser', async () => {
  const { Game } = await import('@/tracker')
  const { createTrackerControllerHarness } = await import('../helpers/trackerController')
  return { tracker: createTrackerControllerHarness({ gameState: Game }).controller }
})

import { cancelGameOverTask, handleGameOver, handleLeaveTable } from '@/handler/MsgGameOver'
import { Game } from '@/tracker'
import { tracker } from '@/tracker/runtime/browser'

const gameId = { low: -1804863040, high: 207369892, unsigned: true }

describe('结束通知的对局归属', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    cancelGameOverTask({ resetForNewGame: true })
    Game.reset()
    Game.updateRecordInfo({ gameId, matchName: '新欢乐排位' })
    tracker.initTrackerRoom()
    tracker.registerTrackerPlayers(
      [
        { SeatID: 0, ClientID: 100 },
        { SeatID: 1, ClientID: 101 }
      ],
      100
    )
    tracker.initTrackerDeck([11, 12])
    Game.setTurn(3)
    Game.setSpellState('active-game', true)
  })

  afterEach(() => {
    cancelGameOverTask()
    tracker.destroyTrackerRoom()
    Game.reset()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it.each([
    { ...gameId, low: gameId.low + 1 },
    { ...gameId, high: gameId.high + 1 }
  ])('其他对局的重复结束通知不清理本局，也不启动兜底：%j', (otherGameId) => {
    const room = tracker.getReadyTrackerRoom()!

    handleGameOver({ game_id: otherGameId })
    handleGameOver({ game_id: otherGameId })
    vi.advanceTimersByTime(1200)

    expect(tracker.getReadyTrackerRoom()).toBe(room)
    expect(Game.isGameStart).toBe(true)
    expect(Game.turn).toBe(3)
    expect(Game.getSpellState('active-game')).toBe(true)

    handleGameOver({ game_id: gameId })
    expect(tracker.getReadyTrackerRoom()).toBe(room)
    handleGameOver({ game_id: gameId })
    expect(tracker.getTrackerRoom()).toBeNull()
    expect(Game.isGameStart).toBe(false)
    expect(Game.getSpellState('active-game')).toBeUndefined()
  })

  it.each(['第二次本局通知', '超时兜底'])(
    '本局首次通知后夹入其他对局通知，仍由%s收尾',
    (finish) => {
      const room = tracker.getReadyTrackerRoom()!
      handleGameOver({ game_id: gameId })
      vi.advanceTimersByTime(500)

      handleGameOver({ game_id: { ...gameId, low: gameId.low + 1 } })
      vi.advanceTimersByTime(500)

      expect(tracker.getReadyTrackerRoom()).toBe(room)
      expect(Game.isGameStart).toBe(true)
      expect(Game.getSpellState('active-game')).toBe(true)

      if (finish === '第二次本局通知') {
        handleGameOver({ game_id: { ...gameId, low: gameId.low >>> 0 } })
      }
      if (finish === '超时兜底') vi.advanceTimersByTime(200)

      expect(tracker.getTrackerRoom()).toBeNull()
      expect(Game.isGameStart).toBe(false)
      expect(Game.getSpellState('active-game')).toBeUndefined()
      expect(Game.isCurrentGame(gameId)).toBe(false)
    }
  )

  it.each(['第二次本局通知', '超时兜底'])(
    '两次结束通知之间离桌后，保留任务并由%s完成收尾',
    (finish) => {
      const end = vi.spyOn(Game, 'end')
      handleGameOver({ game_id: gameId })
      vi.advanceTimersByTime(500)

      handleLeaveTable()

      expect(tracker.getTrackerRoom()).toBeNull()
      expect(Game.isGameStart).toBe(false)
      expect(Game.isCurrentGame(gameId)).toBe(false)
      expect(Game.getSpellState('active-game')).toBeUndefined()
      expect(end).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(1)

      if (finish === '第二次本局通知') {
        handleGameOver({ game_id: { ...gameId, low: gameId.low >>> 0 } })
      }
      if (finish === '超时兜底') vi.advanceTimersByTime(700)

      expect(vi.getTimerCount()).toBe(0)
      expect(end).toHaveBeenCalledOnce()
    }
  )

  it('离桌清空当前对局 ID 后，后续结束通知仍可完成已有任务', () => {
    const end = vi.spyOn(Game, 'end')
    handleGameOver({ game_id: gameId })
    handleLeaveTable()

    const laterGameId = { ...gameId, low: gameId.low + 1 }
    expect(Game.isOtherGame(laterGameId)).toBe(false)
    handleGameOver({ game_id: laterGameId })

    expect(vi.getTimerCount()).toBe(0)
    expect(end).toHaveBeenCalledOnce()
  })

  it('离桌先清理对局后到达的结束通知可以启动结算收尾', () => {
    const end = vi.spyOn(Game, 'end')
    handleLeaveTable()

    handleGameOver({ game_id: gameId })
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(1200)

    expect(vi.getTimerCount()).toBe(0)
    expect(end).toHaveBeenCalledOnce()
  })

  it('兜底已经收尾后，离桌和晚到的第二次通知不重复销毁', () => {
    const end = vi.spyOn(Game, 'end')
    handleGameOver({ game_id: gameId })
    vi.advanceTimersByTime(1200)

    handleLeaveTable()
    handleGameOver({ game_id: gameId })

    expect(end).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    expect(tracker.getTrackerRoom()).toBeNull()
  })

  it('离桌后新开局取消旧任务，旧通知不影响新局收尾', () => {
    const end = vi.spyOn(Game, 'end')
    handleGameOver({ game_id: gameId })
    handleLeaveTable()

    cancelGameOverTask({ resetForNewGame: true })
    const nextGameId = { ...gameId, low: gameId.low + 1 }
    Game.updateRecordInfo({ gameId: nextGameId, matchName: '新欢乐排位' })
    tracker.initTrackerRoom()
    tracker.registerTrackerPlayers([{ SeatID: 0, ClientID: 100 }], 100)
    tracker.initTrackerDeck([11, 12])
    const room = tracker.getReadyTrackerRoom()!

    handleGameOver({ game_id: gameId })
    vi.advanceTimersByTime(1200)

    expect(tracker.getReadyTrackerRoom()).toBe(room)
    expect(Game.isGameStart).toBe(true)
    expect(Game.isCurrentGame(nextGameId)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(end).toHaveBeenCalledOnce()

    handleGameOver({ game_id: nextGameId })
    expect(tracker.getReadyTrackerRoom()).toBe(room)
    handleGameOver({ game_id: nextGameId })

    expect(tracker.getTrackerRoom()).toBeNull()
    expect(Game.isGameStart).toBe(false)
    expect(end).toHaveBeenCalledTimes(2)
  })

  it('新对局初始化信息已经切换时，旧任务超时不清理当前 Room', () => {
    const room = tracker.getReadyTrackerRoom()!
    const end = vi.spyOn(Game, 'end')
    handleGameOver({ game_id: gameId })
    const nextGameId = { ...gameId, low: gameId.low + 1 }
    Game.updateRecordInfo({ gameId: nextGameId, matchName: '新欢乐排位' })

    vi.advanceTimersByTime(1200)

    expect(tracker.getReadyTrackerRoom()).toBe(room)
    expect(Game.isGameStart).toBe(true)
    expect(Game.isCurrentGame(nextGameId)).toBe(true)
    expect(Game.getSpellState('active-game')).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(end).not.toHaveBeenCalled()
  })
})
