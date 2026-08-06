import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  destroyPeiXiuMapWindow,
  Game,
  globalConfig,
  laya,
  mvpWindow,
  querySelectorAll,
  resetSeatUIs,
  resultWindow,
  tracker
} = vi.hoisted(() => ({
  destroyPeiXiuMapWindow: vi.fn(),
  Game: {
    isShanHeTu: false,
    isPassed: true as boolean | null,
    end: vi.fn()
  },
  globalConfig: {
    blockMvpSettlementSwitch: true
  },
  laya: {
    GetWindow: vi.fn(),
    zhanfaMap: {
      clear: vi.fn()
    }
  },
  mvpWindow: {
    visible: true,
    laterClose: vi.fn()
  },
  querySelectorAll: vi.fn<() => { style: { display: string } }[]>(),
  resetSeatUIs: vi.fn(),
  resultWindow: {
    visible: true,
    laterClose: vi.fn()
  },
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
    Game.isShanHeTu = false
    Game.isPassed = true
    globalConfig.blockMvpSettlementSwitch = true
    laya.GetWindow.mockImplementation((name) => {
      if (name === 'GameResultWindow') return resultWindow
      if (name === 'GameMvpWindow') return mvpWindow
      return null
    })
    querySelectorAll.mockReturnValue([{ style: { display: 'block' } }])
    vi.stubGlobal('document', { querySelectorAll })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('重复结束消息刷新定时器，并从最后一次消息开始等待结算窗口', async () => {
    handleGameOver()

    await vi.advanceTimersByTimeAsync(300)
    handleGameOver()

    await vi.advanceTimersByTimeAsync(499)
    expect(laya.GetWindow).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(laya.GetWindow).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)
    expect(laya.GetWindow).toHaveBeenCalledWith('GameResultWindow')
    expect(resultWindow.laterClose).toHaveBeenCalledOnce()
    expect(mvpWindow.laterClose).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)

    expect(laya.GetWindow.mock.calls).toEqual([['GameResultWindow'], ['GameMvpWindow']])
    expect(mvpWindow.laterClose).toHaveBeenCalledOnce()
    expect(Game.end).toHaveBeenCalledOnce()
  })

  it('未找到结果窗口时重试后清理且不查询 MVP 窗口', async () => {
    laya.GetWindow.mockReturnValue(null)

    handleGameOver()
    await vi.advanceTimersByTimeAsync(5500)

    expect(laya.GetWindow).toHaveBeenCalledTimes(10)
    expect(laya.GetWindow).toHaveBeenCalledWith('GameResultWindow')
    expect(resultWindow.laterClose).not.toHaveBeenCalled()
    expect(mvpWindow.laterClose).not.toHaveBeenCalled()
    expect(Game.end).toHaveBeenCalledOnce()
  })

  it('关闭设置未开启时取消待执行任务并立即清理', async () => {
    handleGameOver()
    await vi.advanceTimersByTimeAsync(300)

    globalConfig.blockMvpSettlementSwitch = false
    handleGameOver()

    expect(laya.GetWindow).not.toHaveBeenCalled()
    expect(laya.zhanfaMap.clear).toHaveBeenCalledOnce()
    expect(Game.end).toHaveBeenCalledOnce()
  })

  it('离桌只清理对局，不安排结算窗口关闭', () => {
    handleLeaveTable()

    expect(laya.GetWindow).not.toHaveBeenCalled()
    expect(laya.zhanfaMap.clear).toHaveBeenCalledOnce()
    expect(Game.end).toHaveBeenCalledOnce()
    expect(destroyPeiXiuMapWindow).toHaveBeenCalledOnce()
    expect(resetSeatUIs).toHaveBeenCalledOnce()
    expect(tracker.destroyTrackerRoom).toHaveBeenCalledOnce()
  })
})
