import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POSITION_BOTTOM } from '@/tracker/candidate/cardPositions'

const { revealTrackerCardsInZone, setTrackerFirstHand } = vi.hoisted(() => ({
  revealTrackerCardsInZone: vi.fn(),
  setTrackerFirstHand: vi.fn()
}))

vi.mock('../../src/tracker/runtime/browser', () => ({
  tracker: {
    revealTrackerCardsInZone,
    setTrackerFirstHand
  }
}))

import { handleRoleSpellOptRep } from '../../src/handler/CGsRoleSpellOptRep'
import { Game } from '../../src/tracker'

describe('CGsRoleSpellOptRep', () => {
  beforeEach(() => {
    revealTrackerCardsInZone.mockClear()
    setTrackerFirstHand.mockClear()
    Game.deleteSpellState(3731)
    Game.isGameStart = false
    Game.round = 0
    Game.phase = 0
  })

  it('Type 44 将叫分座位同步为先手', () => {
    handleRoleSpellOptRep({
      Datas: [300],
      SeatID: 2,
      SpellID: 0,
      Type: 44
    })

    expect(setTrackerFirstHand).toHaveBeenCalledWith(2)
  })

  it('Type 72 在开局阶段累计去重后的正 CardID', () => {
    Game.isGameStart = true
    Game.setSpellState(3731, [2, 63])

    handleRoleSpellOptRep({
      Datas: [63, 125, 0],
      SeatID: 2,
      SpellID: 0,
      Type: 72
    })

    expect(Game.getSpellState(3731)).toEqual([2, 63, 125])
  })

  it('捷悟将 Datas 同步为对应座位的手牌明牌', () => {
    handleRoleSpellOptRep({
      Datas: [158, 2],
      SeatID: 2,
      SpellID: 3659,
      Type: 30
    })

    expect(revealTrackerCardsInZone).toHaveBeenCalledWith(
      { id: 2, zone: 5, pos: undefined },
      [158, 2]
    )
  })

  it('鹰视将 Type 30 的 Datas 作为牌堆顶可见牌同步', () => {
    handleRoleSpellOptRep({
      Datas: [158, 2, 63, 125],
      SeatID: 2,
      SpellID: 7009,
      Type: 30,
      className: 'CGsRoleSpellOptRep',
      data_count: 4
    })

    expect(revealTrackerCardsInZone).toHaveBeenCalledOnce()
    expect(revealTrackerCardsInZone).toHaveBeenCalledWith(
      { id: 255, zone: 1, pos: undefined },
      [158, 2, 63, 125]
    )
  })

  it('鹰视的其它回复类型不公开牌堆牌', () => {
    handleRoleSpellOptRep({
      Datas: [158, 2, 63, 125],
      SpellID: 7009,
      Type: 50
    })

    expect(revealTrackerCardsInZone).not.toHaveBeenCalled()
  })

  it('嚣翻按协议底部方向同步逆序后的 Datas', () => {
    handleRoleSpellOptRep({
      Datas: [158, 2, 63, 125],
      SeatID: 2,
      SpellID: 3336,
      Type: 50
    })

    expect(revealTrackerCardsInZone).toHaveBeenCalledWith(
      { id: 255, zone: 1, pos: POSITION_BOTTOM },
      [125, 63, 2, 158]
    )
  })
})
