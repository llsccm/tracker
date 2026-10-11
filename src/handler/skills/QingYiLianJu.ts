import type { CardID } from '@/tracker/types'
import type { SkillMoveContext } from './types'

export default function handleQingYiLianJu(context: SkillMoveContext): void {
  const spellCards = context.game.getSpellState<CardID[]>(context.SpellID)
  if (
    context.FromZone == 2 &&
    context.ToZone == 5 &&
    context.CardCount == spellCards?.length &&
    context.CardIDs.filter((id) => id > 0).length == 0
  ) {
    spellCards.forEach((id, i) => {
      context.CardIDs[i] = id
    })
    context.game.deleteSpellState(context.SpellID)
  }
}
