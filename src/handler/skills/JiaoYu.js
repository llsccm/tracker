export default function handleJiaoYu(context) {
  if (
    context.FromZone != 8 ||
    context.ToZone != 5 ||
    context.MoveType != 8 ||
    context.CardIDs.some((id) => id > 0)
  ) {
    return
  }

  const colors = context.game.getSpellState(context.SpellID)
  if (!(colors instanceof Set) || colors.size == 0) return

  const markSpellID = Number(context.FromID || context.SpellID)
  const markCards =
    context.game.room
      ?.refreshPlayerSnapshot()
      .filter(
        (card) =>
          card.location === 'player' &&
          card.subZone === 'mark' &&
          Number(card.spellID) === markSpellID &&
          card.isKnown === true &&
          card.id > 0 &&
          colors.has(card.color)
      ) ?? []
  const spellCardIDs = markCards.map((card) => card.id)

  // 同色候选数与协议张数不一致时无法唯一确认，保留暗牌语义交给 tracker 收敛。
  if (spellCardIDs.length != context.CardCount) return
  context.CardIDs.splice(0, context.CardIDs.length, ...spellCardIDs)
}
