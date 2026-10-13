import type { CardID } from '@/tracker/types'
import type { SkillMoveContext } from './types'

export default function handleQianFu(context: SkillMoveContext): void {
  const { patched } = context
  const spellCards = context.game.getSpellState<CardID[]>(patched.SpellID)

  if (
    patched.FromZone == 2 &&
    patched.ToZone == 1 &&
    patched.MoveType == 15 &&
    patched.CardCount == spellCards?.length &&
    patched.CardIDs.filter((id) => id > 0).length == 0
  ) {
    patched.CardIDs = spellCards
    context.game.deleteSpellState(patched.SpellID)
  }
}
