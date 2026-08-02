export const POSITION_BOTTOM = 0 as const
export const POSITION_TOP = 0xff00 as const
export const POSITION_RANDOM = 0xff02 as const

export type CardPosition = typeof POSITION_BOTTOM | typeof POSITION_TOP | typeof POSITION_RANDOM

/**
 * 将协议位置解析为目标有序区中的精确插槽。
 *
 * 公共区内部统一按底 -> 顶保存，因此普通小整数直接表示从牌底起算的零基插槽；
 * POSITION_BOTTOM/POSITION_TOP 分别解析为 0/当前张数，POSITION_RANDOM 不提供精确索引。
 * 越界位置保持不可解析，由调用方沿用原有的无序降级语义。
 */
export function getProtocolInsertionIndex(position: unknown, cardCount: number): number | null {
  if (
    (typeof position !== 'number' && typeof position !== 'string') ||
    (typeof position === 'string' && position.trim() === '')
  ) {
    return null
  }

  const normalizedCardCount = Math.max(0, Math.floor(Number(cardCount) || 0))
  const normalizedPosition = typeof position === 'string' ? position.trim().toLowerCase() : position
  if (normalizedPosition === POSITION_TOP || normalizedPosition === 'top') {
    return normalizedCardCount
  }
  if (normalizedPosition === POSITION_BOTTOM || normalizedPosition === 'bottom') return 0
  if (
    normalizedPosition === POSITION_RANDOM ||
    normalizedPosition === 'random' ||
    normalizedPosition === 'any'
  ) {
    return null
  }

  const insertionIndex = Number(position)
  if (
    !Number.isInteger(insertionIndex) ||
    insertionIndex < POSITION_BOTTOM ||
    insertionIndex > normalizedCardCount
  ) {
    return null
  }

  return insertionIndex
}

/**
 * 按 PubGsCMoveCard 的位置语义插入一批牌。
 *
 * 数值位置与 POSITION_BOTTOM 共用从牌底起算的坐标；批量插入时反转输入顺序，保持
 * Zone.add(POSITION_BOTTOM) 既有的批次相对顺序。返回 false 表示位置不是可用的精确插槽。
 *
 * 注意：POSITION_TOP 哨兵与等于 orderedCards.length 的数值槽位指向同一落点（牌顶），但批次
 * 顺序不同——TOP 直接 push，保持 cards 的输入顺序；数值槽位走 splice 分支会反转输入顺序。
 * 因此不要把 POSITION_TOP 归一化成 cardCount，否则会意外翻转批次顺序。
 */
export function insertCardsAtProtocolPosition<T>(
  orderedCards: T[],
  cards: readonly T[],
  position: unknown
): boolean {
  const normalizedPosition = typeof position === 'string' ? position.trim().toLowerCase() : position
  if (normalizedPosition === POSITION_TOP || normalizedPosition === 'top') {
    orderedCards.push(...cards)
    return true
  }

  const insertionIndex = getProtocolInsertionIndex(position, orderedCards.length)
  if (insertionIndex === null) return false

  orderedCards.splice(insertionIndex, 0, ...[...cards].reverse())
  return true
}
