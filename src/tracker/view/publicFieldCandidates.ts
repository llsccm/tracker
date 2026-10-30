import { isAmbiguousKnownCard } from '../projection/AmbiguousKnownIndex'
import type { Card } from '@/tracker/model'
import type { DirtyCardEvent, Room } from '../Room'

// 视图私有消费状态：不清理 Room.dirtyCards，只记录本视图处理到哪一次卡牌变更。
const dirtyCardCursors = new WeakMap<Room, { events: DirtyCardEvent[]; seq: number }>()
const supplementalCandidateCards = new WeakMap<Room, Set<Card>>()

export function getPublicFieldCandidateCards(room: Room): Card[] {
  const cardsByID = new Map<number, Card>()
  const indexedItems = room.ambiguousKnownIndex.items
  const indexedCards = Array.from(indexedItems.values(), ({ card }) => card).filter((card) =>
    isAmbiguousKnownCard(card)
  )

  const scannedCards = collectSupplementalCandidateCards(room, indexedItems)

  const ambiguousCards = [...indexedCards, ...scannedCards]

  ambiguousCards.forEach((card) => {
    if (card.id > 0) cardsByID.set(card.id, card)
  })

  // 候选过宽或旧牌堆世代失效都会暂停具体位置追踪；这些身份仍应在“场上候选”中展示。
  room.suspendedKnownCards.forEach((card) => {
    if (card.id > 0 && card.isKnown) cardsByID.set(card.id, card)
  })

  return Array.from(cardsByID.values())
}

function collectSupplementalCandidateCards(
  room: Room,
  indexedItems: Room['ambiguousKnownIndex']['items']
): Card[] {
  const supplementalCards = getSupplementalCandidateSet(room)
  const { cards, overflowed } = consumeDirtyCardsSinceLastRender(room)

  if (overflowed) {
    supplementalCards.clear()
  }

  Array.from(new Set(cards)).forEach((card) => {
    if (isMissingPublicFieldCandidate(card, indexedItems)) {
      supplementalCards.add(card)
    } else {
      supplementalCards.delete(card)
    }
  })

  return Array.from(supplementalCards).filter((card) => {
    const active = isMissingPublicFieldCandidate(card, indexedItems)
    if (!active) supplementalCards.delete(card)
    return active
  })
}

function getSupplementalCandidateSet(room: Room): Set<Card> {
  let cards = supplementalCandidateCards.get(room)
  if (!cards) {
    cards = new Set()
    supplementalCandidateCards.set(room, cards)
  }

  return cards
}

function consumeDirtyCardsSinceLastRender(room: Room): { cards: Card[]; overflowed: boolean } {
  const cursor = dirtyCardCursors.get(room)
  const lastSeq = cursor?.seq ?? 0
  const bufferChanged = cursor !== undefined && cursor.events !== room.dirtyCardEvents
  const latestSeq = room.dirtyCardSeq

  if (!bufferChanged && latestSeq <= lastSeq) {
    return { cards: [], overflowed: false }
  }

  dirtyCardCursors.set(room, { events: room.dirtyCardEvents, seq: latestSeq })

  const events = room.dirtyCardEvents
  const firstEventSeq = events[0]?.seq
  const hasLostEvents = bufferChanged || events.length === 0 || firstEventSeq > lastSeq + 1

  if (hasLostEvents) {
    // 牌堆重建或事件日志被裁剪时重建缓存；常规路径只消费上次渲染后的事件。
    return { cards: Array.from(room.dirtyCards), overflowed: true }
  }

  return {
    cards: events.filter((event) => event.seq > lastSeq).map((event) => event.card),
    overflowed: false
  }
}

function isMissingPublicFieldCandidate(
  card: Card,
  indexedItems: Room['ambiguousKnownIndex']['items']
): boolean {
  return isPublicFieldCandidateCard(card) && indexedItems.get(card.id)?.card !== card
}

function isPublicFieldCandidateCard(card: Card): boolean {
  return (
    card.location === 'player' && card.subZone === 'hand' && card.isKnown && card.seats.size > 1
  )
}
