import type { SkillMoveContext } from './types'

/** 反间 目前废弃 */
export default function handleFanJian({ patched }: SkillMoveContext): void {
  const { CardIDs, CardCount, MoveType } = patched
  if (MoveType !== 21 || CardCount !== CardIDs.length - 2) return

  // 首项是随后牌列表中需剔除的下标，不属于公开牌身份。
  const [index, ...cardIDs] = CardIDs
  if (!Number.isInteger(index) || index < 0 || index >= cardIDs.length) {
    throw new Error(`SpellID=713 移动协议剔除下标 ${String(index)} 越界`)
  }
  cardIDs.splice(index, 1)
  patched.CardIDs = cardIDs
}
