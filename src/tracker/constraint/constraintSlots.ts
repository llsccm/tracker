import {
  createLocationCandidateKey,
  parseLocationCandidateKey
} from '../candidate/locationCandidate'
import type { Card } from '@/tracker/model/Card'
import type { ConstraintGroup, SlotCountRange } from './ConstraintGroup'
import type { LocationCandidate } from '../types'

export interface ConstraintSlotState {
  location: LocationCandidate
  range: SlotCountRange
  exactCards: Card[]
  candidateCards: Card[]
  remainingMin: number
  remainingMax: number
}

export interface ConstraintHandSlotState extends ConstraintSlotState {
  group: ConstraintGroup
}

/** 消元、明牌槽位与暗实体覆盖共用的位置占用读面，不修改牌或组。 */
export function getConstraintSlotState(
  cards: Iterable<Card>,
  location: LocationCandidate,
  range: SlotCountRange
): ConstraintSlotState {
  const key = createLocationCandidateKey(location)
  const exactCards: Card[] = []
  const candidateCards: Card[] = []
  for (const card of cards) {
    if (card.suspended) continue
    if (card.hasLocationCandidates()) {
      if (card.hasLocationCandidate(key)) {
        // 公共端点与容器保留单值候选作为确定位置读面，同样已占用名额。
        if (card.locationCandidates.length === 1) exactCards.push(card)
        else candidateCards.push(card)
      }
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
    range,
    exactCards,
    candidateCards,
    remainingMin: Math.max(0, range.min - exactCards.length),
    remainingMax: Math.max(0, range.max - exactCards.length)
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
