import { Room } from '@/tracker/Room'
import { POSITION_TOP } from '@/tracker/candidate/cardPositions'
import type { Card } from '@/tracker/model/Card'
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
    room.viewDirty = false
    room.locationIndex.rebuild(room)
    room.ambiguousKnownIndex.rebuild([])
    room.rebuildPlayerSnapshot()
  }

  return { room, gameState }
}

export function getCard(room: Room, id: number, { reveal = true } = {}) {
  const existing = room.cardIndex.get(id)
  if (existing) return existing

  const target = room.zones.get('pile')?.cards.find((card) => card.isAnonymous) ?? null
  const card = room.materialize(id, target)
  if (card && reveal) room.applyPileIdentityReveal([id])
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

/** 配置弃牌牌面后调用，按传入顺序逐张入堆，最后一张位于堆顶。 */
export function seedDiscardCards(room: Room, cards: Card[]): void {
  room.clearCardsFromPublicZones(cards)
  cards.forEach((card) => room.zones.get('discard')!.add(card, POSITION_TOP))
  room.applyPileIdentityReveal(
    cards.map((card) => card.id),
    'discard'
  )
}

interface TestHandOptions {
  knownIDs?: number[]
  hiddenCount?: number
  /** 历史正 ID 暗实体回归专用；普通暗牌使用 hiddenCount。 */
  hiddenIDs?: number[]
  observeCount?: number
}

export function bindTestHand(
  room: Room,
  seatID: number,
  { knownIDs = [], hiddenCount = 0, hiddenIDs = [], observeCount }: TestHandOptions = {}
) {
  const knownCards = knownIDs.map((id) => getCard(room, id)!)
  const hiddenCards = hiddenIDs.map((id) => getCard(room, id, { reveal: false })!)
  room.clearCardsFromPublicZones([...knownCards, ...hiddenCards])
  for (let index = 0; index < hiddenCount; index++) hiddenCards.push(takeAnonymousCard(room))
  knownCards.forEach((card) => card.bindCandidates([seatID], 'hand', null, { known: true }))
  hiddenCards.forEach((card) => {
    card.bindCandidates([seatID], 'hand', null, { known: false })
    card.isKnown = false
  })
  if (observeCount !== undefined) room.getPlayer(seatID)!.syncObservedHandCount(observeCount)
  room.applyPileIdentityReveal(knownIDs, 'outside')
  return { knownCards, hiddenCards }
}

export function getHandCards(room: Room, seatID: number): Card[] {
  return room.cards.filter(
    (card) => card.location === 'player' && card.subZone === 'hand' && card.seats.has(seatID)
  )
}

export function getHandCardIDs(room: Room, seatID: number): number[] {
  return getHandCards(room, seatID)
    .map((card) => card.id)
    .sort((left, right) => left - right)
}
