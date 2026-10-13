import type { SkillMoveContext } from './types'

export default function handleChengXiang(context: SkillMoveContext): void {
  const { patched } = context
  if (patched.ToZone != 8 || patched.MoveType != 6) return
  context.game.setSpellState(patched.SpellID, [...(patched.CardIDs || [])])
}
