import handleChengXiang from './skills/ChengXiang'

export const spellEffectHandlers = new Map([
  [441, handleChengXiang],
  [3492, handleChengXiang]
])

// Handler 仅采集 UI 状态；记牌器推断通过 RoomSkillPlugin 运行。
export function applySpellEffect(context) {
  const handler = spellEffectHandlers.get(context.patched.SpellID)
  if (!handler) return false

  handler(context)
  return true
}
