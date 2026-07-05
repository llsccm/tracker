import { normalizeCandidateSpellID, normalizeSubZoneCandidate } from './subZoneCandidate'
import type { SubZoneCandidateInput } from './subZoneCandidate'
import type {
  CardID,
  ContainerLocationCandidate,
  LocationCandidate,
  OutsideLocationCandidate,
  PlayerLocationCandidate,
  PublicCandidate,
  PublicLocationCandidate,
  PublicPosition,
  PublicZoneName,
  SeatID,
  SpellID,
  SubZone,
  SubZoneCandidate
} from '../types'

export interface LocationCandidateInput {
  type?: LocationCandidate['type'] | string
  seatID?: SeatID
  subZone?: SubZone | null
  spellID?: SpellID | string | null
  zone?: PublicZoneName | null
  position?: PublicPosition | null
  count?: number | string | null
  label?: string | null
  cardID?: CardID | string
  containerCardID?: CardID | string
  containerType?: string | null
}

function isPlayerLocationCandidate(
  candidate: LocationCandidate | null
): candidate is PlayerLocationCandidate {
  return candidate?.type === 'player'
}

function isPublicLocationCandidate(
  candidate: LocationCandidate | null
): candidate is PublicLocationCandidate {
  return candidate?.type === 'public'
}

function isContainerLocationCandidate(
  candidate: LocationCandidate | null
): candidate is ContainerLocationCandidate {
  return candidate?.type === 'container'
}

/**
 * 规整完整位置候选。玩家区候选用于推理 owner 与子区域，公共区候选只描述公共位置，
 * 不投影为 owner。
 */
export function normalizeLocationCandidate(
  candidate: LocationCandidateInput = {}
): LocationCandidate | null {
  if (!candidate) return null

  const type = candidate.type ?? (candidate.seatID !== undefined ? 'player' : 'public')

  if (type === 'player') {
    const normalized = normalizeSubZoneCandidate(candidate)
    if (!normalized) return null

    return {
      type: 'player',
      seatID: normalized.seatID,
      subZone: normalized.subZone,
      spellID: normalized.spellID
    }
  }

  if (type === 'public') {
    const zone =
      candidate.zone === null || candidate.zone === undefined ? '' : String(candidate.zone)
    if (!zone) return null

    const count = Number(candidate.count)
    return {
      type: 'public',
      zone,
      position: candidate.position ?? 'any',
      count: Number.isFinite(count) && count > 0 ? count : null,
      label: candidate.label ?? null
    }
  }

  if (type === 'container') {
    // 装备容器候选描述“牌在某个装备附属空间内”，不直接绑定当前承载座位。
    const cardID = Number(candidate.cardID ?? candidate.containerCardID)
    const containerType = candidate.containerType ?? 'equipment'
    if (!Number.isFinite(cardID) || cardID <= 0 || !containerType) return null

    return {
      type: 'container',
      containerType,
      cardID,
      spellID: normalizeCandidateSpellID(candidate.spellID)
    }
  }

  if (type === 'outside') {
    return {
      type: 'outside',
      zone: candidate.zone ?? 'outside'
    } as OutsideLocationCandidate
  }

  return null
}

/**
 * 生成稳定 key。字符串 key 仅用于 Map/Set，不作为业务状态源。
 */
export function createLocationCandidateKey(candidate: LocationCandidateInput = {}): string {
  const normalized = normalizeLocationCandidate(candidate)
  if (!normalized) return ''

  if (normalized.type === 'player') {
    return [
      'player',
      normalized.seatID,
      normalized.subZone,
      normalized.spellID === null ? 'none' : normalized.spellID
    ].join(':')
  }

  if (normalized.type === 'public') {
    return [
      'public',
      normalized.zone,
      normalized.position ?? 'any',
      normalized.count === null ? 'any' : normalized.count
    ].join(':')
  }

  if (normalized.type === 'container') {
    // key 固定在容器实体上；装备迁移时无需重写候选，只更新投影。
    return [
      'container',
      normalized.containerType,
      normalized.cardID,
      normalized.spellID === null ? 'none' : normalized.spellID
    ].join(':')
  }

  if (normalized.type === 'outside') {
    return ['outside', normalized.zone ?? 'outside'].join(':')
  }

  return ''
}

