import { describe, expect, it } from 'vitest'
import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import {
  isPileSingleCardShow,
  normalizeMoveCardFields,
  normalizeMoveEvent,
  validateMoveEvent
} from '@/tracker/MoveEventNormalizer'

describe('MoveEventNormalizer 当前行为', () => {
  it('归一化标准 PubGsCMoveCard 消息', () => {
    const event = normalizeMoveEvent({
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

    expect(event.cardIDs).toEqual([1, 2])
    expect(event.cardCount).toBe(2)
    expect(event.toZone).toBe('player')
    expect(event.options.seatID).toBe(3)
    expect(event.options.fromZone).toBe('pile')
    expect(event.options.subZone).toBe('hand')
    expect(event.options.cardCount).toBe(2)
    expect(event.options.sourceEvent.raw).toBe(event.raw)
  })

  it('保留普通小整数 ToPosition 交给协议位置层解析', () => {
    const event = normalizeMoveEvent({
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

    expect(event.options.position).toBe(2)
    expect(event.options.sourceEvent.raw?.ToPosition).toBe(2)
  })

  it('未知区域编号当前降级为 process 且不伪造手牌子区', () => {
    const raw = {
      CardIDs: [1],
      CardCount: 1,
      FromZone: 99,
      ToZone: 98,
      MoveType: 19
    }
    const event = normalizeMoveEvent(raw)

    expect(event.toZone).toBe('process')
    expect(event.options.fromZone).toBeNull()
    expect(event.options.subZone).toBeUndefined()
    expect(event.options.fromSubZone).toBeUndefined()
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
    const event = normalizeMoveEvent({
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

    expect(event.type).toBe('moveUnknown')
    expect(event.toZone).toBe('exchange')
    expect(event.options.fromZone).toBe('pile')
    expect(event.options.seatID).toBeUndefined()
    expect(event.options.fromSeatID).toBeUndefined()
    expect(event.options.subZone).toBeUndefined()
    expect(event.options.fromSubZone).toBeUndefined()
  })

  it('天候牌堆同区单牌展示基础归一为 noop，留给技能装饰器建立范围候选', () => {
    const event = normalizeMoveEvent({
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

    expect(event.type).toBe('noop')
  })

  it('CardIDs 为空时按 CardCount 保留暗牌数量', () => {
    const raw = {
      CardIDs: [],
      CardCount: 3,
      FromZone: 1,
      ToZone: 5,
      ToID: 2,
      MoveType: 1
    }
    const event = normalizeMoveEvent(raw)

    expect(event.cardIDs).toEqual([])
    expect(event.cardCount).toBe(3)
    expect(event.options.cardCount).toBe(3)
    expect(validateMoveEvent(raw)).not.toContainEqual(
      expect.objectContaining({ code: 'CARD_COUNT_MISMATCH' })
    )
  })

  it('CardCount 为 0 时当前按 CardIDs 长度回退', () => {
    const raw = {
      CardIDs: [7],
      CardCount: 0,
      FromZone: 1,
      ToZone: 5,
      ToID: 2,
      MoveType: 1
    }
    const event = normalizeMoveEvent(raw)

    expect(event.cardCount).toBe(1)
    expect(event.options.cardCount).toBe(1)
    expect(validateMoveEvent(raw)).toContainEqual(
      expect.objectContaining({
        code: 'CARD_COUNT_MISMATCH',
        field: 'CardIDs',
        expected: 0,
        actual: 1
      })
    )
  })

  it('关键字段缺失时仍返回可降级事件', () => {
    const raw = { CardIDs: [3] }
    const event = normalizeMoveEvent(raw)

    expect(event.cardIDs).toEqual([3])
    expect(event.cardCount).toBe(1)
    expect(event.toZone).toBe('process')
    expect(event.options.seatID).toBeUndefined()
    expect(event.options.fromZone).toBeNull()
    expect(event.options.sourceEvent.raw).toBe(event.raw)
    expect(validateMoveEvent(raw)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MISSING_FIELD',
          field: 'FromZone'
        }),
        expect.objectContaining({
          code: 'MISSING_FIELD',
          field: 'ToZone'
        }),
        expect.objectContaining({
          code: 'MISSING_FIELD',
          field: 'CardCount'
        })
      ])
    )
  })

  it('空字符串关键字段按缺失处理且不归一成游戏外区域', () => {
    const raw = {
      CardIDs: [3],
      CardCount: '',
      FromZone: '',
      ToZone: '',
      MoveType: 19
    }
    const event = normalizeMoveEvent(raw)

    expect(event.toZone).toBe('process')
    expect(event.options.fromZone).toBeNull()
    expect(validateMoveEvent(raw)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MISSING_FIELD',
          field: 'FromZone',
          value: ''
        }),
        expect.objectContaining({
          code: 'MISSING_FIELD',
          field: 'ToZone',
          value: ''
        }),
        expect.objectContaining({
          code: 'MISSING_FIELD',
          field: 'CardCount',
          value: ''
        })
      ])
    )
  })

  it('CardIDs 与 CardCount 不一致时记录校验警告但保留声明数量', () => {
    const raw = {
      CardIDs: [1],
      CardCount: 2,
      FromZone: 1,
      ToZone: 5,
      ToID: 2,
      MoveType: 1
    }
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
    const raw = {
      CardIDs: [96],
      CardCount: '1',
      FromZone: '4',
      FromID: 0,
      FromZoneParam: '3370',
      FromPosition: POSITION_TOP,
      ToZone: '5',
      ToID: 2,
      ToZoneParam: '0',
      ToPosition: 2,
      MoveType: '8',
      SpellID: '3389',
      Label: '标记牌回手'
    }
    Object.freeze(raw)
    Object.freeze(raw.CardIDs)

    const event = normalizeMoveEvent(raw)

    expect(event).toMatchObject({
      cardIDs: [96],
      cardCount: 1,
      moveType: 8,
      toZone: 'player',
      options: {
        fromSeatID: 0,
        seatID: 2,
        fromSubZone: 'mark',
        subZone: 'hand',
        fromSpellID: 3370,
        spellID: 3389,
        cardCount: 1,
        moveType: 8,
        fromPosition: POSITION_TOP,
        position: 2,
        sourceEvent: { moveType: 8, label: '标记牌回手' }
      }
    })
    expect(event.raw).toBe(raw)
    expect(event.options.sourceEvent.raw).toBe(raw)
    expect(event.cardIDs).not.toBe(raw.CardIDs)
    event.cardIDs[0] = 113
    expect(raw.CardIDs).toEqual([96])
    expect(raw.MoveType).toBe('8')
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
  ])(
    '数值和字符串字段的事件分类一致：%s → %s / %s / %s',
    (FromZone, ToZone, MoveType, SpellID, type) => {
      const raw = {
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
      }
      const event = normalizeMoveEvent(raw)
      const stringEvent = normalizeMoveEvent({
        ...raw,
        CardCount: String(raw.CardCount),
        FromZone: String(FromZone),
        ToZone: String(ToZone),
        MoveType: String(MoveType),
        SpellID: String(SpellID)
      })

      expect(stringEvent.type).toBe(type)
      expect(stringEvent.moveType).toBe(event.moveType)
      expect(stringEvent.options).toEqual({
        ...event.options,
        sourceEvent: { ...event.options.sourceEvent, raw: stringEvent.raw }
      })
    }
  )

  it('共享格式化保留单牌和无技能语义', () => {
    expect(normalizeMoveCardFields({ CardIDs: 0, CardCount: '1', SpellID: null })).toMatchObject({
      CardIDs: [0],
      CardCount: 1,
      SpellID: 0
    })
    expect(normalizeMoveCardFields({ CardIDs: 96, CardCount: '1' })).toMatchObject({
      CardIDs: [96],
      CardCount: 1,
      SpellID: 0
    })
    expect(normalizeMoveCardFields({ CardCount: '2' })).toMatchObject({
      CardIDs: [],
      CardCount: 2
    })
  })

  it.each([undefined, ''])('缺省或空移动类型 %s 保持未指定，不伪造预操作', (MoveType) => {
    const event = normalizeMoveEvent({
      CardIDs: [96],
      CardCount: 1,
      FromZone: 1,
      ToZone: 5,
      ToID: 0,
      MoveType
    })

    expect(event.moveType).toBeUndefined()
    expect(event.options.moveType).toBeUndefined()
    expect(event.options.sourceEvent.moveType).toBeUndefined()
  })

  it('缺少端点、位置或标记参数时不因 undefined 相等被当作同区展示', () => {
    expect(
      normalizeMoveEvent({
        CardIDs: [96],
        CardCount: 1,
        FromZone: 5,
        ToZone: 5,
        MoveType: 19
      }).type
    ).toBe('moveKnown')
    expect(
      normalizeMoveEvent({
        CardIDs: [96],
        CardCount: 1,
        FromID: 255,
        ToID: 255,
        FromZone: 1,
        ToZone: 1,
        MoveType: 19
      }).type
    ).toBe('moveKnown')
    expect(
      normalizeMoveEvent({
        CardIDs: [96],
        CardCount: 1,
        FromID: 0,
        ToID: 0,
        FromZone: 4,
        ToZone: 4,
        MoveType: 19
      }).type
    ).toBe('moveToMark')
  })
})
