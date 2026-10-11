import type { CardID } from '@/tracker/types'
import type { SkillMoveContext } from './types'

export default function handleQianFu(context: SkillMoveContext): void {
  const spellCards = context.game.getSpellState<CardID[]>(context.SpellID)

  if (
    context.FromZone == 2 &&
    context.ToZone == 1 &&
    context.MoveType == 15 &&
    context.CardCount == spellCards?.length &&
    context.CardIDs.filter((id) => id > 0).length == 0
  ) {
    context.CardIDs = spellCards
    context.game.deleteSpellState(context.SpellID)
  }
}
