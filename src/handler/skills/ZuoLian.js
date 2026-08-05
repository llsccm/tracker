export default function handleZuoLian(context) {
  const { game } = context

  // 在手牌中展示
  if (context.FromZone === 5 && context.ToZone === 5 && context.MoveType === 21) {
    const positiveIDs = context.CardIDs.filter((id) => id > 0)

    if (positiveIDs.length === 1) {
      const spellState = game.ensureSpellState(context.SpellID, () => ({}))
      spellState[context.FromID] = positiveIDs[0]
    }

    return
  }

  // 从手牌中移动到交换区
  if (context.FromZone === 5 && context.ToZone === 10 && context.MoveType === 11) {
    if (!context.CardIDs.some((id) => id > 0)) {
      const spellState = game.ensureSpellState(context.SpellID, () => ({}))

      context.CardIDs[0] = spellState[context.FromID] || 0
      spellState.stack = context.CardIDs[0]
    }

    return
  }

  // 交换区返回牌堆顶
  if (
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
