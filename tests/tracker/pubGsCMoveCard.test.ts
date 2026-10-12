import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillMoveContext } from '@/handler/skills/types'
import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'

const { applySpellEffect, handleGameFlowState, handleSpecialZones, syncTrackerMove } = vi.hoisted(
  () => ({
    applySpellEffect: vi.fn(),
    handleGameFlowState: vi.fn(),
    handleSpecialZones: vi.fn<
      (context: SkillMoveContext & { finishMove(): void }) => { handled: boolean }
    >(() => ({ handled: false })),
    syncTrackerMove: vi.fn()
  })
)

vi.mock('../../src/tracker/runtime/browser', () => ({
  tracker: {
    syncTrackerMove
  }
}))

vi.mock('../../src/handler/gameFlowState', () => ({
  handleGameFlowState
}))

vi.mock('../../src/handler/specialZones', () => ({
  handleSpecialZones
}))

vi.mock('../../src/handler/spellEffects', () => ({
  applySpellEffect
}))

import { handleMoveCard } from '../../src/handler/PubGsCMoveCard'

describe('PubGsCMoveCard', () => {
  beforeEach(() => {
    applySpellEffect.mockClear()
    handleGameFlowState.mockClear()
    handleSpecialZones.mockClear()
    syncTrackerMove.mockClear()
  })

  it.each([
    ['其他视角', []],
    ['主视角', [51, 146, 138, 4]]
  ])('手气卡回堆在%s均归一为 RANDOM', (_view, cardIDs) => {
    const msg = {
      CardCount: 4,
      CardIDs: cardIDs,
      FromID: 6,
      FromPosition: POSITION_TOP,
      FromZone: 5,
      FromZoneParam: 0,
      MoveType: 19,
      SpellID: 0,
      ToID: 0,
      ToPosition: POSITION_TOP,
      ToZone: 1,
      ToZoneParam: 0
    }

    handleMoveCard(msg)

    expect(syncTrackerMove).toHaveBeenCalledOnce()
    expect(syncTrackerMove).toHaveBeenCalledWith(msg, {
      CardCount: msg.CardCount,
      FromZone: msg.FromZone,
      ToZone: msg.ToZone,
      MoveType: msg.MoveType,
      SpellID: msg.SpellID,
      CardIDs: cardIDs,
      FromPosition: POSITION_TOP,
      ToPosition: POSITION_RANDOM
    })
    expect(handleSpecialZones).toHaveBeenCalledOnce()
    expect(handleGameFlowState).toHaveBeenCalledOnce()
    expect(applySpellEffect).toHaveBeenCalledOnce()
  })

  it('权变的牌堆同区展示将来源和目标都归一为牌顶', () => {
    const msg = {
      CardCount: 4,
      CardIDs: [158, 2, 63, 125],
      FromID: 255,
      FromPosition: POSITION_RANDOM,
      FromZone: 1,
      FromZoneParam: 0,
      MoveType: 21,
      SpellID: 7011,
      ToID: 255,
      ToPosition: POSITION_RANDOM,
      ToZone: 1,
      ToZoneParam: 0
    }

    handleMoveCard(msg)

    expect(syncTrackerMove).toHaveBeenCalledOnce()
    expect(syncTrackerMove).toHaveBeenCalledWith(msg, {
      CardCount: msg.CardCount,
      FromZone: msg.FromZone,
      ToZone: msg.ToZone,
      MoveType: msg.MoveType,
      SpellID: msg.SpellID,
      CardIDs: [158, 2, 63, 125],
      FromPosition: POSITION_TOP,
      ToPosition: POSITION_TOP
    })
  })

  it('权变同区展示缺少位置字段时仍补为牌顶', () => {
    const msg = {
      CardCount: 4,
      CardIDs: [158, 2, 63, 125],
      FromID: 255,
      FromZone: 1,
      FromZoneParam: 0,
      MoveType: 21,
      SpellID: 7011,
      ToID: 255,
      ToZone: 1,
      ToZoneParam: 0
    }

    handleMoveCard(msg)

    expect(syncTrackerMove).toHaveBeenCalledOnce()
    expect(syncTrackerMove).toHaveBeenCalledWith(msg, {
      CardCount: msg.CardCount,
      FromZone: msg.FromZone,
      ToZone: msg.ToZone,
      MoveType: msg.MoveType,
      SpellID: msg.SpellID,
      CardIDs: [158, 2, 63, 125],
      FromPosition: POSITION_TOP,
      ToPosition: POSITION_TOP
    })
  })

  it('观虚的牌堆同区展示将来源和目标都归一为牌顶', () => {
    const msg = {
      CardCount: 5,
      CardIDs: [62, 67, 37, 53, 142],
      FromID: 255,
      FromPosition: POSITION_RANDOM,
      FromZone: 1,
      FromZoneParam: 0,
      MoveType: 21,
      SpellID: 987,
      ToID: 255,
      ToPosition: POSITION_RANDOM,
      ToZone: 1,
      ToZoneParam: 0
    }

    handleMoveCard(msg)

    expect(syncTrackerMove).toHaveBeenCalledOnce()
    expect(syncTrackerMove).toHaveBeenCalledWith(msg, {
      CardCount: msg.CardCount,
      FromZone: msg.FromZone,
      ToZone: msg.ToZone,
      MoveType: msg.MoveType,
      SpellID: msg.SpellID,
      CardIDs: [62, 67, 37, 53, 142],
      FromPosition: POSITION_TOP,
      ToPosition: POSITION_TOP
    })
  })

  it('天候同区展示不把 RANDOM 来源强行归一为牌顶', () => {
    const msg = {
      CardCount: 1,
      CardIDs: [18],
      FromID: 255,
      FromPosition: POSITION_RANDOM,
      FromZone: 1,
      FromZoneParam: 0,
      MoveType: 21,
      SpellID: 3903,
      ToID: 255,
      ToPosition: POSITION_RANDOM,
      ToZone: 1,
      ToZoneParam: 0
    }

    handleMoveCard(msg)

    expect(syncTrackerMove).toHaveBeenCalledOnce()
    expect(syncTrackerMove).toHaveBeenCalledWith(msg, {
      CardCount: msg.CardCount,
      FromZone: msg.FromZone,
      ToZone: msg.ToZone,
      MoveType: msg.MoveType,
      SpellID: msg.SpellID,
      CardIDs: [18],
      FromPosition: POSITION_RANDOM,
      ToPosition: POSITION_RANDOM
    })
  })

  it('移动后副作用在 tracker 同步完成后执行', () => {
    const order: string[] = []
    applySpellEffect.mockImplementationOnce(
      (context: { afterMove(callback: () => void): void }) => {
        context.afterMove(() => order.push('afterMove'))
      }
    )
    syncTrackerMove.mockImplementationOnce(() => order.push('syncTrackerMove'))

    handleMoveCard({
      CardCount: 1,
      CardIDs: [0],
      FromID: 7,
      FromPosition: POSITION_TOP,
      FromZone: 5,
      FromZoneParam: 0,
      MoveType: 5,
      SpellID: 361,
      ToID: 3,
      ToPosition: POSITION_TOP,
      ToZone: 5,
      ToZoneParam: 0
    })

    expect(order).toEqual(['syncTrackerMove', 'afterMove'])
  })

  it('为技能处理器提供规范化的下书移动位置', () => {
    let effectContext: Record<string, unknown> | undefined
    applySpellEffect.mockImplementationOnce((context: Record<string, unknown>) => {
      effectContext = context
    })

    handleMoveCard({
      CardCount: 1,
      CardIDs: [0],
      FromID: 7,
      FromPosition: POSITION_TOP,
      FromZone: 5,
      FromZoneParam: 0,
      MoveType: 5,
      SpellID: 361,
      ToID: 3,
      ToPosition: POSITION_TOP,
      ToZone: 5,
      ToZoneParam: 0
    })

    expect(effectContext).toMatchObject({
      fromSeatID: 7,
      toSeatID: 3,
      fromSubZone: 'hand',
      toSubZone: 'hand'
    })
  })

  it('入口统一数值字段，所有响应器与 tracker 使用同一份格式化结果', () => {
    const msg = Object.freeze({
      CardCount: '1',
      CardIDs: Object.freeze([96]),
      FromID: 0,
      FromZone: '5',
      FromPosition: POSITION_RANDOM,
      ToID: 3,
      ToZone: '5',
      ToPosition: POSITION_TOP,
      MoveType: '5',
      SpellID: '361',
      SrcSeatID: 0
    })

    handleMoveCard(msg)

    const context = applySpellEffect.mock.calls[0][0]
    expect(context).toMatchObject({
      msg,
      CardIDs: [96],
      CardCount: 1,
      FromID: 0,
      FromZone: 5,
      ToID: 3,
      ToZone: 5,
      MoveType: 5,
      SpellID: 361,
      SrcSeatID: 0,
      fromSeatID: 0,
      toSeatID: 3,
      fromSubZone: 'hand',
      toSubZone: 'hand'
    })
    expect(handleSpecialZones.mock.calls[0][0]).toBe(context)
    expect(handleGameFlowState.mock.calls[0][0]).toBe(context)
    expect(applySpellEffect).toHaveBeenCalledWith(context)
    expect(context.msg).toBe(msg)
    expect(context.CardIDs).not.toBe(msg.CardIDs)
    expect(syncTrackerMove).toHaveBeenCalledWith(msg, {
      CardIDs: [96],
      CardCount: 1,
      FromZone: 5,
      FromPosition: POSITION_RANDOM,
      ToZone: 5,
      ToPosition: POSITION_TOP,
      MoveType: 5,
      SpellID: 361
    })
    expect(syncTrackerMove.mock.calls[0][1].CardIDs).not.toBe(context.CardIDs)
  })

  it.each([
    ['单张明牌', 96, 1, [96], 1],
    ['单张暗牌', 0, 1, [0], 1],
    ['暗牌省略身份', undefined, 2, [], 2]
  ])('统一%s的数组与牌数，技能缺省为 0', (_label, CardIDs, CardCount, ids, count) => {
    handleMoveCard({
      CardIDs,
      CardCount,
      FromZone: 5,
      ToZone: 2,
      FromID: 0,
      ToID: 255,
      MoveType: 4
    })

    expect(applySpellEffect).toHaveBeenCalledOnce()
    expect(applySpellEffect.mock.calls[0][0]).toMatchObject({
      CardIDs: ids,
      CardCount: count,
      SpellID: 0,
      fromSeatID: 0,
      toSeatID: undefined
    })
  })

  it.each([
    ['预操作', { MoveType: '0' }],
    ['过滤区', { ToZone: '11' }]
  ])('数值格式化先于%s过滤', (_label, fields) => {
    handleMoveCard({
      CardIDs: [0],
      CardCount: 1,
      FromZone: 5,
      ToZone: 5,
      MoveType: 5,
      SpellID: 361,
      ...fields
    })

    expect(handleSpecialZones).not.toHaveBeenCalled()
    expect(handleGameFlowState).not.toHaveBeenCalled()
    expect(applySpellEffect).not.toHaveBeenCalled()
    expect(syncTrackerMove).not.toHaveBeenCalled()
  })

  it('字符串技能和牌数在牌 ID 特例预处理前归一化', () => {
    const msg = {
      CardIDs: [0, 96, 113],
      CardCount: '1',
      FromZone: '5',
      FromID: 0,
      ToZone: '5',
      ToID: 0,
      MoveType: '21',
      SpellID: '713'
    }

    handleMoveCard(msg)

    expect(applySpellEffect.mock.calls[0][0]).toMatchObject({
      CardIDs: [113],
      CardCount: 1,
      SpellID: 713
    })
    expect(msg.CardIDs).toEqual([0, 96, 113])
  })

  it('字符串字段在位置特例前归一化，公共区哨兵不作为座位', () => {
    handleMoveCard({
      CardIDs: [96],
      CardCount: '1',
      FromZone: '1',
      FromID: 255,
      FromPosition: POSITION_RANDOM,
      ToZone: '1',
      ToID: 255,
      ToPosition: POSITION_RANDOM,
      MoveType: '21',
      SpellID: '7011'
    })

    expect(applySpellEffect.mock.calls[0][0]).toMatchObject({
      FromPosition: POSITION_TOP,
      ToPosition: POSITION_TOP,
      fromSeatID: undefined,
      toSeatID: undefined
    })
  })

  it('响应器修正牌与位置后同步最新值，不修改原始消息', () => {
    const msg = {
      CardIDs: [0],
      CardCount: 1,
      FromZone: 5,
      FromID: 0,
      FromPosition: POSITION_TOP,
      ToZone: 1,
      ToID: 255,
      ToPosition: POSITION_TOP,
      MoveType: 10,
      SpellID: 1
    }
    handleSpecialZones.mockImplementationOnce((context) => {
      context.CardIDs[0] = 96
      context.ToPosition = POSITION_RANDOM
      context.finishMove()
      return { handled: true }
    })

    handleMoveCard(msg)

    expect(syncTrackerMove).toHaveBeenCalledOnce()
    expect(syncTrackerMove.mock.calls[0][1]).toMatchObject({
      CardIDs: [96],
      ToPosition: POSITION_RANDOM
    })
    expect(msg.CardIDs).toEqual([0])
    expect(msg.ToPosition).toBe(POSITION_TOP)
    expect(applySpellEffect).not.toHaveBeenCalled()
  })
})
