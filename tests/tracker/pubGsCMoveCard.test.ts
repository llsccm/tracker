import { createTrackerControllerHarness, protocolMove } from './helpers/trackerController'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillMoveContext } from '@/handler/skills/types'
import { POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'

const { applySpellEffect, handleGameFlowState, handleSpecialZones, syncTrackerMove } = vi.hoisted(
  () => ({
    applySpellEffect: vi.fn(),
    handleGameFlowState: vi.fn(),
    handleSpecialZones: vi.fn<(context: SkillMoveContext) => { handled: boolean }>(() => ({
      handled: false
    })),
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
  ])('手气卡回堆在%s保留端点交由 Controller 归一化', (_view, cardIDs) => {
    const msg = protocolMove({
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
    })

    handleMoveCard(msg)

    expect(syncTrackerMove).toHaveBeenCalledOnce()
    expect(syncTrackerMove).toHaveBeenCalledWith({ ...msg, CardIDs: cardIDs }, msg)
    expect(handleSpecialZones).toHaveBeenCalledOnce()
    expect(handleGameFlowState).toHaveBeenCalledOnce()
    expect(applySpellEffect).toHaveBeenCalledOnce()
  })

  it('浑天仪特殊位置交由 Controller 归一化，并沿通用流水线提交一次', () => {
    const msg = protocolMove({
      CardIDs: [51],
      FromZone: 0,
      ToID: 255,
      ToZone: 1,
      ToPosition: POSITION_TOP + 1,
      MoveType: 19,
      SpellID: 3694
    })

    handleMoveCard(msg)

    expect(handleSpecialZones).toHaveBeenCalledOnce()
    const context = handleSpecialZones.mock.calls[0][0]
    expect(context.raw.ToPosition).toBe(POSITION_TOP + 1)
    expect(context.patched.ToPosition).toBe(POSITION_TOP + 1)
    expect(handleGameFlowState).toHaveBeenCalledExactlyOnceWith(context)
    expect(applySpellEffect).toHaveBeenCalledExactlyOnceWith(context)
    expect(syncTrackerMove).toHaveBeenCalledExactlyOnceWith(msg, msg)
    expect(msg.ToPosition).toBe(POSITION_TOP + 1)
  })

  it.each([
    ['其他技能', { SpellID: 0 }],
    ['非外部来源', { FromZone: 1 }],
    ['非牌堆目标', { ToZone: 5 }],
    ['牌顶位置', { ToPosition: POSITION_TOP }],
    ['其他移动类型', { MoveType: 18 }]
  ])('浑天仪位置修正不影响%s', (_scenario, fields) => {
    const msg = protocolMove({
      CardIDs: [51],
      FromZone: 0,
      ToID: 255,
      ToZone: 1,
      ToPosition: POSITION_TOP + 1,
      MoveType: 19,
      SpellID: 3694,
      ...fields
    })

    handleMoveCard(msg)

    expect(syncTrackerMove).toHaveBeenCalledExactlyOnceWith(msg, msg)
  })

  it('天候同区展示不把 RANDOM 来源强行归一为牌顶', () => {
    const msg = protocolMove({
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
    })

    handleMoveCard(msg)

    expect(syncTrackerMove).toHaveBeenCalledOnce()
    expect(syncTrackerMove).toHaveBeenCalledWith(
      { ...msg, CardIDs: [18], FromPosition: POSITION_RANDOM, ToPosition: POSITION_RANDOM },
      msg
    )
  })

  it('Handler UI 状态采集后只提交一次，不再维护移动后回调', () => {
    const order: string[] = []
    applySpellEffect.mockImplementationOnce((context) => {
      expect(context).not.toHaveProperty('afterMove')
      order.push('collect')
    })
    syncTrackerMove.mockImplementationOnce(() => order.push('syncTrackerMove'))

    handleMoveCard(
      protocolMove({
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
    )

    expect(order).toEqual(['collect', 'syncTrackerMove'])
  })

  it('下书处理器直接使用完整 patched，不提前派生端点', () => {
    let effectContext: Record<string, unknown> | undefined
    applySpellEffect.mockImplementationOnce((context: Record<string, unknown>) => {
      effectContext = context
    })

    handleMoveCard(
      protocolMove({
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
    )

    expect(effectContext).toMatchObject({
      patched: { FromID: 7, ToID: 3, FromZone: 5, ToZone: 5 }
    })
    expect(effectContext).not.toHaveProperty('fromSeatID')
    expect(effectContext).not.toHaveProperty('toSeatID')
    expect(effectContext).not.toHaveProperty('fromSubZone')
    expect(effectContext).not.toHaveProperty('toSubZone')
  })

  it('入口复制协议字段，所有响应器与 tracker 使用同一份格式化结果', () => {
    const msg = Object.freeze(
      protocolMove({
        CardCount: 1,
        CardIDs: Object.freeze([96]),
        FromID: 0,
        FromZone: 5,
        FromPosition: POSITION_RANDOM,
        ToID: 3,
        ToZone: 5,
        ToPosition: POSITION_TOP,
        MoveType: 5,
        SpellID: 361,
        SrcSeatID: 0
      })
    )

    handleMoveCard(msg)

    const context = applySpellEffect.mock.calls[0][0]
    expect(context).toMatchObject({
      raw: msg,
      patched: {
        CardIDs: [96],
        CardCount: 1,
        FromID: 0,
        FromZone: 5,
        ToID: 3,
        ToZone: 5,
        MoveType: 5,
        SpellID: 361,
        SrcSeatID: 0
      }
    })
    expect(handleSpecialZones.mock.calls[0][0]).toBe(context)
    expect(handleGameFlowState.mock.calls[0][0]).toBe(context)
    expect(applySpellEffect).toHaveBeenCalledWith(context)
    expect(context.raw).not.toBe(msg)
    expect(context.raw.CardIDs).not.toBe(msg.CardIDs)
    expect(context.raw).toEqual(msg)
    expect(Object.isFrozen(context.raw)).toBe(true)
    expect(Object.isFrozen(context.raw.CardIDs)).toBe(true)
    expect(context.patched.CardIDs).not.toBe(context.raw.CardIDs)
    expect(context.patched.CardIDs).not.toBe(msg.CardIDs)
    expect(syncTrackerMove).toHaveBeenCalledWith(
      { ...msg, CardIDs: [96], FromPosition: POSITION_RANDOM, ToPosition: POSITION_TOP },
      msg
    )
    expect(syncTrackerMove.mock.calls[0][0]).toBe(context.patched)
    expect(syncTrackerMove.mock.calls[0][0].CardIDs).toBe(context.patched.CardIDs)
  })

  it.each([
    ['单张明牌', [96], 1, [96], 1],
    ['单张暗牌', [0], 1, [0], 1],
    ['暗牌不公开身份', [], 2, [], 2]
  ])('保留%s的数组与牌数，技能 0 表示无技能', (_label, CardIDs, CardCount, ids, count) => {
    handleMoveCard(
      protocolMove({
        CardIDs,
        CardCount,
        FromZone: 5,
        ToZone: 2,
        FromID: 0,
        ToID: 255,
        MoveType: 4
      })
    )

    expect(applySpellEffect).toHaveBeenCalledOnce()
    expect(applySpellEffect.mock.calls[0][0]).toMatchObject({
      patched: { CardIDs: ids, CardCount: count, SpellID: 0 }
    })
  })

  it.each([
    ['空移动', { CardCount: 0 }],
    ['发送消息', { isSend: true }],
    ['预操作', { MoveType: 0 }],
    ['过滤区', { ToZone: 11 }]
  ])('%s在响应器分发前过滤', (_label, fields) => {
    handleMoveCard(
      protocolMove({
        CardIDs: [0],
        CardCount: 1,
        FromZone: 5,
        ToZone: 5,
        MoveType: 5,
        SpellID: 361,
        ...fields
      })
    )

    expect(handleSpecialZones).not.toHaveBeenCalled()
    expect(handleGameFlowState).not.toHaveBeenCalled()
    expect(applySpellEffect).not.toHaveBeenCalled()
    expect(syncTrackerMove).not.toHaveBeenCalled()
  })

  it('响应器修正牌与位置后同步最新值，不修改原始消息', () => {
    const msg = protocolMove({
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
    })
    handleSpecialZones.mockImplementationOnce((context) => {
      context.patched.CardIDs[0] = 96
      context.patched.ToPosition = POSITION_RANDOM
      return { handled: true }
    })

    handleMoveCard(msg)

    expect(syncTrackerMove).toHaveBeenCalledOnce()
    expect(syncTrackerMove.mock.calls[0][0]).toMatchObject({
      CardIDs: [96],
      ToPosition: POSITION_RANDOM
    })
    expect(msg.CardIDs).toEqual([0])
    expect(msg.ToPosition).toBe(POSITION_TOP)
    expect(applySpellEffect).not.toHaveBeenCalled()
  })

  it.each([
    { name: '明暗混合', CardIDs: [96, 0], CardCount: 2 },
    { name: '明牌数量不符', CardIDs: [96, 113], CardCount: 1 }
  ])('$name交由 Controller 校验，保留协议张数和原始列表', ({ CardIDs, CardCount }) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const msg = protocolMove({ CardIDs, CardCount })
    applySpellEffect.mockImplementationOnce((context) => {
      expect(context.patched.CardIDs).toEqual(CardIDs)
    })

    handleMoveCard(msg)

    expect(syncTrackerMove.mock.calls[0][1]).toMatchObject({ CardIDs, CardCount })
    expect(syncTrackerMove.mock.calls[0][0].CardIDs).toEqual(CardIDs)
    expect(msg.CardIDs).toEqual(CardIDs)
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('特殊区域跳过普通副作用，由外层统一提交一次', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const order: string[] = []
    syncTrackerMove.mockImplementationOnce(() => order.push('sync'))
    handleSpecialZones.mockImplementationOnce((context) => {
      context.patched.CardIDs = [96, 0]
      return { handled: true }
    })

    handleMoveCard(protocolMove({ CardIDs: [], CardCount: 2 }))

    expect(syncTrackerMove.mock.calls[0][0].CardIDs).toEqual([96, 0])
    expect(order).toEqual(['sync'])
    expect(handleGameFlowState).not.toHaveBeenCalled()
    expect(applySpellEffect).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('最终事件使用局流与技能补丁，不沿用入口的暗牌和位置', () => {
    const { controller } = createTrackerControllerHarness()
    controller.initTrackerRoom()
    controller.registerTrackerPlayers([{ SeatID: 0, ClientID: 100 }, { SeatID: 1 }], 100)
    controller.initTrackerDeck([96, 113])
    controller.setTrackerFirstHand(0)
    const room = controller.getTrackerRoom()!
    const decorate = vi.spyOn(room, 'decorateMoveEvent')
    const msg = protocolMove({ CardIDs: [0], FromPosition: POSITION_RANDOM })
    const order: string[] = []
    handleGameFlowState.mockImplementationOnce((context) => {
      order.push('flow')
      context.patched.FromPosition = POSITION_TOP
    })
    applySpellEffect.mockImplementationOnce((context) => {
      order.push('spell')
      context.patched.CardIDs = [96]
    })
    syncTrackerMove.mockImplementationOnce((patched, raw) => {
      order.push('sync')
      controller.syncTrackerMove(patched, raw)
    })

    handleMoveCard(msg)

    expect(order).toEqual(['flow', 'spell', 'sync'])
    expect(decorate).toHaveBeenCalledOnce()
    const event = decorate.mock.calls[0][0]
    expect(event).toMatchObject({
      type: 'drawKnown',
      cardIDs: [96],
      protocol: { CardIDs: [96], FromPosition: POSITION_TOP },
      options: { fromPosition: POSITION_TOP },
      raw: { CardIDs: [0], FromPosition: POSITION_RANDOM }
    })
    expect(event.protocol).toEqual(syncTrackerMove.mock.calls[0][0])
    expect(event.cardIDs).not.toBe(syncTrackerMove.mock.calls[0][0].CardIDs)
    expect(event.raw).toEqual(syncTrackerMove.mock.calls[0][1])
    expect(event.options.sourceEvent?.raw).toBe(event.raw)
    expect(controller.getTrackedPlayerHandCardIDs(1)).toEqual([96])
    expect(msg.CardIDs).toEqual([0])
    expect(msg.FromPosition).toBe(POSITION_RANDOM)
    controller.destroyTrackerRoom()
  })

  it('raw只提取移动所需字段，不携带消息信封和额外数据', () => {
    const msg = {
      ...protocolMove({ CardIDs: [96], SrcSeatID: 6, Label: '测试来源', isSend: false }),
      className: 'PubGsCMoveCard',
      id: 21209,
      DataCount: 1,
      errCode: 0,
      errMsg: '',
      fromSocket2: false,
      isResume: true,
      extra: { payload: [1, 2, 3] }
    }

    handleMoveCard(msg)

    const context = applySpellEffect.mock.calls[0][0]
    expect(Object.keys(context.raw).sort()).toEqual(
      [
        'CardCount',
        'CardIDs',
        'FromID',
        'FromPosition',
        'FromZone',
        'FromZoneParam',
        'ToID',
        'ToPosition',
        'ToZone',
        'ToZoneParam',
        'MoveType',
        'SpellID',
        'SrcSeatID',
        'Label',
        'isSend'
      ].sort()
    )
    expect(context.raw).toMatchObject({
      CardIDs: [96],
      SrcSeatID: 6,
      Label: '测试来源',
      isSend: false
    })
    expect(Object.keys(context.patched)).toEqual(Object.keys(context.raw))
    expect(syncTrackerMove.mock.calls[0][1]).toBe(context.raw)
    expect(context.raw).not.toHaveProperty('extra')
    expect(msg.extra.payload).toEqual([1, 2, 3])
  })
})
