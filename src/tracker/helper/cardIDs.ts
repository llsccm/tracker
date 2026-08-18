import type { CardID } from '../types'

/**
 * 将牌 ID 输入转换为去重后的正数列表（丢弃 0、负数，保留首次出现顺序）；
 * 需要稳定排序的调用方应在结果上显式排序。协议输入归一化约定见
 * docs/agents/tracker_api.md「协议 CardID 输入约定」。
 */
export function getPositiveIDs(cardIDs: readonly number[] = []): CardID[] {
  return Array.from(new Set(cardIDs.map((id) => Number(id) || 0).filter((id) => id > 0)))
}
