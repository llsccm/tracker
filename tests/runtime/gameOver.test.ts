import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  destroyPeiXiuMapWindow,
  Game,
  globalConfig,
  laya,
  querySelectorAll,
  resetSeatUIs,
  tracker
} = vi.hoisted(() => ({
  destroyPeiXiuMapWindow: vi.fn(),
  Game: {
    isPassed: true as boolean | null,
    end: vi.fn()
  },
  globalConfig: {
    blockMvpSettlementSwitch: true
  },
  laya: {
    closeWindow: vi.fn<(name: string) => boolean>()
  },
  querySelectorAll: vi.fn<() => { style: { display: string } }[]>(),
  resetSeatUIs: vi.fn(),
  tracker: {
    destroyTrackerRoom: vi.fn()
  }
}))

vi.mock('@/dom', () => ({ resetSeatUIs }))
vi.mock('@/runtime/gameAdapter', () => ({ laya }))
vi.mock('@/tracker', () => ({ Game, globalConfig }))
vi.mock('@/tracker/runtime/browser', () => ({ tracker }))
vi.mock('@/ui/PeiXiuMapWindow', () => ({ destroyPeiXiuMapWindow }))

import { handleGameOver, handleLeaveTable } from '@/handler/MsgGameOver'

describe('MsgGameOver', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    Game.isPassed = true
    globalConfig.blockMvpSettlementSwitch = true
    laya.closeWindow.mockReturnValue(true)
    querySelectorAll.mockReturnValue([{ style: { display: 'block' } }])
    vi.stubGlobal('document', { querySelectorAll })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('重复结束消息刷新定时器，并从最后一次消息开始延迟关闭', () => {
    laya.closeWindow.mockReturnValueOnce(true).mockReturnValueOnce(false)

    handleGameOver()

    vi.advanceTimersByTime(300)
    handleGameOver()

    vi.advanceTimersByTime(200)
    expect(laya.closeWindow).not.toHaveBeenCalled()

    vi.advanceTimersByTime(299)
    expect(laya.closeWindow).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(laya.closeWindow.mock.calls).toEqual([['GameResultWindow'], ['GameMvpWindow']])
  })

  it('结果窗口关闭失败时不再关闭 MVP 窗口', () => {
    laya.closeWindow.mockReturnValue(false)

    handleGameOver()
    vi.advanceTimersByTime(500)

    expect(laya.closeWindow).toHaveBeenCalledOnce()
    expect(laya.closeWindow).toHaveBeenCalledWith('GameResultWindow')
  })

  it('关闭设置未开启时取消待执行的窗口关闭任务', () => {
    handleGameOver()
    vi.advanceTimersByTime(300)

    globalConfig.blockMvpSettlementSwitch = false
    handleGameOver()
    vi.advanceTimersByTime(500)

    expect(laya.closeWindow).not.toHaveBeenCalled()
  })

  it('离桌只清理对局，不安排结算窗口关闭', () => {
    handleLeaveTable()
    vi.advanceTimersByTime(500)

    expect(laya.closeWindow).not.toHaveBeenCalled()
    expect(Game.end).toHaveBeenCalledOnce()
    expect(destroyPeiXiuMapWindow).toHaveBeenCalledOnce()
    expect(resetSeatUIs).toHaveBeenCalledOnce()
    expect(tracker.destroyTrackerRoom).toHaveBeenCalledOnce()
  })
})
