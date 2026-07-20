import { Room } from '@/tracker/Room'
import { isAnonymous } from '@/tracker/Card'
import { createNoopGameState } from './noopRuntime'

interface CreateTestRoomOptions {
  cardIDs?: number[]
  seatIDs?: number[]
  currentUserID?: number
  materializeDeckIdentities?: boolean
}

export function createTestRoom({
  cardIDs = [],
  seatIDs = [1, 2],
  currentUserID = seatIDs[0],
  materializeDeckIdentities = true
}: CreateTestRoomOptions = {}) {
  const gameState = createNoopGameState()
  const room = new Room({ gameState })
  const infos = seatIDs.map((seatID) => ({
    SeatID: seatID,
    seat_id: seatID,
    user_temp_id: seatID,
    ClientID: seatID
  }))

  room.registerPlayers(infos, currentUserID)
  room.setFirstHand(seatIDs[0])

  if (cardIDs.length > 0) {
    room.initDeck(cardIDs)
    if (materializeDeckIdentities) {
      const pileCards = [...room.zones.get('pile')!.cards]
      cardIDs.forEach((cardID, index) => {
        const card = room.materialize(cardID, pileCards[index])
        if (card) card.isKnown = false
      })
      room.counter.update()
      room.dirtyCards.clear()
      room.dirtyCardEvents = []
      room.dirtyCardSeq = 0
      room.dirtyPublicZones.clear()
      room.cardChangeEvents = []
      room.viewDirty = false
      room.locationIndex.rebuild(room)
      room.ambiguousKnownIndex.rebuild([])
      room.rebuildPlayerSnapshot()
    }
  }

  return { room, gameState }
}

export function getCard(room: Room, id: number) {
  const existing = room.cardIndex.get(id)
  if (existing) return existing

  const target = room.zones.get('pile')?.cards.find(isAnonymous) ?? null
  return room.materialize(id, target)
}
