import handleJiaoYu from './skills/JiaoYu'
import handleZuoLian from './skills/ZuoLian'

function handleChengXiang(context) {
  if (context.ToZone != 8 || context.MoveType != 6) return
  context.game.setSpellState(context.SpellID, context.CardIDs)
}

function handleQingYiLianJu(context) {
  const spellCards = context.game.getSpellState(context.SpellID)
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

function handleQianFu(context) {
  if (
    context.FromZone == 2 &&
    context.ToZone == 1 &&
    context.MoveType == 15 &&
    context.CardIDs.filter((id) => id > 0).length == 0
  ) {
    const spellCards = context.game.getSpellState(context.SpellID)
    if (spellCards?.length) {
      context.CardIDs.splice(0, Infinity, ...spellCards)
    }
  }
}

export const spellEffectHandlers = new Map([
  [441, handleChengXiang],
  [3492, handleChengXiang],
  // [3033, handleJiZhan],
  // [3329, handleHeZhong],
  [3488, handleZuoLian],
  [3157, handleQingYiLianJu],
  [3511, handleQingYiLianJu],
  [3571, handleJiaoYu],
  [3750, handleQianFu]
  // [7016, handleYanXi],
  // [7017, handleYanXi]
])

// 使用已有信息修改 cardIDs 简单不用处理 真是一个好方法吗?
export function applySpellEffect(context) {
  const handler = spellEffectHandlers.get(context.SpellID)
  if (!handler) return false

  handler(context)
  return true
}
