import type { SkillMoveContext } from './types'

export default function handleJiaoYu(context: SkillMoveContext): void {
  const { patched } = context
  if (
    patched.FromZone != 8 ||
    patched.ToZone != 5 ||
    patched.MoveType != 8 ||
    patched.CardIDs.some((id) => id > 0)
  ) {
    return
  }

  const colors = context.game.getSpellState<Set<number>>(patched.SpellID)
  if (!(colors instanceof Set) || colors.size == 0) return

  const markSpellID = patched.FromID || patched.SpellID
  const markCards =
    context.game.room
      ?.refreshPlayerSnapshot()
      .filter(
        (card) =>
          card.location === 'player' &&
          card.subZone === 'mark' &&
          card.spellID === markSpellID &&
          card.isKnown === true &&
          card.id > 0 &&
          colors.has(card.color)
      ) ?? []
  const spellCardIDs = markCards.map((card) => card.id)

  // 同色候选数与协议张数不一致时无法唯一确认，保留暗牌语义交给 tracker 收敛。
  if (spellCardIDs.length != patched.CardCount) return
  patched.CardIDs.splice(0, patched.CardIDs.length, ...spellCardIDs)
}
