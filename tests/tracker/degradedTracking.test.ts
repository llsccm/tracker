import { afterEach, describe, expect, it, vi } from 'vitest'
import { POSITION_RANDOM } from '@/tracker/candidate/cardPositions'
import type { Room } from '@/tracker/Room'
import { trackerLogger } from '@/utils/logger'
import {
  createErrorSpy,
  createTrackerControllerHarness,
  protocolMove
} from './helpers/trackerController'

function createDegradedRoom(cardIDs = [11, 12, 13, 14]) {
  const errorSpy = createErrorSpy()
  const warn = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})
  const harness = createTrackerControllerHarness()
  harness.controller.initTrackerRoom()
  harness.controller.registerTrackerPlayers(
    [
      { SeatID: 0, ClientID: 100 },
      { SeatID: 1, ClientID: 101 }
    ],
    100
  )
  harness.controller.initTrackerDeck(cardIDs)
  harness.controller.degradeTrackerRoom()
  return { ...harness, room: harness.controller.getTrackerRoom()!, errorSpy, warn }
}

function shuffleMove(cardCount: number) {
  return protocolMove({
    CardIDs: [],
    CardCount: cardCount,
    FromID: 255,
    FromPosition: 65280,
    FromZone: 2,
    ToID: 255,
    ToPosition: 0,
    ToZone: 9,
    MoveType: 255
  })
}

function expectPileCount(room: Room, count: number) {
  expect(room.getZone('pile').cards).toHaveLength(count)
  expect(room.pileIdentityLedger.getSnapshot().accountedPileCount).toBe(count)
  expect(room.pileIdentityLedger.assertConsistency(count, 'test:degraded-pile')).toEqual([])
  expect(room.publicZones.getPublicZoneConsistencyIssues()).toEqual([])
}

afterEach(() => vi.restoreAllMocks())

