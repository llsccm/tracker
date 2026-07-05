import type { PublicZoneName, SpellID } from './types'

export type ProtocolPlayerSubZone = 'hand' | 'equip' | 'judge' | 'mark'

// 0: '游戏外',
// 2: '弃牌堆',
// 3: '处理区',
// 4: '标记',
// 5: '手牌',
// 6: '装备',
// 7: '判定区',
// 8: '弹窗',
// 10: '交换临时区',
// 11: '弃牌临时区',
// 12: '回收区'
export const PROTOCOL_ZONE = Object.freeze({
  OUTSIDE: 0,
  PILE: 1,
  DISCARD: 2,
  PROCESS: 3,
  MARK: 4,
  HAND: 5,
  EQUIP: 6,
  JUDGE: 7,
  POPUP_MARK: 8,
  SHUFFLE_PILE: 9,
  EXCHANGE: 10,
  DISCARD_TEMP: 11,
  EXILE: 12
})

interface ProtocolMarkSpellParams {
  param?: unknown
  toZoneParam?: unknown
  fromZoneParam?: unknown
  spellID?: unknown
}

const PROTOCOL_PUBLIC_ZONE_MAP = new Map<number, PublicZoneName>([
  [PROTOCOL_ZONE.OUTSIDE, 'outside'],
  [PROTOCOL_ZONE.PILE, 'pile'],
  [PROTOCOL_ZONE.DISCARD, 'discard'],
  [PROTOCOL_ZONE.PROCESS, 'process'],
  [PROTOCOL_ZONE.SHUFFLE_PILE, 'pile'],
  [PROTOCOL_ZONE.EXCHANGE, 'exchange'],
  [PROTOCOL_ZONE.DISCARD_TEMP, 'process'],
  [PROTOCOL_ZONE.EXILE, 'exile']
])

const PROTOCOL_PLAYER_SUB_ZONE_MAP = new Map<number, ProtocolPlayerSubZone>([
  [PROTOCOL_ZONE.MARK, 'mark'],
  [PROTOCOL_ZONE.HAND, 'hand'],
  [PROTOCOL_ZONE.EQUIP, 'equip'],
  [PROTOCOL_ZONE.JUDGE, 'judge'],
  [PROTOCOL_ZONE.POPUP_MARK, 'mark']
])

function normalizeProtocolID(value: unknown, fallback: number | null = null): number | null {
  if (value === null || value === undefined || value === '') return fallback
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : fallback
}

function normalizeNonZeroProtocolID(value: unknown): number | null {
  const normalized = normalizeProtocolID(value)
  return normalized ? normalized : null
}

export function getProtocolPublicZone(
  zone: unknown,
  fallback: PublicZoneName | null = null
): PublicZoneName | null {
  const zoneNum = normalizeProtocolID(zone)
  return zoneNum === null ? fallback : (PROTOCOL_PUBLIC_ZONE_MAP.get(zoneNum) ?? fallback)
}

export function getProtocolPlayerSubZone(
  zone: unknown,
  fallback: ProtocolPlayerSubZone | null = 'hand'
): ProtocolPlayerSubZone | null {
  const zoneNum = normalizeProtocolID(zone)
  return zoneNum === null ? fallback : (PROTOCOL_PLAYER_SUB_ZONE_MAP.get(zoneNum) ?? fallback)
}

export function getProtocolMarkSpellID(
  zone: unknown,
  params: ProtocolMarkSpellParams = {},
  fallback: SpellID | string | null = null
): SpellID | null {
  const zoneNum = normalizeProtocolID(zone)
  const fallbackID = normalizeProtocolID(fallback, null)
  const paramID =
    normalizeNonZeroProtocolID(params.param) ??
    normalizeNonZeroProtocolID(params.toZoneParam) ??
    normalizeNonZeroProtocolID(params.fromZoneParam)
  const spellID = normalizeNonZeroProtocolID(params.spellID)

  // 旧 Zone 的标记区分桶规则：zone 4 使用 ZoneParam 优先，zone 8 使用 SpellID 优先。
  if (zoneNum === PROTOCOL_ZONE.MARK) return paramID ?? spellID ?? fallbackID
  if (zoneNum === PROTOCOL_ZONE.POPUP_MARK) return spellID ?? paramID ?? fallbackID

  return normalizeProtocolID(params.spellID, fallbackID)
}

export function isProtocolPlayerZone(zone: unknown): boolean {
  const zoneNum = normalizeProtocolID(zone)
  return zoneNum !== null && PROTOCOL_PLAYER_SUB_ZONE_MAP.has(zoneNum)
}

export function isKnownProtocolZone(zone: unknown): boolean {
  const zoneNum = normalizeProtocolID(zone)
  return (
    zoneNum !== null &&
    (PROTOCOL_PUBLIC_ZONE_MAP.has(zoneNum) || PROTOCOL_PLAYER_SUB_ZONE_MAP.has(zoneNum))
  )
}
