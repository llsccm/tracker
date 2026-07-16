export function handleYanXi(context) {
  const { game } = context

  if (
    context.ToZone == 5 &&
    context.CardCount == 1 &&
    (context.SrcSeatID == game.myID || import.meta.env.DEV)
  ) {
    const spellCards = game.getSpellState(context.SpellID)
    if (!spellCards?.length) return
    if (context.CardIDs[0] && spellCards.includes(context.CardIDs[0])) {
      spellCards.splice(spellCards.indexOf(context.CardIDs[0]), 1)
    } else if (context.FromZone == 5 || spellCards.length == 2 || spellCards.length == 1) {
      context.CardIDs[0] = spellCards.shift()
    }
  }
}
