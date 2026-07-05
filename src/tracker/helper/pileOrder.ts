import type { Card } from '../Card'

export function getPileDisplayCards(cards: Card[]): Card[] {
  // 牌堆内部顺序是底 -> 顶，展示时从左到右显示顶 -> 底。
  return [...cards].reverse()
}
