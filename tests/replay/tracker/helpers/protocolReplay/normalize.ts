/** 回放选项的数值兜底：非法输入一律退回默认值，而不是让 NaN/负数流进回放逻辑。 */

export function normalizePositive(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

export function normalizeNonNegative(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback
}
