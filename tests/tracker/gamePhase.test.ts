import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { Game, getElementById, scheduleTrackerRender } = vi.hoisted(() => ({
  Game: {
    currentID: 1 as number | undefined,
    myID: 1 as number | undefined,
    phase: 0,
    enter: vi.fn<(round: number, seatID: number) => void>()
  },
  getElementById: vi.fn(),
  scheduleTrackerRender: vi.fn()
}))

vi.mock('@/tracker', () => ({ Game }))
vi.mock('@/tracker/runtime/browser', () => ({
  tracker: { scheduleTrackerRender }
}))
vi.mock('@/runtime/gameAdapter', () => ({
  laya: {
    resetRoundZhanFa: vi.fn()
  }
}))

import { handleGamePhase, SeatRoundState } from '@/handler/GsCGamephaseNtf'

describe('GsCGamephaseNtf', () => {
  const elements = new Map<string, { innerHTML: string; innerText: string }>()

  beforeEach(() => {
    Game.currentID = 1
    Game.myID = 1
    Game.phase = 0
    Game.enter.mockReset()
    Game.enter.mockImplementation((round, seatID) => {
      Game.currentID = seatID
      Game.phase = round === SeatRoundState.INIT ? 0 : Game.phase + 1
    })
    scheduleTrackerRender.mockReset()

    elements.clear()
    elements.set('phrase', { innerHTML: '', innerText: '' })
    elements.set('suit', { innerHTML: '', innerText: 'suit' })
    elements.set('result', { innerHTML: '待清理', innerText: '' })
    getElementById.mockReset()
    getElementById.mockImplementation((id: string) => elements.get(id) ?? null)
    vi.stubGlobal('document', { getElementById })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    [SeatRoundState.START, '开始阶段'],
    [SeatRoundState.JUDGE, '判定阶段'],
    [SeatRoundState.DESKTOP_DEAL, '摸牌阶段'],
    [SeatRoundState.DEAL, '出牌阶段'],
    [SeatRoundState.DISCARD, '弃牌阶段'],
    [SeatRoundState.INIT, ''],
    [SeatRoundState.OVER, '']
  ])('返回回合状态 %i 的名称', (round, expectedName) => {
    expect(SeatRoundState.GetRoundStateName(round)).toBe(expectedName)
  })

  it('回合初始化后清理结果 DOM', () => {
    handleGamePhase({ Round: SeatRoundState.INIT, SeatID: 2 })

    expect(Game.enter).toHaveBeenCalledWith(SeatRoundState.INIT, 2)
    expect(elements.get('phrase')?.innerText).toBe('回合开始时 (0)')
    expect(elements.get('suit')?.innerText).toBe('')
    expect(elements.get('result')?.innerHTML).toBe('')
    expect(scheduleTrackerRender).toHaveBeenCalledOnce()
  })

  it('阶段推进使用协议阶段名称，并保留回合结果', () => {
    handleGamePhase({ Round: SeatRoundState.START, SeatID: 2 })

    expect(elements.get('phrase')?.innerText).toBe('开始阶段 (1)')
    expect(elements.get('suit')?.innerText).toBe('suit')
    expect(elements.get('result')?.innerHTML).toBe('待清理')
    expect(scheduleTrackerRender).toHaveBeenCalledOnce()
  })

  it('同一 phase 追加阶段时保留已有阶段链', () => {
    Game.phase = 3
    elements.get('phrase')!.innerText = '判定(2)>出牌(4)'

    handleGamePhase({ Round: SeatRoundState.START, SeatID: 2 })

    expect(elements.get('phrase')?.innerText).toBe('判定(2)>出牌>开始(4)')
  })
})
