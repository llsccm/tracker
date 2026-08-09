import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleGuiFu, parseGuiFuCardIDs, ROLE_DATA_3709 } from '@/handler/skills/GuiFu'
import { isAnonymous } from '@/tracker/Card'
import type { Room } from '@/tracker/Room'
import { trackerLogger } from '@/utils/logger'
import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'

const {
  getTrackerGuiFuRevealDelta,
  revealTrackerCards,
  settleTrackerPendingDiscardGain,
  trackerMock
} = vi.hoisted(() => {
  const getTrackerGuiFuRevealDelta = vi.fn()
  const revealTrackerCards = vi.fn()
  const settleTrackerPendingDiscardGain = vi.fn()
  return {
    getTrackerGuiFuRevealDelta,
    revealTrackerCards,
    settleTrackerPendingDiscardGain,
    trackerMock: {
      getTrackerGuiFuRevealDelta,
      revealTrackerCards,
      settleTrackerPendingDiscardGain
    }
  }
})

vi.mock('@/tracker/runtime/browser', () => ({
  tracker: trackerMock
}))

function getPlayerHandCards(room: Room, seatID: number) {
  return room.cards.filter(
    (card) => card.location === 'player' && card.subZone === 'hand' && card.seats.has(seatID)
  )
}

describe('GsCUpdateRoleDataExNtf 3709', () => {
  beforeEach(() => {
    // 个别用例会删除方法模拟旧运行时；每次恢复完整 tracker 表面后再重置调用记录。
    trackerMock.getTrackerGuiFuRevealDelta = getTrackerGuiFuRevealDelta
    trackerMock.revealTrackerCards = revealTrackerCards
    trackerMock.settleTrackerPendingDiscardGain = settleTrackerPendingDiscardGain
    revealTrackerCards.mockReset()
    getTrackerGuiFuRevealDelta.mockReset()
    getTrackerGuiFuRevealDelta.mockImplementation((_seatID, cardIDs) => cardIDs)
    settleTrackerPendingDiscardGain.mockReset()
    settleTrackerPendingDiscardGain.mockReturnValue({ result: 'settled', newCardIDs: [] })
  })

  it('按数量读取角色数据中的 CardID', () => {
    expect(parseGuiFuCardIDs([1, 132, 0, 0, 0, 0])).toEqual([132])
    expect(parseGuiFuCardIDs([2, 2, 132, 0, 0, 0])).toEqual([2, 132])
  })

  it('非主视角以角色数据结算已有匿名弃牌获得', () => {
    const msg = {
      DataID: ROLE_DATA_3709,
      Datas: [1, 132, 0, 0, 0, 0],
      SeatID: 2
    }

    expect(handleGuiFu(msg, 1)).toEqual([132])
    expect(settleTrackerPendingDiscardGain).toHaveBeenCalledWith(2, [132], {
      type: 'role-data-3709',
      label: 'GsCUpdateRoleDataExNtf:3709',
      raw: msg
    })
    expect(revealTrackerCards).not.toHaveBeenCalled()
  })

  it('主视角不重复处理角色数据', () => {
    expect(handleGuiFu({ Datas: [1, 132, 0], SeatID: 2 }, 2)).toEqual([])
    expect(settleTrackerPendingDiscardGain).not.toHaveBeenCalled()
    expect(revealTrackerCards).not.toHaveBeenCalled()
  })

  it('没有待结算记录时回退到普通明牌同步', () => {
    settleTrackerPendingDiscardGain.mockReturnValue({ result: 'missing', newCardIDs: [132] })
    const msg = { Datas: [1, 132, 0], SeatID: 2 }

    expect(handleGuiFu(msg, 1)).toEqual([132])
    expect(revealTrackerCards).toHaveBeenCalledWith(
      {
        type: 'player',
        seatID: 2,
        fromSeatID: 2,
        fromZone: null,
        fromSubZone: 'hand',
        subZone: 'hand',
        handMoveCount: 0,
        sourceEvent: {
          type: 'role-data-3709',
          label: 'GsCUpdateRoleDataExNtf:3709',
          raw: msg
        }
      },
      [132]
    )
  })

  it('兼容回退直接使用结算返回的新增牌', () => {
    settleTrackerPendingDiscardGain.mockReturnValue({ result: 'missing', newCardIDs: [2] })
    const msg = { Datas: [2, 2, 132, 0], SeatID: 2 }

    expect(handleGuiFu(msg, 1)).toEqual([2, 132])
    expect(getTrackerGuiFuRevealDelta).not.toHaveBeenCalled()
    expect(revealTrackerCards).toHaveBeenCalledWith(expect.objectContaining({ seatID: 2 }), [2])
  })

  it('结算方法缺失时才使用只读快照差量', () => {
    Reflect.deleteProperty(trackerMock, 'settleTrackerPendingDiscardGain')
    getTrackerGuiFuRevealDelta.mockReturnValue([2])

    expect(handleGuiFu({ Datas: [2, 2, 132, 0], SeatID: 2 }, 1)).toEqual([2, 132])
    expect(getTrackerGuiFuRevealDelta).toHaveBeenCalledWith(2, [2, 132])
    expect(revealTrackerCards).toHaveBeenCalledWith(expect.objectContaining({ seatID: 2 }), [2])
  })

  it('结算与差量方法同时缺失时使用本次角色数据降级', () => {
    Reflect.deleteProperty(trackerMock, 'settleTrackerPendingDiscardGain')
    Reflect.deleteProperty(trackerMock, 'getTrackerGuiFuRevealDelta')

    expect(handleGuiFu({ Datas: [1, 132, 0], SeatID: 2 }, 1)).toEqual([132])
    expect(revealTrackerCards).toHaveBeenCalledWith(expect.objectContaining({ seatID: 2 }), [132])
  })

  it('普通明牌方法缺失时保留角色数据主处理链', () => {
    settleTrackerPendingDiscardGain.mockReturnValue({ result: 'missing', newCardIDs: [132] })
    Reflect.deleteProperty(trackerMock, 'revealTrackerCards')

    expect(handleGuiFu({ Datas: [1, 132, 0], SeatID: 2 }, 1)).toEqual([132])
  })

  it('弃牌堆随机获得先保留全部槽，角色数据到达后才移动真实牌', () => {
    const { controller } = createTrackerControllerHarness()
    const mainSeatID = 1
    const targetSeatID = 2

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: mainSeatID, ClientID: 100 },
        { SeatID: targetSeatID, ClientID: 200 }
      ],
      100
    )
    controller.initTrackerDeck([132, 1, 201, 202])
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [132, 1],
        CardCount: 2,
        FromZone: 1,
        ToZone: 2,
        ToID: 255,
        MoveType: 4
      })
    )

    const room = controller.getTrackerRoom()!
    const discard = room.zones.get('discard')!
    const beforeIDs = discard.cards.map((card) => card.id)

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromID: 255,
        FromPosition: 65282,
        FromZone: 2,
        ToID: targetSeatID,
        ToPosition: 65280,
        ToZone: 5,
        MoveType: 18,
        SpellID: ROLE_DATA_3709
      })
    )

    expect(discard.cards.map((card) => card.id)).toEqual(beforeIDs)
    const actualID = beforeIDs[0]

    const anonymousHand = getPlayerHandCards(room, targetSeatID)
    expect(anonymousHand).toHaveLength(1)
    expect(anonymousHand[0].isKnown).toBe(false)
    expect(room.assertPileIdentityLedgerConsistency('3709-before-role-data')).toEqual([])

    expect(controller.settleTrackerPendingDiscardGain(targetSeatID, [201])).toMatchObject({
      result: 'invalid'
    })
    expect(room.pendingDiscardGains).toHaveLength(1)
    expect(discard.cards.map((card) => card.id)).toEqual(beforeIDs)
    expect(anonymousHand[0].isKnown).toBe(false)
    expect(room.assertPileIdentityLedgerConsistency('3709-invalid-role-data')).toEqual([])

    expect(
      controller.settleTrackerPendingDiscardGain(targetSeatID, [actualID], {
        type: 'role-data-3709',
        label: 'GsCUpdateRoleDataExNtf:3709'
      })
    ).toEqual({ result: 'settled', newCardIDs: [actualID] })

    expect(discard.cards.map((card) => card.id)).toEqual(
      beforeIDs.filter((cardID) => cardID !== actualID)
    )
    const hand = getPlayerHandCards(room, targetSeatID)
    expect(hand).toHaveLength(1)
    expect(hand[0]).toMatchObject({ id: actualID, isKnown: true })
    expect(anonymousHand[0].location).toBe('outside')
    expect(discard.cards.every((card) => card.isKnown)).toBe(true)
    expect(room.pendingDiscardGains).toHaveLength(0)
    expect(room.assertPileIdentityLedgerConsistency('3709-after-role-data')).toEqual([])
  })

  it('牌堆获得的 3709 角色数据也只补充身份', () => {
    const { controller } = createTrackerControllerHarness()
    const mainSeatID = 1
    const targetSeatID = 2

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: mainSeatID, ClientID: 100 },
        { SeatID: targetSeatID, ClientID: 200 }
      ],
      100
    )
    controller.initTrackerDeck([132, 1, 201])
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromZone: 1,
        FromPosition: 65280,
        ToID: targetSeatID,
        ToZone: 5,
        MoveType: 18,
        SpellID: ROLE_DATA_3709
      })
    )

    const room = controller.getTrackerRoom()!
    const pile = room.zones.get('pile')!
    expect(pile.cards).toHaveLength(2)

    expect(
      controller.settleTrackerPendingDiscardGain(targetSeatID, [132], {
        type: 'role-data-3709',
        label: 'GsCUpdateRoleDataExNtf:3709'
      })
    ).toEqual({ result: 'missing', newCardIDs: [132] })
    controller.revealTrackerCards(
      {
        type: 'player',
        seatID: targetSeatID,
        fromSeatID: targetSeatID,
        fromZone: null,
        fromSubZone: 'hand',
        subZone: 'hand',
        handMoveCount: 0,
        sourceEvent: {
          type: 'role-data-3709',
          label: 'GsCUpdateRoleDataExNtf:3709'
        }
      },
      [132]
    )

    expect(pile.cards).toHaveLength(2)
    const hand = getPlayerHandCards(room, targetSeatID)
    expect(hand).toHaveLength(1)
    expect(hand[0]).toMatchObject({ id: 132, isKnown: true })
    expect(room.assertPileIdentityLedgerConsistency('3709-pile-after-role-data')).toEqual([])

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromZone: 1,
        FromPosition: 65280,
        ToID: targetSeatID,
        ToZone: 5,
        MoveType: 18,
        SpellID: ROLE_DATA_3709
      })
    )
    expect(pile.cards).toHaveLength(1)
    expect(
      controller.settleTrackerPendingDiscardGain(targetSeatID, [1, 132], {
        type: 'role-data-3709',
        label: 'GsCUpdateRoleDataExNtf:3709'
      })
    ).toEqual({ result: 'missing', newCardIDs: [1] })
    controller.revealTrackerCards(
      {
        type: 'player',
        seatID: targetSeatID,
        fromSeatID: targetSeatID,
        fromZone: null,
        fromSubZone: 'hand',
        subZone: 'hand',
        handMoveCount: 0,
        sourceEvent: {
          type: 'role-data-3709',
          label: 'GsCUpdateRoleDataExNtf:3709'
        }
      },
      [1]
    )
    expect(
      getPlayerHandCards(room, targetSeatID)
        .map((card) => card.id)
        .sort((a, b) => a - b)
    ).toEqual([1, 132])
  })

  it('弃牌 pending 与牌堆获得交错时先回退牌堆身份并保留 FIFO', () => {
    const { controller } = createTrackerControllerHarness()
    const mainSeatID = 1
    const targetSeatID = 2

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: mainSeatID, ClientID: 100 },
        { SeatID: targetSeatID, ClientID: 200 }
      ],
      100
    )
    controller.initTrackerDeck([10, 20, 30])
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [10],
        CardCount: 1,
        FromZone: 1,
        ToZone: 2,
        ToID: 255,
        MoveType: 4
      })
    )

    // 第一条匿名获得来自弃牌堆，会登记 pending；第二条来自牌堆，只留下额外匿名手牌槽。
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromZone: 2,
        FromPosition: 65282,
        ToID: targetSeatID,
        ToZone: 5,
        MoveType: 18,
        SpellID: ROLE_DATA_3709
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromZone: 1,
        FromPosition: 65280,
        ToID: targetSeatID,
        ToZone: 5,
        MoveType: 18,
        SpellID: ROLE_DATA_3709
      })
    )

    const room = controller.getTrackerRoom()!
    const pendingCard = room.pendingDiscardGains[0].cards[0]
    const pileSettlement = controller.settleTrackerPendingDiscardGain(targetSeatID, [20])
    expect(pileSettlement).toEqual({ result: 'missing', newCardIDs: [20] })
    expect(room.pendingDiscardGains).toHaveLength(1)

    controller.revealTrackerCards(
      {
        type: 'player',
        seatID: targetSeatID,
        fromSeatID: targetSeatID,
        fromZone: null,
        fromSubZone: 'hand',
        subZone: 'hand',
        handMoveCount: 0
      },
      pileSettlement.newCardIDs
    )
    expect(pendingCard).toSatisfy(isAnonymous)

    expect(controller.settleTrackerPendingDiscardGain(targetSeatID, [20, 10])).toEqual({
      result: 'settled',
      newCardIDs: [10]
    })
    expect(room.pendingDiscardGains).toHaveLength(0)
    expect(
      getPlayerHandCards(room, targetSeatID)
        .map((card) => card.id)
        .sort((left, right) => left - right)
    ).toEqual([10, 20])
  })

  it('主视角携带 CardIDs 时沿用普通弃牌堆移动', () => {
    const { controller } = createTrackerControllerHarness()
    const seatID = 2

    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: seatID, ClientID: 200 }], 200)
    controller.initTrackerDeck([132, 1, 201])
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [132, 1],
        CardCount: 2,
        FromZone: 1,
        ToZone: 2,
        ToID: 255,
        MoveType: 4
      })
    )

    const room = controller.getTrackerRoom()!
    const discard = room.zones.get('discard')!
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [132],
        CardCount: 1,
        FromZone: 2,
        ToID: seatID,
        ToZone: 5,
        MoveType: 18,
        SpellID: ROLE_DATA_3709
      })
    )

    expect(discard.cards).toHaveLength(1)
    const hand = getPlayerHandCards(room, seatID)
    expect(hand).toHaveLength(1)
    expect(hand[0]).toMatchObject({ id: 132, isKnown: true })
  })

  it('多张角色数据同步后保持手牌与弃牌堆数量', () => {
    const { controller } = createTrackerControllerHarness()
    const mainSeatID = 1
    const targetSeatID = 2

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: mainSeatID, ClientID: 100 },
        { SeatID: targetSeatID, ClientID: 200 }
      ],
      100
    )
    controller.initTrackerDeck([2, 132, 1, 201])
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [2, 132, 1],
        CardCount: 3,
        FromZone: 1,
        ToZone: 2,
        ToID: 255,
        MoveType: 4
      })
    )

    const room = controller.getTrackerRoom()!
    const discard = room.zones.get('discard')!
    const beforeMove = discard.cards.map((card) => card.id)
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 2,
        FromZone: 2,
        FromPosition: 65282,
        ToID: targetSeatID,
        ToZone: 5,
        MoveType: 18,
        SpellID: ROLE_DATA_3709
      })
    )

    expect(discard.cards.map((card) => card.id)).toEqual(beforeMove)

    expect(
      controller.settleTrackerPendingDiscardGain(targetSeatID, [2, 132], {
        type: 'role-data-3709',
        label: 'GsCUpdateRoleDataExNtf:3709'
      })
    ).toEqual({ result: 'settled', newCardIDs: [2, 132] })

    const hand = getPlayerHandCards(room, targetSeatID)
    expect(hand).toHaveLength(2)
    expect(hand.map((card) => card.id).sort((a, b) => a - b)).toEqual([2, 132])
    expect(hand.every((card) => card.isKnown)).toBe(true)
    expect(discard.cards).toHaveLength(1)
    expect(discard.cards[0].isKnown).toBe(true)
  })

  it('角色数据同步不重排弃牌堆槽位', () => {
    const { controller } = createTrackerControllerHarness()
    const mainSeatID = 1
    const targetSeatID = 2

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: mainSeatID, ClientID: 100 },
        { SeatID: targetSeatID, ClientID: 200 }
      ],
      100
    )
    controller.initTrackerDeck([10, 20, 30, 40, 201])
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [10, 20, 30, 40],
        CardCount: 4,
        FromZone: 1,
        ToZone: 2,
        ToID: 255,
        MoveType: 4
      })
    )

    const room = controller.getTrackerRoom()!
    const discard = room.zones.get('discard')!
    const beforeMove = discard.cards.map((card) => card.id)
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromZone: 2,
        FromPosition: 65282,
        ToID: targetSeatID,
        ToZone: 5,
        MoveType: 18,
        SpellID: ROLE_DATA_3709
      })
    )
    const afterMove = discard.cards.map((card) => card.id)
    expect(afterMove).toEqual(beforeMove)
    const actualID = beforeMove[1]

    expect(
      controller.settleTrackerPendingDiscardGain(targetSeatID, [actualID], {
        type: 'role-data-3709',
        label: 'GsCUpdateRoleDataExNtf:3709'
      })
    ).toEqual({ result: 'settled', newCardIDs: [actualID] })

    expect(discard.cards.map((card) => card.id)).toEqual(
      beforeMove.filter((cardID) => cardID !== actualID)
    )
    expect(discard.cards).toHaveLength(beforeMove.length - 1)
    expect(discard.cards.every((card) => card.isKnown)).toBe(true)
  })

  it('两次移动和累计揭示只移动第二次新增的牌', () => {
    const { controller } = createTrackerControllerHarness()
    const mainSeatID = 1
    const targetSeatID = 2

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: mainSeatID, ClientID: 100 },
        { SeatID: targetSeatID, ClientID: 200 }
      ],
      100
    )
    controller.initTrackerDeck([10, 20, 30])
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [10, 20],
        CardCount: 2,
        FromZone: 1,
        ToZone: 2,
        ToID: 255,
        MoveType: 4
      })
    )

    const room = controller.getTrackerRoom()!
    const discard = room.zones.get('discard')!
    const discardIDs = discard.cards.map((card) => card.id)

    const move = () =>
      controller.syncTrackerMove(
        protocolMove({
          CardIDs: [],
          CardCount: 1,
          FromZone: 2,
          FromPosition: 65282,
          ToID: targetSeatID,
          ToZone: 5,
          MoveType: 18,
          SpellID: ROLE_DATA_3709
        })
      )

    move()
    expect(controller.settleTrackerPendingDiscardGain(targetSeatID, [discardIDs[0]])).toMatchObject(
      { result: 'settled' }
    )
    expect(discard.cards.map((card) => card.id)).toEqual([discardIDs[1]])

    move()
    expect(
      controller.settleTrackerPendingDiscardGain(targetSeatID, [discardIDs[1], discardIDs[0]])
    ).toMatchObject({ result: 'settled' })

    expect(discard.cards).toHaveLength(0)
    const hand = getPlayerHandCards(room, targetSeatID)
    expect(hand.map((card) => card.id).sort((a, b) => a - b)).toEqual(
      discardIDs.slice().sort((a, b) => a - b)
    )
    expect(room.pendingDiscardGains).toHaveLength(0)
  })

  it('重复累计揭示不会再次移动或扣除弃牌堆', () => {
    const { controller } = createTrackerControllerHarness()
    const mainSeatID = 1
    const targetSeatID = 2

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: mainSeatID, ClientID: 100 },
        { SeatID: targetSeatID, ClientID: 200 }
      ],
      100
    )
    controller.initTrackerDeck([10, 20, 30])
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [10, 20],
        CardCount: 2,
        FromZone: 1,
        ToZone: 2,
        ToID: 255,
        MoveType: 4
      })
    )

    const room = controller.getTrackerRoom()!
    const discard = room.zones.get('discard')!
    const actualID = discard.cards[0].id
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromZone: 2,
        FromPosition: 65282,
        ToID: targetSeatID,
        ToZone: 5,
        MoveType: 18,
        SpellID: ROLE_DATA_3709
      })
    )

    expect(controller.settleTrackerPendingDiscardGain(targetSeatID, [actualID])).toMatchObject({
      result: 'settled'
    })
    const discardAfterFirstReveal = discard.cards.map((card) => card.id)
    const handAfterFirstReveal = getPlayerHandCards(room, targetSeatID).map((card) => card.id)

    expect(controller.settleTrackerPendingDiscardGain(targetSeatID, [actualID])).toEqual({
      result: 'duplicate',
      newCardIDs: []
    })
    expect(discard.cards.map((card) => card.id)).toEqual(discardAfterFirstReveal)
    expect(getPlayerHandCards(room, targetSeatID).map((card) => card.id)).toEqual(
      handAfterFirstReveal
    )
  })

  it('角色数据快照缩短时只忽略旧牌删除并继续识别新增牌', () => {
    const { controller } = createTrackerControllerHarness()
    const mainSeatID = 1
    const targetSeatID = 2
    const warn = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})

    try {
      controller.initTrackerRoom()
      controller.registerTrackerPlayers(
        [
          { SeatID: mainSeatID, ClientID: 100 },
          { SeatID: targetSeatID, ClientID: 200 }
        ],
        100
      )
      controller.initTrackerDeck([2, 132, 1, 201])
      controller.syncTrackerMove(
        protocolMove({
          CardIDs: [2, 132, 1],
          CardCount: 3,
          FromZone: 1,
          ToZone: 2,
          ToID: 255,
          MoveType: 4
        })
      )

      const room = controller.getTrackerRoom()!
      const discard = room.zones.get('discard')!
      controller.syncTrackerMove(
        protocolMove({
          CardIDs: [],
          CardCount: 2,
          FromZone: 2,
          FromPosition: 65282,
          ToID: targetSeatID,
          ToZone: 5,
          MoveType: 18,
          SpellID: ROLE_DATA_3709
        })
      )
      expect(controller.settleTrackerPendingDiscardGain(targetSeatID, [2, 132])).toMatchObject({
        result: 'settled'
      })

      const discardBeforeShortSnapshot = discard.cards.map((card) => card.id)
      expect(controller.settleTrackerPendingDiscardGain(targetSeatID, [2])).toEqual({
        result: 'duplicate',
        newCardIDs: []
      })
      expect(discard.cards.map((card) => card.id)).toEqual(discardBeforeShortSnapshot)
      expect(warn).not.toHaveBeenCalled()

      controller.syncTrackerMove(
        protocolMove({
          CardIDs: [132],
          CardCount: 1,
          FromID: targetSeatID,
          FromZone: 5,
          ToID: 255,
          ToZone: 2,
          MoveType: 4
        })
      )
      expect(room.cardIndex.get(132)?.location).toBe('discard')

      controller.syncTrackerMove(
        protocolMove({
          CardIDs: [],
          CardCount: 1,
          FromZone: 2,
          FromPosition: 65282,
          ToID: targetSeatID,
          ToZone: 5,
          MoveType: 18,
          SpellID: ROLE_DATA_3709
        })
      )
      const newCardID = discard.cards[0].id
      expect(
        controller.settleTrackerPendingDiscardGain(targetSeatID, [newCardID, 2])
      ).toMatchObject({ result: 'settled' })
      expect(room.cardIndex.get(newCardID)?.location).toBe('player')
      expect(room.cardIndex.get(132)?.location).toBe('discard')
    } finally {
      warn.mockRestore()
    }
  })

  it('旧 3709 牌进入弃牌堆后，后续快照可以只包含新牌', () => {
    const { controller } = createTrackerControllerHarness()
    const mainSeatID = 1
    const targetSeatID = 2

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: mainSeatID, ClientID: 100 },
        { SeatID: targetSeatID, ClientID: 200 }
      ],
      100
    )
    controller.initTrackerDeck([10, 20, 30, 40])
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [10, 20],
        CardCount: 2,
        FromZone: 1,
        ToZone: 2,
        ToID: 255,
        MoveType: 4
      })
    )

    const room = controller.getTrackerRoom()!
    const discard = room.zones.get('discard')!
    const firstID = discard.cards[0].id

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromZone: 2,
        FromPosition: 65282,
        ToID: targetSeatID,
        ToZone: 5,
        MoveType: 18,
        SpellID: ROLE_DATA_3709
      })
    )
    expect(controller.settleTrackerPendingDiscardGain(targetSeatID, [firstID])).toMatchObject({
      result: 'settled'
    })

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [firstID],
        CardCount: 1,
        FromID: targetSeatID,
        FromZone: 5,
        ToID: 255,
        ToZone: 2,
        MoveType: 4,
        SpellID: 0
      })
    )
    expect(room.cardIndex.get(firstID)?.location).toBe('discard')

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromZone: 2,
        FromPosition: 65282,
        ToID: targetSeatID,
        ToZone: 5,
        MoveType: 18,
        SpellID: ROLE_DATA_3709
      })
    )
    const nextID = discard.cards[0].id

    expect(room.getGuiFuRevealDelta(targetSeatID, [nextID])).toEqual([nextID])
    expect(controller.settleTrackerPendingDiscardGain(targetSeatID, [nextID])).toMatchObject({
      result: 'settled'
    })
    expect(room.pendingDiscardGains).toHaveLength(0)
    expect(room.cardIndex.get(nextID)?.location).toBe('player')
  })

  it('单次两张牌可以分两次按当前快照新增牌揭示', () => {
    const { controller } = createTrackerControllerHarness()
    const mainSeatID = 1
    const targetSeatID = 2

    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: mainSeatID, ClientID: 100 },
        { SeatID: targetSeatID, ClientID: 200 }
      ],
      100
    )
    controller.initTrackerDeck([10, 20, 30])
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [10, 20],
        CardCount: 2,
        FromZone: 1,
        ToZone: 2,
        ToID: 255,
        MoveType: 4
      })
    )

    const room = controller.getTrackerRoom()!
    const discard = room.zones.get('discard')!
    const discardIDs = discard.cards.map((card) => card.id)
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 2,
        FromZone: 2,
        FromPosition: 65282,
        ToID: targetSeatID,
        ToZone: 5,
        MoveType: 18,
        SpellID: ROLE_DATA_3709
      })
    )

    expect(controller.settleTrackerPendingDiscardGain(targetSeatID, [discardIDs[0]])).toMatchObject(
      { result: 'settled' }
    )
    expect(discard.cards.map((card) => card.id)).toEqual([discardIDs[1]])
    expect(room.pendingDiscardGains).toHaveLength(1)

    expect(
      controller.settleTrackerPendingDiscardGain(targetSeatID, [discardIDs[1], discardIDs[0]])
    ).toMatchObject({ result: 'settled' })
    expect(discard.cards).toHaveLength(0)
    expect(room.pendingDiscardGains).toHaveLength(0)
  })

  it('累计角色数据只同步未出现在快照中的新牌', () => {
    const { controller } = createTrackerControllerHarness()
    const mainSeatID = 1
    const targetSeatID = 2
    const warn = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})

    try {
      controller.initTrackerRoom()
      controller.registerTrackerPlayers(
        [
          { SeatID: mainSeatID, ClientID: 100 },
          { SeatID: targetSeatID, ClientID: 200 }
        ],
        100
      )
      controller.initTrackerDeck([10, 20, 30])
      controller.syncTrackerMove(
        protocolMove({
          CardIDs: [10, 20],
          CardCount: 2,
          FromZone: 1,
          ToZone: 2,
          ToID: 255,
          MoveType: 4
        })
      )

      const room = controller.getTrackerRoom()!
      const discard = room.zones.get('discard')!
      const discardIDs = discard.cards.map((card) => card.id)
      controller.syncTrackerMove(
        protocolMove({
          CardIDs: [],
          CardCount: 1,
          FromZone: 2,
          FromPosition: 65282,
          ToID: targetSeatID,
          ToZone: 5,
          MoveType: 18,
          SpellID: ROLE_DATA_3709
        })
      )
      expect(
        controller.settleTrackerPendingDiscardGain(targetSeatID, [discardIDs[0]])
      ).toMatchObject({ result: 'settled' })

      controller.syncTrackerMove(
        protocolMove({
          CardIDs: [],
          CardCount: 1,
          FromZone: 2,
          FromPosition: 65282,
          ToID: targetSeatID,
          ToZone: 5,
          MoveType: 18,
          SpellID: ROLE_DATA_3709
        })
      )
      const discardBefore = discard.cards.map((card) => card.id)

      expect(
        controller.settleTrackerPendingDiscardGain(targetSeatID, [discardIDs[0], discardIDs[1]])
      ).toMatchObject({ result: 'settled' })
      expect(room.pendingDiscardGains).toHaveLength(0)
      expect(discard.cards.map((card) => card.id)).toEqual(
        discardBefore.filter((cardID) => cardID !== discardIDs[1])
      )
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('严格按 FIFO 队首结算并对乱序角色数据告警', () => {
    const { controller } = createTrackerControllerHarness()
    const firstTargetSeatID = 2
    const secondTargetSeatID = 3
    const warn = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})

    try {
      controller.initTrackerRoom()
      controller.registerTrackerPlayers(
        [
          { SeatID: 1, ClientID: 100 },
          { SeatID: firstTargetSeatID, ClientID: 200 },
          { SeatID: secondTargetSeatID, ClientID: 300 }
        ],
        100
      )
      controller.initTrackerDeck([10, 20, 30])
      controller.syncTrackerMove(
        protocolMove({
          CardIDs: [10, 20],
          CardCount: 2,
          FromZone: 1,
          ToZone: 2,
          ToID: 255,
          MoveType: 4
        })
      )

      const room = controller.getTrackerRoom()!
      const discard = room.zones.get('discard')!
      const discardIDs = discard.cards.map((card) => card.id)

      for (const targetSeatID of [firstTargetSeatID, secondTargetSeatID]) {
        controller.syncTrackerMove(
          protocolMove({
            CardIDs: [],
            CardCount: 1,
            FromZone: 2,
            FromPosition: 65282,
            ToID: targetSeatID,
            ToZone: 5,
            MoveType: 18,
            SpellID: ROLE_DATA_3709
          })
        )
      }

      expect(room.pendingDiscardGains).toHaveLength(2)
      expect(discard.cards.map((card) => card.id)).toEqual(discardIDs)
      expect(
        controller.settleTrackerPendingDiscardGain(secondTargetSeatID, [discardIDs[1]])
      ).toMatchObject({ result: 'invalid' })
      expect(room.pendingDiscardGains).toHaveLength(2)
      expect(warn).toHaveBeenCalledWith(
        '诡伏角色数据与待结算 FIFO 队首座位不一致',
        expect.objectContaining({
          pendingSeatID: firstTargetSeatID,
          receivedSeatID: secondTargetSeatID
        })
      )

      expect(
        controller.settleTrackerPendingDiscardGain(firstTargetSeatID, [discardIDs[0]])
      ).toMatchObject({ result: 'settled' })
      expect(
        controller.settleTrackerPendingDiscardGain(secondTargetSeatID, [discardIDs[1]])
      ).toMatchObject({ result: 'settled' })
      expect(room.pendingDiscardGains).toHaveLength(0)
      expect(discard.cards).toHaveLength(0)
    } finally {
      warn.mockRestore()
    }
  })
})
