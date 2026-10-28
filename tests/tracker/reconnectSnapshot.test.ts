import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReconnectGameSnapshot, ReconnectSeatInfo } from '@/tracker/types'
import { trackerLogger } from '@/utils/logger'
import {
  createErrorSpy,
  createTrackerControllerHarness,
  protocolMove
} from './helpers/trackerController'

function seatInfo(SeatID: number, overrides: Partial<ReconnectSeatInfo> = {}): ReconnectSeatInfo {
  return {
    SeatID,
    HandCardCount: 0,
    EquipCardCount: 0,
    EquipCards: [],
    JudgeCardCount: 0,
    JudgeCards: [],
    ...overrides
  }
}

function reconnectSnapshot(): ReconnectGameSnapshot {
  return {
    CardPileCount: 71,
    SeatInfos: Array.from({ length: 8 }, (_, seatID) =>
      seatInfo(
        seatID,
        seatID === 7
          ? {
              CharacterID: 638,
              Figure: 2,
              EquipCardCount: 2,
              EquipCards: [
                { CardId: 122, SubType: 1 },
                { CardId: 136, SubType: 2 }
              ],
              JudgeCardCount: 1,
              JudgeCards: [{ CardId: 32, SpellId: 15 }]
            }
          : {}
      )
    )
  }
}

function createReconnectRoom(cardIDs = Array.from({ length: 136 }, (_, index) => index + 1)) {
  const errorSpy = createErrorSpy()
  const warn = vi.spyOn(trackerLogger, 'warn').mockImplementation(() => {})
  const harness = createTrackerControllerHarness()
  harness.controller.initTrackerRoom()
  harness.controller.registerTrackerPlayers(
    Array.from({ length: 8 }, (_, SeatID) => ({ SeatID, ClientID: 100 + SeatID })),
    100
  )
  harness.controller.setTrackerFirstHand(0)
  harness.controller.initTrackerDeck(cardIDs)
  return { ...harness, room: harness.controller.getReadyTrackerRoom()!, errorSpy, warn }
}

afterEach(() => vi.restoreAllMocks())

