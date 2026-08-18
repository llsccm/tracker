import type { CardID } from '../types'

/**
 * 从协议牌 ID 中提取去重后的真实身份（过滤 0，保留首次出现顺序）；
 * 结果不保证按数值排序，需要按数值排序的调用方应在结果上显式排序。协议输入归一化约定见
 * docs/agents/tracker_api.md「协议 CardID 输入约定」。
 */
export function getPositiveIDs(cardIDs: readonly CardID[] = []): CardID[] {
  return Array.from(new Set(cardIDs.filter((id) => id > 0)))
}
