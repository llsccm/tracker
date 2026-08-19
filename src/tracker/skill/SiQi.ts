import { POSITION_RANDOM } from '../candidate/cardPositions'
import { trackerLogger } from '@/utils/logger'
import type { Room } from '../Room'
import {
  getCount,
  getRaw,
  getSourceZoneCards,
  hasPositiveID,
  nextGroupID,
  type MoveEventDraft,
  patchEvent
} from './moveEventUtils'

const SI_QI_SPELL_ID = 3543

export default function decorateSiQi(event: MoveEventDraft, room: Room): MoveEventDraft {
  const raw = getRaw(event)
  if (
    Number(raw.FromZone) !== 2 ||
    Number(raw.ToZone) !== 1 ||
    Number(raw.MoveType) !== 15 ||
    Number(raw.FromPosition) !== POSITION_RANDOM ||
    hasPositiveID(event.cardIDs)
  ) {
    return event
  }

  const cardCount = getCount(event)
  const sourceCards = getSourceZoneCards(event, room)

  // 弃牌区按展示顺序（顶 -> 底）挑红色牌作为思泣来源实体候选。
  const selectedCards: any[] = []
  for (
    let index = sourceCards.length - 1;
    index >= 0 && selectedCards.length < cardCount;
    index--
  ) {
    const card = sourceCards[index]
    if (card.color === 1 || card.color === 2) selectedCards.push(card)
  }

  if (selectedCards.length === 0) return event

  const decorated = patchEvent(event, {
    options: {
      sourceCards: selectedCards,
      combinationID: nextGroupID(room, SI_QI_SPELL_ID, 'siqi_candidate')
    }
  })

  trackerLogger.debug('思泣来源牌推断', {
    cardCount,
    selectedCardIDs: selectedCards.map((card) => card.id),
    fallbackCount: Math.max(0, cardCount - selectedCards.length)
  })

  return decorated
}
