import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import type {
  MoveRoute,
  MoveSource,
  MoveTarget,
  PlayerMoveArea,
  PlayerMoveEndpoint,
  PlayerCandidateTarget,
  PublicMoveEndpoint,
  SeatID,
  SpellID
} from '../types'

type MoveZone = PublicMoveEndpoint['zone'] | 'player' | 'popup' | 'outside'
export function getMoveZone(endpoint: MoveTarget): MoveZone
export function getMoveZone(endpoint: MoveSource): MoveZone | null
export function getMoveZone(endpoint: MoveSource | MoveTarget): MoveZone | null
export function getMoveZone(endpoint: MoveSource | MoveTarget): MoveZone | null {
  if (endpoint.type === 'public') return endpoint.zone
  if (endpoint.type === 'playerCandidates') return 'player'
  return endpoint.type === 'unresolved' ? null : endpoint.type
}

export function getMoveSeat(endpoint: MoveSource | MoveTarget): SeatID | null {
  return endpoint.type === 'player' ? endpoint.seatID : null
}

export function getMoveSubZone(endpoint: MoveSource | MoveTarget) {
  return endpoint.type === 'player' || endpoint.type === 'playerCandidates'
    ? endpoint.subZone
    : undefined
}

export function getMoveMarkSpellID(endpoint: MoveSource | MoveTarget): SpellID | null {
  return (endpoint.type === 'player' || endpoint.type === 'playerCandidates') &&
    endpoint.subZone === 'mark'
    ? endpoint.markSpellID
    : null
}

export function getMovePosition(endpoint: MoveSource | MoveTarget) {
  return endpoint.type === 'public' ? endpoint.position : POSITION_TOP
}

export function getPopupSpaceID(endpoint: MoveSource | MoveTarget) {
  return endpoint.type === 'popup' ? endpoint.spaceID : undefined
}

export function getMoveTargetSeats(endpoint: MoveTarget): SeatID[] {
  if (endpoint.type === 'player') return [endpoint.seatID]
  if (endpoint.type === 'playerCandidates') return [...endpoint.seatIDs]
  return []
}

/** 旧逐牌回调的选择规则；动作技能与标记空间仍分别保存在请求中。 */
export function getMoveCallbackSpellID(route: MoveRoute, triggerSpellID?: SpellID | null) {
  if (route.to.type === 'player' || route.to.type === 'playerCandidates') {
    return route.to.subZone === 'mark' ? route.to.markSpellID : triggerSpellID
  }
  if (route.from.type === 'player' && route.from.subZone === 'mark') {
    return route.from.markSpellID
  }
  return triggerSpellID
}

export function playerMoveTarget(
  seats: readonly [SeatID, ...SeatID[]],
  area: PlayerMoveArea
): PlayerMoveEndpoint | PlayerCandidateTarget {
  const unique = [...new Set(seats)] as [SeatID, ...SeatID[]]
  if (unique.length === 1) return { type: 'player', seatID: unique[0], ...area }
  return {
    type: 'playerCandidates',
    seatIDs: unique as [SeatID, SeatID, ...SeatID[]],
    ...area
  }
}
