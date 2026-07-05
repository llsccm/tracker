import { getPlayerLocationCandidates } from './locationCandidate'
import { recordTraversal } from '../traversalStats'
import type { Card } from '../Card'

export type HandSlotKind = 'known' | 'candidate'

export interface HandSlotCards {
  knownCards: Card[]
  candidateCards: Card[]
}

/**
 * 判定一张已知玩家牌在某座位上占用的手牌槽类型。
 */
export function getHandSlotKindForSeat(card: Card, seatID: number): HandSlotKind | null {
  if (card.location !== 'player' || card.isKnown !== true) return null

  const normalizedSeatID = Number(seatID)
  const locationCandidates = card.hasLocationCandidates?.()
    ? getPlayerLocationCandidates(card.getLocationCandidates())
    : []
  const handLocationCandidates = locationCandidates.filter(
    (candidate) => candidate.seatID === normalizedSeatID && candidate.subZone === 'hand'
  )

  if (handLocationCandidates.length > 0) {
    return card.getLocationCandidates().length === 1 ? 'known' : 'candidate'
  }

  const hasSubZoneCandidates = card.hasSubZoneCandidates?.() === true

  if (card.subZone === 'hand' && !hasSubZoneCandidates && card.seats.has(normalizedSeatID)) {
    return card.seats.size === 1 ? 'known' : 'candidate'
  }

  if (
    card.hasSubZoneCandidate?.({
      seatID: normalizedSeatID,
      subZone: 'hand',
      spellID: null
    })
  ) {
    return 'candidate'
  }

  return null
}

/**
 * 按座位收集确定/候选手牌槽位牌。
 */
export function collectHandSlotCardsBySeat(
  cards: Card[],
  seatIDs: Iterable<number>
): Map<number, HandSlotCards> {
  recordTraversal('handSlotCounts:collectBySeat', cards.length)
  const cardsBySeat = new Map<number, HandSlotCards>()
  for (const seatID of seatIDs) {
    cardsBySeat.set(Number(seatID), {
      knownCards: [],
      candidateCards: []
    })
  }

  for (const card of cards) {
    if (card.location !== 'player' || card.isKnown !== true) continue

    const hasLocationCandidates = card.hasLocationCandidates?.() === true
    const hasSubZoneCandidates = card.hasSubZoneCandidates?.() === true
    if (card.subZone !== 'hand' && !hasLocationCandidates && !hasSubZoneCandidates) continue

    cardsBySeat.forEach((slotCards, seatID) => {
      const handSlotKind = getHandSlotKindForSeat(card, seatID)
      if (handSlotKind === 'known') {
        slotCards.knownCards.push(card)
      } else if (handSlotKind === 'candidate') {
        slotCards.candidateCards.push(card)
      }
    })
  }

  return cardsBySeat
}
