import type { SpellID, SubZone, SubZoneCandidate } from '../types'

export interface SubZoneCandidateInput {
  seatID?: number
  subZone?: SubZone | null
  spellID?: SpellID | string | null
}

/**
 * 玩家子区域候选的轻量工具。
 *
 * 注意：这里的候选是“完整位置候选”，不是单纯的子区域名。
 * 例如同一张牌可以同时是：A 手牌 / B 手牌 / A 标记。
 * 这样 seats 收敛到 A 后，仍能保留 A 手牌 / A 标记两个位置候选。
 */

export function normalizeCandidateSpellID(spellID: unknown): SpellID | null {
  if (spellID === null || spellID === undefined || spellID === '') return null
  const value = Number(spellID)
  return Number.isNaN(value) ? null : value
}

/**
 * 规整候选位置，保证 seatID、subZone、spellID 三元组稳定。
 */
export function normalizeSubZoneCandidate(
  candidate: SubZoneCandidateInput = {}
): SubZoneCandidate | null {
  const seatID = Number(candidate.seatID)
  const subZone = candidate.subZone ?? 'hand'
  if (Number.isNaN(seatID) || !subZone) return null

  return {
    seatID,
    subZone,
    spellID: normalizeCandidateSpellID(candidate.spellID)
  }
}

/**
 * 用字符串 key 表达候选位置，便于 Map/Set 和 ConstraintGroup 统一索引。
 */
export function createSubZoneCandidateKey(candidate: SubZoneCandidateInput = {}): string {
  const normalized = normalizeSubZoneCandidate(candidate)
  if (!normalized) return ''
  return [
    normalized.seatID,
    normalized.subZone,
    normalized.spellID === null ? '' : normalized.spellID
  ].join(':')
}

/**
 * 将候选位置 key 还原为三元组对象。
 */
export function parseSubZoneCandidateKey(key: string): SubZoneCandidate | null {
  const [seatID, subZone, spellID] = String(key).split(':')
  return normalizeSubZoneCandidate({
    seatID: Number(seatID),
    subZone,
    spellID: spellID === '' ? null : spellID
  })
}

/**
 * 比较两个候选位置是否完全相同。
 */
export function isSameSubZoneCandidate(
  left: SubZoneCandidateInput,
  right: SubZoneCandidateInput
): boolean {
  return createSubZoneCandidateKey(left) === createSubZoneCandidateKey(right)
}

/**
 * 子区域展示名，供悬浮提示与位置描述复用。
 */
export function getSubZoneName(subZone: SubZone): string {
  if (subZone === 'equip') return '装备'
  if (subZone === 'judge') return '判定区'
  if (subZone === 'mark') return '标记'
  return '手牌'
}
