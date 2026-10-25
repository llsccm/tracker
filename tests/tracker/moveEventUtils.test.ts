import { protocolMove } from './helpers/trackerController'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { normalizeMoveEvent } from '@/tracker/protocol/MoveEventNormalizer'

import { getPositiveIDs } from '@/tracker/helper/cardIDs'
import { patchEvent, type MoveEventDraft } from '@/tracker/skill/moveEventUtils'

function verifyPatchEventTypes(event: MoveEventDraft): void {
  patchEvent(event, { options: { sourceCards: [] } })

  // @ts-expect-error 技能补丁不允许覆盖完整协议。
  patchEvent(event, { protocol: event.protocol })

  // @ts-expect-error 技能补丁不允许覆盖原始数据追溯。
  patchEvent(event, { raw: event.raw })

  // @ts-expect-error cardIDs 只能包含数字牌 ID。
  patchEvent(event, { cardIDs: ['invalid'] })

  // @ts-expect-error sourceCards 必须写入 options，不能污染事件顶层。
  patchEvent(event, { sourceCards: [] })

  // @ts-expect-error 端点补丁必须完整提供同一分支的字段。
  patchEvent(event, { from: { type: 'player', seatID: 0 } })
  // @ts-expect-error 标记空间只能出现在 mark 端点。
  patchEvent(event, { to: { type: 'player', seatID: 0, subZone: 'hand', markSpellID: 414 } })
  // @ts-expect-error 旧端点字段不能通过执行选项注入。
  patchEvent(event, { options: { fromZone: 'pile' } })
}

void verifyPatchEventTypes

describe('moveEventUtils', () => {
  it('位置补丁创建新公共端点，保留原事件与未修正目标', () => {
    const event = normalizeMoveEvent(protocolMove({ FromPosition: 65282 }))
    const patched = patchEvent(event, {
      from: event.from.type === 'public' ? { ...event.from, position: 0 } : event.from
    })
    expect(patched.from).toEqual({ type: 'public', zone: 'pile', position: 0 })
    expect(event.from).toEqual({ type: 'public', zone: 'pile', position: 65282 })
    expect(patched.to).toBe(event.to)
    expect(patched.protocol.FromPosition).toBe(65282)
  })

  it('端点整体替换，字段更多的补丁对象也不能覆盖协议或追溯数据', () => {
    const event = normalizeMoveEvent(protocolMove({ CardIDs: [1], ToZone: 2 }))
    const otherEvent = normalizeMoveEvent(protocolMove({ CardIDs: [2], ToZone: 5 }))

    const patched = patchEvent(event, otherEvent)

    expect(patched.cardIDs).toEqual([2])
    expect(patched.protocol).toBe(event.protocol)
    expect(patched.raw).toBe(event.raw)
    expect(patched.to).toBe(otherEvent.to)
    expect(patched.to).not.toHaveProperty('zone')
    expect(event.to).toEqual({ type: 'public', zone: 'discard', position: 65280 })
  })

  it('getPositiveIDs 过滤未知占位并按首次出现顺序去重', () => {
    expect(getPositiveIDs([3, 2, 3, 0])).toEqual([3, 2])
  })

  it('patchEvent 只替换指定字段并浅合并 options', () => {
    const event: MoveEventDraft = {
      protocol: normalizeMoveEvent(
        protocolMove({
          CardIDs: [1],
          CardCount: 1,
          FromZone: 1,
          ToZone: 2,
          MoveType: 4,
          SpellID: 0
        })
      ).protocol,
      type: 'moveKnown',
      moveType: 4,
      cardIDs: [1],
      cardCount: 1,
      from: { type: 'public', zone: 'pile', position: 65280 },
      to: { type: 'public', zone: 'discard', position: 65280 },
      options: {
        cardCount: 1
      }
    }

    const patched = patchEvent(event, {
      type: 'noop',
      cardIDs: [2],
      options: {
        cardCount: 2,
        combinationID: 'move_event_utils'
      }
    })

    expectTypeOf(patched).toEqualTypeOf<MoveEventDraft>()
    expect(patched).not.toBe(event)
    expect(patched.protocol).toBe(event.protocol)
    expect(patched.cardIDs).toEqual([2])
    expect(patched.options).toEqual({
      cardCount: 2,
      combinationID: 'move_event_utils'
    })
    expect(event.options).toEqual({
      cardCount: 1
    })
  })
})
