import { afterEach, describe, expect, it, vi } from 'vitest'
import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import {
  formatTrackerProtocolReplayReport,
  TrackerProtocolReplayer,
  type RecordedTrackerProtocol
} from './helpers/protocolReplay'
import { assertTrackerReplayConsistency } from './helpers/protocolReplay/snapshot'

describe('重连协议回放', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('保留重连前 103 张洗牌锚点并继续记录摸牌、弃牌与手牌差量', () => {
    const records = openingRecords(Array.from({ length: 103 }, (_, index) => index + 1)).concat([
      {
        seq: 4,
        className: 'PubGsCMoveCard',
        payload: shufflePayload(103)
      },
      { seq: 5, className: 'MsgReconnectGame', payload: {} },
      {
        seq: 6,
        className: 'PubGsCMoveCard',
        payload: movePayload({ CardIDs: [], CardCount: 2 })
      },
      {
        seq: 7,
        className: 'PubGsCMoveCard',
        payload: movePayload({
          CardIDs: [1],
          FromID: 1,
          FromZone: 5,
          ToID: 255,
          ToZone: 2,
          MoveType: 4
        })
      }
    ])
    const report = new TrackerProtocolReplayer({
      currentUserID: 101,
      mode: 'deep',
      captureStepStates: true
    }).replay(records)

    expect(report.failure).toBeUndefined()
    expect(report).toMatchObject({ success: true, applied: 6, partial: 1, ignored: 0 })
    expect(report.steps[4]).toMatchObject({
      status: 'partial',
      state: {
        room: {
          trackingMode: 'degraded',
          isPileCountKnown: true,
          zones: { pile: { count: 103 } }
        }
      }
    })
    expect(report.finalState.room).toMatchObject({
      deckReady: true,
      trackingMode: 'degraded',
      isPileCountKnown: true,
      zones: { pile: { count: 101 }, discard: { knownCardIDs: [1] } }
    })
    expect(report.finalState.room?.players.find((player) => player.seatID === 1)).toMatchObject({
      observedHandCount: null,
      handCountDelta: 1
    })
  })

  it.each([false, true])('71 张残局快照在牌堆初始化前到达=%s 时恢复八人状态', (beforeDeckInit) => {
    const opening = openingRecords(
      Array.from({ length: 160 }, (_, index) => index + 1),
      Array.from({ length: 8 }, (_, index) => index)
    )
    const reconnect: RecordedTrackerProtocol = {
      seq: beforeDeckInit ? 3 : 4,
      className: 'MsgReconnectGame',
      payload: reconnectPayload()
    }
    const records = (
      beforeDeckInit
        ? opening.slice(0, 2).concat([reconnect, { ...opening[2], seq: 4 }])
        : opening.concat(reconnect)
    ).concat([
      {
        seq: 5,
        className: 'PubGsCMoveCard',
        payload: movePayload({ CardIDs: [1], ToID: 7 })
      },
      {
        seq: 6,
        className: 'PubGsCMoveCard',
        payload: movePayload({
          CardIDs: [122],
          FromID: 7,
          FromZone: 6,
          ToID: 255,
          ToZone: 2,
          MoveType: 4
        })
      }
    ])
    const replayer = new TrackerProtocolReplayer({
      currentUserID: 100,
      mode: 'deep',
      captureStepStates: true
    })
    const report = replayer.replay(records)

    expect(report.failure).toBeUndefined()
    expect(report).toMatchObject({ success: true, applied: 5, partial: 1, ignored: 0 })
    const restored = report.steps[3].state?.room
    expect(restored).toMatchObject({
      trackingMode: 'degraded',
      isPileCountKnown: true,
      seatIDs: [0, 1, 2, 3, 4, 5, 6, 7],
      zones: { pile: { count: 71 } }
    })
    expect(restored?.players.find((player) => player.seatID === 7)).toMatchObject({
      observedHandCount: 0,
      handCountDelta: 0,
      equipCardIDs: [122, 136],
      judgeCardIDs: [32],
      generals: [638]
    })
    expect(report.finalState.room).toMatchObject({
      trackingMode: 'degraded',
      isPileCountKnown: true,
      zones: { pile: { count: 70 }, discard: { knownCardIDs: [122] } }
    })
    expect(report.finalState.room?.players.find((player) => player.seatID === 7)).toMatchObject({
      observedHandCount: 1,
      knownHandCardIDs: [1],
      equipCardIDs: [136],
      judgeCardIDs: [32]
    })
    expect(replayer.controller.getReadyTrackerRoom()?.getPlayer(7)?.figure).toBe(2)
    const output = formatTrackerProtocolReplayReport(report)
    expect(output).toContain('"trackingMode": "degraded"')
    expect(output).toContain('"isPileCountKnown": true')
    expect(output).toContain('"handCountDelta": 0')
  })

  it('未锚定的降级回放在后续明确洗牌后恢复数量，身份集合不足不导致容量失败', () => {
    const records = openingRecords([1, 2]).concat([
      { seq: 4, className: 'MsgReconnectGame', payload: {} },
      { seq: 5, className: 'PubGsCMoveCard', payload: shufflePayload(9) },
      {
        seq: 6,
        className: 'PubGsCMoveCard',
        payload: movePayload({ CardIDs: [], CardCount: 2, ToID: 2 })
      }
    ])
    const report = new TrackerProtocolReplayer({
      currentUserID: 101,
      mode: 'deep',
      captureStepStates: true
    }).replay(records)

    expect(report.failure).toBeUndefined()
    expect(report.success).toBe(true)
    expect(report.steps[3].state?.room?.isPileCountKnown).toBe(false)
    expect(report.finalState.room).toMatchObject({
      trackingMode: 'degraded',
      isPileCountKnown: true,
      zones: { pile: { count: 7 } }
    })
    expect(report.finalState.room?.players.find((player) => player.seatID === 2)).toMatchObject({
      observedHandCount: null,
      handCountDelta: 2
    })
  })

  it.each([0, 7])('旁观回放以重连手牌 SeatIndex=%s 覆盖早先推断并继续追踪', (SeatIndex) => {
    const previousSeatID = SeatIndex === 0 ? 7 : 0
    const records = openingRecords([1, 2], [0, 7]).concat([
      { seq: 4, className: 'MsgReconnectGame', payload: {} },
      {
        seq: 5,
        className: 'GsCUpdateRoleDataNtf',
        payload: { SeatID: previousSeatID, StateID: 58 }
      },
      {
        seq: 6,
        className: 'MsgReconnectGameHand',
        payload: { CardIDs: [0], Count: 1, SeatIndex }
      },
      {
        seq: 7,
        className: 'GsCUpdateRoleDataNtf',
        payload: { SeatID: previousSeatID, StateID: 58 }
      },
      {
        seq: 8,
        className: 'PubGsCMoveCard',
        payload: movePayload({ CardIDs: [1], ToID: SeatIndex })
      }
    ])
    const replayer = new TrackerProtocolReplayer({
      currentUserID: 999,
      mode: 'deep',
      captureStepStates: true
    })
    const report = replayer.replay(records)

    expect(report.failure).toBeUndefined()
    expect(report.success).toBe(true)
    expect(report.steps[4].state?.room?.mySeatID).toBe(previousSeatID)
    expect(report.steps[5]).toMatchObject({
      status: 'applied',
      state: { room: { mySeatID: SeatIndex, zones: { pile: { count: 2 } } } }
    })
    expect(report.finalState.room).toMatchObject({
      trackingMode: 'degraded',
      mySeatID: SeatIndex,
      zones: { pile: { count: 1 } }
    })
    expect(
      report.finalState.room?.players.find((player) => player.seatID === SeatIndex)
    ).toMatchObject({
      knownHandCardIDs: [1],
      observedHandCount: 2,
      handCountDelta: 0
    })
    expect(replayer.gameState.myID).toBe(SeatIndex)
    expect(replayer.gameState.isRecord).toBe(true)
  })

  it.each([0, 7])('重连回放恢复座位 %s 的明暗手牌并继续摸牌、弃牌', (SeatIndex) => {
    const records = openingRecords(
      Array.from({ length: 136 }, (_, index) => index + 1),
      Array.from({ length: 8 }, (_, index) => index)
    ).concat([
      { seq: 4, className: 'MsgReconnectGame', payload: reconnectPayload() },
      {
        seq: 5,
        className: 'MsgReconnectGameHand',
        payload: { SeatIndex, Count: 3, CardIDs: [11, 0, 12] }
      },
      {
        seq: 6,
        className: 'PubGsCMoveCard',
        payload: movePayload({ CardIDs: [13], ToID: SeatIndex })
      },
      {
        seq: 7,
        className: 'PubGsCMoveCard',
        payload: movePayload({
          CardIDs: [11],
          FromID: SeatIndex,
          FromZone: 5,
          ToID: 255,
          ToZone: 2,
          MoveType: 4
        })
      }
    ])
    const replayer = new TrackerProtocolReplayer({
      currentUserID: 999,
      mode: 'deep',
      captureStepStates: true
    })
    const report = replayer.replay(records)

    expect(report.failure).toBeUndefined()
    expect(report.success).toBe(true)
    const restored = report.steps[4].state?.room
    expect(restored).toMatchObject({ mySeatID: SeatIndex, zones: { pile: { count: 71 } } })
    expect(restored?.players.find((player) => player.seatID === SeatIndex)).toMatchObject({
      observedHandCount: 3,
      knownHandCardIDs: [11, 12],
      unknownHandCount: 1
    })
    expect(report.finalState.room).toMatchObject({
      trackingMode: 'degraded',
      isPileCountKnown: true,
      zones: { pile: { count: 70 }, discard: { knownCardIDs: [11] } }
    })
    expect(
      report.finalState.room?.players.find((player) => player.seatID === SeatIndex)
    ).toMatchObject({
      observedHandCount: 3,
      knownHandCardIDs: [12, 13],
      unknownHandCount: 1,
      handCountDelta: 0
    })
  })

  it.each([true, false])('初始化前手牌通知先于座位快照=%s 时回放保留手牌身份', (handFirst) => {
    const opening = openingRecords(
      Array.from({ length: 136 }, (_, index) => index + 1),
      Array.from({ length: 8 }, (_, index) => index)
    )
    const hand = {
      className: 'MsgReconnectGameHand',
      payload: { SeatIndex: 7, Count: 2, CardIDs: [11, 12] }
    }
    const room = { className: 'MsgReconnectGame', payload: reconnectPayload() }
    const notifications = (handFirst ? [hand, room] : [room, hand]).map((record, index) => ({
      ...record,
      seq: index + 3
    }))
    const records = opening.slice(0, 2).concat(notifications, { ...opening[2], seq: 5 })
    const report = new TrackerProtocolReplayer({ currentUserID: 999, mode: 'deep' }).replay(records)

    expect(report.failure).toBeUndefined()
    expect(report.success).toBe(true)
    expect(report.finalState.room).toMatchObject({
      trackingMode: 'degraded',
      mySeatID: 7,
      zones: { pile: { count: 71 } }
    })
    expect(report.finalState.room?.players.find((player) => player.seatID === 7)).toMatchObject({
      observedHandCount: 2,
      knownHandCardIDs: [11, 12]
    })
  })

  it('旧录制仅有 SeatIndex 时仍恢复视角，并标记手牌数据缺失', () => {
    const records = openingRecords([11, 12], [0, 7]).concat([
      { seq: 4, className: 'MsgReconnectGame', payload: {} },
      { seq: 5, className: 'MsgReconnectGameHand', payload: { SeatIndex: 7 } }
    ])
    const report = new TrackerProtocolReplayer({ currentUserID: 999, mode: 'deep' }).replay(records)

    expect(report.failure).toBeUndefined()
    expect(report.success).toBe(true)
    expect(report.steps[4]).toMatchObject({ status: 'partial' })
    expect(report.steps[4].note).toContain('缺少重连手牌字段')
    expect(report.finalState.room?.mySeatID).toBe(7)
    expect(report.finalState.room?.players.find((player) => player.seatID === 7)).toMatchObject({
      observedHandCount: null,
      knownHandCardIDs: []
    })
  })

  it('降级一致性检查跳过开局守恒，但仍拒绝损坏的实体索引', () => {
    const replayer = new TrackerProtocolReplayer({ currentUserID: 100, mode: 'deep' })
    const report = replayer.replay(
      openingRecords(
        Array.from({ length: 160 }, (_, index) => index + 1),
        Array.from({ length: 8 }, (_, index) => index)
      ).concat({ seq: 4, className: 'MsgReconnectGame', payload: reconnectPayload() })
    )
    expect(report.failure).toBeUndefined()
    const room = replayer.controller.getReadyTrackerRoom()
    if (!room) throw new Error('测试预期重连后 Room 仍可用')
    const ledgerSpy = vi.spyOn(room.pileIdentityLedger, 'assertConsistency')

    expect(() => assertTrackerReplayConsistency(room, 'degraded')).not.toThrow()
    expect(ledgerSpy).not.toHaveBeenCalled()
    room.cardIndex.delete(122)
    expect(() => assertTrackerReplayConsistency(room, 'degraded-index')).toThrow(
      'card-index-mismatch'
    )
  })
})

