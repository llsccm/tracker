import type { Room } from '@/tracker/Room'
import type { SeatID, SpellID } from '@/tracker/types'

export function moveKnownCardsToHand(room: Room, cardIDs: number[], seatID: SeatID): void {
  room.moveCards(cardIDs, 'player', {
    toSeatID: seatID,
    subZone: 'hand',
    fromZone: 'pile',
    cardCount: cardIDs.length,
    sourceEvent: { type: 'test:known-hand' }
  })
}

export function moveUnknownCardsToHand(room: Room, count: number, seatID: SeatID): void {
  room.moveCards(Array(count).fill(0), 'player', {
    toSeatID: seatID,
    subZone: 'hand',
    fromZone: 'pile',
    cardCount: count,
    sourceEvent: { type: 'test:unknown-hand' }
  })
}

export function moveHiddenHandToMark(
  room: Room,
  { seatID, count, spellID }: { seatID: SeatID; count: number; spellID: SpellID }
): void {
  room.moveCards(Array(count).fill(0), 'player', {
    toSeatID: seatID,
    fromSeatID: seatID,
    fromZone: 5,
    fromSubZone: 'hand',
    subZone: 'mark',
    spellID,
    cardCount: count,
    sourceEvent: { type: 'test:hidden-mark' }
  })
}