describe('重连消息中的残局快照', () => {
  it.each([0, 7])('重连手牌同步座位 %s 的正 ID 和总数，重复通知不会增加物理槽', (SeatIndex) => {
    const { controller, room, errorSpy } = createReconnectRoom()
    controller.degradeTrackerRoom(reconnectSnapshot())
    const pileCards = room.getZone('pile').cards.slice()
    const generation = room.pileIdentityLedger.getSnapshot().cohort.generation
    const snapshot = { SeatIndex, Count: 3, CardIDs: [11, 0, 12] }

    controller.restoreTrackerReconnectHand(snapshot)

    const player = room.getPlayer(SeatIndex)!
    expect(room.mySeatID).toBe(SeatIndex)
    expect(player.observedHandCount).toBe(3)
    expect(player.handCountDelta).toBe(0)
    expect(player.knownHandCards.map((card) => card.id)).toEqual([11, 12])
    expect(player.unknownCardCount).toBe(1)
    expect(player.cards.filter((card) => card.subZone === 'hand')).toHaveLength(3)
    const knownCards = player.knownHandCards.slice()
    const entityCount = room.cards.length

    controller.restoreTrackerReconnectHand(snapshot)

    expect(player.knownHandCards).toEqual(knownCards)
    expect(room.cards).toHaveLength(entityCount)
    expect(room.getZone('pile').cards).toEqual(pileCards)
    expect(room.isPileCountKnown).toBe(true)
    expect(room.pileIdentityLedger.getSnapshot().accountedPileCount).toBe(71)
    expect(room.pileIdentityLedger.getSnapshot().cohort.generation).toBe(generation)
    expect(room.unlocatedIdentities.has(11)).toBe(false)
    expect(room.unlocatedIdentities.has(12)).toBe(false)
    expect(room.getPlayer(7)?.equipCards.map((card) => card.id)).toEqual([122, 136])
    expect(room.getPlayer(7)?.judgeCards.map((card) => card.id)).toEqual([32])

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [11],
        FromID: SeatIndex,
        FromZone: 5,
        ToID: 255,
        ToZone: 2,
        MoveType: 4
      })
    )
    expect(player.observedHandCount).toBe(2)
    expect(player.knownHandCards.map((card) => card.id)).toEqual([12])
    expect(room.getZone('discard').cards.map((card) => card.id)).toEqual([11])
    expect(room.getZone('pile').cards).toEqual(pileCards)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('更新手牌快照暂停旧身份，全未知和零手牌仍建立明确总数', () => {
    const { controller, room, errorSpy } = createReconnectRoom()
    controller.degradeTrackerRoom(reconnectSnapshot())
    controller.restoreTrackerReconnectHand({ SeatIndex: 7, Count: 1, CardIDs: [11] })
    controller.restoreTrackerReconnectHand({ SeatIndex: 7, Count: 1, CardIDs: [12] })
    const player = room.getPlayer(7)!
    expect(player.knownHandCards.map((card) => card.id)).toEqual([12])
    expect(room.cardIndex.get(11)?.suspended).toBe(true)

    controller.restoreTrackerReconnectHand({ SeatIndex: 7, Count: 1, CardIDs: [0] })
    expect(player.knownHandCards).toEqual([])
    expect(player.observedHandCount).toBe(1)
    expect(player.unknownCardCount).toBe(1)
    expect(room.cardIndex.get(12)?.suspended).toBe(true)

    controller.restoreTrackerReconnectHand({ SeatIndex: 7, Count: 0, CardIDs: [] })
    expect(player.hasObservedHandCount).toBe(true)
    expect(player.observedHandCount).toBe(0)
    expect(player.unknownCardCount).toBe(0)
    expect(player.cards.filter((card) => card.subZone === 'hand')).toEqual([])
    expect(player.equipCards.map((card) => card.id)).toEqual([122, 136])
    expect(room.getZone('discard').cards).toEqual([])
    expect(room.getZone('pile').cards).toHaveLength(71)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it.each([true, false])('初始化前手牌通知先于座位快照=%s 时均恢复具体身份', (handFirst) => {
    const errorSpy = createErrorSpy()
    const { controller, gameState } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      Array.from({ length: 8 }, (_, SeatID) => ({ SeatID, ClientID: 100 + SeatID })),
      999
    )
    const restoreHand = () =>
      controller.restoreTrackerReconnectHand({ SeatIndex: 7, Count: 3, CardIDs: [11, 0, 12] })
    if (handFirst) restoreHand()
    controller.degradeTrackerRoom(reconnectSnapshot())
    if (!handFirst) restoreHand()
    const room = controller.getTrackerRoom()!
    expect(gameState.myID).toBe(7)
    expect(room.isDeckReady).toBe(false)

    controller.initTrackerDeck(Array.from({ length: 136 }, (_, index) => index + 1))

    expect(controller.getReadyTrackerRoom()).toBe(room)
    expect(room.trackingMode).toBe('degraded')
    expect(room.getZone('pile').cards).toHaveLength(71)
    expect(room.getPlayer(7)?.observedHandCount).toBe(3)
    expect(room.getPlayer(7)?.knownHandCards.map((card) => card.id)).toEqual([11, 12])
    expect(room.getPlayer(7)?.unknownCardCount).toBe(1)
    expect(room.getPlayer(7)?.equipCards.map((card) => card.id)).toEqual([122, 136])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('手牌快照复用已有身份并修正区域，保留已锚定的牌堆数量', () => {
    const { controller, room, errorSpy } = createReconnectRoom()
    controller.degradeTrackerRoom(reconnectSnapshot())
    controller.syncTrackerMove(protocolMove({ CardIDs: [11], ToID: 255, ToZone: 2, MoveType: 4 }))
    const card = room.cardIndex.get(11)
    const pileCount = room.getZone('pile').cards.length

    controller.restoreTrackerReconnectHand({ SeatIndex: 7, Count: 1, CardIDs: [11] })

    expect(room.cardIndex.get(11)).toBe(card)
    expect(room.getPlayer(7)?.knownHandCards).toEqual([card])
    expect(room.getZone('discard').cards).toEqual([])
    expect(room.getZone('pile').cards).toHaveLength(pileCount)
    expect(room.isPileCountKnown).toBe(true)
    expect(room.trackedCards.filter((entry) => entry.id === 11)).toHaveLength(1)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('销毁 Room 后丢弃尚未初始化的手牌快照', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 7, ClientID: 107 }], 999)
    controller.restoreTrackerReconnectHand({ SeatIndex: 7, Count: 1, CardIDs: [11] })
    const previousRoom = controller.getTrackerRoom()

    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 7, ClientID: 107 }], 999)
    controller.initTrackerDeck([11, 12])

    const room = controller.getReadyTrackerRoom()!
    expect(room).not.toBe(previousRoom)
    expect(room.trackingMode).toBe('full')
    expect(room.getPlayer(7)?.knownHandCards).toEqual([])
    expect(room.getPlayer(7)?.hasObservedHandCount).toBe(false)
    expect(room.getZone('pile').cards).toHaveLength(2)
  })

  it('另一局的 CardPileCount 71 快照建立牌堆、零手牌、装备与判定基线', () => {
    const { controller, room, view, errorSpy, warn } = createReconnectRoom()
    const players = [...room.players.values()]

    controller.degradeTrackerRoom(reconnectSnapshot())

    expect(controller.getReadyTrackerRoom()).toBe(room)
    expect([...room.players.values()]).toEqual(players)
    expect(room.trackingMode).toBe('degraded')
    expect(room.isPileCountKnown).toBe(true)
    expect(room.getZone('pile').cards).toHaveLength(71)
    expect(room.pileIdentityLedger.getSnapshot().accountedPileCount).toBe(71)
    const player = room.getPlayer(7)!
    expect(player.hasObservedHandCount).toBe(true)
    expect(player.observedHandCount).toBe(0)
    expect(player.knownHandCards).toEqual([])
    expect(player.generals).toEqual([638])
    expect(player.figure).toBe(2)
    expect(player.equipCards.map((card) => card.id)).toEqual([122, 136])
    expect(player.judgeCards.map((card) => [card.id, card.spellID])).toEqual([[32, 15]])
    expect(room.publicZones.getPublicZoneConsistencyIssues()).toEqual([])
    expect(view.calls.unmount).toBe(0)
    expect(warn.mock.calls.filter(([message]) => message === '牌堆身份账本异常')).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('快照恢复后继续更新绝对手牌数、装备判定移动和牌堆数量', () => {
    const { controller, room, errorSpy } = createReconnectRoom()
    controller.degradeTrackerRoom(reconnectSnapshot())
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [122],
        FromID: 7,
        FromZone: 6,
        ToID: 255,
        ToZone: 2,
        MoveType: 4
      })
    )
    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [32],
        FromID: 7,
        FromZone: 7,
        ToID: 255,
        ToZone: 2,
        MoveType: 14,
        SpellID: 15
      })
    )
    controller.syncTrackerMove(protocolMove({ CardIDs: [11], ToID: 7 }))
    controller.syncTrackerMove(protocolMove({ CardIDs: [], CardCount: 2, ToID: 7 }))

    const player = room.getPlayer(7)!
    expect(player.observedHandCount).toBe(3)
    expect(player.handCountDelta).toBe(0)
    expect(player.equipCards.map((card) => card.id)).toEqual([136])
    expect(player.judgeCards).toEqual([])
    expect(player.knownHandCards.map((card) => card.id)).toEqual([11])
    expect(player.cards.filter((card) => card.isAnonymous && card.subZone === 'hand')).toHaveLength(
      2
    )
    expect(room.getZone('discard').cards.map((card) => card.id)).toEqual([122, 32])
    expect(room.getZone('pile').cards).toHaveLength(68)
    expect(room.isPileCountKnown).toBe(true)
    expect(room.pileIdentityLedger.getSnapshot().accountedPileCount).toBe(68)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('快照先于牌堆初始化时按 Room 暂存，初始化后恢复同一份残局基线', () => {
    const errorSpy = createErrorSpy()
    const { controller, view } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers(
      Array.from({ length: 8 }, (_, SeatID) => ({ SeatID, ClientID: 100 + SeatID })),
      100
    )
    controller.degradeTrackerRoom(reconnectSnapshot())
    const room = controller.getTrackerRoom()!
    expect(room.isDeckReady).toBe(false)

    controller.initTrackerDeck(Array.from({ length: 136 }, (_, index) => index + 1))

    expect(controller.getReadyTrackerRoom()).toBe(room)
    expect(room.trackingMode).toBe('degraded')
    expect(room.isPileCountKnown).toBe(true)
    expect(room.getZone('pile').cards).toHaveLength(71)
    expect(room.getPlayer(7)?.observedHandCount).toBe(0)
    expect(room.getPlayer(7)?.equipCards.map((card) => card.id)).toEqual([122, 136])
    expect(room.getPlayer(7)?.judgeCards.map((card) => card.id)).toEqual([32])
    expect(view.calls.unmount).toBe(0)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('快照清理过时手牌、装备和判定位置，重复恢复不重复创建明牌', () => {
    const { controller, room, errorSpy } = createReconnectRoom([1, 2, 3, 4])
    controller.syncTrackerMove(protocolMove({ CardIDs: [1], ToID: 0 }))
    controller.syncTrackerMove(protocolMove({ CardIDs: [2], ToID: 0, ToZone: 6 }))
    controller.syncTrackerMove(protocolMove({ CardIDs: [3], ToID: 0, ToZone: 7 }))
    const snapshot = {
      CardPileCount: 5,
      SeatInfos: [seatInfo(0, { EquipCardCount: 1, EquipCards: [{ CardId: 4 }] })]
    }

    controller.degradeTrackerRoom(snapshot)

    const player = room.getPlayer(0)!
    expect(player.observedHandCount).toBe(0)
    expect(player.knownHandCards).toEqual([])
    expect(player.equipCards.map((card) => card.id)).toEqual([4])
    expect(player.judgeCards).toEqual([])
    for (const cardID of [1, 2, 3]) {
      expect(room.cardIndex.get(cardID)?.suspended).toBe(true)
    }
    expect(room.getZone('discard').cards).toEqual([])
    const equipment = room.cardIndex.get(4)
    const entityCount = room.cards.length

    controller.degradeTrackerRoom(snapshot)
    expect(room.cardIndex.get(4)).toBe(equipment)
    expect(room.cards.length).toBe(entityCount)
    expect(room.trackedCards.filter((card) => card.id === 4)).toHaveLength(1)
    controller.syncTrackerMove(protocolMove({ CardIDs: [2], ToID: 0 }))
    expect(room.cardIndex.get(2)?.suspended).toBe(false)
    expect(room.cardIndex.get(2)?.resolvedSeat).toBe(0)
    expect(player.observedHandCount).toBe(1)
    expect(room.getZone('pile').cards).toHaveLength(4)
    expect(room.isPileCountKnown).toBe(true)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('重连数量快照不会清空已有弃牌，也不会推进洗牌世代', () => {
    const { controller, room, errorSpy } = createReconnectRoom()
    controller.syncTrackerMove(protocolMove({ CardIDs: [99], ToID: 255, ToZone: 2, MoveType: 4 }))
    const generation = room.pileIdentityLedger.getSnapshot().cohort.generation

    controller.degradeTrackerRoom({ CardPileCount: 71 })

    expect(room.getZone('discard').cards.map((card) => card.id)).toEqual([99])
    expect(room.pileIdentityLedger.getSnapshot().cohort.generation).toBe(generation)
    expect(room.getZone('pile').cards).toHaveLength(71)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('数量快照不能保留断线前的已知牌顶位置，身份仍可在后续协议中重新揭示', () => {
    const { controller, room, errorSpy } = createReconnectRoom()
    controller.revealTrackerCardsInZone({ zone: 1, id: 255 }, [11])
    expect(room.pileIdentityLedger.getSnapshot().knownPileIdentityIDs).toEqual([11])

    controller.degradeTrackerRoom({ CardPileCount: 71 })

    expect(room.pileIdentityLedger.getSnapshot().knownPileIdentityIDs).toEqual([])
    expect(room.getZone('pile').cards.every((card) => card.isAnonymous)).toBe(true)
    expect(room.unlocatedIdentities.has(11)).toBe(true)
    controller.revealTrackerCardsInZone({ zone: 1, id: 255 }, [11])
    expect(room.pileIdentityLedger.getSnapshot().knownPileIdentityIDs).toEqual([11])
    expect(room.getZone('pile').cards).toHaveLength(71)
    expect(room.isPileCountKnown).toBe(true)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('牌堆快照零值有效，后续明确洗牌继续恢复数量', () => {
    const { controller, room, errorSpy } = createReconnectRoom([])
    controller.degradeTrackerRoom({ CardPileCount: 0, SeatInfos: [seatInfo(0)] })
    expect(room.getZone('pile').cards).toEqual([])
    expect(room.isPileCountKnown).toBe(true)

    controller.syncTrackerMove(
      protocolMove({
        CardIDs: [],
        CardCount: 6,
        FromZone: 2,
        ToZone: 9,
        ToID: 255,
        MoveType: 255
      })
    )
    expect(room.getZone('pile').cards).toHaveLength(6)
    expect(room.isPileCountKnown).toBe(true)
    expect(room.trackingMode).toBe('degraded')
    expect(room.pileIdentityLedger.getSnapshot().accountedPileCount).toBe(6)
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
