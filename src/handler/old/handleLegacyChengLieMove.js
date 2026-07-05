import { cardManager } from '@/context'
import { POSITION_BOTTOM } from '@/tracker/candidate/cardPositions'

export function handleLegacyChengLieMove({ CardIDs, FromZone, ToZone, SpellID, from, to }) {
  // 旧版 fallback；新版主动记牌器的跨事件差分实现见 refactor/moveEventHandlers.js。
  if (FromZone == 10 && ToZone == 5 && CardIDs.filter((id) => id > 0).length === 0) {
    from.pos = POSITION_BOTTOM
    cardManager.pack(from.cards.slice(0, from.length - 1))
    to.add(from.remove(CardIDs))
  } else {
    to.add(from.remove(CardIDs, SpellID))
  }
}
