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
    const spellState = game.ensureSpellState(context.SpellID, () => ({}))
    const knownCardID = context.CardIDs.find((id) => id > 0)
    const cardID = knownCardID || spellState[context.FromID]

    delete spellState[context.FromID]

    if (!(cardID > 0)) {
      delete spellState.stack
      return
    }

    if (!knownCardID) context.CardIDs[0] = cardID
    spellState.stack = cardID

    return
  }

  // 交换区返回牌堆顶
  if (
    context.FromZone === 10 &&
    (context.ToZone === 1 || context.ToZone === 2) &&
    context.MoveType === 11
  ) {
    const spellState = game.getSpellState(context.SpellID)
    const cardID = spellState?.stack

    if (!context.CardIDs.some((id) => id > 0) && cardID > 0) context.CardIDs[0] = cardID
    if (spellState) delete spellState.stack
  }
}
