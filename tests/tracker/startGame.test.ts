import { beforeEach, describe, expect, it, vi } from 'vitest'

const { Game, addTooltip, hideOrderContainer, resetOrderContainer, resetSeatUIs, tracker, user } =
  vi.hoisted(() => ({
    Game: {
      init: vi.fn(),
      size: 0
    },
    addTooltip: vi.fn(),
    hideOrderContainer: vi.fn(),
    resetOrderContainer: vi.fn(),
    resetSeatUIs: vi.fn(),
    tracker: {
      initTrackerRoom: vi.fn(),
      registerTrackerPlayers: vi.fn()
    },
    user: {
      userID: 123
    }
  }))

vi.mock('@/dom', () => ({ resetSeatUIs }))
vi.mock('@/tracker', () => ({ Game, user }))
vi.mock('@/tracker/runtime/browser', () => ({ tracker }))
vi.mock('@/utils/notification', () => ({ addTooltip }))
vi.mock('@/ui/seatOverlay', () => ({
  hideOrderContainer,
  resetOrderContainer
}))

import { handleRecordStartGame } from '@/handler/StartGame'

describe('StartGame', () => {
  beforeEach(() => {
    Game.init.mockReset()
    Game.size = 0
    addTooltip.mockReset()
    hideOrderContainer.mockReset()
    resetOrderContainer.mockReset()
    resetSeatUIs.mockReset()
    tracker.initTrackerRoom.mockReset()
    tracker.registerTrackerPlayers.mockReset()
    user.userID = 123
  })

  it('录像开局注册玩家后初始化座位覆盖层容器', () => {
    const seatinfo = [{ seat_id: 1 }, { seat_id: 2 }]
    Game.size = 2

    handleRecordStartGame({ data: { protoObj: { seatinfo } } })

    expect(tracker.registerTrackerPlayers).toHaveBeenCalledWith(seatinfo, 123)
    expect(resetSeatUIs).toHaveBeenCalledOnce()
    expect(resetOrderContainer).toHaveBeenCalledOnce()
    expect(hideOrderContainer).toHaveBeenCalledWith(2)
    expect(resetSeatUIs.mock.invocationCallOrder[0]).toBeLessThan(
      tracker.initTrackerRoom.mock.invocationCallOrder[0]
    )
    expect(tracker.initTrackerRoom.mock.invocationCallOrder[0]).toBeLessThan(
      tracker.registerTrackerPlayers.mock.invocationCallOrder[0]
    )
    expect(resetOrderContainer.mock.invocationCallOrder[0]).toBeLessThan(
      hideOrderContainer.mock.invocationCallOrder[0]
    )
  })

  it('录像换局时先清理上一局，再按新人数重置容器', () => {
    const firstRound = Array.from({ length: 4 }, (_, index) => ({ seat_id: index + 1 }))
    const secondRound = Array.from({ length: 8 }, (_, index) => ({ seat_id: index + 1 }))

    handleRecordStartGame({ data: { protoObj: { seatinfo: firstRound } } })
    handleRecordStartGame({ data: { protoObj: { seatinfo: secondRound } } })

    expect(resetSeatUIs).toHaveBeenCalledTimes(2)
    expect(resetOrderContainer).toHaveBeenNthCalledWith(2)
    expect(hideOrderContainer).toHaveBeenNthCalledWith(2, 8)
  })
})
