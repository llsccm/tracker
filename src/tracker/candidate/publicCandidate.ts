import { POSITION_BOTTOM, POSITION_TOP } from './cardPositions'
import type { PublicCandidate, PublicPosition, PublicZoneName } from '../types'

export type PublicCandidatePosition = 'top' | 'bottom' | 'random'

export function normalizePublicPosition(
  position: PublicPosition | null | undefined
): PublicCandidatePosition {
  if (position === POSITION_BOTTOM || position === 'bottom') return 'bottom'
  if (position === POSITION_TOP || position === 'top') return 'top'
  return 'random'
}

/**
 * 将公共候选位置转换成可读中文文案。
 */
export function getPublicCandidateLabel(
  zone: PublicZoneName,
  position: PublicPosition | null,
  count: number | null
): string {
  const zoneName = zone === 'pile' ? '牌堆' : zone
  const normalizedPosition = normalizePublicPosition(position)
  const countText = count ?? '未知'

  if (normalizedPosition === 'top') return `${zoneName}顶前${countText}张`
  if (normalizedPosition === 'bottom') return `${zoneName}底${countText}张`
  return `${zoneName}随机${countText}张`
}

export function createPublicCandidate(
  zone: PublicZoneName,
  position: PublicPosition,
  count: number
): PublicCandidate {
  const normalizedPosition = normalizePublicPosition(position)

  return {
    zone,
    position: normalizedPosition,
    count,
    label: getPublicCandidateLabel(zone, normalizedPosition, count)
  }
}
