import { Room } from '@/tracker/Room'
import { createNoopGameState } from './noopRuntime'

interface CreateTestRoomOptions {
  cardIDs?: number[]
  seatIDs?: number[]
  currentUserID?: number
  /** 仅用于历史正 ID 暗实体异常和遍历成本对照；普通测试保持匿名初始化。 */
  materializeDeckIdentities?: boolean
}

export function createTestRoom({
  cardIDs = [],
  seatIDs = [1, 2],
  currentUserID = seatIDs[0],
  materializeDeckIdentities = false
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
    }
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

  return { room, gameState }
}

export function getCard(room: Room, id: number) {
  const existing = room.cardIndex.get(id)
  if (existing) return existing

  const target = room.zones.get('pile')?.cards.find((card) => card.isAnonymous) ?? null
  const card = room.materialize(id, target)
  if (card) room.applyPileIdentityReveal([id])
  return card
}

/** 领域单元测试取一个未分配身份的物理槽，不按 CardID 猜测暗牌。 */
export function takeAnonymousCard(room: Room) {
  const card = room.zones.get('pile')!.cards.find((card) => card.isAnonymous)
  if (!card) throw new Error('测试牌堆缺少匿名槽')
  room.clearCardsFromPublicZones([card])
  return card
}

export function getSuspendedIdentityIDs(room: Room): number[] {
  return Array.from(room.suspendedKnownCards, (card) => card.id).sort((left, right) => left - right)
}