describe('重连残局降级追踪', () => {
  it('按重连初始化顺序先收到 CardCount 103，再切换模式，保留锚点并继续摸牌', () => {
    const errorSpy = createErrorSpy()
    const { controller, gameState, view } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      [
        { SeatID: 0, ClientID: 100 },
        { SeatID: 1, ClientID: 101 }
      ],
      100
    )
    const recordInfo = {
      gameId: { low: 123, high: 456, unsigned: true },
      matchName: '新欢乐排位'
    }
    gameState.updateRecordInfo(recordInfo)
    gameState.updateRecordInfo(recordInfo)
    controller.setTrackerFirstHand(0)
    gameState.setTurn(7)
    controller.initTrackerDeck(Array.from({ length: 136 }, (_, index) => index + 1))
    controller.syncTrackerMove(shuffleMove(103))
    const room = controller.getReadyTrackerRoom()!
    const players = [...room.players.values()]
    const pileCards = [...room.getZone('pile').cards]

    controller.degradeTrackerRoom()

    expect(controller.getReadyTrackerRoom()).toBe(room)
    expect(room.trackingMode).toBe('degraded')
    expect(room.isPileCountKnown).toBe(true)
    expect(room.getZone('pile').cards).toEqual(pileCards)
    expect([...room.players.values()]).toEqual(players)
    expect(gameState.turn).toBe(7)
    expect(view.calls.mount).toBe(2)
    expect(view.calls.unmount).toBe(0)
    expectPileCount(room, 103)

    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 2, ToID: 1 }))
    expectPileCount(room, 101)
    expect(room.isPileCountKnown).toBe(true)
    expect(room.getPlayer(1)?.handCountDelta).toBe(2)
    expect(room.getPlayer(1)?.cards).toHaveLength(2)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('旧局没有记录的明牌出牌、装备、判定和标记变动仍按协议落区', () => {
    const { controller, room, errorSpy } = createDegradedRoom()
    controller.syncTrackerMove(protocolMove({ CardIDs: [11], ToID: 0 }))
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [11],
        FromID: 0,
        FromZone: 5,
        ToID: 0,
        ToZone: 6,
        MoveType: 2
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [12],
        FromID: 0,
        FromZone: 5,
        ToID: 0,
        ToZone: 7,
        MoveType: 2
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [13],
        FromID: 0,
        FromZone: 5,
        ToID: 0,
        ToZone: 4,
        ToZoneParam: 3000,
        MoveType: 9
      })
    )

    expect(room.getPlayer(0)?.equipCards.map((card) => card.id)).toEqual([11])
    expect(room.getPlayer(0)?.judgeCards.map((card) => card.id)).toEqual([12])
    expect(
      room
        .getPlayer(0)
        ?.markCards.get(3000)
        ?.map((card) => card.id)
    ).toEqual([13])
    expect(room.getPlayer(0)?.handCountDelta).toBe(-2)

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [99],
        FromID: 0,
        FromZone: 5,
        ToID: 255,
        ToZone: 2,
        MoveType: 4
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [11],
        FromID: 0,
        FromZone: 6,
        ToID: 255,
        ToZone: 2,
        MoveType: 4
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [13],
        FromID: 0,
        FromZone: 4,
        FromZoneParam: 3000,
        ToID: 0,
        ToZone: 5,
        MoveType: 8
      })
    )

    expect(room.getZone('discard').cards.map((card) => card.id)).toEqual([99, 11])
    expect(room.getPlayer(0)?.equipCards).toEqual([])
    expect(room.getPlayer(0)?.getMarkCardsBySpell(3000)).toEqual([])
    expect(room.getPlayer(0)?.knownHandCards.map((card) => card.id)).toEqual([13])
    expect(room.getPlayer(0)?.handCountDelta).toBe(-2)
    expect(room.cardIndex.get(99)?.isKnown).toBe(true)
    expect(room.trackedCards.filter((card) => card.id === 99)).toHaveLength(1)
    expect(room.publicZones.getPublicZoneConsistencyIssues()).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('未知来源缺口补位，仍完整记录手牌、暗标记和公共区的协议张数', () => {
    const { controller, room, errorSpy } = createDegradedRoom([])
    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 3, ToID: 0 }))
    expect(room.getPlayer(0)?.cards).toHaveLength(3)
    expect(room.getPlayer(0)?.handCountDelta).toBe(3)

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 2,
        FromZone: 5,
        FromID: 1,
        ToZone: 4,
        ToZoneParam: 3000,
        ToID: 1,
        MoveType: 9
      })
    )
    expect(
      room.getPlayer(1)?.cards.filter((card) => card.subZone === 'mark' && card.spellID === 3000)
    ).toHaveLength(2)
    expect(room.getPlayer(1)?.handCountDelta).toBe(-2)

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 1,
        FromZone: 5,
        FromID: 1,
        ToZone: 2,
        ToID: 255,
        MoveType: 4
      })
    )
    expect(room.getZone('discard').cards).toHaveLength(1)
    expect(room.getPlayer(1)?.handCountDelta).toBe(-3)
    expect(room.getPlayer(1)?.hasObservedHandCount).toBe(false)
    expect(room.isPileCountKnown).toBe(false)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('丢弃旧手牌总数基线，差量不建立绝对总数；明确快照到达后继续按总数更新', () => {
    const errorSpy = createErrorSpy()
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 0, ClientID: 100 }], 100)
    controller.initTrackerDeck([11, 12, 13, 14])
    controller.syncTrackerMove(protocolMove({ CardIDs: [11, 12], ToID: 0 }))
    const room = controller.getReadyTrackerRoom()!
    room.syncObservedPlayerHandCount(0, 4)
    expect(room.getPlayer(0)?.observedHandCount).toBe(4)
    const knownHandBefore = [...room.getPlayer(0)!.knownHandCards]
    controller.degradeTrackerRoom()
    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 1, ToID: 0 }))
    const player = room.getPlayer(0)!

    expect(player.handCountDelta).toBe(1)
    expect(player.hasObservedHandCount).toBe(false)
    expect(room.shouldRevealPlayerHandAsFullHand(0, player.cards.length)).toBe(false)
    expect(player.knownHandCards).toEqual(knownHandBefore)

    room.syncObservedPlayerHandCount(0, 5)
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [11],
        FromZone: 5,
        FromID: 0,
        ToZone: 2,
        ToID: 255,
        MoveType: 4
      })
    )
    expect(player.hasObservedHandCount).toBe(true)
    expect(player.observedHandCount).toBe(4)
    expect(player.handCountDelta).toBe(0)
    expect(room.shouldRevealPlayerHandAsFullHand(0, 4)).toBe(true)

    controller.degradeTrackerRoom()
    expect(player.observedHandCount).toBe(4)
    expect(player.hasObservedHandCount).toBe(true)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('无手牌基线的随机获得只扩大明牌候选，不将本地牌数当作完整全集', () => {
    const { controller, room, errorSpy } = createDegradedRoom()
    controller.revealTrackerCards({ type: 'player', seatID: 0 }, [11, 12])
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 2,
        FromZone: 5,
        FromID: 0,
        FromPosition: POSITION_RANDOM,
        ToID: 1,
        MoveType: 18
      })
    )

    for (const cardID of [11, 12]) {
      expect(room.cardIndex.get(cardID)?.seats).toEqual(new Set([0, 1]))
    }
    expect(room.getPlayer(0)?.hasObservedHandCount).toBe(false)
    expect(room.getPlayer(1)?.hasObservedHandCount).toBe(false)
    expect(room.getPlayer(0)?.handCountDelta).toBe(-2)
    expect(room.getPlayer(1)?.handCountDelta).toBe(2)
    expect(room.getPlayer(1)?.cards.filter((card) => card.isAnonymous)).toHaveLength(2)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it.each([0, 2, 4, 10])('洗牌按明确 CardCount %s 校准物理槽并保持降级模式', (count) => {
    const { controller, room, errorSpy, warn } = createDegradedRoom()
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [99],
        FromZone: 5,
        FromID: 0,
        ToZone: 2,
        ToID: 255,
        MoveType: 4
      })
    )
    controller.syncTrackerMove(shuffleMove(count))

    expect(room.isPileCountKnown).toBe(true)
    expect(room.trackingMode).toBe('degraded')
    expect(room.getZone('discard').cards).toEqual([])
    expectPileCount(room, count)
    expect(room.pileIdentityLedger.getSnapshot().cohort.definitelyInPileIDs).toEqual([])
    expect(room.pileIdentityLedger.getSnapshot().cohort.definitelyOutsidePileIDs).toEqual([])
    expect(warn.mock.calls.filter(([message]) => message === '牌堆身份账本异常')).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('没有明确 CardCount 的洗牌不建立数量锚点', () => {
    const { room, errorSpy } = createDegradedRoom()
    room.shufflePile()
    expect(room.isPileCountKnown).toBe(false)
    room.shufflePile({ cardCount: null })
    expect(room.isPileCountKnown).toBe(false)
    expectPileCount(room, 4)
    room.shufflePile({ cardCount: 6 })
    expect(room.isPileCountKnown).toBe(true)
    room.shufflePile()
    expect(room.isPileCountKnown).toBe(false)
    expectPileCount(room, 6)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('数量恢复后保留明确牌顶身份，并正常记录后续明牌和匿名摸牌', () => {
    const { controller, room, errorSpy } = createDegradedRoom()
    controller.syncTrackerMove(shuffleMove(10))
    controller.revealTrackerCardsInZone({ zone: 1, id: 255 }, [11])
    const knownTop = room.cardIndex.get(11)!
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [99],
        FromZone: 5,
        FromID: 0,
        ToZone: 2,
        ToID: 255,
        MoveType: 4
      })
    )

    controller.syncTrackerMove(shuffleMove(12))
    expectPileCount(room, 12)
    expect(room.getZone('pile').cards.at(-1)).toBe(knownTop)
    expect(room.pileIdentityLedger.getSnapshot().knownPileIdentityIDs).toEqual([11])
    expect(room.getZone('pile').cards.filter((card) => card.isKnown)).toEqual([knownTop])

    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 1, ToID: 0 }))
    expect(room.getPlayer(0)?.knownHandCards).toEqual([knownTop])
    expectPileCount(room, 11)
    expect(room.isPileCountKnown).toBe(true)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('身份集合不足仍可锚定、摸牌和匿名回堆，不裁减物理数量或报警', () => {
    const { controller, room, errorSpy, warn } = createDegradedRoom([11, 12])
    controller.syncTrackerMove(shuffleMove(10))
    expectPileCount(room, 10)
    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 3, ToID: 0 }))
    expectPileCount(room, 7)
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 2,
        FromZone: 5,
        FromID: 0,
        ToZone: 1,
        ToID: 255,
        ToPosition: POSITION_RANDOM,
        MoveType: 19
      })
    )

    expectPileCount(room, 9)
    expect(room.isPileCountKnown).toBe(true)
    expect(room.pileIdentityLedger.getSnapshot().identityUniverseIDs).toEqual([11, 12])
    expect(warn.mock.calls.filter(([message]) => message === '牌堆身份账本异常')).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('已锚定牌堆不足时保留移动，数量退回未知，下一次明确洗牌再次锚定', () => {
    const { controller, room, errorSpy } = createDegradedRoom([])
    controller.syncTrackerMove(shuffleMove(1))
    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 3, ToID: 0 }))
    expect(room.getPlayer(0)?.cards).toHaveLength(3)
    expect(room.isPileCountKnown).toBe(false)

    controller.syncTrackerMove(shuffleMove(6))
    expect(room.isPileCountKnown).toBe(true)
    expectPileCount(room, 6)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('关闭跨账本强断言，仍保持实体与公共区域结构一致性检查', () => {
    const { room, errorSpy } = createDegradedRoom()
    const assertLedger = vi.spyOn(room.pileIdentityLedger, 'assertConsistency')
    expect(room.assertPileIdentityLedgerConsistency('test:degraded')).toEqual([])
    expect(assertLedger).not.toHaveBeenCalled()
    expect(room.publicZones.getPublicZoneConsistencyIssues()).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('新的 Room 恢复 full，不继承降级模式、手牌差量或旧锚点', () => {
    const { controller, room } = createDegradedRoom()
    controller.syncTrackerMove(shuffleMove(10))
    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 2, ToID: 0 }))

    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 0, ClientID: 100 }], 100)
    controller.initTrackerDeck([11, 12])
    const nextRoom = controller.getReadyTrackerRoom()!

    expect(nextRoom).not.toBe(room)
    expect(nextRoom.trackingMode).toBe('full')
    expect(nextRoom.isPileCountKnown).toBe(true)
    expect(nextRoom.getPlayer(0)?.handCountDelta).toBe(0)
    expectPileCount(nextRoom, 2)
    expect(nextRoom.pileIdentityLedger.getSnapshot().cohort.definitelyInPileIDs).toEqual([11, 12])
  })
})
