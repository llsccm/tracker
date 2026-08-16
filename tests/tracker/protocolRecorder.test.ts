import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearProtocolRecording,
  getProtocolRecordingSnapshot,
  MAX_PROTOCOL_RECORDS,
  recordTrackerProtocol,
  serializeProtocolRecording,
  startProtocolRecording,
  stopProtocolRecording,
  subscribeProtocolRecordingStatus,
  type ProtocolRecordingStatus
} from '@/tracker/runtime/protocolRecorder'
import {
  projectTrackerProtocol,
  shouldRecordTrackerProtocol
} from '@/tracker/runtime/protocolRecordingRules'

describe('tracker protocol recording rules', () => {
  it('只接受会改变记牌器状态或回放上下文的协议', () => {
    expect(shouldRecordTrackerProtocol({ className: 'PubGsCMoveCard' })).toBe(true)
    expect(shouldRecordTrackerProtocol({ className: 'MsgGamePlayCardNtf' })).toBe(true)
    expect(shouldRecordTrackerProtocol({ className: 'decodeSSCChatmsgNtf' })).toBe(false)
    expect(shouldRecordTrackerProtocol({ className: 'MsgHeartAliveRep' })).toBe(false)
    expect(shouldRecordTrackerProtocol({ className: 'GsCTriggerSpellNew' })).toBe(false)
    expect(shouldRecordTrackerProtocol({ className: 'decodeGameDealPileTopCardList' })).toBe(false)
  })

  it('按协议字段进一步过滤混合用途消息', () => {
    const mainSeatContext = { mySeatID: 6 }

    expect(
      shouldRecordTrackerProtocol(
        {
          className: 'PubGsCUseCard',
          SeatID: 6,
          useType: 1,
          isSend: 0,
          spellID: 1
        },
        mainSeatContext
      )
    ).toBe(true)
    expect(
      shouldRecordTrackerProtocol(
        {
          className: 'PubGsCUseCard',
          SeatID: 4,
          useType: 1,
          isSend: 0,
          spellID: 1
        },
        mainSeatContext
      )
    ).toBe(false)
    expect(
      shouldRecordTrackerProtocol({
        className: 'PubGsCUseCard',
        SeatID: 6,
        useType: 0,
        isSend: 1,
        spellID: 0
      })
    ).toBe(false)

    expect(
      shouldRecordTrackerProtocol(
        { className: 'PubGsCUseSpell', SpellID: 3090, SeatID: 4, EffectIndex: 1 },
        { currentSeatID: 4 }
      )
    ).toBe(true)
    expect(
      shouldRecordTrackerProtocol(
        { className: 'PubGsCUseSpell', SpellID: 3090, SeatID: 6, EffectIndex: 1 },
        { currentSeatID: 4 }
      )
    ).toBe(false)
    expect(
      shouldRecordTrackerProtocol({
        className: 'PubGsCUseSpell',
        SpellID: 3750,
        EffectIndex: 2,
        DestSeatIDs: []
      })
    ).toBe(true)
    expect(
      shouldRecordTrackerProtocol({
        className: 'PubGsCUseSpell',
        SpellID: 3730,
        EffectIndex: 1,
        DestSeatIDs: [3]
      })
    ).toBe(false)
    expect(
      shouldRecordTrackerProtocol({
        className: 'PubGsCUseSpell',
        SpellID: 3750,
        EffectIndex: 2,
        DestSeatIDs: [6]
      })
    ).toBe(false)
    expect(shouldRecordTrackerProtocol({ className: 'PubGsCUseSpell', SpellID: 4022 })).toBe(false)
    expect(
      shouldRecordTrackerProtocol({
        className: 'PubGsCUseSpell',
        SpellID: 3731,
        EffectIndex: 2,
        DestSeatIDs: [3]
      })
    ).toBe(true)

    expect(
      shouldRecordTrackerProtocol({
        className: 'PubGsCMoveCard',
        CardCount: 1,
        MoveType: 1,
        ToZone: 5,
        isSend: 0
      })
    ).toBe(true)
    expect(
      shouldRecordTrackerProtocol({
        className: 'PubGsCMoveCard',
        CardCount: 0,
        MoveType: 1,
        ToZone: 5,
        isSend: 0
      })
    ).toBe(false)
    expect(
      shouldRecordTrackerProtocol({
        className: 'PubGsCMoveCard',
        CardCount: 1,
        MoveType: 1,
        ToZone: 5,
        isSend: 1
      })
    ).toBe(false)

    expect(
      shouldRecordTrackerProtocol({
        className: 'CGsRoleSpellOptRep',
        SpellID: 7009,
        Type: 30,
        Datas: [1, 2]
      })
    ).toBe(true)
    expect(
      shouldRecordTrackerProtocol({
        className: 'CGsRoleSpellOptRep',
        SpellID: 7009,
        Type: 30,
        Datas: []
      })
    ).toBe(false)
    expect(
      shouldRecordTrackerProtocol(
        {
          className: 'CGsRoleSpellOptRep',
          SpellID: 3483,
          Type: 53,
          Datas: [7, 6, 1, 48, 1, 110]
        },
        { mySeatID: 6 }
      )
    ).toBe(true)
    expect(
      shouldRecordTrackerProtocol(
        {
          className: 'CGsRoleSpellOptRep',
          SpellID: 3483,
          Type: 53,
          Datas: [7, 6, 1, 48, 1, 110]
        },
        { mySeatID: 7 }
      )
    ).toBe(false)
    expect(
      shouldRecordTrackerProtocol({
        className: 'GsCRoleOptTargetNtf',
        SpellID: 4,
        targetSeatID: 6,
        Params: [1]
      })
    ).toBe(true)
    expect(
      shouldRecordTrackerProtocol({
        className: 'GsCRoleOptTargetNtf',
        SpellID: 4,
        targetSeatID: 6,
        Params: []
      })
    ).toBe(false)

    expect(shouldRecordTrackerProtocol({ className: 'GsCUpdateRoleDataNtf', StateID: 58 })).toBe(
      true
    )
    expect(shouldRecordTrackerProtocol({ className: 'GsCUpdateRoleDataNtf', StateID: 47 })).toBe(
      false
    )

    expect(shouldRecordTrackerProtocol({ className: 'GsCUpdateRoleDataExNtf', DataID: 3544 })).toBe(
      true
    )
    expect(shouldRecordTrackerProtocol({ className: 'GsCUpdateRoleDataExNtf', DataID: 8 })).toBe(
      true
    )
    expect(shouldRecordTrackerProtocol({ className: 'GsCUpdateRoleDataExNtf', DataID: 3709 })).toBe(
      true
    )
    expect(shouldRecordTrackerProtocol({ className: 'GsCUpdateRoleDataExNtf', DataID: 4022 })).toBe(
      false
    )

    expect(
      shouldRecordTrackerProtocol({
        className: 'GsCRoleOptTargetNtf',
        SpellID: 987,
        targetSeatID: 6,
        Param: 1,
        Params: [1, 0, 2]
      })
    ).toBe(true)
    expect(shouldRecordTrackerProtocol({ className: 'GsCRoleOptTargetNtf', SpellID: 4021 })).toBe(
      false
    )

    expect(
      shouldRecordTrackerProtocol({
        className: 'CGsRoleSpellOptRep',
        SpellID: 7009,
        Type: 30,
        Datas: [1]
      })
    ).toBe(true)
    expect(shouldRecordTrackerProtocol({ className: 'CGsRoleSpellOptRep', SpellID: 4022 })).toBe(
      false
    )
    expect(
      shouldRecordTrackerProtocol({ className: 'CGsRoleSpellOptRep', Type: 72, Datas: [1] })
    ).toBe(true)
  })
})

