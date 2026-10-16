import type { SpellID } from '../types'

// 技能 414 暗置到标记区后，回手牌协议可能使用 3389 作为返回技能 ID；取源牌时需要互扫同一标记空间。
const MARK_SPELL_ALIAS_GROUPS = [[414, 3389]]

export function getCompatibleMarkSpellIDs(spellID: SpellID | null | undefined): SpellID[] {
  if (spellID === null || spellID === undefined) return []
  const aliasGroup = MARK_SPELL_ALIAS_GROUPS.find((group) => group.includes(spellID))
  return aliasGroup ? aliasGroup.slice() : [spellID]
}
