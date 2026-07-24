import { describe, expect, it } from 'vitest'
import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import { normalizeMoveEvent, validateMoveEvent } from '@/tracker/MoveEventNormalizer'

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
})
