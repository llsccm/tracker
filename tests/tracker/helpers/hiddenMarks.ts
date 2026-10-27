import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import type { Room } from '@/tracker/Room'
import type { SeatID, SpellID } from '@/tracker/types'

export function moveKnownCardsToHand(room: Room, cardIDs: number[], seatID: SeatID): void {
  room.moveCards(cardIDs, {
    from: { type: 'public', zone: 'pile', position: POSITION_TOP },
    to: { type: 'player', seatID: seatID, subZone: 'hand' },
    cardCount: cardIDs.length,
    sourceEvent: { type: 'test:known-hand' }
  })
}

export function moveUnknownCardsToHand(room: Room, count: number, seatID: SeatID): void {
  room.moveCards(Array(count).fill(0), {
    from: { type: 'public', zone: 'pile', position: POSITION_TOP },
    to: { type: 'player', seatID: seatID, subZone: 'hand' },
    cardCount: count,
    sourceEvent: { type: 'test:unknown-hand' }
  })
}

export function moveHiddenHandToMark(
  room: Room,
  { seatID, count, spellID }: { seatID: SeatID; count: number; spellID: SpellID }
): void {
  room.moveCards(Array(count).fill(0), {
    from: { type: 'player', seatID: seatID, subZone: 'hand' },
    to: { type: 'player', seatID: seatID, subZone: 'mark', markSpellID: spellID },
    triggerSpellID: spellID,
    cardCount: count,
    sourceEvent: { type: 'test:hidden-mark' }
  })
}
