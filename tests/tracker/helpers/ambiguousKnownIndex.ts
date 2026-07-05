import { expect } from 'vitest'
import { AmbiguousKnownIndex } from '@/tracker/AmbiguousKnownIndex'
import type { Room } from '@/tracker/Room'

/**
 * 断言当前 ambiguousKnownIndex（通常是增量维护后的状态）与同一 Room 的全量 rebuild 结果一致。
 */
export function expectAmbiguousKnownIndexMatchesRebuild(room: Room): void {
  const shadow = new AmbiguousKnownIndex(room)
  shadow.rebuild(Array.from(room.constraintGroups.values()), { record: false })
  expect(room.ambiguousKnownIndex.toComparable(room)).toEqual(shadow.toComparable(room))
}
