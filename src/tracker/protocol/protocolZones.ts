import type { PublicZoneName, SpellID, ZoneID } from '../types'

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
  POPUP: 8,
  SHUFFLE_PILE: 9,
  EXCHANGE: 10,
  DISCARD_TEMP: 11,
  EXILE: 12
})

interface ProtocolMarkSpellParams {
  param?: SpellID | null
  toZoneParam?: SpellID | null
  fromZoneParam?: SpellID | null
  spellID?: SpellID | null
}

const PROTOCOL_PUBLIC_ZONE_MAP = new Map<number, PublicZoneName>([
  [PROTOCOL_ZONE.OUTSIDE, 'outside'],
  [PROTOCOL_ZONE.PILE, 'pile'],
  [PROTOCOL_ZONE.DISCARD, 'discard'],
  [PROTOCOL_ZONE.PROCESS, 'process'],
  [PROTOCOL_ZONE.POPUP, 'popup'],
  [PROTOCOL_ZONE.SHUFFLE_PILE, 'pile'],
  [PROTOCOL_ZONE.EXCHANGE, 'exchange'],
  [PROTOCOL_ZONE.DISCARD_TEMP, 'process'],
  [PROTOCOL_ZONE.EXILE, 'exile']
])

const PROTOCOL_PLAYER_SUB_ZONE_MAP = new Map<number, ProtocolPlayerSubZone>([
  [PROTOCOL_ZONE.MARK, 'mark'],
  [PROTOCOL_ZONE.HAND, 'hand'],
  [PROTOCOL_ZONE.EQUIP, 'equip'],
  [PROTOCOL_ZONE.JUDGE, 'judge']
])

export function getProtocolPublicZone(
  zone: ZoneID | null | undefined,
  fallback: PublicZoneName | null = null
): PublicZoneName | null {
  return zone == null ? fallback : (PROTOCOL_PUBLIC_ZONE_MAP.get(zone) ?? fallback)
}

export function getProtocolPlayerSubZone(
  zone: ZoneID | null | undefined,
  fallback: ProtocolPlayerSubZone | null = 'hand'
): ProtocolPlayerSubZone | null {
  return zone == null ? fallback : (PROTOCOL_PLAYER_SUB_ZONE_MAP.get(zone) ?? fallback)
}

export function getProtocolMarkSpellID(
  zone: ZoneID | null | undefined,
  params: ProtocolMarkSpellParams = {},
  fallback: SpellID | null = null
): SpellID | null {
  const paramID = params.param || params.toZoneParam || params.fromZoneParam || null
  const spellID = params.spellID || null

  // 玩家标记空间由端点 ZoneParam 标识，独立于触发本次移动的技能。
  if (zone === PROTOCOL_ZONE.MARK) return paramID ?? spellID ?? fallback

  return params.spellID ?? fallback
}

export function isProtocolPlayerZone(zone: ZoneID | null | undefined): boolean {
  return zone != null && PROTOCOL_PLAYER_SUB_ZONE_MAP.has(zone)
}

export function isKnownProtocolZone(zone: ZoneID | null | undefined): boolean {
  return (
    zone != null && (PROTOCOL_PUBLIC_ZONE_MAP.has(zone) || PROTOCOL_PLAYER_SUB_ZONE_MAP.has(zone))
  )
}