describe('tracker protocol projection', () => {
  it('只保留移动协议业务字段且不访问原型 getter', () => {
    let getterCalls = 0
    const prototype = {}
    Object.defineProperty(prototype, 'ByteData', {
      enumerable: true,
      get() {
        getterCalls++
        return [1, 2, 3]
      }
    })

    const message = Object.assign(Object.create(prototype), {
      CardCount: 4,
      CardIDs: [0, 0, 0, 0],
      DataCount: 0,
      FromID: 255,
      FromPosition: 65280,
      FromZone: 1,
      FromZoneParam: 0,
      MoveType: 1,
      SpellID: 0,
      SrcSeatID: 7,
      ToID: 7,
      ToPosition: 65280,
      ToZone: 5,
      ToZoneParam: 0,
      className: 'PubGsCMoveCard',
      data: { version: 4080, protoObj: { ignored: true } },
      errCode: 0,
      errMsg: '',
      fromSocket2: false,
      id: 21209,
      isResume: true,
      isSend: 0,
      msgQueuePriority: 0,
      pbMsgType: 0,
      printIgnorList: ['data'],
      printJsonIgnorList: ['data'],
      protoName: 'Protocol',
      receviedStatus: 3,
      sendStatus: 3,
      timestamp: 7000,
      userID: 0,
      _className_: 'PubGsCMoveCard'
    })

    expect(projectTrackerProtocol(message)).toEqual({
      className: 'PubGsCMoveCard',
      payload: {
        CardCount: 4,
        CardIDs: [0, 0, 0, 0],
        FromID: 255,
        FromPosition: 65280,
        FromZone: 1,
        FromZoneParam: 0,
        MoveType: 1,
        SpellID: 0,
        SrcSeatID: 7,
        isSend: 0,
        ToID: 7,
        ToPosition: 65280,
        ToZone: 5,
        ToZoneParam: 0
      }
    })
    expect(getterCalls).toBe(0)
  })

  it('对局结束只保留生命周期事件，不保存结算明细或时间', () => {
    expect(
      projectTrackerProtocol({
        className: 'MsgGameOver',
        time: 104,
        round: 4,
        Result: 2,
        Players: [{ SeatID: 4, SelfResult: { Result: 1 } }],
        SelfResult: { SeatID: 6, Result: 0 }
      })
    ).toEqual({
      className: 'MsgGameOver',
      payload: {}
    })
  })

  it('已支持回放协议只保留处理器读取的业务字段', () => {
    expect(
      projectTrackerProtocol({
        className: 'MsgGamePlayCardNtf',
        Param: 0,
        cardCount: 2,
        CardList: [1, 2]
      })
    ).toEqual({
      className: 'MsgGamePlayCardNtf',
      payload: { CardList: [1, 2] }
    })

    expect(
      projectTrackerProtocol({
        className: 'PubGsCUseSpell',
        SpellID: 3157,
        SeatID: 6,
        SrcSeatID: 6,
        CardIDs: [1],
        EffectIndex: 1,
        DestSeatIDs: [],
        Params: [99],
        GeneralID: 123
      })
    ).toEqual({
      className: 'PubGsCUseSpell',
      payload: {
        SpellID: 3157,
        SeatID: 6,
        SrcSeatID: 6,
        CardIDs: [1],
        EffectIndex: 1,
        DestSeatIDs: []
      }
    })

    expect(
      projectTrackerProtocol({
        className: 'PubGsCUseSpell',
        SpellID: 3731,
        SeatID: 4,
        SkillOwerSeatID: 4,
        EffectIndex: 2,
        DestSeatIDs: [3]
      })
    ).toEqual({
      className: 'PubGsCUseSpell',
      payload: {
        SpellID: 3731,
        SeatID: 4,
        SkillOwerSeatID: 4,
        EffectIndex: 2,
        DestSeatIDs: [3]
      }
    })

    expect(
      projectTrackerProtocol({
        className: 'SmsgGameSetCharacter',
        Count: 1,
        SetCharacterParam: 0,
        Infos: [{ SeatID: 6, CharacterID: 606, Country: 1 }]
      })
    ).toEqual({
      className: 'SmsgGameSetCharacter',
      payload: { Infos: [{ SeatID: 6, CharacterID: 606 }] }
    })
  })

  it('为录像开局保留处理器实际读取的 seatinfo', () => {
    const message = {
      className: 'decodeGsClientUserSeatFlagNtf',
      accountName: '不需要保存',
      data: {
        version: 4080,
        timestamp: 7000,
        protoObj: {
          seatinfo: [{ seat_id: 1, user_temp_id: 100, nickname: '不需要保存', timestamp: 8000 }]
        }
      },
      nickname: '不需要保存'
    }

    expect(projectTrackerProtocol(message)).toEqual({
      className: 'decodeGsClientUserSeatFlagNtf',
      payload: {
        data: {
          protoObj: {
            seatinfo: [{ seat_id: 1, user_temp_id: 100 }]
          }
        }
      }
    })
  })

  it('只为录像模式协议读取必要的 ProtoObj.matchName', () => {
    const message = {
      accountName: '不需要保存',
      className: 'decodeGameRecordInitInfo',
      nickname: '不需要保存'
    }
    Object.defineProperty(message, 'ProtoObj', {
      get() {
        return { matchName: '斗地主', timestamp: 9000, ignored: true }
      }
    })

    expect(projectTrackerProtocol(message)).toEqual({
      className: 'decodeGameRecordInitInfo',
      payload: { ProtoObj: { matchName: '斗地主' } }
    })
  })

  it('只在处理或回放实际使用 isSend 的协议中保留该字段', () => {
    expect(
      projectTrackerProtocol({
        className: 'MsgNtfUseCardType',
        isSend: 1,
        castSeatId: 3,
        spellID: 1
      })
    ).toEqual({
      className: 'MsgNtfUseCardType',
      payload: { isSend: 1, castSeatId: 3, spellID: 1 }
    })

    expect(
      projectTrackerProtocol({ className: 'PubGsCMoveCard', isSend: 0, CardIDs: [1] })
    ).toEqual({
      className: 'PubGsCMoveCard',
      payload: { isSend: 0, CardIDs: [1] }
    })
  })
})

