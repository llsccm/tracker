import type { SpellID } from '../types'

export type SpellIDInput = SpellID | string | null | undefined

// 技能 414 暗置到标记区后，回手牌协议可能使用 3389 作为返回技能 ID；取源牌时需要互扫同一标记空间。
export const MARK_SPELL_ALIAS_GROUPS = [[414, 3389]]

export function normalizeSpellID(spellID: SpellIDInput): SpellID | null {
  if (spellID === null || spellID === undefined || spellID === '') return null
  const normalized = Number(spellID)
  return Number.isFinite(normalized) ? normalized : null
}

export function getCompatibleMarkSpellIDs(spellID: SpellIDInput): (SpellID | string)[] {
  if (spellID === null || spellID === undefined) return []
  const normalized = Number(spellID)
  const base = Number.isNaN(normalized) ? spellID : normalized
  const aliasGroup = MARK_SPELL_ALIAS_GROUPS.find((group) => group.includes(Number(base)))
  return aliasGroup ? aliasGroup.slice() : [base]
}
