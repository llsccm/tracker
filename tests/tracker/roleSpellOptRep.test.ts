import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POSITION_BOTTOM } from '@/tracker/candidate/cardPositions'

const {
  getReadyTrackerRoom,
  parseJieLiSelectionData,
  recordJieLiSelection,
  revealTrackerCards,
  revealTrackerCardsInZone,
  setTrackerFirstHand
} = vi.hoisted(() => ({
  getReadyTrackerRoom: vi.fn(),
  parseJieLiSelectionData: vi.fn(),
  recordJieLiSelection: vi.fn(),
  revealTrackerCards: vi.fn(),
  revealTrackerCardsInZone: vi.fn(),
  setTrackerFirstHand: vi.fn()
}))

vi.mock('../../src/tracker/runtime/browser', () => ({
  tracker: {
    getReadyTrackerRoom,
    revealTrackerCards,
    revealTrackerCardsInZone,
    setTrackerFirstHand
  }
}))

vi.mock('../../src/tracker/skill/JieLi', () => ({
  parseJieLiSelectionData,
  recordJieLiSelection
}))

import { handleRoleSpellOptRep } from '@/handler/CGsRoleSpellOptRep'
import { Game } from '@/tracker'
import { Room } from '@/tracker/Room'
import type { DuoQiState } from '@/tracker/skill/DuoQi'

describe('CGsRoleSpellOptRep', () => {
  beforeEach(() => {
    getReadyTrackerRoom.mockReset()
    parseJieLiSelectionData.mockReset()
    recordJieLiSelection.mockReset()
    revealTrackerCards.mockClear()
    revealTrackerCardsInZone.mockClear()
    setTrackerFirstHand.mockClear()
    Game.deleteSpellState(361)
    Game.deleteSpellState(3731)
    Game.isGameStart = false
    Game.round = 0
    Game.phase = 0
  })

  it('诫厉 Type 53 只在当前视角为目标座位时记录交换选择', () => {
    const datas = [7, 6, 1, 48, 1, 110]
    const selection = {
      actorSeat: 7,
      targetSeat: 6,
      handCardIDs: [48],
      pileCardIDs: [110]
    }
    const room = { mySeatID: 6 }
    getReadyTrackerRoom.mockReturnValue(room)
    parseJieLiSelectionData.mockReturnValue(selection)

    handleRoleSpellOptRep({
      Datas: datas,
      SeatID: 7,
      SpellID: 3483,
      Type: 53
    })

    expect(parseJieLiSelectionData).toHaveBeenCalledWith(datas)
    expect(recordJieLiSelection).toHaveBeenCalledWith(room, selection)
  })

  it.each([7, 5])('诫厉 Type 53 在座位 %s 视角不处理目标座位 6 的选择', (mySeatID) => {
    const selection = {
      actorSeat: 7,
      targetSeat: 6,
      handCardIDs: [48],
      pileCardIDs: [110]
    }
    getReadyTrackerRoom.mockReturnValue({ mySeatID })
    parseJieLiSelectionData.mockReturnValue(selection)

    handleRoleSpellOptRep({
      Datas: [7, 6, 1, 48, 1, 110],
      SeatID: 7,
      SpellID: 3483,
      Type: 53
    })

    expect(parseJieLiSelectionData).not.toHaveBeenCalled()
    expect(recordJieLiSelection).not.toHaveBeenCalled()
  })

  it('Type 44 叫分回包不设置先手', () => {
    handleRoleSpellOptRep({
      Datas: [300],
      SeatID: 2,
      SpellID: 0,
      Type: 44
    })

    expect(setTrackerFirstHand).not.toHaveBeenCalled()
  })

  it('Type 45 地主结果播报当前不设置先手', () => {
    handleRoleSpellOptRep({
      Datas: [300, 1],
      SeatID: 2,
      SpellID: 0,
      Type: 45
    })

    expect(setTrackerFirstHand).not.toHaveBeenCalled()
  })

  it('Type 72 在开局时机创建结构化夺炁状态', () => {
    Game.isGameStart = true
    const room = new Room({ gameState: Game })
    room.registerPlayers([{ SeatID: 2, ClientID: 200 }], 200)
    room.initDeck([63, 125])

    handleRoleSpellOptRep({
      Datas: [63, 125, 0],
      SeatID: 2,
      SpellID: 0,
      Type: 72
    })

    const state = Game.getSpellState<DuoQiState>(3731)
    expect(state?.active).toBe(true)
    expect(Array.from(state?.allCardIDs ?? [])).toEqual([63, 125])
    room.destroy()
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

  it('下书选择回复先于移动，只记录选项等待实际转移', () => {
    Game.setSpellState(361, {
      shownCardIDs: [108, 131, 49, 54, 78],
      targetSeatID: 4
    })

    handleRoleSpellOptRep({
      Datas: [2, 1],
      SeatID: 1,
      SpellID: 361,
      Type: 22,
      data_count: 2
    })

    expect(Game.getSpellState(361)).toMatchObject({
      actorSeatID: 1,
      choice: 2,
      targetSeatID: 4
    })
    expect(revealTrackerCards).not.toHaveBeenCalled()
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
