import { cardManager } from '@/context'
import { Game } from '@/tracker'
import { POSITION_BOTTOM, POSITION_RANDOM, POSITION_TOP } from '@/tracker/candidate/cardPositions'

export function handleLegacyJieLiMove({
  CardIDs,
  CardCount,
  FromZone,
  ToZone,
  FromPosition,
  SpellID,
  from,
  to
}) {
  const hasNoPositiveID = !CardIDs.some((id) => id > 0)

  if (FromZone === 10 && ToZone === 10) {
    if (hasNoPositiveID) {
      from.pos = POSITION_BOTTOM
      to.pos = POSITION_TOP
    }

    to.add(from.remove(CardIDs))
  } else if (FromZone === 1 && ToZone === 10 && FromPosition === POSITION_RANDOM) {
    const spellCards = Game.getSpellState(SpellID)
    if (spellCards) {
      cardManager.pack(from.cards.slice(0, spellCards))
    }

    if (hasNoPositiveID) {
      from.pos = POSITION_BOTTOM
    }

    to.add(from.remove(CardIDs))
  } else if (FromZone === 5 && ToZone === 10) {
    Game.setSpellState(SpellID, to.add(from.remove(CardIDs)))
  } else if (FromZone === 10 && ToZone === 1 && FromPosition === POSITION_RANDOM) {
    const spellCards = Game.getSpellState(SpellID)

    if (
      hasNoPositiveID &&
      spellCards?.length === CardCount &&
      spellCards.every((card) => from.cards.includes(card))
    ) {
      const cards = []

      for (const card of spellCards) {
        const index = from.cards.indexOf(card)
        if (index !== -1) {
          cards.push(from.cards.splice(index, 1)[0])
        }
      }

      cardManager.pack(to.add(cards))
      const ids = cards.map((card) => card.key)

      if (ids.every((id) => id > 0)) {
        CardIDs.splice(0, CardCount, ...ids)
      }
    } else {
      to.add(from.remove(CardIDs))
    }
    Game.deleteSpellState(SpellID)
  } else {
    to.add(from.remove(CardIDs))
  }
}