/**
 * 解析 location key。
 */
export function parseLocationCandidateKey(key: string): LocationCandidate | null {
  const parts = String(key).split(':')
  const type = parts[0]

  if (type === 'player') {
    return normalizeLocationCandidate({
      type,
      seatID: Number(parts[1]),
      subZone: parts[2],
      spellID: parts[3] === 'none' ? null : parts[3]
    })
  }

  if (type === 'public') {
    return normalizeLocationCandidate({
      type,
      zone: parts[1],
      position: parts[2] === 'any' ? null : parts[2],
      count: parts[3] === 'any' ? null : parts[3]
    })
  }

  if (type === 'container') {
    // container key 的第三段是装备物理牌 ID，第四段是该装备承载的标记空间 ID。
    return normalizeLocationCandidate({
      type,
      containerType: parts[1],
      cardID: parts[2],
      spellID: parts[3] === 'none' ? null : parts[3]
    })
  }

  if (type === 'outside') {
    return normalizeLocationCandidate({
      type,
      zone: parts[1]
    })
  }

  return null
}

/**
 * 比较两个完整位置候选是否一致。
 */
export function isSameLocationCandidate(
  left: LocationCandidateInput,
  right: LocationCandidateInput
): boolean {
  return createLocationCandidateKey(left) === createLocationCandidateKey(right)
}

/**
 * 从完整位置候选投影候选座位。
 */
export function projectSeatsFromLocationCandidates(
  candidates: LocationCandidateInput[] = []
): Set<SeatID> {
  const seats = new Set<SeatID>()
  getPlayerLocationCandidates(candidates).forEach((candidate) => seats.add(candidate.seatID))
  return seats
}

export function getPlayerLocationCandidates(
  candidates: LocationCandidateInput[] = []
): PlayerLocationCandidate[] {
  return candidates
    .map((candidate) => normalizeLocationCandidate(candidate))
    .filter(isPlayerLocationCandidate)
}

export function getPublicLocationCandidates(
  candidates: LocationCandidateInput[] = []
): PublicLocationCandidate[] {
  return candidates
    .map((candidate) => normalizeLocationCandidate(candidate))
    .filter(isPublicLocationCandidate)
}

export function getContainerLocationCandidates(
  candidates: LocationCandidateInput[] = []
): ContainerLocationCandidate[] {
  return candidates
    .map((candidate) => normalizeLocationCandidate(candidate))
    .filter(isContainerLocationCandidate)
}

export function fromSubZoneCandidate(
  candidate: SubZoneCandidateInput = {}
): PlayerLocationCandidate | null {
  return normalizeLocationCandidate({
    ...candidate,
    type: 'player'
  }) as PlayerLocationCandidate | null
}

export function toSubZoneCandidate(
  candidate: LocationCandidateInput = {}
): SubZoneCandidate | null {
  const normalized = normalizeLocationCandidate(candidate)
  if (normalized?.type !== 'player') return null

  return {
    seatID: normalized.seatID,
    subZone: normalized.subZone,
    spellID: normalizeCandidateSpellID(normalized.spellID)
  }
}

export function fromPublicCandidate(
  candidate: Partial<PublicCandidate> = {}
): PublicLocationCandidate | null {
  return normalizeLocationCandidate({
    ...candidate,
    type: 'public'
  }) as PublicLocationCandidate | null
}

export function toPublicCandidate(
  candidate: LocationCandidateInput = {},
  getLabel:
    | ((
        zone: PublicZoneName,
        position: PublicPosition | null,
        count: number | null
      ) => string | null)
    | null = null
): PublicCandidate | null {
  const normalized = normalizeLocationCandidate(candidate)
  if (normalized?.type !== 'public') return null

  const label =
    normalized.label ??
    (typeof getLabel === 'function'
      ? (getLabel(normalized.zone, normalized.position, normalized.count) ?? null)
      : null)

  return {
    zone: normalized.zone,
    position: normalized.position,
    count: normalized.count,
    label
  }
}
