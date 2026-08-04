import { CardConfig } from '../config'
import { drawChengXiang } from '../draw'
import handleJiaoYu from './skills/JiaoYu'

function handleChengXiang(context) {
  if (context.ToZone == 8 && context.MoveType == 6) {
    const arr = context.CardIDs.map((id) => CardConfig.GetInstance().getCardNumber(id))
    drawChengXiang(arr, context.SpellID == 3492)
  }
}

function handleZuoLian(context) {
  const { game } = context

  if (context.FromZone === 5 && context.ToZone === 5 && context.MoveType === 21) {
    const positiveIDs = context.CardIDs.filter((id) => id > 0)

    if (positiveIDs.length === 1) {
      const spellState = game.ensureSpellState(context.SpellID, () => ({}))
      spellState[context.FromID] = positiveIDs[0]
    }
  } else if (context.FromZone === 5 && context.ToZone === 10 && context.MoveType === 11) {
    if (!context.CardIDs.some((id) => id > 0)) {
      const spellState = game.ensureSpellState(context.SpellID, () => ({}))

      context.CardIDs[0] = spellState[context.FromID] || 0
      spellState.stack = context.CardIDs[0]
    }
  } else if (
    context.FromZone === 10 &&
    (context.ToZone === 1 || context.ToZone === 2) &&
    context.MoveType === 11
  ) {
    if (!context.CardIDs.some((id) => id > 0)) {
      const spellState = game.getSpellState(context.SpellID)
      context.CardIDs[0] = spellState?.stack || 0

      if (spellState) {
        delete spellState.stack
      }
    }
  }
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
