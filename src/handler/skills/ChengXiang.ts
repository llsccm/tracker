import type { SkillMoveContext } from './types'

export default function handleChengXiang(context: SkillMoveContext): void {
  if (context.ToZone != 8 || context.MoveType != 6) return
  context.game.setSpellState(context.SpellID, [...(context.CardIDs || [])])
}
