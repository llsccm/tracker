import { protocolMove } from './helpers/trackerController'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { normalizeMoveCardFields, normalizeMoveEvent } from '@/tracker/MoveEventNormalizer'

import { getPositiveIDs, patchEvent, type MoveEventDraft } from '@/tracker/skill/moveEventUtils'

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
}

void verifyPatchEventTypes

describe('moveEventUtils', () => {
  it('字段更多的补丁对象也不能覆盖协议、追溯数据或目标区域', () => {
    const event = normalizeMoveEvent(protocolMove({ CardIDs: [1], ToZone: 2 }))
    const otherEvent = normalizeMoveEvent(protocolMove({ CardIDs: [2], ToZone: 5 }))

    const patched = patchEvent(event, otherEvent)

    expect(patched.cardIDs).toEqual([2])
    expect(patched.protocol).toBe(event.protocol)
    expect(patched.raw).toBe(event.raw)
    expect(patched.toZone).toBe(event.toZone)
  })

  it('getPositiveIDs 过滤未知占位并按首次出现顺序去重', () => {
    expect(getPositiveIDs([3, 2, 3, 0])).toEqual([3, 2])
  })

  it('patchEvent 只替换指定字段并浅合并 options', () => {
    const event: MoveEventDraft = {
      protocol: normalizeMoveCardFields(
        protocolMove({
          CardIDs: [1],
          CardCount: 1,
          FromZone: 1,
          ToZone: 2,
          MoveType: 4,
          SpellID: 0
        })
      ),
      type: 'moveKnown',
      cardIDs: [1],
      cardCount: 1,
      toZone: 'discard',
      options: {
        fromZone: 'pile',
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
      fromZone: 'pile',
      cardCount: 2,
      combinationID: 'move_event_utils'
    })
    expect(event.options).toEqual({
      fromZone: 'pile',
      cardCount: 1
    })
  })
})