function openingRecords(cardIDs: number[], seatIDs = [1, 2]): RecordedTrackerProtocol[] {
  return [
    {
      seq: 1,
      className: 'decodeGameRecordInitInfo',
      payload: { ProtoObj: { matchName: '标准身份' } }
    },
    {
      seq: 2,
      className: 'decodeGsClientUserSeatFlagNtf',
      payload: {
        data: {
          protoObj: { seatinfo: seatIDs.map((SeatID) => ({ SeatID, ClientID: 100 + SeatID })) }
        }
      }
    },
    { seq: 3, className: 'MsgGamePlayCardNtf', payload: { CardList: cardIDs } }
  ]
}

function reconnectPayload(): Record<string, unknown> {
  return {
    CardPileCount: 71,
    SeatInfos: Array.from({ length: 8 }, (_, SeatID) => ({
      SeatID,
      HandCardCount: 0,
      EquipCardCount: SeatID === 7 ? 2 : 0,
      EquipCards:
        SeatID === 7
          ? [
              { CardId: 122, SubType: 1 },
              { CardId: 136, SubType: 2 }
            ]
          : [],
      JudgeCardCount: SeatID === 7 ? 1 : 0,
      JudgeCards: SeatID === 7 ? [{ CardId: 32, SpellId: 15 }] : [],
      ...(SeatID === 7 ? { CharacterID: 638, Figure: 2 } : {})
    }))
  }
}

function movePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    CardIDs: [0],
    CardCount: 1,
    FromID: 255,
    FromZone: 1,
    FromZoneParam: 0,
    FromPosition: POSITION_TOP,
    ToID: 1,
    ToZone: 5,
    ToZoneParam: 0,
    ToPosition: POSITION_TOP,
    MoveType: 1,
    SpellID: 0,
    ...overrides
  }
}

function shufflePayload(CardCount: number): Record<string, unknown> {
  return movePayload({
    CardIDs: [],
    CardCount,
    FromZone: 2,
    FromPosition: 65280,
    ToID: 255,
    ToZone: 9,
    ToPosition: 0,
    MoveType: 255
  })
}
