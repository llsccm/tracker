import {
  getMoveSeat,
  getMoveZone,
  getMoveSubZone,
  getMovePosition
} from '@/tracker/helper/moveEndpoint'
import type {
  PatchedMoveCardFields,
  NormalizedMoveCardFields,
  NormalizedMoveEvent,
  RawMoveCardEvent
} from '@/tracker/types'
import { protocolMove } from './helpers/trackerController'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'
import {
  isPileSingleCardShow,
  normalizeMoveEvent,
  validateMoveEvent
} from '@/tracker/protocol/MoveEventNormalizer'

describe('MoveEventNormalizer 当前行为', () => {
  it('九条实际移动消息均满足完整契约，保留顺序、数量和数值哨兵', () => {
    const messages: RawMoveCardEvent[] = [
      {
        CardCount: 4,
        CardIDs: [51, 146, 138, 4],
        FromID: 255,
        FromPosition: 65280,
        FromZone: 1,
        FromZoneParam: 0,
        MoveType: 1,
        SpellID: 0,
        ToID: 7,
        ToPosition: 65280,
        ToZone: 5,
        ToZoneParam: 0
      },
      {
        CardCount: 2,
        CardIDs: [87, 41],
        FromID: 255,
        FromPosition: 65280,
        FromZone: 1,
        FromZoneParam: 0,
        MoveType: 6,
        SpellID: 3544,
        ToID: 255,
        ToPosition: 65280,
        ToZone: 8,
        ToZoneParam: 0
      },
      {
        CardCount: 1,
        CardIDs: [80],
        FromID: 255,
        FromPosition: 65282,
        FromZone: 3,
        FromZoneParam: 0,
        MoveType: 2,
        SpellID: 0,
        ToID: 7,
        ToPosition: 65282,
        ToZone: 6,
        ToZoneParam: 0
      },
      {
        CardCount: 2,
        CardIDs: [],
        FromID: 255,
        FromPosition: 65282,
        FromZone: 1,
        FromZoneParam: 0,
        MoveType: 18,
        SpellID: 3644,
        ToID: 0,
        ToPosition: 65280,
        ToZone: 5,
        ToZoneParam: 0
      },
      {
        CardCount: 1,
        CardIDs: [26],
        FromID: 1,
        FromPosition: 65282,
        FromZone: 5,
        FromZoneParam: 0,
        MoveType: 4,
        SpellID: 24,
        ToID: 255,
        ToPosition: 65280,
        ToZone: 2,
        ToZoneParam: 0
      },
      {
        CardCount: 1,
        CardIDs: [87],
        FromID: 7,
        FromPosition: 65282,
        FromZone: 5,
        FromZoneParam: 0,
        MoveType: 2,
        SpellID: 0,
        ToID: 255,
        ToPosition: 65280,
        ToZone: 3,
        ToZoneParam: 0
      },
      {
        CardCount: 3,
        CardIDs: [99, 36, 109],
        FromID: 255,
        FromPosition: 65280,
        FromZone: 1,
        FromZoneParam: 0,
        MoveType: 21,
        SpellID: 3208,
        ToID: 255,
        ToPosition: 65280,
        ToZone: 1,
        ToZoneParam: 0
      },
      {
        CardCount: 3,
        CardIDs: [109, 36, 99],
        FromID: 255,
        FromPosition: 65282,
        FromZone: 1,
        FromZoneParam: 0,
        MoveType: 11,
        SpellID: 3208,
        ToID: 0,
        ToPosition: 65280,
        ToZone: 10,
        ToZoneParam: 0
      },
      {
        CardCount: 1,
        CardIDs: [109],
        FromID: 0,
        FromPosition: 65282,
        FromZone: 10,
        FromZoneParam: 0,
        MoveType: 11,
        SpellID: 3208,
        ToID: 0,
        ToPosition: 65280,
        ToZone: 5,
        ToZoneParam: 0
      }
    ]
    for (const raw of messages) {
      const event = normalizeMoveEvent(raw)
      expect(event.protocol).toEqual(raw)
      expect(event.cardIDs).toEqual(raw.CardIDs)
      expect(event.cardIDs).toBe(raw.CardIDs)
      expect(event.cardCount).toBe(raw.CardCount)
      expect(validateMoveEvent(raw)).toEqual([])
    }
    const hiddenGain = normalizeMoveEvent(messages[3])
    expect(hiddenGain.cardIDs).toEqual([])
    expect(hiddenGain.cardCount).toBe(2)
    expect(getMoveSeat(hiddenGain.to)).toBe(0)
  })

  it('原始消息核心字段必填，牌 ID 只允许数组', () => {
    type CoreFields = Omit<RawMoveCardEvent, 'SrcSeatID' | 'Label' | 'isSend'>
    expectTypeOf<CoreFields>().toEqualTypeOf<Required<CoreFields>>()
    expectTypeOf<RawMoveCardEvent['CardIDs']>().toEqualTypeOf<readonly number[]>()
  })

  it('归一化标准 PubGsCMoveCard 消息', () => {
    const event = normalizeMoveEvent(
      protocolMove({
        CardIDs: [1, 2],
        CardCount: 2,
        FromZone: 1,
        FromID: 255,
        FromPosition: POSITION_TOP,
        ToZone: 5,
        ToID: 3,
        ToPosition: POSITION_TOP,
        MoveType: 1,
        SpellID: 0
      })
    )

    expect(event.cardIDs).toEqual([1, 2])
    expect(event.cardCount).toBe(2)
    expect(getMoveZone(event.to)).toBe('player')
    expect(getMoveSeat(event.to)).toBe(3)
    expect(getMoveZone(event.from)).toBe('pile')
    expect(getMoveSubZone(event.to)).toBe('hand')
    expect(event.options.cardCount).toBe(2)
    expect(event.options.sourceEvent.raw).toBe(event.raw)
  })

  it('保留普通小整数 ToPosition 交给协议位置层解析', () => {
    const event = normalizeMoveEvent(
      protocolMove({
        CardIDs: [39],
        CardCount: 1,
        FromID: 3,
        FromZone: 10,
        MoveType: 11,
        SpellID: 987,
        ToID: 7,
        ToPosition: 2,
        ToZone: 10
      })
    )

    expect(getMovePosition(event.to)).toBe(2)
    expect(event.options.sourceEvent.raw?.ToPosition).toBe(2)
  })

  it('未知区域编号当前降级为 process 且不伪造手牌子区', () => {
    const raw = protocolMove({
      CardIDs: [1],
      CardCount: 1,
      FromZone: 99,
      ToZone: 98,
      MoveType: 19
    })
    const event = normalizeMoveEvent(raw)

    expect(getMoveZone(event.to)).toBe('process')
    expect(getMoveZone(event.from)).toBeNull()
    expect(getMoveSubZone(event.to)).toBeUndefined()
    expect(getMoveSubZone(event.from)).toBeUndefined()
    expect(validateMoveEvent(raw)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'UNKNOWN_PROTOCOL_ZONE',
          field: 'FromZone',
          value: 99
        }),
        expect.objectContaining({
          code: 'UNKNOWN_PROTOCOL_ZONE',
          field: 'ToZone',
          value: 98
        })
      ])
    )
  })

  it('公共区到公共区不填充手牌子区', () => {
    const event = normalizeMoveEvent(
      protocolMove({
        CardCount: 5,
        CardIDs: [],
        FromID: 255,
        FromZone: 1,
        FromZoneParam: 0,
        MoveType: 11,
        SpellID: 987,
        ToID: 6,
        ToZone: 10,
        ToZoneParam: 0
      })
    )

    expect(event.type).toBe('moveUnknown')
    expect(getMoveZone(event.to)).toBe('exchange')
    expect(getMoveZone(event.from)).toBe('pile')
    expect(getMoveSeat(event.to)).toBeNull()
    expect(getMoveSeat(event.from)).toBeNull()
    expect(getMoveSubZone(event.to)).toBeUndefined()
    expect(getMoveSubZone(event.from)).toBeUndefined()
  })

  it('天候牌堆同区单牌展示基础归一为 noop，留给技能装饰器建立范围候选', () => {
    const event = normalizeMoveEvent(
      protocolMove({
        CardCount: 1,
        CardIDs: [18],
        FromID: 255,
        FromZone: 1,
        FromZoneParam: 0,
        MoveType: 21,
        SpellID: 3903,
        ToID: 255,
        ToZone: 1,
        ToZoneParam: 0
      })
    )

    expect(event.type).toBe('noop')
  })

  it('CardIDs 为空时按 CardCount 保留暗牌数量', () => {
    const raw = protocolMove({
      CardIDs: [],
      CardCount: 3,
      FromZone: 1,
      ToZone: 5,
      ToID: 2,
      MoveType: 1
    })
    const event = normalizeMoveEvent(raw)

    expect(event.cardIDs).toEqual([])
    expect(event.cardCount).toBe(3)
    expect(event.options.cardCount).toBe(3)
    expect(validateMoveEvent(raw)).not.toContainEqual(
      expect.objectContaining({ code: 'CARD_COUNT_MISMATCH' })
    )
  })

  it('CardCount 为 0 时保留声明并诊断身份数量不一致', () => {
    const raw = protocolMove({
      CardIDs: [7],
      CardCount: 0,
      FromZone: 1,
      ToZone: 5,
      ToID: 2,
      MoveType: 1
    })
    const event = normalizeMoveEvent(raw)

    expect(event.cardCount).toBe(0)
    expect(event.options.cardCount).toBe(0)
    expect(validateMoveEvent(raw)).toContainEqual(
      expect.objectContaining({
        code: 'CARD_COUNT_MISMATCH',
        field: 'CardIDs',
        expected: 0,
        actual: 1
      })
    )
  })

  it('归一化结果与诊断入口都保留完整协议契约，补丁只能修改声明字段', () => {
    type CoreFields = Omit<NormalizedMoveCardFields, 'SrcSeatID' | 'Label' | 'isSend'>
    expectTypeOf<CoreFields>().toEqualTypeOf<Required<CoreFields>>()
    expectTypeOf(validateMoveEvent).parameter(0).toEqualTypeOf<RawMoveCardEvent>()
    expectTypeOf<NormalizedMoveEvent['protocol']>().toEqualTypeOf<NormalizedMoveCardFields>()
    expectTypeOf<PatchedMoveCardFields['CardIDs']>().toEqualTypeOf<number[]>()
    expectTypeOf<NormalizedMoveEvent['cardIDs']>().toEqualTypeOf<readonly number[]>()
  })

  it('CardIDs 与 CardCount 不一致时记录校验警告但保留声明数量', () => {
    const raw = protocolMove({
      CardIDs: [1],
      CardCount: 2,
      FromZone: 1,
      ToZone: 5,
      ToID: 2,
      MoveType: 1
    })
    const event = normalizeMoveEvent(raw)

    expect(event.cardCount).toBe(2)
    expect(validateMoveEvent(raw)).toContainEqual(
      expect.objectContaining({
        code: 'CARD_COUNT_MISMATCH',
        field: 'CardIDs',
        expected: 2,
        actual: 1
      })
    )
  })

  it('正确识别牌堆两端均为 255 的单牌同区展示谓词 isPileSingleCardShow', () => {
    expect(
      isPileSingleCardShow({
        MoveType: 21,
        CardCount: 1,
        FromID: 255,
        FromZone: 1,
        ToID: 255,
        ToZone: 1
      })
    ).toBe(true)

    expect(
      isPileSingleCardShow({
        MoveType: 21,
        CardCount: 2,
        FromID: 255,
        FromZone: 1,
        ToID: 255,
        ToZone: 1
      })
    ).toBe(false)
  })

  it('标准事件各层输出数值字段，来源和目标技能空间分别归一化', () => {
    const raw = protocolMove({
      CardIDs: [96],
      CardCount: 1,
      FromZone: 4,
      FromID: 0,
      FromZoneParam: 3370,
      FromPosition: POSITION_TOP,
      ToZone: 5,
      ToID: 2,
      ToZoneParam: 0,
      ToPosition: 2,
      MoveType: 8,
      SpellID: 3389,
      Label: '标记牌回手'
    })
    Object.freeze(raw)
    Object.freeze(raw.CardIDs)

    const event = normalizeMoveEvent(raw)

    expect(event).toMatchObject({
      cardIDs: [96],
      cardCount: 1,
      moveType: 8,
      from: { type: 'player', seatID: 0, subZone: 'mark', markSpellID: 3370 },
      to: { type: 'player', seatID: 2, subZone: 'hand' },
      options: {
        cardCount: 1,
        moveType: 8,
        sourceEvent: { moveType: 8, label: '标记牌回手' }
      }
    })
    expect(event.raw).toBe(raw)
    expect(event.options.sourceEvent.raw).toBe(raw)
    expect(event.protocol).toBe(raw)
    expect(event.cardIDs).toBe(raw.CardIDs)
    expect(raw.CardIDs).toEqual([96])
    expect(raw.MoveType).toBe(8)
    expect(event.protocol).toMatchObject({
      CardCount: 1,
      FromZone: 4,
      FromZoneParam: 3370,
      ToZone: 5,
      ToZoneParam: 0,
      MoveType: 8,
      SpellID: 3389
    })
  })

  it.each([
    [1, 5, 1, 0, 'drawKnown'],
    [2, 9, 255, 0, 'shuffleDiscardIntoPile'],
    [1, 1, 21, 3903, 'noop'],
    [1, 1, 19, 7011, 'noop'],
    [1, 1, 21, 7011, 'showCards'],
    [5, 4, 8, 3370, 'moveToMark']
  ])('按数值协议字段分类事件：%s → %s / %s / %s', (FromZone, ToZone, MoveType, SpellID, type) => {
    const raw = protocolMove({
      CardIDs: [96],
      CardCount: 1,
      FromID: 255,
      ToID: 255,
      FromPosition: POSITION_TOP,
      ToPosition: POSITION_TOP,
      FromZone,
      ToZone,
      MoveType,
      SpellID
    })
    const event = normalizeMoveEvent(raw)
    expect(event.type).toBe(type)
    expect(event.moveType).toBe(MoveType)
    expect(event.protocol).toMatchObject({ FromZone, ToZone, MoveType, SpellID })
    expect(event.options.sourceEvent.raw).toBe(raw)
  })

  it('标准事件直接引用协议，保留单张数组、匿名数组和无技能语义', () => {
    expect(
      normalizeMoveEvent(protocolMove({ CardIDs: [0], CardCount: 1, SpellID: 0 })).protocol
    ).toMatchObject({
      CardIDs: [0],
      CardCount: 1,
      SpellID: 0
    })
    expect(
      normalizeMoveEvent(protocolMove({ CardIDs: [96], CardCount: 1 })).protocol
    ).toMatchObject({
      CardIDs: [96],
      CardCount: 1,
      SpellID: 0
    })
    expect(normalizeMoveEvent(protocolMove({ CardIDs: [], CardCount: 2 })).protocol).toMatchObject({
      CardIDs: [],
      CardCount: 2
    })
  })

  it('标准事件直接引用只读协议及牌数组，保留零值', () => {
    const raw = Object.freeze(
      protocolMove({
        CardIDs: Object.freeze([]),
        CardCount: 0,
        FromZone: 0,
        ToZone: 0,
        FromZoneParam: 0,
        ToZoneParam: 0,
        MoveType: 0,
        SpellID: 0
      })
    )
    const fields = normalizeMoveEvent(raw).protocol
    expect(fields).toEqual(raw)
    expect(fields).toBe(raw)
    expect(fields.CardIDs).toBe(raw.CardIDs)
    expect(validateMoveEvent(fields)).toEqual([])
  })

  it('预操作类型 0 保持为数值，不作为缺省处理', () => {
    const event = normalizeMoveEvent(protocolMove({ MoveType: 0 }))
    expect(event.moveType).toBe(0)
    expect(event.options.moveType).toBe(0)
    expect(event.options.sourceEvent.moveType).toBe(0)
  })

  it('端点、位置或标记参数不同的同区消息不误判为展示', () => {
    expect(
      normalizeMoveEvent(
        protocolMove({
          CardIDs: [96],
          FromZone: 5,
          ToZone: 5,
          FromID: 0,
          ToID: 1,
          MoveType: 19
        })
      ).type
    ).toBe('moveKnown')
    expect(
      normalizeMoveEvent(
        protocolMove({
          CardIDs: [96],
          FromZone: 1,
          ToZone: 1,
          FromID: 255,
          ToID: 255,
          FromPosition: POSITION_TOP,
          ToPosition: POSITION_RANDOM,
          MoveType: 19
        })
      ).type
    ).toBe('moveKnown')
    expect(
      normalizeMoveEvent(
        protocolMove({
          CardIDs: [96],
          FromZone: 4,
          ToZone: 4,
          FromID: 0,
          ToID: 0,
          FromZoneParam: 3370,
          ToZoneParam: 3389,
          MoveType: 19
        })
      ).type
    ).toBe('moveToMark')
  })
})
