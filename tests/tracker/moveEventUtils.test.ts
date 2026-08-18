import { describe, expect, expectTypeOf, it } from 'vitest'

import { getPositiveIDs, patchEvent, type MoveEventDraft } from '@/tracker/skill/moveEventUtils'

function verifyPatchEventTypes(event: MoveEventDraft): void {
  patchEvent(event, { options: { sourceCards: [] } })

  // @ts-expect-error cardIDs 只能包含数字牌 ID。
  patchEvent(event, { cardIDs: ['invalid'] })

  // @ts-expect-error sourceCards 必须写入 options，不能污染事件顶层。
  patchEvent(event, { sourceCards: [] })
}

void verifyPatchEventTypes

describe('moveEventUtils', () => {
  it('getPositiveIDs 过滤非正数并按首次出现顺序去重', () => {
    expect(getPositiveIDs([3, 2, 3, 0, -1, NaN])).toEqual([3, 2])
  })

  it('patchEvent 只替换指定字段并浅合并 options', () => {
    const event: MoveEventDraft = {
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
