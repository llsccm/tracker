import type { CardID } from '@/tracker/types'
import type { SkillMoveContext } from './types'

export default function handleShengMo(context: SkillMoveContext): void {
  const { game, patched } = context
  const spellCards = game.getSpellState<CardID[]>(patched.SpellID)

  if (
    patched.FromZone == 2 &&
    patched.ToZone == 5 &&
    patched.MoveType == 15 &&
    patched.CardCount == spellCards?.length &&
    patched.CardIDs.filter((id) => id > 0).length == 0
  ) {
    patched.CardIDs = spellCards
    game.deleteSpellState(patched.SpellID)
  }
}
