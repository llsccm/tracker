import type { CardID } from '@/tracker/types'
import type { SkillMoveContext } from './types'

export default function handleZeXing(context: SkillMoveContext): void {
  const { game } = context
  const spellCards = game.getSpellState<CardID[]>(context.SpellID)

  if (
    context.FromZone == 5 &&
    context.ToZone == 5 &&
    context.CardCount == spellCards?.length &&
    context.CardIDs.filter((id) => id > 0).length == 0
  ) {
    context.CardIDs = spellCards
    game.deleteSpellState(context.SpellID)
  }
}
