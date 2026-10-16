import type { CardID } from '@/tracker/types'
import type { SkillMoveContext } from './types'

export default function handleQingYiLianJu(context: SkillMoveContext): void {
  const { patched } = context
  const spellCards = context.game.getSpellState<CardID[]>(patched.SpellID)
  if (
    patched.FromZone == 2 &&
    patched.ToZone == 5 &&
    patched.CardCount == spellCards?.length &&
    patched.CardIDs.filter((id) => id > 0).length == 0
  ) {
    spellCards.forEach((id, i) => {
      patched.CardIDs[i] = id
    })
    context.game.deleteSpellState(patched.SpellID)
  }
}
