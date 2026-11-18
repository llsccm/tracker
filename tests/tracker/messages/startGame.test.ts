import { beforeEach, describe, expect, it, vi } from 'vitest'

const { Game, addTooltip, resetSeatOverlay, tracker, user } = vi.hoisted(() => ({
  Game: {
    init: vi.fn(),
    size: 0
  },
  addTooltip: vi.fn(),
  resetSeatOverlay: vi.fn(),
  tracker: {
    initTrackerRoom: vi.fn(),
    registerTrackerPlayers: vi.fn()
  },
  user: {
    userID: 123
  }
}))

vi.mock('@/tracker', () => ({ Game, user }))
vi.mock('@/tracker/runtime/browser', () => ({ tracker }))
vi.mock('@/utils/notification', () => ({ addTooltip }))
vi.mock('@/ui/seatOverlay', () => ({
  resetSeatOverlay
}))

import { handleRecordStartGame } from '@/handler/StartGame'

describe('StartGame', () => {
  beforeEach(() => {
    Game.init.mockReset()
    Game.size = 0
    addTooltip.mockReset()
    resetSeatOverlay.mockReset()
    tracker.initTrackerRoom.mockReset()
    tracker.registerTrackerPlayers.mockReset()
    user.userID = 123
  })

  it('录像开局先清理上一局，再初始化 Room 和注册玩家', () => {
    const seatinfo = [{ seat_id: 1 }, { seat_id: 2 }]
    Game.size = 2

    handleRecordStartGame({ data: { protoObj: { seatinfo } } })

    expect(tracker.registerTrackerPlayers).toHaveBeenCalledWith(seatinfo, 123)
    expect(resetSeatOverlay).toHaveBeenCalledOnce()
    expect(resetSeatOverlay.mock.invocationCallOrder[0]).toBeLessThan(
      tracker.initTrackerRoom.mock.invocationCallOrder[0]
    )
    expect(tracker.initTrackerRoom.mock.invocationCallOrder[0]).toBeLessThan(
      tracker.registerTrackerPlayers.mock.invocationCallOrder[0]
    )
  })

  it('录像换局时每次都清理上一局', () => {
    const firstRound = Array.from({ length: 4 }, (_, index) => ({ seat_id: index + 1 }))
    const secondRound = Array.from({ length: 8 }, (_, index) => ({ seat_id: index + 1 }))

    handleRecordStartGame({ data: { protoObj: { seatinfo: firstRound } } })
    handleRecordStartGame({ data: { protoObj: { seatinfo: secondRound } } })

    expect(resetSeatOverlay).toHaveBeenCalledTimes(2)
  })
})
