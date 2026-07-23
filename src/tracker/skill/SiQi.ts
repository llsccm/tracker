import { POSITION_RANDOM } from '../candidate/cardPositions'
import { trackerLogger } from '@/utils/logger'
import type { Room } from '../Room'

type MoveEventDraft = any

const SI_QI_SPELL_ID = 3543

function getRaw(event: MoveEventDraft): any {
  return event.raw ?? event.options?.sourceEvent?.raw ?? {}
}

function getCount(event: MoveEventDraft): number {
  return Math.max(0, Number(event.cardCount ?? event.options?.cardCount ?? 0))
}

function hasPositiveID(cardIDs: any[] = []): boolean {
  return cardIDs.some((id) => id > 0)
}

function patchEvent(event: MoveEventDraft, sourceCards: any[], combinationID: string) {
  return {
    ...event,
    cardIDs: event.cardIDs,
    options: {
      ...event.options,
      sourceCards,
      combinationID
    }
  }
}

function nextGroupID(room: Room): string {
  return `siqi_candidate_${SI_QI_SPELL_ID}_${++room.constraintGroupSeq}`
}

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
  const sourceCards = room.zones.get(event.options?.fromZone)?.cards ?? []

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

  const decorated = patchEvent(event, selectedCards, nextGroupID(room))

  trackerLogger.debug('思泣来源牌推断', {
    cardCount,
    selectedCardIDs: selectedCards.map((card) => card.id),
    fallbackCount: Math.max(0, cardCount - selectedCards.length)
  })

  return decorated
}
