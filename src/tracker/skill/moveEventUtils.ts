import { CARD_INSTANCE_STATUS } from '../CardCounter'
import type { Room } from '../Room'

export type MoveEventDraft = any

export function getRaw(event: MoveEventDraft): any {
  return event.raw ?? event.options?.sourceEvent?.raw ?? {}
}

export function getCount(event: MoveEventDraft): number {
  return Math.max(0, Number(event.cardCount ?? event.options?.cardCount ?? 0))
}

export function hasPositiveID(cardIDs: any[] = []): boolean {
  return cardIDs.some((id) => id > 0)
}

export function nextGroupID(room: Room, spellID: number | string, label: string): string {
  return `${label}_${spellID}_${++room.constraintGroupSeq}`
}

export function patchEvent(event: MoveEventDraft, patch: any = {}): MoveEventDraft {
  return {
    ...event,
    ...patch,
    cardIDs: patch.cardIDs ?? event.cardIDs,
    options: {
      ...event.options,
      ...(patch.options ?? {})
    }
  }
}

export function getSourceZoneCards(event: MoveEventDraft, room: Room): any[] {
  const zoneID = event.options?.fromZone
  return room.zones.get(zoneID)?.cards ?? []
}

export function getEventSourceCards(event: MoveEventDraft, room: Room): any[] {
  const count = getCount(event)
  const knownCards = room.findCardsByIDs(event.cardIDs)
  if (knownCards.length > 0) return knownCards.slice(0, count)

  const fromSeat = event.options?.fromSeatID
  if (fromSeat !== undefined && fromSeat !== null) {
    return getUnknownPlayerCards(room, fromSeat, count, event.options?.fromSubZone ?? 'hand')
  }

  return getTopFirstCards(getSourceZoneCards(event, room)).slice(0, count)
}

function getUnknownPlayerCards(
  room: Room,
  seatID: unknown,
  count: number,
  subZone = 'hand'
): any[] {
  const seat = Number(seatID)
  if (Number.isNaN(seat)) return []

  const playerCards: any[] = []
  if (!(count > 0)) return playerCards

  const unknownCards = room.counter?.cardsByStatus?.[CARD_INSTANCE_STATUS.UNKNOWN] ?? room.cards
  for (const card of unknownCards) {
    if (
      card.location === 'player' &&
      card.subZone === subZone &&
      card.seats.has(seat) &&
      card.isKnown !== true
    ) {
      playerCards.push(card)
      if (playerCards.length >= count) break
    }
  }

  return playerCards
}

export function getTopFirstCards(cards: any[] = []): any[] {
  return cards.slice().reverse()
}

export function createSourcePatch(event: MoveEventDraft, cards: any[]): Record<string, unknown> {
  if (hasPositiveID(event.cardIDs)) return {}
  return cards.length > 0 ? { sourceCards: cards } : {}
}

export function getPositiveIDs(cardIDs: any[] = []): number[] {
  return Array.from(new Set(cardIDs.map((id) => Number(id) || 0).filter((id) => id > 0)))
}
