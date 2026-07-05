import { expect } from 'vitest'
import { CardLocationIndex } from '@/tracker/CardLocationIndex'
import type { Room } from '@/tracker/Room'

/**
 * 断言当前 locationIndex（通常是增量维护后的状态）与对同一 Room 全量 rebuild 的影子索引
 * 逐桶等价（含桶内顺序）。复用 `CardLocationIndex.toComparable()` 做单一比对口径。
 * 这是 plans/cards-incremental-index-and-fast-path-plan.md 步骤 1 要求的
 * “增量结果 vs 全量 rebuild 结果”断言辅助。
 */
export function expectLocationIndexMatchesRebuild(room: Room): void {
  const shadow = new CardLocationIndex()
  shadow.rebuild(room, { record: false })
  expect(room.locationIndex.toComparable(room)).toEqual(shadow.toComparable(room))
}
