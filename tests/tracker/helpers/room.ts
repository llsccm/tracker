import { Room } from '@/tracker/Room'
import { createNoopGameState } from './noopRuntime'

interface CreateTestRoomOptions {
  cardIDs?: number[]
  seatIDs?: number[]
  currentUserID?: number
}

export function createTestRoom({
  cardIDs = [],
  seatIDs = [1, 2],
  currentUserID = seatIDs[0]
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
  }

  return { room, gameState }
}

export function getCard(room: Room, id: number) {
  return room.cardIndex.get(id)
}