describe('tracker protocol recorder', () => {
  beforeEach(async () => {
    await clearProtocolRecording()
  })

  afterEach(async () => {
    await clearProtocolRecording()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('默认关闭，手动开启后才按序号记录', async () => {
    recordTrackerProtocol({ className: 'PubGsCMoveCard', CardIDs: [1], timestamp: 1 })
    expect(getProtocolRecordingSnapshot()).toEqual([])

    startProtocolRecording()
    recordTrackerProtocol({ className: 'decodeSSCChatmsgNtf', Content: 'ignored' })
    recordTrackerProtocol({ className: 'PubGsCMoveCard', CardIDs: [1], timestamp: 2 })
    recordTrackerProtocol({ className: 'MsgGameTurnNtf', TurnCnt: 1, timestamp: 3 })
    await stopProtocolRecording()
    recordTrackerProtocol({ className: 'PubGsCMoveCard', CardIDs: [2] })

    const recording = getProtocolRecordingSnapshot()
    expect(recording).toEqual([
      {
        seq: 1,
        className: 'PubGsCMoveCard',
        payload: { CardIDs: [1] }
      },
      {
        seq: 2,
        className: 'MsgGameTurnNtf',
        payload: { TurnCnt: 1 }
      }
    ])

    const serialized = serializeProtocolRecording(recording)
    expect(serialized).toBe(
      '{"seq":1,"className":"PubGsCMoveCard","payload":{"CardIDs":[1]}}\n' +
        '{"seq":2,"className":"MsgGameTurnNtf","payload":{"TurnCnt":1}}\n'
    )
    expect(serialized).not.toContain('timestamp')
  })

  it('录制时按主视角过滤不会改变记牌状态的出牌消息', async () => {
    startProtocolRecording()
    recordTrackerProtocol(
      {
        className: 'PubGsCUseCard',
        SeatID: 4,
        useType: 1,
        isSend: 0,
        spellID: 1
      },
      { mySeatID: 6 }
    )
    recordTrackerProtocol(
      {
        className: 'PubGsCUseCard',
        SeatID: 6,
        useType: 1,
        isSend: 0,
        spellID: 1
      },
      { mySeatID: 6 }
    )
    await stopProtocolRecording()

    expect(getProtocolRecordingSnapshot()).toEqual([
      {
        seq: 1,
        className: 'PubGsCUseCard',
        payload: { SeatID: 6, useType: 1, isSend: 0, spellID: 1 }
      }
    ])
  })

  it('randomUUID 不可用时使用 Web Crypto 生成会话标识', async () => {
    const getRandomValues = vi.fn((values: Uint8Array) => {
      values.fill(7)
      return values
    })
    vi.stubGlobal('crypto', { getRandomValues })
    const insecureRandom = vi.spyOn(Math, 'random')

    startProtocolRecording()
    await stopProtocolRecording()

    expect(getRandomValues).toHaveBeenCalledOnce()
    expect(insecureRandom).not.toHaveBeenCalled()
  })

  it('达到最大条数后自动停止并通过状态监听器提示', async () => {
    const statuses: ProtocolRecordingStatus[] = []
    const unsubscribe = subscribeProtocolRecordingStatus((status) => statuses.push(status))

    startProtocolRecording()
    for (let index = 0; index <= MAX_PROTOCOL_RECORDS; index += 1) {
      recordTrackerProtocol({ className: 'MsgGameTurnNtf', TurnCnt: index })
    }
    await stopProtocolRecording()
    await Promise.resolve()
    unsubscribe()

    expect(getProtocolRecordingSnapshot()).toHaveLength(MAX_PROTOCOL_RECORDS)
    expect(statuses.at(-1)).toEqual({
      active: false,
      count: MAX_PROTOCOL_RECORDS,
      limitReached: true
    })
  })
})
