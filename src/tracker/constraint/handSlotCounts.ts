import { getPlayerLocationCandidates } from '../candidate/locationCandidate'
import { recordTraversal } from '../traversalStats'
import type { Card } from '@/tracker/model'

export type HandSlotKind = 'known' | 'candidate'

export interface HandSlotCards {
  knownCards: Card[]
  candidateCards: Card[]
  exactHiddenCards: Card[]
}

/**
 * 判定一张已知玩家牌在某座位上占用的手牌槽类型。
 */
export function getHandSlotKindForSeat(card: Card, seatID: number): HandSlotKind | null {
  if (card.location !== 'player' || card.isKnown !== true) return null

  const locations = card.getPossibleLocations()
  const hasHand = getPlayerLocationCandidates(locations).some(
    (candidate) => candidate.seatID === seatID && candidate.subZone === 'hand'
  )
  if (!hasHand) return null
  return locations.length === 1 ? 'known' : 'candidate'
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
      candidateCards: [],
      exactHiddenCards: []
    })
  }

  for (const card of cards) {
    if (card.location !== 'player' || card.suspended) continue

    if (!card.isKnown) {
      // 同一 owner 下仍有 hand/mark 等候选时，不是确定暗手牌。
      if (!card.hasLocationCandidates() && card.subZone === 'hand' && card.owner !== null) {
        cardsBySeat.get(card.owner)?.exactHiddenCards.push(card)
      }
      continue
    }

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
