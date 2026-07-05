import { Game } from '@/tracker'
import { POSITION_RANDOM } from '@/tracker/candidate/cardPositions'

export function handleLegacyWenGuaMove({
  CardIDs,
  CardCount,
  FromID,
  FromZone,
  ToZone,
  FromPosition,
  SpellID,
  from,
  to
}) {
  if (FromZone == 5 && FromPosition == POSITION_RANDOM && CardCount == 1) {
    if (ToZone == 5 && FromID == Game.currentID) {
      Game.setSpellState(SpellID, to.add(from.remove(CardIDs))[0])
    } else {
      const spellCard = Game.getSpellState(SpellID)
      if (ToZone == 1 && FromID != Game.currentID && from.cards.includes(spellCard)) {
        const id = to.add(from.cards.splice(from.cards.indexOf(spellCard), 1))[0]?.key

        if (id > 0 && CardIDs.filter((id) => id > 0).length == 0) {
          CardIDs[0] = id
        }

        Game.deleteSpellState(SpellID)
      } else {
        to.add(from.remove(CardIDs))
      }
    }
  } else {
    to.add(from.remove(CardIDs, SpellID))
  }
}
