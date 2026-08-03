import { handleQiaoZhi } from '@/handler/skills/QiaoZhi'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { revealTrackerCards } = vi.hoisted(() => ({
  revealTrackerCards: vi.fn()
}))

vi.mock('../../src/tracker/runtime/browser', () => ({
  tracker: {
    revealTrackerCards
  }
}))

describe('GsCUpdateRoleDataExNtf 3544', () => {
  beforeEach(() => {
    revealTrackerCards.mockClear()
  })

  it('用 Datas 首项的正 CardID 同步目标普通手牌', () => {
    const msg = {
      DataID: 3544,
      Datas: [37, 0],
      SeatID: 3
    }

    handleQiaoZhi(msg, 1)

    expect(revealTrackerCards).toHaveBeenCalledOnce()
    expect(revealTrackerCards).toHaveBeenCalledWith(
      {
        type: 'player',
        seatID: 3,
        handMoveCount: 0,
        sourceEvent: {
          type: 'qiaozhi:update-role-data',
          label: 'GsCUpdateRoleDataExNtf:3544',
          raw: msg
        }
      },
      [37]
    )
  })

  it.each([
    ['主视角消息', { DataID: 3544, Datas: [37, 0], SeatID: 3 }, 3],
    ['结束值消息', { DataID: 3544, Datas: [0, 0], SeatID: 3 }, 1]
  ])('忽略%s', (_name, msg, currentSeatID) => {
    handleQiaoZhi(msg, currentSeatID)

    expect(revealTrackerCards).not.toHaveBeenCalled()
  })

  it('主视角未确定时不同步 0 号位消息', () => {
    const msg = {
      DataID: 3544,
      Datas: [37, 0],
      SeatID: 0
    }

    handleQiaoZhi(msg, null)

    expect(revealTrackerCards).toHaveBeenCalledTimes(0)
  })
})
