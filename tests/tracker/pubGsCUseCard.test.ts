import { beforeEach, describe, expect, it, vi } from 'vitest'

const { drawCard, shaCounter, useCounter, layaShaCounter, layaUseCounter } = vi.hoisted(() => ({
  drawCard: vi.fn(),
  shaCounter: vi.fn(),
  useCounter: vi.fn(),
  layaShaCounter: vi.fn(),
  layaUseCounter: vi.fn()
}))

vi.mock('@/draw', () => ({ drawCard }))
vi.mock('@/tracker', () => ({
  Game: {
    myID: 3,
    shaCounter,
    useCounter
  }
}))
vi.mock('@/runtime/gameAdapter', () => ({
  laya: {
    shaCounter: layaShaCounter,
    useCounter: layaUseCounter
  }
}))

import { handleUseCard } from '../../src/handler/PubGsCUseCard'

describe('handleUseCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('虚拟牌计数但不绘制实体牌', () => {
    handleUseCard(
      { SeatID: 3, useType: 1, isSend: false, spellID: 1 },
      { shouldDrawCard: false }
    )

    expect(drawCard).not.toHaveBeenCalled()
    expect(shaCounter).toHaveBeenCalledOnce()
    expect(layaShaCounter).toHaveBeenCalledOnce()
    expect(useCounter).toHaveBeenCalledOnce()
    expect(layaUseCounter).toHaveBeenCalledOnce()
  })

  it('普通出牌绘制实体牌并只计数一次', () => {
    handleUseCard({ SeatID: 3, CardID: 101, useType: 1, isSend: false, spellID: 1 })

    expect(drawCard).toHaveBeenCalledOnce()
    expect(drawCard).toHaveBeenCalledWith([101])
    expect(shaCounter).toHaveBeenCalledOnce()
    expect(layaShaCounter).toHaveBeenCalledOnce()
    expect(useCounter).toHaveBeenCalledOnce()
    expect(layaUseCounter).toHaveBeenCalledOnce()
  })
})
