import type { CardID } from '../types'

/**
 * 将牌 ID 输入转换为去重后的正数列表。
 *
 * 转换会丢弃 0、负数，并保留每个 ID 首次出现的顺序；
 * 需要稳定排序的调用方应在返回结果上显式排序。
 */
export function getPositiveIDs(cardIDs: readonly number[] = []): CardID[] {
  return Array.from(new Set(cardIDs.map((id) => Number(id) || 0).filter((id) => id > 0)))
}
