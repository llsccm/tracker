import { beforeEach, describe, expect, it, vi } from 'vitest'

const { drawLastUseCard, shaCounter, useCounter, layaShaCounter, layaUseCounter } = vi.hoisted(
  () => ({
    drawLastUseCard: vi.fn(),
    shaCounter: vi.fn(),
    useCounter: vi.fn(),
    layaShaCounter: vi.fn(),
    layaUseCounter: vi.fn()
  })
)

vi.mock('@/draw', () => ({ drawLastUseCard }))
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

  it('单张实体牌按卡牌 ID 渲染并计数一次', () => {
    handleUseCard({ SeatID: 3, CardID: 101, useType: 1, spellID: 1 })

    expect(drawLastUseCard).toHaveBeenCalledOnce()
    expect(drawLastUseCard).toHaveBeenCalledWith([101], { spellId: 1, color: undefined })
    expect(shaCounter).toHaveBeenCalledOnce()
    expect(layaShaCounter).toHaveBeenCalledOnce()
    expect(useCounter).toHaveBeenCalledOnce()
    expect(layaUseCounter).toHaveBeenCalledOnce()
  })

  it('多张转化牌透传 cardIds、spellId 与颜色', () => {
    handleUseCard({
      castSeatId: 3,
      cardIds: [101, 102],
      color: 1,
      useType: 1,
      spellId: 5001
    })

    expect(drawLastUseCard).toHaveBeenCalledOnce()
    expect(drawLastUseCard).toHaveBeenCalledWith([101, 102], { spellId: 5001, color: 1 })
    expect(shaCounter).not.toHaveBeenCalled()
    expect(useCounter).toHaveBeenCalledOnce()
  })

  it('无色转化牌把 color=0 透传下去', () => {
    handleUseCard({ castSeatId: 3, cardIds: [101, 102], color: 0, useType: 1, spellId: 5001 })

    expect(drawLastUseCard).toHaveBeenCalledWith([101, 102], { spellId: 5001, color: 0 })
  })

  it('没有卡牌 ID 的虚拟牌仍计数，交给绘制层跳过渲染', () => {
    handleUseCard({ SeatID: 3, useType: 1, spellID: 1 })

    expect(drawLastUseCard).toHaveBeenCalledWith([], { spellId: 1, color: undefined })
    expect(shaCounter).toHaveBeenCalledOnce()
    expect(useCounter).toHaveBeenCalledOnce()
  })

  it('其他座位的出牌不渲染也不计数', () => {
    handleUseCard({ SeatID: 1, CardID: 101, useType: 1, spellID: 1 })

    expect(drawLastUseCard).not.toHaveBeenCalled()
    expect(useCounter).not.toHaveBeenCalled()
  })
})
