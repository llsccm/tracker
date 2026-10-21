import { createLocationCandidateKey, parseLocationCandidateKey } from './locationCandidate'
import type { Card } from '../Card'
import type { ConstraintGroup } from '../ConstraintGroup'
import type { LocationCandidate } from '../types'

export interface ConstraintSlotState {
  location: LocationCandidate
  expectedCount: number
  exactCards: Card[]
  candidateCards: Card[]
  remainingCount: number
}

export interface ConstraintHandSlotState extends ConstraintSlotState {
  group: ConstraintGroup
}

/** 消元、明牌槽位与暗实体覆盖共用的位置占用读面，不修改牌或组。 */
export function getConstraintSlotState(
  cards: Iterable<Card>,
  location: LocationCandidate,
  expectedCount: number
): ConstraintSlotState {
  const key = createLocationCandidateKey(location)
  const exactCards: Card[] = []
  const candidateCards: Card[] = []
  for (const card of cards) {
    if (card.suspended) continue
    if (card.hasLocationCandidates()) {
      if (card.hasLocationCandidate(key)) candidateCards.push(card)
      continue
    }

    if (
      card.getPossibleLocations().some((candidate) => createLocationCandidateKey(candidate) === key)
    ) {
      exactCards.push(card)
    }
  }
  return {
    location,
    expectedCount,
    exactCards,
    candidateCards,
    remainingCount: Math.max(0, expectedCount - exactCards.length)
  }
}

export function collectConstraintHandSlots(
  groups: Iterable<ConstraintGroup>
): ConstraintHandSlotState[] {
  const slots: ConstraintHandSlotState[] = []
  for (const group of groups) {
    group.expectedSlotsByLocation.forEach((count, key) => {
      const location = parseLocationCandidateKey(key)
      if (location?.type !== 'player' || location.subZone !== 'hand') return
      slots.push({ ...getConstraintSlotState(group.cards, location, count), group })
    })
  }
  return slots
}
