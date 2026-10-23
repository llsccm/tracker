import type { SlotCountRange } from '@/tracker/constraint/ConstraintGroup'

/** 快照、来源追踪和变化签名共用稳定顺序；复制区间以隔离后续运行时更新。 */
export function snapshotLocationSlots(
  slots: ReadonlyMap<string, SlotCountRange>
): Record<string, SlotCountRange> {
  return Object.fromEntries(
    Array.from(slots, ([key, range]) => [key, { min: range.min, max: range.max }] as const).sort(
      ([left], [right]) => left.localeCompare(right)
    )
  )
}
